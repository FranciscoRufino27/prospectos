import 'server-only'
import crypto from 'node:crypto'

// Fluxo OAuth HubSpot → ProspectOS (Fase 1, somente leitura).
//
// Somente a API OAuth 2026-03 (spec oficial: HubSpot-public-api-spec-collection,
// PublicApiSpecs/Auth/Oauth/Rollouts/279897/2026-03/oauth.json). Nada de v1.
//   - POST /oauth/2026-03/token            → authorization_code e refresh_token
//   - POST /oauth/2026-03/token/introspect → hub_id, scopes e demais metadados
const TOKEN_URL = 'https://api.hubapi.com/oauth/2026-03/token'
const INTROSPECT_URL = 'https://api.hubapi.com/oauth/2026-03/token/introspect'
const AUTHORIZE_URL = 'https://app.hubspot.com/oauth/authorize'

export const HUBSPOT_SCOPES = [
  'oauth',
  'crm.objects.contacts.read',
  'crm.objects.companies.read',
  'crm.objects.deals.read',
  'crm.objects.owners.read',
] as const

type EnvOAuth = Record<string, string | undefined>

export interface ConfigHubspotApp {
  clientId: string
  clientSecret: string
  redirectUri: string
}

export function lerConfigHubspotApp(env: EnvOAuth = process.env): ConfigHubspotApp | null {
  const clientId = env.HUBSPOT_CLIENT_ID?.trim()
  const clientSecret = env.HUBSPOT_CLIENT_SECRET?.trim()
  const redirectUri = env.HUBSPOT_REDIRECT_URI?.trim()
  if (!clientId || !clientSecret || !redirectUri) return null
  return { clientId, clientSecret, redirectUri }
}

// ----------------------------------------------------------------------------
// State: assinado por HMAC-SHA256(INTERNAL_SECRET), mesmo padrão do token de
// opt-out (lib/engine/optout.ts). Self-contained — carrega organização e
// quem iniciou o connect, com TTL curto. Sem tabela de nonce: o `code` que o
// HubSpot emite é de uso único (reaproveitar derruba a troca no próprio
// provider), o que já cobre o replay do state isolado.
// ----------------------------------------------------------------------------
const STATE_TTL_MS = 10 * 60 * 1000 // 10 minutos

export interface EstadoOAuth {
  org: string
  perfilId: string
  nonce: string
  exp: number // epoch ms
}

function segredoEstado(env: EnvOAuth): string {
  const s = env.INTERNAL_SECRET
  if (!s) throw new Error('INTERNAL_SECRET não configurado (necessário p/ state do OAuth HubSpot)')
  return s
}

function assinar(payload: string, env: EnvOAuth): string {
  return crypto.createHmac('sha256', segredoEstado(env)).update(payload).digest('base64url')
}

export function gerarState(org: string, perfilId: string, env: EnvOAuth = process.env): string {
  const payload: EstadoOAuth = {
    org,
    perfilId,
    nonce: crypto.randomBytes(16).toString('base64url'),
    exp: Date.now() + STATE_TTL_MS,
  }
  const json = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `${json}.${assinar(json, env)}`
}

export type ResultadoState =
  | { ok: true; estado: EstadoOAuth }
  | { ok: false; motivo: 'formato_invalido' | 'assinatura_invalida' | 'expirado' }

export function validarState(state: string | null | undefined, env: EnvOAuth = process.env): ResultadoState {
  if (!state || !state.includes('.')) return { ok: false, motivo: 'formato_invalido' }
  const idx = state.indexOf('.')
  const json = state.slice(0, idx)
  const assinatura = state.slice(idx + 1)
  if (!json || !assinatura) return { ok: false, motivo: 'formato_invalido' }

  const esperada = assinar(json, env)
  const a = Buffer.from(assinatura)
  const b = Buffer.from(esperada)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, motivo: 'assinatura_invalida' }
  }

  let estado: EstadoOAuth
  try {
    estado = JSON.parse(Buffer.from(json, 'base64url').toString('utf8'))
  } catch {
    return { ok: false, motivo: 'formato_invalido' }
  }
  if (typeof estado?.org !== 'string' || !estado.org || typeof estado?.exp !== 'number') {
    return { ok: false, motivo: 'formato_invalido' }
  }
  if (Date.now() > estado.exp) return { ok: false, motivo: 'expirado' }
  return { ok: true, estado }
}

export function montarUrlAutorizacao(cfg: ConfigHubspotApp, state: string): string {
  const u = new URL(AUTHORIZE_URL)
  u.searchParams.set('client_id', cfg.clientId)
  u.searchParams.set('redirect_uri', cfg.redirectUri)
  u.searchParams.set('scope', HUBSPOT_SCOPES.join(' '))
  u.searchParams.set('state', state)
  return u.toString()
}

