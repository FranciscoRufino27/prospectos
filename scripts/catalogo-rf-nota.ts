/**
 * Recalcula a nota de qualidade das empresas do catálogo RF (migration 0054),
 * que ordena a busca da Prospecção.
 *
 *   npx tsx scripts/catalogo-rf-nota.ts              # ensaio: só conta
 *   npx tsx scripts/catalogo-rf-nota.ts --confirmar  # grava
 *
 * Exige a 0054 aplicada. Só escreve qualidade_email/nota em
 * catalogo_estabelecimentos (tabela global, sem organização). Idempotente:
 * linha já com a nota certa não é tocada. Não envia nada a lead nenhum.
 */
import { bootstrapEnv } from './_bootstrap'
import { anunciarModo } from './_guarda'

bootstrapEnv()

const C = { dim: '\x1b[2m', b: '\x1b[1m', cyan: '\x1b[36m', r: '\x1b[0m' }

async function main() {
  const { createSupabaseAdminClient } = await import('../lib/supabase-admin')
  const { recalcularNotas } = await import('../lib/prospeccao/catalogoRf/recalcularNotas')

  const alvo = process.env.NEXT_PUBLIC_SUPABASE_URL
    ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host
    : '(NEXT_PUBLIC_SUPABASE_URL ausente)'
  const real = anunciarModo({
    nome: 'Nota de qualidade do catálogo RF',
    alvo,
    efeitos: ['update de qualidade_email e nota em catalogo_estabelecimentos (só linhas com nota diferente)'],
  })

  const inicio = Date.now()
  const resumo = await recalcularNotas(createSupabaseAdminClient(), {
    gravar: real,
    aoProgredir: (msg) => console.log(`${C.dim}  [${Math.round((Date.now() - inicio) / 1000)}s] ${msg}${C.r}`),
  })

  console.log(`\n${C.b}Resultado${C.r} (${real ? 'gravado' : 'ensaio, nada gravado'})`)
  console.log(`  lidas ....... ${resumo.lidas.toLocaleString('pt-BR')}`)
  console.log(`  ${real ? 'atualizadas' : 'a atualizar'} . ${resumo.alteradas.toLocaleString('pt-BR')}`)
  const notas = Object.entries(resumo.porNota).sort((a, b) => Number(b[0]) - Number(a[0]))
  console.log(`  por nota .... ${notas.map(([n, q]) => `${n}:${q}`).join(' ')}`)
  console.log(`${C.cyan}  nota = faixa x 10 + telefone (5 corporativo que confere ... 1 contador/typo/sem e-mail)${C.r}`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
