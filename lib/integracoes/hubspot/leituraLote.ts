import 'server-only'
import { consultarHubspot, type ResultadoHubspot } from './client'

// Leituras em LOTE (evita N+1): objetos por IDs (batch/read, 100 por chamada)
// e associações (v4 batch/read, 100 origens por chamada). Somente leitura —
// os POSTs aqui são endpoints de leitura do HubSpot.

export interface ObjetoHubspot {
  id: string
  properties: Record<string, string | null>
}

const LOTE = 100

export async function lerObjetosPorIds(
  objeto: 'companies' | 'contacts' | 'deals',
  accessToken: string,
  ids: readonly string[],
  propriedades: readonly string[],
  doFetch?: typeof fetch,
): Promise<ResultadoHubspot<ObjetoHubspot[]>> {
  const todos: ObjetoHubspot[] = []
  const unicos = [...new Set(ids)]
  for (let i = 0; i < unicos.length; i += LOTE) {
    const r = await consultarHubspot<{ results?: ObjetoHubspot[] }>(
      `/crm/v3/objects/${objeto}/batch/read`,
      accessToken,
      { inputs: unicos.slice(i, i + LOTE).map((id) => ({ id })), properties: [...propriedades] },
      doFetch,
    )
    if (!r.ok) return r
    todos.push(...(r.dados.results ?? []))
  }
  return { ok: true, dados: todos }
}

export interface Associados {
  ids: string[] // ordenados por ID numérico crescente (estável)
  truncado: boolean // passou do limite por objeto (ou o HubSpot paginou)
}

type RespostaAssoc = {
  results?: Array<{ from: { id: string }; to?: Array<{ toObjectId: number | string }>; paging?: { next?: unknown } }>
}

const porIdNumerico = (a: string, b: string) => Number(a) - Number(b) || a.localeCompare(b)

// Origens sem nenhuma associação simplesmente não aparecem (o HubSpot as
// devolve como "erro" 207 NO_ASSOCIATIONS_FOUND) — viram lista vazia.
export async function lerAssociacoes(
  de: 'companies' | 'contacts' | 'deals',
  para: 'companies' | 'contacts' | 'deals',
  accessToken: string,
  ids: readonly string[],
  limitePorObjeto: number,
  doFetch?: typeof fetch,
): Promise<ResultadoHubspot<Map<string, Associados>>> {
  const mapa = new Map<string, Associados>()
  const unicos = [...new Set(ids)]
  for (const id of unicos) mapa.set(id, { ids: [], truncado: false })
  for (let i = 0; i < unicos.length; i += LOTE) {
    const r = await consultarHubspot<RespostaAssoc>(
      `/crm/v4/associations/${de}/${para}/batch/read`,
      accessToken,
      { inputs: unicos.slice(i, i + LOTE).map((id) => ({ id })) },
      doFetch,
    )
    if (!r.ok) return r
    for (const item of r.dados.results ?? []) {
      const destino = [...new Set((item.to ?? []).map((t) => String(t.toObjectId)))].sort(porIdNumerico)
      mapa.set(String(item.from.id), {
        ids: destino.slice(0, limitePorObjeto),
        truncado: destino.length > limitePorObjeto || !!item.paging?.next,
      })
    }
  }
  return { ok: true, dados: mapa }
}

// Cache curto em memória do processo (por instância). Só guarda sucesso.
const cache = new Map<string, { expira: number; valor: unknown }>()

export async function comCache<T>(chave: string, ttlMs: number, carregar: () => Promise<T | null>): Promise<T | null> {
  const agora = Date.now()
  const hit = cache.get(chave)
  if (hit && hit.expira > agora) return hit.valor as T
  const valor = await carregar()
  if (valor !== null) cache.set(chave, { expira: agora + ttlMs, valor })
  return valor
}

export function limparCacheLeitura() {
  cache.clear()
}
