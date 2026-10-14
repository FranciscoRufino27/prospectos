/**
 * Varre a caixa de e-mail de UMA organização atrás de avisos de falha de
 * entrega (bounce) e aplica o resultado no banco. Serve para os bounces que o
 * motor não conseguiu marcar: aviso que chegou antes de o lead existir (base
 * apagada e reimportada, como a da Laudos em 12/09/2026 — a idempotência por
 * mensagem, 0030, impede o motor de reler o aviso) ou anterior à migration 0062.
 *
 * Leitura da caixa: IMAP SOMENTE LEITURA (EXAMINE) nas pastas "Todos os
 * e-mails" e Spam. Nada é marcado como lido, movido ou apagado. O destinatário
 * que falhou vem da parte delivery-status (lib/engine/email/dsn.ts, o mesmo
 * leitor do motor). Aviso só de atraso (Action: delayed) é ignorado.
 *
 * ENSAIO por padrão — sem `--confirmar` só mostra o que faria.
 * Com `--confirmar`, numa transação única:
 *   - grava os endereços em `emails_invalidos` (origem 'varredura_caixa');
 *   - marca bounced=true nos leads da org com esses e-mails, qualquer owner
 *     (backup das linhas antes, em backups/);
 *   - cancela as workflow_execucoes ativas desses leads (sai da campanha);
 *   - registra a nota "Bounce SMTP detectado" (uma por lead — índice da 0032).
 *
 * Uso:
 *   npx tsx scripts/emails-invalidos-da-caixa.ts --org <uuid> --conta LAUDO [--desde 2026-06-01]
 *   npx tsx scripts/emails-invalidos-da-caixa.ts --org <uuid> --conta LAUDO --confirmar
 *
 * --conta é a chave das credenciais no .env.local: GMAIL_USER_<CONTA> e
 * GMAIL_APP_PASSWORD_<CONTA> (a mesma `email_conta_key` da organização).
 */
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import { ImapFlow } from 'imapflow'
import { anunciarModo, limiteSeguranca } from './_guarda'
import { lerFalhaEntrega } from '../lib/engine/email/dsn'

for (const l of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8').split(/\r?\n/)) {
  const i = l.indexOf('=')
  if (i <= 0 || l.trim().startsWith('#')) continue
  const k = l.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '')
}

function arg(nome: string): string | null {
  const i = process.argv.indexOf(`--${nome}`)
  return i >= 0 ? process.argv[i + 1] ?? null : null
}

const ORG_ARG = arg('org')
const CONTA = arg('conta')?.toUpperCase() ?? null
const DESDE = arg('desde') ? new Date(`${arg('desde')}T00:00:00Z`) : new Date(Date.now() - 90 * 24 * 3600_000)
// A org da Laudos tinha 85 endereços devolvidos em 2026; muito acima disso é
// sinal de filtro errado (ex.: caixa de outra operação).
const MAX_LEADS = 500

if (!ORG_ARG || !/^[0-9a-f-]{36}$/i.test(ORG_ARG) || !CONTA || Number.isNaN(DESDE.getTime())) {
  console.error('uso: npx tsx scripts/emails-invalidos-da-caixa.ts --org <uuid> --conta <CHAVE> [--desde AAAA-MM-DD] [--confirmar]')
  process.exit(1)
}
const ORG: string = ORG_ARG

const real = anunciarModo({
  nome: 'E-mails inválidos a partir da caixa (bounces)',
  alvo: `organização ${ORG}, caixa GMAIL_USER_${CONTA}, avisos desde ${DESDE.toISOString().slice(0, 10)}`,
  efeitos: [
    'grava os endereços devolvidos em emails_invalidos',
    'marca bounced=true nos leads da organização com esses e-mails (backup antes)',
    'cancela as execuções de workflow ativas desses leads',
    'registra uma nota "Bounce SMTP detectado" por lead marcado',
    'a caixa de e-mail só é lida (nada é marcado como lido)',
  ],
})

interface Endereco { status: Set<string>; ultimo: Date }

