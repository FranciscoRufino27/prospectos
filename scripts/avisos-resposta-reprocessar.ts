/**
 * Reprocessa os avisos de "cliente respondeu" pendentes de UMA organização —
 * o mesmo passo que o motor roda a cada ciclo (lib/engine/index.ts). Útil para
 * testar/destravar sem esperar o cron (ex.: depois de cadastrar o número em
 * Meu perfil ou configurar a Z-API).
 *
 * ENSAIO por padrão: sem `--confirmar` só lista as pendências e para.
 * Com `--confirmar`, ENVIA de verdade pela Z-API (para a equipe, nunca ao cliente).
 *
 * `server-only` obriga a condição de resolução do React Server:
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/avisos-resposta-reprocessar.ts --org <uuid>
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/avisos-resposta-reprocessar.ts --org <uuid> --confirmar
 */
import fs from 'node:fs'
import path from 'node:path'

for (const l of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8').split(/\r?\n/)) {
  const i = l.indexOf('='); if (i <= 0 || l.startsWith('#')) continue
  const k = l.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '')
}

const args = process.argv.slice(2)
const org = args[args.indexOf('--org') + 1]
const confirmar = args.includes('--confirmar')
if (!args.includes('--org') || !org) {
  console.error('uso: ... scripts/avisos-resposta-reprocessar.ts --org <uuid> [--confirmar]')
  process.exit(1)
}

async function main() {
  const { createSupabaseAdminClient } = await import('@/lib/supabase-admin')
  const { SupabaseAvisoRespostaRepository } = await import('@/lib/comercial/avisosResposta/supabaseRepository')
  const { MAX_TENTATIVAS_AVISO, JANELA_REPROCESSAMENTO_HORAS } = await import('@/lib/comercial/avisosResposta/servico')
  const { reprocessarAvisosRespostaDaOrg } = await import('@/lib/comercial/avisosResposta/composicao')

  const admin = createSupabaseAdminClient()
  const desde = new Date(Date.now() - JANELA_REPROCESSAMENTO_HORAS * 3_600_000).toISOString()
  const pendentes = await new SupabaseAvisoRespostaRepository(admin).listarReprocessaveis(org, MAX_TENTATIVAS_AVISO, desde, 20)
  console.log(`${pendentes.length} aviso(s) pendente(s) nas últimas ${JANELA_REPROCESSAMENTO_HORAS}h:`)
  for (const a of pendentes) {
    console.log(`  - ${a.destinoTipo} | ${a.status} | tentativas ${a.tentativas} | ${a.dados.empresa || a.dados.contato} | ${a.ultimoErro ?? ''}`)
  }
  if (!confirmar) {
    console.log('ENSAIO: nada enviado. Use --confirmar para reprocessar.')
    return
  }
  console.log('Reprocessando:', await reprocessarAvisosRespostaDaOrg(admin, org))
  const depois = await new SupabaseAvisoRespostaRepository(admin).listarReprocessaveis(org, MAX_TENTATIVAS_AVISO, desde, 20)
  for (const a of depois) console.log(`  ainda pendente: ${a.destinoTipo} | ${a.status} | ${a.ultimoErro ?? ''}`)
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
