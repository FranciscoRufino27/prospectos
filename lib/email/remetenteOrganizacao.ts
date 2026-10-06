import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  lerCredenciaisGmail,
  verificarCredenciaisGmail,
  type GmailCredenciais,
  type VerificacaoGmail,
} from '@/lib/engine/email/gmailProvider'
import { cifrar, decifrar } from '@/lib/seguranca/criptografia'
import { mesclarWorkspaceConfig, parseWorkspaceConfig, type WorkspaceConfig } from '@/lib/config/workspaceConfig'

// Remetente de e-mail de UMA organização — regra única para campanhas, Central,
// propostas, convites, envio de teste e leitura da caixa (respostas/bounces).
// Ordem:
//   1. conta conectada pela própria organização (Configurações > Distribuição >
//      E-mail de envio): tabela organizacao_remetentes_email (0066), senha cifrada;
//   2. legado: nomenclaturas.email_conta_key → GMAIL_USER_<CHAVE> no ambiente
//      (só para quem já tinha; o navegador não altera mais essa chave);
//   3. nada: cada chamador decide (prospecção bloqueia; os demais usam a conta
//      padrão da plataforma, como antes).
// Conta configurada mas inutilizável (senha ilegível, chave sem credencial)
// é "incompleto": bloqueia — nunca cai em silêncio na conta de outra operação.
// `org` vem sempre da sessão ou do iterador interno do motor.

export const TABELA_REMETENTES = 'organizacao_remetentes_email'

export type FonteRemetente = 'conectada' | 'legada' | 'padrao'

export interface RemetenteOrganizacao {
  fonte: FonteRemetente
  /** Identificação para logs/UI — nunca segredo ('conectada', a chave legada ou 'followup'). */
  conta: string
  email: string
  credenciais: GmailCredenciais
}

export type SituacaoRemetente =
  | { estado: 'pronto'; remetente: RemetenteOrganizacao; verificadoEm: string | null }
  | { estado: 'incompleto'; fonte: 'conectada' | 'legada'; email: string | null; mensagem: string }
  | { estado: 'ausente' }

export interface DepsRemetente {
  lerCredenciais?: (chave: string) => GmailCredenciais | null
  decifrar?: (valor: string) => string
  /** Config já lida pelo chamador (evita reler organizacoes). */
  config?: WorkspaceConfig
}

// Migration 0066 ainda não aplicada: comporta-se como "sem conta conectada".
function tabelaAusente(error: { code?: string; message?: string }): boolean {
  return error.code === '42P01' || error.code === 'PGRST205'
    || /does not exist|could not find the table/i.test(error.message ?? '')
}

export async function situacaoRemetenteOrganizacao(
  db: SupabaseClient,
  org: string,
  deps: DepsRemetente = {},
): Promise<SituacaoRemetente> {
  const { data, error } = await db
    .from(TABELA_REMETENTES)
    .select('email, senha_cifrada, verificado_em')
    .eq('organizacao_id', org)
    .maybeSingle()
  if (error && !tabelaAusente(error)) {
    throw new Error(`Remetente da organização indisponível: ${error.message}`)
  }
  const linha = error ? null : (data as { email: string; senha_cifrada: string; verificado_em: string | null } | null)
  if (linha) {
    try {
      const appPassword = (deps.decifrar ?? decifrar)(linha.senha_cifrada)
      return {
        estado: 'pronto',
        remetente: { fonte: 'conectada', conta: 'conectada', email: linha.email, credenciais: { user: linha.email, appPassword } },
        verificadoEm: linha.verificado_em ?? null,
      }
    } catch {
      return {
        estado: 'incompleto',
        fonte: 'conectada',
        email: linha.email,
        mensagem: `Envio bloqueado: a senha salva da conta ${linha.email} não pôde ser lida. Conecte a conta de novo em Configurações > Distribuição.`,
      }
    }
  }

  let config = deps.config
  if (!config) {
    const { data: orgRow, error: orgError } = await db
      .from('organizacoes')
      .select('configuracoes')
      .eq('id', org)
      .maybeSingle()
    if (orgError) throw orgError
    config = parseWorkspaceConfig((orgRow as { configuracoes?: unknown } | null)?.configuracoes)
  }
  const chave = config.nomenclaturas?.email_conta_key?.trim()
  if (chave) {
    const cred = (deps.lerCredenciais ?? lerCredenciaisGmail)(chave)
    if (cred) {
      return { estado: 'pronto', remetente: { fonte: 'legada', conta: chave, email: cred.user, credenciais: cred }, verificadoEm: null }
    }
    return {
      estado: 'incompleto',
      fonte: 'legada',
      email: null,
      mensagem: `Envio bloqueado: credencial Gmail dedicada '${chave}' não configurada.`,
    }
  }
  return { estado: 'ausente' }
}

