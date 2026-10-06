// Provedor Gmail REAL: ENVIO via SMTP (nodemailer) e LEITURA via IMAP (imapflow).
// Implementa a mesma interface EmailProvider, então os fluxos não mudam ao trocar
// o simulado por este.
//
// Respeita MODO_ENSAIO: enquanto ensaio=true, NÃO envia (só loga) e NÃO marca
// mensagens como lidas. Para ativar de verdade, defina GMAIL_USER e
// GMAIL_APP_PASSWORD no .env.local (senha de app do Gmail) e MODO_ENSAIO=false.
import nodemailer, { type Transporter } from 'nodemailer'
import { ImapFlow } from 'imapflow'
import { simpleParser, type ParsedMail } from 'mailparser'
import { lerFalhaEntrega } from './dsn'
import type { AnexoEmail, EmailProvider } from './provider'
import type { MensagemRecebida } from '../types'
import { engineConfig } from '../config'
import { log } from '../logger'

// Padrões de assunto que indicam auto-resposta (férias/ausência/devolução).
const ASSUNTO_AUTO = [
  'fora do escrit', 'out of office', 'automatic reply', 'auto-reply', 'autoreply',
  'resposta autom', 'de férias', 'em férias', 'estou ausente', 'ausência',
  'undeliverable', 'mail delivery', 'returned mail', 'delivery status notification',
]

export const JANELA_PADRAO_RESPOSTAS_DIAS = 30

export function montarBuscaMensagensRecentes(
  agora: Date = new Date(),
  janelaDiasRaw: string | undefined = process.env.GMAIL_JANELA_RESPOSTAS_DIAS,
): { since: Date } {
  const valor = Number(janelaDiasRaw)
  const janelaDias = Number.isFinite(valor) && valor >= 1
    ? Math.min(90, Math.floor(valor))
    : JANELA_PADRAO_RESPOSTAS_DIAS
  return { since: new Date(agora.getTime() - janelaDias * 24 * 60 * 60 * 1_000) }
}

// Detecta auto-resposta pelos CABEÇALHOS (Auto-Submitted, X-Autoreply, Precedence)
// e, como reforço, pelo assunto. Os fluxos não enxergam cabeçalhos — por isso o
// provedor é o lugar certo para essa marcação.
function detectarAutomatica(parsed: ParsedMail): boolean {
  const h = parsed.headers
  const autoSubmitted = String(h.get('auto-submitted') ?? '').toLowerCase()
  if (autoSubmitted && autoSubmitted !== 'no') return true
  if (h.has('x-autoreply') || h.has('x-autorespond') || h.has('x-auto-response-suppress')) return true
  const precedence = String(h.get('precedence') ?? '').toLowerCase()
  if (['auto_reply', 'bulk', 'junk'].includes(precedence)) return true
  const assunto = (parsed.subject ?? '').toLowerCase()
  return ASSUNTO_AUTO.some((p) => assunto.includes(p))
}

function corpoTexto(parsed: ParsedMail): string {
  if (parsed.text && parsed.text.trim()) return parsed.text.trim()
  if (parsed.html) return parsed.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  return ''
}

export interface GmailCredenciais {
  user: string // conta Gmail remetente (ex.: francisco@gmail.com)
  appPassword: string // senha de app de 16 caracteres
}

// Papel da conta de e-mail (item 2.7): duas caixas separadas para não misturar
// reputação/inbox entre a 1ª abordagem (prospecção) e a cadência (follow-up).
// Aceita também chave livre (string) para conta por organização — ex.: 'LAUDO'
// lê GMAIL_USER_LAUDO / GMAIL_APP_PASSWORD_LAUDO. Mantém compatibilidade total
// com os papéis predefinidos.
export type PapelEmail = 'followup' | 'prospeccao'

// Credenciais Gmail por PAPEL ou chave livre por org. Lookup em cascata:
//   1. GMAIL_USER_<PREFIXO> / GMAIL_APP_PASSWORD_<PREFIXO>  (conta específica)
//   2. GMAIL_USER / GMAIL_APP_PASSWORD                       (conta padrão)
export function lerCredenciaisGmail(papel: PapelEmail | string = 'followup'): GmailCredenciais | null {
  const prefixo =
    papel === 'prospeccao' ? 'PROSPECCAO'
    : papel === 'followup'  ? 'FOLLOWUP'
    : papel.toUpperCase()
  const contaEspecifica = papel !== 'prospeccao' && papel !== 'followup'
  // Chaves por organização (ex.: LAUDO) são isoladas: se a credencial dedicada
  // estiver ausente, bloqueamos o envio em vez de cair silenciosamente na conta
  // padrão de outra operação. Os papéis legados mantêm o fallback compatível.
  const user = process.env[`GMAIL_USER_${prefixo}`]
    ?? (contaEspecifica ? undefined : process.env.GMAIL_USER)
  const appPassword = process.env[`GMAIL_APP_PASSWORD_${prefixo}`]
    ?? (contaEspecifica ? undefined : process.env.GMAIL_APP_PASSWORD)
  if (!user || !appPassword) return null
  return { user, appPassword }
}

