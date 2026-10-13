/**
 * Atende os pedidos de carga do catálogo RF (migration 0068): o nicho novo de
 * uma organização trouxe atividades que o catálogo ainda não tem.
 *
 *   npx tsx scripts/catalogo-rf-pedidos.ts              # ensaio: só mostra o plano
 *   npx tsx scripts/catalogo-rf-pedidos.ts --confirmar  # carrega e fecha os pedidos
 *
 * Roda no GitHub Actions (.github/workflows/catalogo-rf-pedidos.yml), acordado
 * pela tela (repository_dispatch) ou pelo agendamento. Junta os pedidos
 * pendentes de todas as organizações, carrega as atividades que faltam com os
 * 10 shards da RF do mês mais recente (~80 min) e marca cada pedido como
 * concluído ou com erro. Pedido já coberto pelo catálogo fecha sem carga.
 *
 * Efeitos com --confirmar: upsert em catalogo_estabelecimentos (global),
 * registro em catalogo_rf_cargas e status em catalogo_rf_pedidos (sempre por
 * id + organizacao_id). Não envia nada a lead nenhum.
 */
import { bootstrapEnv } from './_bootstrap'
import { anunciarModo } from './_guarda'

bootstrapEnv()

const C = { dim: '\x1b[2m', b: '\x1b[1m', cyan: '\x1b[36m', red: '\x1b[31m', r: '\x1b[0m' }

async function main() {
  const { createSupabaseAdminClient } = await import('../lib/supabase-admin')
  const { statusCatalogo } = await import('../lib/prospeccao/buscaServidor')
  const { planejarAtendimento } = await import('../lib/prospeccao/catalogoRf/atenderPedidos')
  type PedidoAberto = import('../lib/prospeccao/catalogoRf/atenderPedidos').PedidoAberto

  const alvo = process.env.NEXT_PUBLIC_SUPABASE_URL
    ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host
    : '(NEXT_PUBLIC_SUPABASE_URL ausente)'
  const real = anunciarModo({
    nome: 'Pedidos de carga do catálogo RF',
    alvo,
    efeitos: [
      'upsert em catalogo_estabelecimentos das atividades pedidas (tabela global)',
      'registro da execução em catalogo_rf_cargas',
      'status dos pedidos em catalogo_rf_pedidos (por id + organizacao_id)',
    ],
  })

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('catalogo_rf_pedidos')
    .select('id, organizacao_id, cnaes, status, iniciado_em')
    .in('status', ['pendente', 'em_andamento'])
    .order('criado_em', { ascending: true })
    .limit(200)
  if (error) throw new Error(`Falha ao ler pedidos: ${error.message}`)
  const catalogo = await statusCatalogo(admin)
  const plano = planejarAtendimento((data ?? []) as PedidoAberto[], catalogo?.cnaes ?? [], new Date())

  console.log(`${C.cyan}▸ ${plano.aCarregar.length} pedido(s) a carregar · ${plano.jaAtendidos.length} já no catálogo · ${plano.abandonados.length} retomado(s)${C.r}`)
  if (plano.cnaes.length) console.log(`${C.cyan}▸ Atividades: ${plano.cnaes.join(', ')}${C.r}`)
  if (!real) {
    console.log(`\n${C.dim}Ensaio: nada foi baixado nem gravado. Use --confirmar para atender.${C.r}`)
    return
  }

  const marcar = async (pedidos: PedidoAberto[], campos: Record<string, unknown>) => {
    for (const p of pedidos) {
      const { error: e } = await admin
        .from('catalogo_rf_pedidos')
        .update(campos)
        .eq('id', p.id)
        .eq('organizacao_id', p.organizacao_id)
      if (e) throw new Error(`Falha ao atualizar o pedido ${p.id}: ${e.message}`)
    }
  }

  const agora = () => new Date().toISOString()
  await marcar(plano.jaAtendidos, { status: 'concluido', concluido_em: agora(), erro: null })
  if (!plano.aCarregar.length) {
    console.log(`${C.dim}Nada a carregar.${C.r}`)
    return
  }

  const { carregarCatalogo, TOTAL_SHARDS } = await import('../lib/prospeccao/catalogoRf/carga')
  const { criarFonteRf, mesMaisRecenteRf } = await import('../lib/prospeccao/catalogoRf/fonteRf')
  const destino = await import('../lib/prospeccao/catalogoRf/destinoSupabase')

  await marcar(plano.aCarregar, { status: 'em_andamento', iniciado_em: agora(), erro: null })
  const mesRf = await mesMaisRecenteRf()
  const shards = Array.from({ length: TOTAL_SHARDS }, (_, i) => i)
  const inicio = Date.now()
  const log = (msg: string) => console.log(`${C.dim}  [${Math.round((Date.now() - inicio) / 1000)}s] ${msg}${C.r}`)
  const cargaId = await destino.registrarInicioCarga(admin, { mesRf, cnaes: plano.cnaes, shards, completa: true })

  try {
    const resumo = await carregarCatalogo({
      fonte: criarFonteRf(mesRf, { aoProgredir: log }),
      mesRf,
      cnaes: plano.cnaes,
      cnaesSecundarios: [],
      shards,
      destino: destino.criarDestinoSupabase(admin),
      aoProgredir: log,
    })
    await destino.registrarFimCarga(admin, cargaId, { resumo })
    await marcar(plano.aCarregar, { status: 'concluido', concluido_em: agora(), carga_id: cargaId })
    console.log(`\n${C.b}Concluído${C.r}: ${resumo.estabelecimentos.toLocaleString('pt-BR')} estabelecimentos · ${JSON.stringify(resumo.porCnaePrincipal)}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await destino.registrarFimCarga(admin, cargaId, { erro: msg }).catch(() => {})
    await marcar(plano.aCarregar, { status: 'erro', concluido_em: agora(), carga_id: cargaId, erro: msg.slice(0, 500) })
    throw err
  }
}

main().catch((err) => {
  console.error(`${C.red}${err instanceof Error ? err.stack ?? err.message : String(err)}${C.r}`)
  process.exit(1)
})