/** Conta DEDICADA da organização (conectada ou legada) — nunca a padrão da plataforma. */
export async function remetenteDedicado(
  db: SupabaseClient,
  org: string,
  deps: DepsRemetente = {},
): Promise<RemetenteOrganizacao | null> {
  const s = await situacaoRemetenteOrganizacao(db, org, deps)
  return s.estado === 'pronto' ? s.remetente : null
}

/**
 * Para envios que aceitam a conta padrão: a dedicada; configurada mas
 * inutilizável → null (bloqueia); nenhuma → conta padrão ('followup').
 */
export async function remetenteComPadrao(
  db: SupabaseClient,
  org: string,
  deps: DepsRemetente = {},
): Promise<RemetenteOrganizacao | null> {
  const s = await situacaoRemetenteOrganizacao(db, org, deps)
  if (s.estado === 'pronto') return s.remetente
  if (s.estado === 'incompleto') return null
  const cred = (deps.lerCredenciais ?? lerCredenciaisGmail)('followup')
  return cred ? { fonte: 'padrao', conta: 'followup', email: cred.user, credenciais: cred } : null
}

// ---- Tela: status sem segredo, conectar e desconectar ----------------------

export interface StatusRemetentePublico {
  estado: 'conectado' | 'incompleto' | 'nao_configurado'
  /** conectada = pela tela; legada = configurada pela equipe da plataforma. */
  fonte: 'conectada' | 'legada' | null
  email: string | null
  verificadoEm: string | null
  mensagem: string | null
}