export type VerificacaoGmail =
  | { ok: true }
  | { ok: false; etapa: 'smtp' | 'imap'; motivo: 'autenticacao' | 'conexao'; mensagem: string }

// Confere a conta antes de salvá-la (Configurações > E-mail de envio): login
// no SMTP (envio) e no IMAP (leitura das respostas), sem enviar nem ler nada.
// Nunca registra a senha; a mensagem de erro é a do servidor, sem credenciais.
export async function verificarCredenciaisGmail(cred: GmailCredenciais): Promise<VerificacaoGmail> {
  const falha = (etapa: 'smtp' | 'imap', e: unknown): VerificacaoGmail => {
    const err = e as { code?: string; responseCode?: number; authenticationFailed?: boolean; message?: string }
    const autenticacao = err?.code === 'EAUTH' || err?.responseCode === 535 || err?.authenticationFailed === true
      || /auth|credentials|invalid login/i.test(err?.message ?? '')
    return { ok: false, etapa, motivo: autenticacao ? 'autenticacao' : 'conexao', mensagem: (err?.message ?? String(e)).slice(0, 300) }
  }

  const smtp = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: cred.user, pass: cred.appPassword },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
  })
  try {
    await smtp.verify()
  } catch (e) {
    return falha('smtp', e)
  } finally {
    smtp.close()
  }

  const imap = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: cred.user, pass: cred.appPassword },
    logger: false,
    greetingTimeout: 15000,
    socketTimeout: 20000,
  })
  imap.on('error', () => { /* tratado pelo catch do connect */ })
  try {
    await imap.connect()
  } catch (e) {
    return falha('imap', e)
  }
  await imap.logout().catch(() => {})
  return { ok: true }
}

export class GmailProvider implements EmailProvider {
  private transporter: Transporter | null = null
  private recebimentosPendentes = new Map<string, { mailbox: string; uid: number }>()

  constructor(private cred: GmailCredenciais) {}

