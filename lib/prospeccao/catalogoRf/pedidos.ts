// Pedidos de carga do catálogo RF (migration 0068). A tela pede quando um
// nicho tem atividade que o catálogo ainda não tem; o job do GitHub Actions
// (scripts/catalogo-rf-pedidos.ts) atende. `org` vem SEMPRE da sessão.
import type { SupabaseClient } from '@supabase/supabase-js'

export type StatusPedido = 'pendente' | 'em_andamento' | 'concluido' | 'erro'

export interface PedidoCarga {
  id: string
  cnaes: string[]
  status: StatusPedido
  erro: string | null
  criadoEm: string
  iniciadoEm: string | null
  concluidoEm: string | null
}

interface LinhaPedido {
  id: string
  cnaes: string[]
  status: StatusPedido
  erro: string | null
  criado_em: string
  iniciado_em: string | null
  concluido_em: string | null
}

const COLUNAS = 'id, cnaes, status, erro, criado_em, iniciado_em, concluido_em'
export const STATUS_ABERTOS: StatusPedido[] = ['pendente', 'em_andamento']

function paraPedido(l: LinhaPedido): PedidoCarga {
  return {
    id: l.id,
    cnaes: l.cnaes ?? [],
    status: l.status,
    erro: l.erro,
    criadoEm: l.criado_em,
    iniciadoEm: l.iniciado_em,
    concluidoEm: l.concluido_em,
  }
}

/** Pedidos recentes da organização, do mais novo ao mais antigo. */
export async function pedidosDaOrg(admin: SupabaseClient, org: string, limite = 20): Promise<PedidoCarga[]> {
  const { data, error } = await admin
    .from('catalogo_rf_pedidos')
    .select(COLUNAS)
    .eq('organizacao_id', org)
    .order('criado_em', { ascending: false })
    .limit(limite)
  if (error) throw new Error(`Falha ao ler pedidos de carga: ${error.message}`)
  return ((data ?? []) as LinhaPedido[]).map(paraPedido)
}

/**
 * Atividades que ainda precisam de carga: fora do catálogo e sem pedido aberto
 * desta org que as cubra (clicar duas vezes não duplica o pedido).
 */
export function cnaesAPedir(cnaes: readonly string[], noCatalogo: readonly string[], abertos: readonly PedidoCarga[]): string[] {
  const cobertos = new Set([...noCatalogo, ...abertos.filter((p) => STATUS_ABERTOS.includes(p.status)).flatMap((p) => p.cnaes)])
  return [...new Set(cnaes)].filter((c) => !cobertos.has(c))
}

/**
 * Registra o pedido das atividades que faltam e acorda o job. Devolve o pedido
 * criado, ou null quando nada falta (já no catálogo ou já pedido).
 */
export async function pedirCarga(
  admin: SupabaseClient,
  org: string,
  usuarioId: string | null,
  cnaes: readonly string[],
  noCatalogo: readonly string[],
): Promise<PedidoCarga | null> {
  const faltam = cnaesAPedir(cnaes, noCatalogo, await pedidosDaOrg(admin, org))
  if (!faltam.length) return null
  const { data, error } = await admin
    .from('catalogo_rf_pedidos')
    .insert({ organizacao_id: org, cnaes: faltam, status: 'pendente', solicitado_por: usuarioId })
    .select(COLUNAS)
    .single()
  if (error || !data) throw new Error(`Falha ao registrar pedido de carga: ${error?.message ?? 'sem retorno'}`)
  await acordarJob()
  return paraPedido(data as LinhaPedido)
}

/**
 * Dispara o workflow do GitHub (repository_dispatch). Sem token configurado,
 * ou se o GitHub recusar, o pedido fica pendente e a execução agendada do
 * workflow o pega — nunca derruba o pedido do usuário.
 */
export async function acordarJob(fetcher: typeof fetch = fetch): Promise<boolean> {
  const token = process.env.GITHUB_DISPATCH_TOKEN
  const repositorio = process.env.GITHUB_REPOSITORIO
  if (!token || !repositorio || !/^[\w.-]+\/[\w.-]+$/.test(repositorio)) return false
  try {
    const res = await fetcher(`https://api.github.com/repos/${repositorio}/dispatches`, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ event_type: 'catalogo-rf-pedido' }),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) console.error('[catalogo-rf-pedidos] GitHub recusou o disparo:', res.status)
    return res.ok
  } catch (err) {
    console.error('[catalogo-rf-pedidos] falha ao disparar o job:', err)
    return false
  }
}
