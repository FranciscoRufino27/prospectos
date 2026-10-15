/**
 * Estende uma campanha de prospecção JÁ PUBLICADA com os follow-ups 3 a 6 dos
 * templates de `templates/Template ProspectOS/`, publicando uma NOVA versão do
 * workflow gerenciado da campanha.
 *
 * - Versões publicadas são imutáveis: execuções em andamento ou concluídas
 *   continuam presas à versão em que entraram (2 follow-ups). Só quem for
 *   inscrito DEPOIS desta publicação percorre os 6.
 * - Não inscreve leads, não envia e-mail, não muda status/dry_run da campanha.
 * - Os 3 conteúdos já existentes (mensagem inicial + 2 follow-ups) não são tocados.
 *
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/estender-campanha-followups.ts            # ensaio
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/estender-campanha-followups.ts --confirmar
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { anunciarModo } from './_guarda'

for (const linha of readFileSync('.env.local', 'utf-8').split(/\r?\n/)) {
  const i = linha.indexOf('=')
  if (i > 0 && !linha.trim().startsWith('#')) {
    const k = linha.slice(0, i).trim()
    if (!process.env[k]) process.env[k] = linha.slice(i + 1).trim().replace(/^["']|["']$/g, '')
  }
}

const ORGANIZACAO_ID = '03097614-9fd5-4491-a91c-589f84461683'
const CAMPANHA_ID = 'e55b9dac-9184-4e41-bc4d-05145066f516'
const CAMPANHA_NOME = 'PROSPECÇÃO'
const PASTA = path.join(process.cwd(), 'templates', 'Template ProspectOS')
// Dias contados do 1º contato (mesma semântica de `diasApos` da campanha: 3 e 7 hoje).
const NOVOS = [
  { arquivo: '03_followup_3.html', diasApos: 20 },
  { arquivo: '04_followup_4.html', diasApos: 30 },
  { arquivo: '05_followup_5.html', diasApos: 45 },
  { arquivo: '06_followup_6.html', diasApos: 60 },
]
const LOGO = 'https://prospectos-six.vercel.app/prospectos/logo-prospectos.png'

async function main() {
  const { extrairTextoHtmlEmail } = await import('../lib/campanhas/emailCampanha')
  const { normalizarPublicoCampanha, validarCampanhaGuiada, LIMITE_HTML_CAMPANHA } = await import('../lib/campanhas/configuracaoGuiada')
  const { materializarCampanhaGuiada } = await import('../lib/campanhas/materializarServidor')
  const { publicar, SupabaseWorkflowStore } = await import('../lib/workflows')
  const { validarTemplatesDaDefinicao, mensagemProblemasTemplate } = await import('../lib/workflows/validarTemplates')

  const confirmar = anunciarModo({
    nome: 'Estender campanha com follow-ups 3 a 6',
    alvo: `campanha ${CAMPANHA_NOME} (${CAMPANHA_ID}) — org ${ORGANIZACAO_ID}`,
    efeitos: [
      'acrescenta 4 follow-ups (D20, D30, D45, D60) com o HTML dos templates ProspectOS',
      'cria/atualiza os 4 templates da campanha e publica uma nova versão imutável do workflow',
      'leads já inscritos seguem na versão antiga; só novos inscritos percorrem os 6',
      'não inscreve leads, não envia e-mail, não altera status nem dry_run',
    ],
  })

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: campanha, error } = await admin
    .from('campanhas').select('id, nome, status, tipo, dry_run, workflow_id, publico')
    .eq('organizacao_id', ORGANIZACAO_ID).eq('id', CAMPANHA_ID).maybeSingle()
  if (error) throw error
  if (!campanha || campanha.nome !== CAMPANHA_NOME) throw new Error('Campanha não encontrada ou com nome diferente do esperado.')
  if (campanha.status !== 'ativa' && campanha.status !== 'pausada') throw new Error(`Status inesperado: ${campanha.status}`)

  const publico = normalizarPublicoCampanha(campanha.publico)
  const atuais = publico.operacao?.followups ?? []
  if (atuais.length !== 2) throw new Error(`Esperava 2 follow-ups atuais, há ${atuais.length}; abortando (já estendida?).`)
  const assunto = atuais[atuais.length - 1].assunto
  if (!assunto) throw new Error('Follow-up atual sem assunto.')

  const novos = NOVOS.map(({ arquivo, diasApos }) => {
    const html = readFileSync(path.join(PASTA, arquivo), 'utf-8')
    if (/data:/i.test(html)) throw new Error(`${arquivo}: imagem embutida.`)
    if (!html.includes(LOGO)) throw new Error(`${arquivo}: logo pública ausente.`)
    if (Buffer.byteLength(html) > LIMITE_HTML_CAMPANHA) throw new Error(`${arquivo}: HTML acima do limite.`)
    const corpo = extrairTextoHtmlEmail(html)
    if (!corpo) throw new Error(`${arquivo}: texto vazio.`)
    return { assunto, corpo, html, diasApos }
  })

  const novoPublico = {
    ...publico,
    operacao: { ...publico.operacao, followups: [...atuais, ...novos] },
  }
  const erros = validarCampanhaGuiada(normalizarPublicoCampanha(novoPublico))
  if (erros.length) throw new Error(`Validação: ${erros.join(' ')}`)

  console.log(`\nCampanha ${campanha.status}, dry_run=${campanha.dry_run}, workflow ${campanha.workflow_id}`)
  console.log(`Hoje: inicial + ${atuais.map((f) => `D${f.diasApos}`).join(' + ')}`)
  console.log(`Depois: inicial + ${[...atuais, ...novos].map((f) => `D${f.diasApos}`).join(' + ')}`)
  for (const n of novos) console.log(`  + D${n.diasApos} — assunto "${n.assunto}" — ${Buffer.byteLength(n.html)} bytes — texto: ${n.corpo.split('\n')[0].slice(0, 70)}`)
  if (!confirmar) { console.log('\nEnsaio concluído: nada foi gravado.'); return }

  const m = await materializarCampanhaGuiada(admin, ORGANIZACAO_ID, CAMPANHA_ID, campanha.nome, novoPublico, campanha.tipo)
  if (!m.workflowId || m.workflowId !== campanha.workflow_id) throw new Error('Workflow divergente após materializar.')
  const store = new SupabaseWorkflowStore(ORGANIZACAO_ID, admin)
  const wf = await store.buscarWorkflow(m.workflowId)
  const problemas = await validarTemplatesDaDefinicao(admin, ORGANIZACAO_ID, wf?.rascunho_definicao ?? null)
  if (problemas.length) throw new Error(mensagemProblemasTemplate(problemas, 'publicar'))
  const { versao } = await publicar(store, m.workflowId, null)
  console.log(`\nPublicada a versão ${versao.numero} com ${(wf?.rascunho_definicao?.acoes ?? []).length} ações.`)
}

main().catch((e) => { console.error(e); process.exit(1) })
