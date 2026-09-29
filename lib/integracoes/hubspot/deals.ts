import 'server-only'
import { buscarHubspot, type ResultadoHubspot } from './client'
import type { ListaHubspot } from './contacts'

export interface NegocioHubspot {
  id: string
  properties: Record<string, string | null>
}

export function listarNegocios(
  accessToken: string,
  limite = 10,
  doFetch?: typeof fetch,
): Promise<ResultadoHubspot<ListaHubspot<NegocioHubspot>>> {
  return buscarHubspot(
    '/crm/v3/objects/deals',
    accessToken,
    { limit: limite, properties: 'dealname,amount,dealstage' },
    doFetch,
  )
}
