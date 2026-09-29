import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { NICHOS } from '@/lib/prospeccao/nichos'
import { getValidHubSpotAccessToken } from './tokens'
import { lerEmpresasPorIds } from './companies'
import { mapaResponsaveis } from './comerciais'

// Preparo da importação (microentrega 1): grava só a SELEÇÃO — um lote com o
// nicho esperado e as empresas escolhidas. NÃO cria empresas, contatos nem
// leads; a validação (OpenCNPJ/DGCBR) e a importação são as próximas etapas.
//
// O navegador manda só os IDs. Nome, domínio, industry e owner são relidos do
// HubSpot aqui (batch/read) — nada de dono/responsável vindo do payload.
// Dedup: empresa já importada (organizacao_id + hubspot_company_id em
// `empresas`) fica de fora do lote.

export const LIMITE_EMPRESAS_LOTE = 200
const ID_COMPANY = /^\d{1,20}$/

export type ResultadoPreparo =
  | { ok: true; loteId: string; nicho: string; incluidas: number; jaImportadas: number; naoEncontradas: number }
  | {
      ok: false
      motivo:
        | 'nicho_invalido'
        | 'selecao_vazia'
        | 'selecao_excede_limite'
        | 'id_invalido'
        | 'nenhuma_elegivel'
        | 'nao_conectado'
        | 'inativo'
        | 'app_nao_configurado'
        | 'erro_refresh'
        | 'erro_hubspot'
        | 'erro_banco'
      mensagem?: string
    }

export function validarSelecao(entrada: { nicho: unknown; companyIds: unknown }):
  | { ok: true; nicho: string; ids: string[] }
  | { ok: false; motivo: 'nicho_invalido' | 'selecao_vazia' | 'selecao_excede_limite' | 'id_invalido' } {
  const nicho = typeof entrada.nicho === 'string' ? entrada.nicho : ''
  if (!NICHOS.some((n) => n.id === nicho)) return { ok: false, motivo: 'nicho_invalido' }
  if (!Array.isArray(entrada.companyIds) || entrada.companyIds.length === 0) return { ok: false, motivo: 'selecao_vazia' }
  if (entrada.companyIds.some((id) => typeof id !== 'string' || !ID_COMPANY.test(id))) return { ok: false, motivo: 'id_invalido' }
  const ids = [...new Set(entrada.companyIds as string[])]
  if (ids.length > LIMITE_EMPRESAS_LOTE) return { ok: false, motivo: 'selecao_excede_limite' }
  return { ok: true, nicho, ids }
}

export async function prepararLote(
  org: string,
  perfilId: string,
  entrada: { nicho: unknown; companyIds: unknown },
  deps: { admin?: SupabaseClient; fetch?: typeof fetch } = {},
): Promise<ResultadoPreparo> {
  const selecao = validarSelecao(entrada)
  if (!selecao.ok) return selecao

  const admin = deps.admin ?? createSupabaseAdminClient()
  const token = await getValidHubSpotAccessToken(org, { admin, fetch: deps.fetch })
  if (!token.ok) return { ok: false, motivo: token.motivo }

  const leitura = await lerEmpresasPorIds(token.accessToken, selecao.ids, deps.fetch)
  if (!leitura.ok) return { ok: false, motivo: 'erro_hubspot', mensagem: leitura.mensagem }
  const encontradas = leitura.dados.filter((e) => selecao.ids.includes(e.id))

  const { data: jaExistentes } = await admin
    .from('empresas')
    .select('hubspot_company_id')
    .eq('organizacao_id', org)
    .in('hubspot_company_id', selecao.ids)
  const importadas = new Set((jaExistentes ?? []).map((r) => String(r.hubspot_company_id)))
  const elegiveis = encontradas.filter((e) => !importadas.has(e.id))
  if (elegiveis.length === 0) return { ok: false, motivo: 'nenhuma_elegivel' }

  const responsaveis = await mapaResponsaveis(admin, org)

  const { data: lote, error: erroLote } = await admin
    .from('hubspot_importacao_lotes')
    .insert({
      organizacao_id: org,
      nicho_esperado: selecao.nicho,
      status: 'preparado',
      total_itens: elegiveis.length,
      criado_por: perfilId,
    })
    .select('id')
    .single()
  if (erroLote || !lote) return { ok: false, motivo: 'erro_banco', mensagem: erroLote?.message }

  const itens = elegiveis.map((e) => {
    const p = e.properties ?? {}
    const ownerId = p.hubspot_owner_id ? String(p.hubspot_owner_id) : null
    return {
      organizacao_id: org,
      lote_id: lote.id,
      hubspot_company_id: e.id,
      nome: p.name ?? null,
      dominio: p.domain ?? null,
      industry_hubspot: p.industry ?? null,
      hubspot_owner_id: ownerId,
      usuario_id: ownerId ? responsaveis.get(ownerId) ?? null : null,
    }
  })
  const { error: erroItens } = await admin.from('hubspot_importacao_itens').insert(itens)
  if (erroItens) {
    // Sem itens o lote não tem sentido: desfaz (escopo da própria organização).
    await admin.from('hubspot_importacao_lotes').delete().eq('organizacao_id', org).eq('id', lote.id)
    return { ok: false, motivo: 'erro_banco', mensagem: erroItens.message }
  }

  return {
    ok: true,
    loteId: String(lote.id),
    nicho: selecao.nicho,
    incluidas: elegiveis.length,
    jaImportadas: encontradas.length - elegiveis.length,
    naoEncontradas: selecao.ids.length - encontradas.length,
  }
}
