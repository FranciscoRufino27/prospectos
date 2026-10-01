import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { cifrar, decifrar } from '@/lib/seguranca/criptografia'
import { lerConfigHubspotApp, renovarTokens, type TokensHubspot } from './oauth'

// Persistência da conexão HubSpot por organização. access_token/refresh_token
// SEMPRE cifrados (lib/seguranca/criptografia) — nunca gravados nem devolvidos
// em texto puro. Todo acesso filtra organizacao_id explicitamente (service_role
// bypassa RLS; a RLS da migration 0054 é backstop, não o enforcement real).

interface LinhaIntegracao {
  hubspot_portal_id: number
  access_token_cifrado: string
  refresh_token_cifrado: string
  expires_at: string
  scopes: string[] | null
  ativo: boolean
  ultima_sincronizacao: string | null
}

export interface ConexaoHubspot {
  hubspotPortalId: number
  scopes: string[]
  ativo: boolean
  expiresAt: string
  ultimaSincronizacao: string | null
}

export async function salvarConexao(params: {
  organizacaoId: string
  perfilId: string
  hubspotPortalId: number
  scopes: string[]
  tokens: TokensHubspot
  admin?: SupabaseClient
}): Promise<{ ok: true } | { ok: false; mensagem: string }> {
  const admin = params.admin ?? createSupabaseAdminClient()
  const { error } = await admin.from('integracoes_hubspot').upsert(
    {
      organizacao_id: params.organizacaoId,
      hubspot_portal_id: params.hubspotPortalId,
      access_token_cifrado: cifrar(params.tokens.accessToken),
      refresh_token_cifrado: cifrar(params.tokens.refreshToken),
      expires_at: params.tokens.expiresAt,
      scopes: params.scopes,
      ativo: true,
      conectado_por: params.perfilId,
    },
    { onConflict: 'organizacao_id' },
  )
  if (error) return { ok: false, mensagem: error.message }
  return { ok: true }
}

export async function statusConexao(
  organizacaoId: string,
  admin: SupabaseClient = createSupabaseAdminClient(),
): Promise<{ conectado: false } | { conectado: true; conexao: ConexaoHubspot }> {
  const { data } = await admin
    .from('integracoes_hubspot')
    .select('hubspot_portal_id, scopes, ativo, ultima_sincronizacao, expires_at')
    .eq('organizacao_id', organizacaoId)
    .maybeSingle<LinhaIntegracao>()
  if (!data) return { conectado: false }
  return {
    conectado: true,
    conexao: {
      hubspotPortalId: data.hubspot_portal_id,
      scopes: data.scopes ?? [],
      ativo: data.ativo,
      expiresAt: data.expires_at,
      ultimaSincronizacao: data.ultima_sincronizacao,
    },
  }
}

export async function desconectar(
  organizacaoId: string,
  admin: SupabaseClient = createSupabaseAdminClient(),
): Promise<{ ok: true } | { ok: false; mensagem: string }> {
  const { error } = await admin.from('integracoes_hubspot').delete().eq('organizacao_id', organizacaoId)
  if (error) return { ok: false, mensagem: error.message }
  return { ok: true }
}

export async function registrarSincronizacao(
  organizacaoId: string,
  admin: SupabaseClient = createSupabaseAdminClient(),
): Promise<void> {
  await admin
    .from('integracoes_hubspot')
    .update({ ultima_sincronizacao: new Date().toISOString() })
    .eq('organizacao_id', organizacaoId)
}

export type ResultadoAccessToken =
  | { ok: true; accessToken: string }
  | { ok: false; motivo: 'nao_conectado' | 'inativo' | 'app_nao_configurado' | 'erro_refresh' }

const MARGEM_EXPIRACAO_MS = 5 * 60 * 1000 // renova 5 min antes de expirar

// Único ponto que devolve um access token utilizável. Nunca sai do backend —
// quem chama usa e descarta; não persistir/logar o retorno.
export async function getValidHubSpotAccessToken(
  organizacaoId: string,
  deps: { admin?: SupabaseClient; fetch?: typeof fetch; agora?: () => number } = {},
): Promise<ResultadoAccessToken> {
  const admin = deps.admin ?? createSupabaseAdminClient()
  const agora = deps.agora ?? (() => Date.now())

  const { data } = await admin
    .from('integracoes_hubspot')
    .select('access_token_cifrado, refresh_token_cifrado, expires_at, ativo')
    .eq('organizacao_id', organizacaoId)
    .maybeSingle<Pick<LinhaIntegracao, 'access_token_cifrado' | 'refresh_token_cifrado' | 'expires_at' | 'ativo'>>()

  if (!data) return { ok: false, motivo: 'nao_conectado' }
  if (!data.ativo) return { ok: false, motivo: 'inativo' }

  const expiraEm = new Date(data.expires_at).getTime()
  if (agora() < expiraEm - MARGEM_EXPIRACAO_MS) {
    return { ok: true, accessToken: decifrar(data.access_token_cifrado) }
  }

  const cfg = lerConfigHubspotApp()
  if (!cfg) return { ok: false, motivo: 'app_nao_configurado' }

  const refreshToken = decifrar(data.refresh_token_cifrado)
  const resultado = await renovarTokens(cfg, refreshToken, deps.fetch)
  if (!resultado.ok) return { ok: false, motivo: 'erro_refresh' }

  await admin
    .from('integracoes_hubspot')
    .update({
      access_token_cifrado: cifrar(resultado.tokens.accessToken),
      refresh_token_cifrado: cifrar(resultado.tokens.refreshToken),
      expires_at: resultado.tokens.expiresAt,
    })
    .eq('organizacao_id', organizacaoId)

  return { ok: true, accessToken: resultado.tokens.accessToken }
}