async function lerCaixa(): Promise<Map<string, Endereco>> {
  const user = process.env[`GMAIL_USER_${CONTA}`]
  const pass = process.env[`GMAIL_APP_PASSWORD_${CONTA}`]
  if (!user || !pass) throw new Error(`GMAIL_USER_${CONTA}/GMAIL_APP_PASSWORD_${CONTA} ausentes no .env.local`)

  const enderecos = new Map<string, Endereco>()
  let avisos = 0, atrasos = 0, semDsn = 0
  const client = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user, pass }, logger: false })
  await client.connect()
  try {
    const pastas = (await client.list())
      .filter((m) => m.specialUse === '\\All' || m.specialUse === '\\Junk')
      .map((m) => m.path)
    for (const pasta of pastas) {
      const lock = await client.getMailboxLock(pasta, { readOnly: true })
      try {
        const uids = await client.search({
          since: DESDE,
          or: [
            { from: 'mailer-daemon' }, { from: 'postmaster' },
            { subject: 'Delivery Status Notification' }, { subject: 'Undeliverable' },
            { subject: 'Mail Delivery' }, { subject: 'Returned mail' },
          ],
        }, { uid: true })
        console.log(`· ${pasta}: ${uids ? uids.length : 0} aviso(s)`)
        if (!uids || uids.length === 0) continue
        for await (const m of client.fetch(uids, { source: true, internalDate: true }, { uid: true })) {
          if (!m.source) continue
          avisos++
          const falha = lerFalhaEntrega(m.source.toString('utf8'), [user])
          if (!falha || falha.destinatarios.length === 0) { semDsn++; continue }
          if (falha.somenteAtraso) { atrasos++; continue }
          const data = m.internalDate ? new Date(m.internalDate) : new Date()
          for (const email of falha.destinatarios) {
            const atual = enderecos.get(email) ?? { status: new Set<string>(), ultimo: data }
            for (const s of falha.status) atual.status.add(s)
            if (data > atual.ultimo) atual.ultimo = data
            enderecos.set(email, atual)
          }
        }
      } finally {
        lock.release()
      }
    }
  } finally {
    await client.logout()
  }
  console.log(`· avisos lidos: ${avisos} | só atraso (ignorados): ${atrasos} | sem destinatário legível: ${semDsn}`)
  return enderecos
}

