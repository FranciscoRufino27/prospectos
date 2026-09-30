import 'server-only'
import { buscarHubspot, consultarHubspot, type ResultadoHubspot } from './client'
import { lerObjetosPorIds } from './leituraLote'
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
  'hs_num_open_deals',
  'recent_deal_close_date',
  'notes_last_updated',
  'notes_last_contacted',
  'lifecyclestage',
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

// Leitura por IDs (batch/read). Leitura, apesar do POST. IDs inexistentes
// simplesmente não voltam.
export function lerEmpresasPorIds(
  accessToken: string,
  ids: readonly string[],
  doFetch?: typeof fetch,
): Promise<ResultadoHubspot<EmpresaHubspot[]>> {
  return lerObjetosPorIds('companies', accessToken, ids, PROPRIEDADES_IMPORTACAO, doFetch)
}