export function statusPublico(s: SituacaoRemetente): StatusRemetentePublico {
  if (s.estado === 'pronto') {
    return {
      estado: 'conectado',
      fonte: s.remetente.fonte === 'padrao' ? null : s.remetente.fonte,
      email: s.remetente.email,
      verificadoEm: s.verificadoEm,
      mensagem: null,
    }
  }
  if (s.estado === 'incompleto') {
    return {
      estado: 'incompleto',
      fonte: s.fonte,
      email: s.email,
      verificadoEm: null,
      // A chave legada é detalhe de infraestrutura: a tela só diz o que fazer.
      mensagem: s.fonte === 'conectada'
        ? 'A senha salva não pôde ser lida. Conecte a conta de novo.'
        : 'A conta configurada anteriormente não está disponível. Conecte a conta Gmail da organização.',
    }
  }
  return { estado: 'nao_configurado', fonte: null, email: null, verificadoEm: null, mensagem: null }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function normalizarEmailRemetente(valor: unknown): string | null {
  if (typeof valor !== 'string') return null
  const email = valor.trim().toLowerCase()
  return email.length <= 254 && EMAIL_RE.test(email) ? email : null
}

/** Senha de app do Google: 16 letras (o Google exibe em blocos de 4 — espaços são ignorados). */
export function normalizarSenhaApp(valor: unknown): string | null {
  if (typeof valor !== 'string') return null
  const senha = valor.replace(/\s+/g, '')
  return /^[a-zA-Z]{16}$/.test(senha) ? senha : null
}

export type ResultadoConexao =
  | { ok: true; status: StatusRemetentePublico }
  | { ok: false; status: number; erro: string }

export interface DepsConexao {
  verificar?: (cred: GmailCredenciais) => Promise<VerificacaoGmail>
  cifrar?: (texto: string) => string
  agora?: () => Date
}

export async function conectarRemetenteOrganizacao(
  db: SupabaseClient,
  org: string,
  entrada: { email?: unknown; senhaApp?: unknown },
  usuarioId: string | null,
  deps: DepsConexao = {},
): Promise<ResultadoConexao> {
  const email = normalizarEmailRemetente(entrada.email)
  if (!email) return { ok: false, status: 400, erro: 'Informe um e-mail válido.' }
  const senha = normalizarSenhaApp(entrada.senhaApp)
  if (!senha) {
    return {
      ok: false,
      status: 400,
      erro: 'A senha de app do Google tem 16 letras (ex.: abcd efgh ijkl mnop). A senha normal da conta não funciona aqui.',
    }
  }

  const verificacao = await (deps.verificar ?? verificarCredenciaisGmail)({ user: email, appPassword: senha })
  if (!verificacao.ok) {
    if (verificacao.motivo === 'autenticacao') {
      return {
        ok: false,
        status: 400,
        erro: 'O Gmail recusou o login. Confira o e-mail e use uma senha de app gerada com a verificação em 2 etapas ativa.',
      }
    }
    console.error('[remetente] falha de conexão ao verificar a conta Gmail:', { org, etapa: verificacao.etapa, erro: verificacao.mensagem })
    return { ok: false, status: 502, erro: 'Não foi possível falar com o Gmail agora. Tente de novo em instantes.' }
  }

  let senhaCifrada: string
  try {
    senhaCifrada = (deps.cifrar ?? cifrar)(senha)
  } catch (e) {
    console.error('[remetente] criptografia indisponível:', e instanceof Error ? e.message : e)
    return { ok: false, status: 500, erro: 'O servidor não está configurado para guardar a senha com segurança.' }
  }

  const agora = (deps.agora ?? (() => new Date()))().toISOString()
  const { error } = await db.from(TABELA_REMETENTES).upsert(
    {
      organizacao_id: org,
      provedor: 'gmail',
      email,
      senha_cifrada: senhaCifrada,
      verificado_em: agora,
      conectado_por: usuarioId,
      atualizado_em: agora,
    },
    { onConflict: 'organizacao_id' },
  )
  if (error) {
    console.error('[remetente] não salvou a conta:', error.message)
    return { ok: false, status: 500, erro: 'Não foi possível salvar a conta agora.' }
  }

  // A tela passa a ser a única fonte: a chave legada (ambiente) sai da config,
  // para "Remover" não ressuscitar uma conta antiga. Falha aqui só vai ao
  // log — a conta conectada já tem precedência.
  try {
    await removerChaveLegada(db, org)
  } catch (e) {
    console.error('[remetente] não removeu a chave legada:', e instanceof Error ? e.message : e)
  }

  return { ok: true, status: { estado: 'conectado', fonte: 'conectada', email, verificadoEm: agora, mensagem: null } }
}

// Tira nomenclaturas.email_conta_key da config da org (mantém o resto).
async function removerChaveLegada(db: SupabaseClient, org: string): Promise<void> {
  const { data: orgRow, error: orgError } = await db.from('organizacoes').select('configuracoes').eq('id', org).maybeSingle()
  if (orgError) throw new Error(orgError.message)
  const atual = parseWorkspaceConfig((orgRow as { configuracoes?: unknown } | null)?.configuracoes)
  if (atual.nomenclaturas?.email_conta_key === undefined) return
  const nomenclaturas = { ...atual.nomenclaturas }
  delete nomenclaturas.email_conta_key
  const { error } = await db
    .from('organizacoes')
    .update({ configuracoes: mesclarWorkspaceConfig(atual, { nomenclaturas }) })
    .eq('id', org)
  if (error) throw new Error(error.message)
}

/** Remove o remetente da org: a conta conectada E a chave legada, se houver. */
export async function desconectarRemetenteOrganizacao(db: SupabaseClient, org: string): Promise<void> {
  const { error } = await db.from(TABELA_REMETENTES).delete().eq('organizacao_id', org)
  if (error && !tabelaAusente(error)) throw new Error(error.message)
  await removerChaveLegada(db, org)
}
