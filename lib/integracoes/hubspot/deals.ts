import 'server-only'
import { buscarHubspot, type ResultadoHubspot } from './client'
import type { ListaHubspot } from './contacts'

export interface NegocioHubspot {
  id: string
  properties: Record<string, string | null>
}

// Propriedades lidas dos negócios associados na Central de Importação.
export const PROPRIEDADES_NEGOCIO = ['dealname', 'dealstage', 'pipeline', 'hs_is_closed_won', 'hs_is_closed', 'closedate', 'hubspot_owner_id'] as const

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

export interface EstagioNegocio {
  estagio: string
  pipeline: string
}

type RespostaPipelines = { results?: Array<{ id: string; label: string; stages?: Array<{ id: string; label: string }> }> }

// "pipeline/estágio" → rótulos legíveis (os IDs de estágio são numéricos).
export async function listarEstagiosNegocio(
  accessToken: string,
  doFetch?: typeof fetch,
): Promise<ResultadoHubspot<Map<string, EstagioNegocio>>> {
  const r = await buscarHubspot<RespostaPipelines>('/crm/v3/pipelines/deals', accessToken, {}, doFetch)
  if (!r.ok) return r
  const mapa = new Map<string, EstagioNegocio>()
  for (const p of r.dados.results ?? []) {
    for (const s of p.stages ?? []) mapa.set(`${p.id}/${s.id}`, { estagio: s.label, pipeline: p.label })
  }
  return { ok: true, dados: mapa }
}