// ----------------------------------------------------------------------------
// Troca de code/refresh por tokens.
// ----------------------------------------------------------------------------
export interface TokensHubspot {
  accessToken: string
  refreshToken: string
  expiresAt: string // ISO
}

export type ResultadoToken =
  | { ok: true; tokens: TokensHubspot }
  | { ok: false; codigo: 'falha_rede' | 'erro_provider' | 'resposta_invalida'; mensagem: string }

async function trocarPorTokens(body: Record<string, string>, doFetch: typeof fetch): Promise<ResultadoToken> {
  let resposta: Response
  try {
    resposta = await doFetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
    })
  } catch (e) {
    return { ok: false, codigo: 'falha_rede', mensagem: e instanceof Error ? e.message : String(e) }
  }

  let json: unknown
  try {
    json = await resposta.json()
  } catch {
    return { ok: false, codigo: 'resposta_invalida', mensagem: 'Resposta não é JSON' }
  }

  if (!resposta.ok || typeof json !== 'object' || json === null) {
    const corpo = json as Record<string, unknown> | null
    const msg = typeof corpo?.message === 'string' ? corpo.message : `HTTP ${resposta.status}`
    return { ok: false, codigo: 'erro_provider', mensagem: msg }
  }

  const d = json as Record<string, unknown>
  if (typeof d.access_token !== 'string' || typeof d.refresh_token !== 'string' || typeof d.expires_in !== 'number') {
    return { ok: false, codigo: 'resposta_invalida', mensagem: 'Campos esperados ausentes na resposta de token' }
  }
  return {
    ok: true,
    tokens: {
      accessToken: d.access_token,
      refreshToken: d.refresh_token,
      expiresAt: new Date(Date.now() + d.expires_in * 1000).toISOString(),
    },
  }
}

export function trocarCodigoPorTokens(
  cfg: ConfigHubspotApp,
  code: string,
  doFetch: typeof fetch = fetch,
): Promise<ResultadoToken> {
  return trocarPorTokens(
    {
      grant_type: 'authorization_code',
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
      code,
    },
    doFetch,
  )
}

export function renovarTokens(
  cfg: ConfigHubspotApp,
  refreshToken: string,
  doFetch: typeof fetch = fetch,
): Promise<ResultadoToken> {
  return trocarPorTokens(
    {
      grant_type: 'refresh_token',
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: refreshToken,
    },
    doFetch,
  )
}

// ----------------------------------------------------------------------------
// Introspecção do access token recém-emitido (PublicAccessTokenInfoResponse).
// Token inválido/revogado volta 200 com { active: false } — tratado como erro.
// ----------------------------------------------------------------------------
export interface MetadadosToken {
  hubId: number
  hubDomain: string | null
  scopes: string[]
  appId: number | null
  userId: number | null
  expiresIn: number | null
}

export type ResultadoMetadados = { ok: true; metadados: MetadadosToken } | { ok: false; mensagem: string }

const inteiroOuNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export async function obterMetadadosToken(
  cfg: ConfigHubspotApp,
  accessToken: string,
  doFetch: typeof fetch = fetch,
): Promise<ResultadoMetadados> {
  let resposta: Response
  try {
    resposta = await doFetch(INTROSPECT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        token: accessToken,
        token_type_hint: 'access_token',
      }).toString(),
    })
  } catch (e) {
    return { ok: false, mensagem: e instanceof Error ? e.message : String(e) }
  }
  if (!resposta.ok) return { ok: false, mensagem: `HTTP ${resposta.status}` }

  let json: unknown
  try {
    json = await resposta.json()
  } catch {
    return { ok: false, mensagem: 'Resposta não é JSON' }
  }
  const d = (json ?? {}) as Record<string, unknown>
  if (d.active !== true) return { ok: false, mensagem: 'Token inativo na introspecção' }

  const hubId = inteiroOuNull(d.hub_id)
  if (hubId === null) return { ok: false, mensagem: 'hub_id ausente ou inválido na resposta' }
  return {
    ok: true,
    metadados: {
      hubId,
      hubDomain: typeof d.hub_domain === 'string' && d.hub_domain ? d.hub_domain : null,
      scopes: Array.isArray(d.scopes) ? d.scopes.filter((s): s is string => typeof s === 'string') : [],
      appId: inteiroOuNull(d.app_id),
      userId: inteiroOuNull(d.user_id),
      expiresIn: inteiroOuNull(d.expires_in),
    },
  }
}
