import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { lerConfigHubspotApp, obterMetadadosToken, trocarCodigoPorTokens, validarState } from './oauth'
import { salvarConexao } from './tokens'

// Orquestração do callback OAuth, isolada da rota (Next) p/ ser testável sem
// subir servidor — mesma convenção do resto do repo (lógica em lib/, rota
// fina). A identidade de quem conecta vem do `state` assinado, não da sessão
// do browser neste request (pode nem existir mais após o redirect externo).
export type ResultadoCallback =
  | { ok: true }
  | {
      ok: false
      motivo:
        | 'sem_code'
        | 'state_formato_invalido'
        | 'state_assinatura_invalida'
        | 'state_expirado'
        | 'app_nao_configurado'
        | 'troca_falhou'
        | 'metadados_falharam'
        | 'persistencia_falhou'
    }

export async function processarCallbackHubspot(
  params: { code: string | null; state: string | null },
  deps: { env?: Record<string, string | undefined>; admin?: SupabaseClient; fetch?: typeof fetch } = {},
): Promise<ResultadoCallback> {
  const validacao = validarState(params.state, deps.env)
  if (!validacao.ok) return { ok: false, motivo: `state_${validacao.motivo}` }
  if (!params.code) return { ok: false, motivo: 'sem_code' }

  const cfg = lerConfigHubspotApp(deps.env)
  if (!cfg) return { ok: false, motivo: 'app_nao_configurado' }

  const tokens = await trocarCodigoPorTokens(cfg, params.code, deps.fetch)
  if (!tokens.ok) return { ok: false, motivo: 'troca_falhou' }

  const metadados = await obterMetadadosToken(cfg, tokens.tokens.accessToken, deps.fetch)
  if (!metadados.ok) return { ok: false, motivo: 'metadados_falharam' }

  const salvo = await salvarConexao({
    organizacaoId: validacao.estado.org,
    perfilId: validacao.estado.perfilId,
    hubspotPortalId: metadados.metadados.hubId,
    scopes: metadados.metadados.scopes,
    tokens: tokens.tokens,
    admin: deps.admin ?? createSupabaseAdminClient(),
  })
  if (!salvo.ok) return { ok: false, motivo: 'persistencia_falhou' }

  return { ok: true }
}
