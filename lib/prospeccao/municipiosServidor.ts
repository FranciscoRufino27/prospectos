// Lista municípios do catálogo RF (RPC da migration 0052). Dado público, sem
// organização; a rota só chama depois de resolverAcesso().

import type { SupabaseClient } from '@supabase/supabase-js'
import { PROSPECCAO_LIMITES, UFS_BRASIL } from '@/lib/config/workspaceConfig'
import { LIMITE_SUGESTOES_MUNICIPIO, normalizarTextoMunicipio, type Municipio } from './municipios'

export interface ConsultaMunicipios {
  ufs: string[]
  texto: string
  codigos: string[]
}

/** Parâmetros da URL (?uf=SP&uf=RJ&q=campos&codigo=7107), revalidados. */
export function consultaDaUrl(params: URLSearchParams): ConsultaMunicipios {
  const unicos = (v: string[]) => [...new Set(v.map((x) => x.trim()))]
  return {
    ufs: unicos(params.getAll('uf')).filter((u) => (UFS_BRASIL as readonly string[]).includes(u)),
    texto: normalizarTextoMunicipio(params.get('q')),
    codigos: unicos(params.getAll('codigo')).filter((c) => /^\d{1,7}$/.test(c)).slice(0, PROSPECCAO_LIMITES.municipios),
  }
}

export async function listarMunicipios(admin: SupabaseClient, q: ConsultaMunicipios): Promise<Municipio[]> {
  const { data, error } = await admin.rpc('prospeccao_municipios', {
    p_ufs: q.ufs,
    p_texto: q.texto,
    p_codigos: q.codigos,
    // Resolver códigos salvos devolve todos; sugestão é uma página curta.
    p_limite: q.codigos.length ? q.codigos.length : LIMITE_SUGESTOES_MUNICIPIO,
  })
  if (error) throw new Error(`Falha ao listar municípios: ${error.message}`)
  return ((data ?? []) as Municipio[]).map((m) => ({ codigo: m.codigo, nome: m.nome, uf: m.uf }))
}
