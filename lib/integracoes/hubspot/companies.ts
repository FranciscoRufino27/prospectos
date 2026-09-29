import 'server-only'
import { buscarHubspot, consultarHubspot, type ResultadoHubspot } from './client'
import type { ListaHubspot } from './contacts'

export interface EmpresaHubspot {
  id: string
  properties: Record<string, string | null>
}

export function listarEmpresas(
  accessToken: string,
  limite = 10,
  doFetch?: typeof fetch,
): Promise<ResultadoHubspot<ListaHubspot<EmpresaHubspot>>> {
  return buscarHubspot(
    '/crm/v3/objects/companies',
    accessToken,
    { limit: limite, properties: 'name,domain' },
    doFetch,
  )
}

// Propriedades usadas na listagem/preparo da importação.
export const PROPRIEDADES_IMPORTACAO = [
  'name',
  'domain',
  'industry',
  'hubspot_owner_id',
  'num_associated_contacts',
  'num_associated_deals',
] as const

export interface RespostaBuscaEmpresas {
  total: number
  results: EmpresaHubspot[]
  paging?: { next?: { after?: string } }
}

// Busca server-side (filtros/paginação/texto). Leitura, apesar do POST.
export function pesquisarEmpresas(
  accessToken: string,
  corpo: unknown,
  doFetch?: typeof fetch,
): Promise<ResultadoHubspot<RespostaBuscaEmpresas>> {
  return consultarHubspot('/crm/v3/objects/companies/search', accessToken, corpo, doFetch)
}

export const LIMITE_LEITURA_LOTE = 100 // máximo de inputs do batch/read

// Leitura por IDs (batch/read). Leitura, apesar do POST. IDs inexistentes
// simplesmente não voltam.
export async function lerEmpresasPorIds(
  accessToken: string,
  ids: readonly string[],
  doFetch?: typeof fetch,
): Promise<ResultadoHubspot<EmpresaHubspot[]>> {
  const todas: EmpresaHubspot[] = []
  for (let i = 0; i < ids.length; i += LIMITE_LEITURA_LOTE) {
    const fatia = ids.slice(i, i + LIMITE_LEITURA_LOTE)
    const r = await consultarHubspot<{ results: EmpresaHubspot[] }>(
      '/crm/v3/objects/companies/batch/read',
      accessToken,
      { inputs: fatia.map((id) => ({ id })), properties: [...PROPRIEDADES_IMPORTACAO] },
      doFetch,
    )
    if (!r.ok) return r
    todas.push(...(r.dados.results ?? []))
  }
  return { ok: true, dados: todas }
}
