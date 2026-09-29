import 'server-only'
import { buscarHubspot, type ResultadoHubspot } from './client'

export interface ContatoHubspot {
  id: string
  properties: Record<string, string | null>
}

export interface ListaHubspot<T> {
  results: T[]
  paging?: { next?: { after?: string } }
}

// Somente leitura. `properties` limitado às colunas úteis p/ a validação da
// Fase 1 — não traz a ficha completa do contato.
export function listarContatos(
  accessToken: string,
  limite = 10,
  doFetch?: typeof fetch,
): Promise<ResultadoHubspot<ListaHubspot<ContatoHubspot>>> {
  return buscarHubspot(
    '/crm/v3/objects/contacts',
    accessToken,
    { limit: limite, properties: 'firstname,lastname,email' },
    doFetch,
  )
}
