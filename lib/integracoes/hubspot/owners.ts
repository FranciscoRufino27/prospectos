import 'server-only'
import { buscarHubspot, type ResultadoHubspot } from './client'
import type { ListaHubspot } from './contacts'

export interface ProprietarioHubspot {
  id: string
  email?: string
  firstName?: string
  lastName?: string
  archived?: boolean
}

export function listarProprietarios(
  accessToken: string,
  limite = 10,
  doFetch?: typeof fetch,
): Promise<ResultadoHubspot<ListaHubspot<ProprietarioHubspot>>> {
  return buscarHubspot('/crm/v3/owners', accessToken, { limit: limite }, doFetch)
}

const MAX_PAGINAS_OWNERS = 20 // 2.000 owners: trava contra loop de paginação

// Todos os owners ativos (não arquivados), percorrendo a paginação.
export async function listarTodosProprietarios(
  accessToken: string,
  doFetch?: typeof fetch,
): Promise<ResultadoHubspot<ProprietarioHubspot[]>> {
  const todos: ProprietarioHubspot[] = []
  let after: string | undefined
  for (let pagina = 0; pagina < MAX_PAGINAS_OWNERS; pagina++) {
    const r = await buscarHubspot<ListaHubspot<ProprietarioHubspot>>(
      '/crm/v3/owners',
      accessToken,
      { limit: 100, archived: 'false', after },
      doFetch,
    )
    if (!r.ok) return r
    todos.push(...(r.dados.results ?? []))
    after = r.dados.paging?.next?.after
    if (!after) break
  }
  return { ok: true, dados: todos.filter((o) => o.archived !== true) }
}

export function nomeProprietario(o: ProprietarioHubspot): string {
  const nome = `${o.firstName ?? ''} ${o.lastName ?? ''}`.trim()
  return nome || o.email || `Owner ${o.id}`
}