async function main() {
  const enderecos = await lerCaixa()
  console.log(`· endereços com falha definitiva: ${enderecos.size}`)
  if (enderecos.size === 0) return

  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    const org = await c.query('select nome from organizacoes where id = $1', [ORG])
    if (org.rowCount !== 1) throw new Error(`organização ${ORG} não encontrada`)
    console.log(`· organização: ${org.rows[0].nome}`)

    // O ensaio funciona antes da migration (prévia do que entraria); gravar não.
    const tabela = await c.query(`select to_regclass('public.emails_invalidos') is not null as existe`)
    const temTabela = tabela.rows[0].existe === true
    if (!temTabela && real) throw new Error('tabela emails_invalidos ausente — aplique a migration 0062 antes')
    if (!temTabela) console.log('· tabela emails_invalidos ainda não existe (migration 0062 pendente)')

    const lista = Array.from(enderecos.keys())
    const jaNaLista = temTabela
      ? await c.query('select email from emails_invalidos where organizacao_id = $1 and email = any($2::text[])', [ORG, lista])
      : { rowCount: 0 }
    const leads = await c.query(
      `select l.*,
              exists (select 1 from workflow_execucoes e
                       where e.organizacao_id = l.organizacao_id and e.lead_id = l.id
                         and e.status in ('em_andamento', 'aguardando')) as em_execucao
         from leads l
        where l.organizacao_id = $1 and lower(btrim(l.contato_email)) = any($2::text[])`,
      [ORG, lista],
    )
    const aMarcar = leads.rows.filter((l) => !l.bounced)
    console.log(`· já na lista da organização: ${jaNaLista.rowCount}/${lista.length}`)
    console.log(`· leads com esses e-mails: ${leads.rowCount} (já bounced: ${leads.rowCount! - aMarcar.length}, a marcar: ${aMarcar.length}, com execução ativa: ${aMarcar.filter((l) => l.em_execucao).length})`)
    const porEstagio = aMarcar.reduce<Record<string, number>>((acc, l) => ((acc[l.estagio] = (acc[l.estagio] ?? 0) + 1), acc), {})
    if (aMarcar.length) console.log(`· a marcar por estágio: ${JSON.stringify(porEstagio)}`)

    if (!real) {
      console.log('\nENSAIO: nada foi gravado. Rode de novo com --confirmar para aplicar.')
      return
    }
    limiteSeguranca(aMarcar.length, MAX_LEADS, 'leads a marcar')

    const backup = path.join(process.cwd(), 'backups', `emails-invalidos-${ORG.slice(0, 8)}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
    fs.mkdirSync(path.dirname(backup), { recursive: true })
    fs.writeFileSync(backup, JSON.stringify({ organizacao_id: ORG, leads: aMarcar }, null, 1))
    console.log(`· backup: ${path.relative(process.cwd(), backup)} (${aMarcar.length} leads)`)

    await c.query('begin')
    for (const [email, info] of enderecos) {
      await c.query(
        `insert into emails_invalidos (organizacao_id, email, motivo, origem, detectado_em)
         values ($1, $2, $3, 'varredura_caixa', $4)
         on conflict (organizacao_id, email) do nothing`,
        [ORG, email, [...info.status].join(', ') || null, info.ultimo],
      )
    }
    const ids = aMarcar.map((l) => l.id as string)
    const marcados = await c.query(
      `update leads set bounced = true, bounced_em = now(), proxima_acao = null, proxima_acao_data = null
        where organizacao_id = $1 and id = any($2::uuid[]) and bounced = false
        returning id, contato_email, responsavel_id`,
      [ORG, ids],
    )
    const cancelados = await c.query(
      `update workflow_execucoes set status = 'cancelado'
        where organizacao_id = $1 and lead_id = any($2::uuid[]) and status in ('em_andamento', 'aguardando')`,
      [ORG, ids],
    )
    let notas = 0
    for (const l of marcados.rows) {
      const status = [...(enderecos.get(String(l.contato_email).trim().toLowerCase())?.status ?? [])].join(', ')
      const r = await c.query(
        `insert into interacoes (organizacao_id, lead_id, tipo, canal, descricao, origem_acao, responsavel_id)
         select $1, $2, 'nota', 'sistema', $3, 'ia', $4
          where not exists (select 1 from interacoes
                             where organizacao_id = $1 and lead_id = $2 and descricao like 'Bounce SMTP detectado%')`,
        [ORG, l.id, `Bounce SMTP detectado na varredura da caixa: e-mail devolvido pelo servidor${status ? ` (status ${status})` : ''}. Lead marcado como bounced — removido da cadência automática e das campanhas.`, l.responsavel_id],
      )
      notas += r.rowCount ?? 0
    }
    if (marcados.rowCount !== aMarcar.length) {
      await c.query('rollback')
      throw new Error(`ROLLBACK: esperava marcar ${aMarcar.length}, o banco marcaria ${marcados.rowCount}. Nada foi alterado.`)
    }
    await c.query('commit')
    console.log(`\nAPLICADO: ${enderecos.size} endereço(s) na lista, ${marcados.rowCount} lead(s) marcados, ${cancelados.rowCount} execução(ões) canceladas, ${notas} nota(s).`)

    const restantes = await c.query(
      `select count(*)::int n from leads
        where organizacao_id = $1 and lower(btrim(contato_email)) = any($2::text[]) and bounced = false`,
      [ORG, lista],
    )
    console.log(`· conferência: leads com e-mail devolvido ainda sem bounce = ${restantes.rows[0].n}`)
  } catch (e) {
    await c.query('rollback').catch(() => {})
    throw e
  } finally {
    await c.end()
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