  private getTransporter(): Transporter {
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: { user: this.cred.user, pass: this.cred.appPassword },
      })
    }
    return this.transporter
  }

  async enviar(para: string, assunto: string, corpo: string, html?: string, cc?: string, anexos?: AnexoEmail[]): Promise<void> {
    // Nos logs, anexos só pelo nome — nunca o conteúdo.
    const nomesAnexos = anexos?.length ? { anexos: anexos.map((a) => a.nomeArquivo) } : {}
    if (engineConfig.modoEnsaio) {
      log.info('[ENSAIO] Gmail NÃO enviado (modoEnsaio)', { para, assunto, cc, ...nomesAnexos })
      return
    }
    const info = await this.getTransporter().sendMail({
      from: this.cred.user,
      to: para,
      subject: assunto,
      text: corpo, // fallback p/ clientes sem HTML
      ...(html ? { html } : {}),
      ...(cc ? { cc } : {}),
      ...(anexos?.length
        ? {
          attachments: anexos.map((a) => ({
            filename: a.nomeArquivo,
            content: Buffer.from(a.conteudo),
            contentType: a.tipo,
          })),
        }
        : {}),
    })
    log.ok('E-mail enviado via Gmail (SMTP)', {
      remetente: this.cred.user,
      para,
      cc,
      assunto,
      ...nomesAnexos,
      messageId: info.messageId,
    })
  }

  // Lê as mensagens RECENTES da INBOX e de [Gmail]/Spam via IMAP (imap.gmail.com:993).
  // Não depende da flag UNSEEN: Gmail/mobile/encaminhamentos podem marcar uma
  // resposta como lida antes que o motor a processe. A idempotência do fluxo,
  // baseada no estado persistido do lead, impede registrar a mesma resposta de novo.
  // Bounces de servidores externos (ex.: Office 365) frequentemente caem em Spam no
  // Gmail — não checar Spam causaria detecção zero em escala. Spam é lido na mesma
  // conexão; falha ao abrir a pasta de Spam é ignorada (não derruba a INBOX).
  // Em MODO_ENSAIO a leitura acontece normalmente, mas as mensagens NÃO são marcadas
  // como lidas para não mexer na caixa durante testes.
  async lerCaixaEntrada(): Promise<MensagemRecebida[]> {
    const client = new ImapFlow({
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      auth: { user: this.cred.user, pass: this.cred.appPassword },
      logger: false,
      greetingTimeout: 15000,
      socketTimeout: 30000,
    })
    client.on('error', (e: unknown) => {
      log.aviso('IMAP erro de conexão', { erro: e instanceof Error ? e.message : String(e) })
    })

    const mensagens: MensagemRecebida[] = []
    await client.connect()
    try {
      for (const mailbox of ['INBOX', '[Gmail]/Spam']) {
        await this.lerMailbox(client, mailbox, mensagens)
      }
    } finally {
      await client.logout()
    }

    return mensagens
  }

  async confirmarLeitura(mensagens?: MensagemRecebida[]): Promise<void> {
    // Em ensaio, a caixa continua intocada mesmo quando o fluxo é exercitado.
    if (engineConfig.modoEnsaio) return

    const porMailbox = new Map<string, number[]>()
    const idsConfirmados: string[] = []
    const ids = mensagens
      ? mensagens.flatMap((mensagem) => mensagem.idRecebimento ? [mensagem.idRecebimento] : [])
      : [...this.recebimentosPendentes.keys()]
    for (const idRecebimento of ids) {
      const ref = this.recebimentosPendentes.get(idRecebimento)
      if (!ref) continue
      const uids = porMailbox.get(ref.mailbox) ?? []
      uids.push(ref.uid)
      porMailbox.set(ref.mailbox, uids)
      idsConfirmados.push(idRecebimento)
    }
    if (porMailbox.size === 0) return

    const client = new ImapFlow({
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      auth: { user: this.cred.user, pass: this.cred.appPassword },
      logger: false,
      greetingTimeout: 15000,
      socketTimeout: 30000,
    })
    client.on('error', (e: unknown) => {
      log.aviso('IMAP erro ao confirmar leitura', { erro: e instanceof Error ? e.message : String(e) })
    })

    await client.connect()
    try {
      for (const [mailbox, uids] of porMailbox) {
        const lock = await client.getMailboxLock(mailbox)
        try {
          await client.messageFlagsAdd([...new Set(uids)], ['\\Seen'], { uid: true })
        } finally {
          lock.release()
        }
      }
    } finally {
      await client.logout()
    }
    for (const id of idsConfirmados) this.recebimentosPendentes.delete(id)
  }

  private async lerMailbox(
    client: ImapFlow,
    mailbox: string,
    resultado: MensagemRecebida[],
  ): Promise<void> {
    let lock: Awaited<ReturnType<ImapFlow['getMailboxLock']>> | null = null
    try {
      lock = await client.getMailboxLock(mailbox)
    } catch {
      // Pasta não existe nesta conta (ex.: conta sem Spam configurado). Silencioso.
      return
    }
    try {
      const uids = await client.search(montarBuscaMensagensRecentes(), { uid: true })
      if (!uids || uids.length === 0) {
        log.info('IMAP caixa consultada', { mailbox, mensagensRecentes: 0 })
        return
      }
      const limite = Math.max(1, Number(process.env.GMAIL_MAX_FETCH ?? '50') || 50)
      const recentes = uids.slice(-limite)
      if (uids.length > recentes.length) {
        log.aviso('IMAP: muitas mensagens recentes; processando só as mais novas', {
          mailbox, totalRecentes: uids.length, processando: recentes.length,
        })
      }
      for await (const m of client.fetch(recentes, { source: true, uid: true }, { uid: true })) {
        const fonte = m.source as Buffer
        const parsed = await simpleParser(fonte)
        const de = parsed.from?.value?.[0]?.address?.toLowerCase() ?? ''
        const idRecebimento = `${mailbox}\u0000${m.uid}`
        if (m.uid) this.recebimentosPendentes.set(idRecebimento, { mailbox, uid: m.uid })
        resultado.push({
          idRecebimento,
          // Message-ID é global e sobrevive a mudança de UIDVALIDITY do IMAP;
          // sem ele, mailbox+UID ainda distingue a mensagem nesta caixa.
          mensagemId: parsed.messageId?.trim() || idRecebimento,
          de,
          assunto: parsed.subject ?? '',
          corpo: corpoTexto(parsed),
          automatica: detectarAutomatica(parsed),
          em: parsed.date ?? new Date(),
          // A própria caixa aparece no aviso (remetente da mensagem original) e
          // nunca é o destinatário que falhou.
          falhaEntrega: lerFalhaEntrega(fonte.toString('utf8'), [this.cred.user]),
        })
      }
      log.info('IMAP caixa consultada', {
        mailbox,
        mensagensRecentes: recentes.length,
        aguardandoConfirmacao: recentes.length,
      })
    } finally {
      lock.release()
    }
  }
}
