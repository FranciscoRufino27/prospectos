import { describe, it, expect, vi } from 'vitest'
import {
  gerarState,
  validarState,
  lerConfigHubspotApp,
  montarUrlAutorizacao,
  trocarCodigoPorTokens,
  renovarTokens,
  obterMetadadosToken,
  HUBSPOT_SCOPES,
} from '../oauth'

const ENV_OK = { INTERNAL_SECRET: 'segredo-teste-interno' }
const CFG = { clientId: 'client-1', clientSecret: 'segredo-app', redirectUri: 'http://localhost:3000/api/integracoes/hubspot/callback' }

function fetchFake(status: number, corpo: unknown) {
  const chamadas: Array<{ url: string; init?: RequestInit }> = []
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    chamadas.push({ url: String(url), init })
    return { ok: status >= 200 && status < 300, status, json: async () => corpo } as unknown as Response
  })
  return { fn: fn as unknown as typeof fetch, chamadas }
}

describe('lerConfigHubspotApp', () => {
  it('null quando falta qualquer uma das três variáveis', () => {
    expect(lerConfigHubspotApp({})).toBeNull()
    expect(lerConfigHubspotApp({ HUBSPOT_CLIENT_ID: 'x', HUBSPOT_CLIENT_SECRET: '', HUBSPOT_REDIRECT_URI: 'y' })).toBeNull()
  })
  it('lê as três quando presentes', () => {
    expect(lerConfigHubspotApp({ HUBSPOT_CLIENT_ID: 'a', HUBSPOT_CLIENT_SECRET: 'b', HUBSPOT_REDIRECT_URI: 'c' }))
      .toEqual({ clientId: 'a', clientSecret: 'b', redirectUri: 'c' })
  })
})

describe('montarUrlAutorizacao', () => {
  it('inclui client_id, redirect_uri, scopes e state', () => {
    const url = new URL(montarUrlAutorizacao(CFG, 'state-xyz'))
    expect(url.origin + url.pathname).toBe('https://app.hubspot.com/oauth/authorize')
    expect(url.searchParams.get('client_id')).toBe('client-1')
    expect(url.searchParams.get('redirect_uri')).toBe(CFG.redirectUri)
    expect(url.searchParams.get('scope')).toBe(HUBSPOT_SCOPES.join(' '))
    expect(url.searchParams.get('state')).toBe('state-xyz')
  })
})

describe('gerarState / validarState', () => {
  it('state gerado é válido e carrega org/perfilId', () => {
    const state = gerarState('org-1', 'perfil-1', ENV_OK)
    const r = validarState(state, ENV_OK)
    expect(r).toMatchObject({ ok: true, estado: { org: 'org-1', perfilId: 'perfil-1' } })
  })

  it('formato inválido (sem ponto separador)', () => {
    expect(validarState('nao-tem-ponto', ENV_OK)).toEqual({ ok: false, motivo: 'formato_invalido' })
  })

  it('null/undefined/vazio → formato inválido', () => {
    expect(validarState(null, ENV_OK)).toMatchObject({ ok: false, motivo: 'formato_invalido' })
    expect(validarState(undefined, ENV_OK)).toMatchObject({ ok: false, motivo: 'formato_invalido' })
    expect(validarState('', ENV_OK)).toMatchObject({ ok: false, motivo: 'formato_invalido' })
  })

  it('assinatura adulterada é rejeitada', () => {
    const state = gerarState('org-1', 'perfil-1', ENV_OK)
    const adulterado = state.slice(0, -2) + 'zz'
    expect(validarState(adulterado, ENV_OK)).toEqual({ ok: false, motivo: 'assinatura_invalida' })
  })

  it('assinado com segredo diferente é rejeitado', () => {
    const state = gerarState('org-1', 'perfil-1', { INTERNAL_SECRET: 'outro-segredo' })
    expect(validarState(state, ENV_OK)).toEqual({ ok: false, motivo: 'assinatura_invalida' })
  })

  it('state expirado é rejeitado', () => {
    const real = Date.now
    Date.now = () => real() - 11 * 60 * 1000 // gera como se fosse 11 min atrás
    const state = gerarState('org-1', 'perfil-1', ENV_OK)
    Date.now = real
    expect(validarState(state, ENV_OK)).toEqual({ ok: false, motivo: 'expirado' })
  })
})

describe('trocarCodigoPorTokens', () => {
  it('monta o body de authorization_code e devolve os tokens', async () => {
    const f = fetchFake(200, { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 1800 })
    const r = await trocarCodigoPorTokens(CFG, 'code-abc', f.fn)
    expect(r).toMatchObject({ ok: true, tokens: { accessToken: 'at-1', refreshToken: 'rt-1' } })
    expect(f.chamadas).toHaveLength(1)
    expect(f.chamadas[0].url).toBe('https://api.hubapi.com/oauth/2026-03/token')
    const body = String(f.chamadas[0].init?.body)
    expect(body).toContain('grant_type=authorization_code')
    expect(body).toContain('code=code-abc')
    expect(body).toContain('client_secret=segredo-app')
  })

  it('provider retorna erro → erro_provider com a mensagem', async () => {
    const f = fetchFake(400, { message: 'invalid code' })
    const r = await trocarCodigoPorTokens(CFG, 'code-invalido', f.fn)
    expect(r).toEqual({ ok: false, codigo: 'erro_provider', mensagem: 'invalid code' })
  })

  it('resposta sem os campos esperados → resposta_invalida', async () => {
    const f = fetchFake(200, { algo: 'inesperado' })
    const r = await trocarCodigoPorTokens(CFG, 'code-x', f.fn)
    expect(r).toMatchObject({ ok: false, codigo: 'resposta_invalida' })
  })

  it('fetch lança → falha_rede', async () => {
    const fn = vi.fn(async () => { throw new Error('timeout') }) as unknown as typeof fetch
    const r = await trocarCodigoPorTokens(CFG, 'code-x', fn)
    expect(r).toMatchObject({ ok: false, codigo: 'falha_rede' })
  })
})

describe('renovarTokens', () => {
  it('monta o body de refresh_token', async () => {
    const f = fetchFake(200, { access_token: 'at-2', refresh_token: 'rt-2', expires_in: 1800 })
    const r = await renovarTokens(CFG, 'refresh-antigo', f.fn)
    expect(r).toMatchObject({ ok: true, tokens: { accessToken: 'at-2', refreshToken: 'rt-2' } })
    const body = String(f.chamadas[0].init?.body)
    expect(body).toContain('grant_type=refresh_token')
    expect(body).toContain('refresh_token=refresh-antigo')
  })
})

describe('obterMetadadosToken (introspecção 2026-03)', () => {
  const ATIVO = {
    active: true,
    hub_id: 12345,
    hub_domain: 'empresa.hubspot.com',
    scopes: ['oauth', 'crm.objects.contacts.read'],
    app_id: 54847041,
    user_id: 777,
    expires_in: 1799,
    client_id: 'client-1',
    token: 'at-1',
    token_type: 'bearer',
    token_use: 'access_token',
  }

  it('POST form-urlencoded no /oauth/2026-03/token/introspect com client_id, client_secret, token e hint', async () => {
    const f = fetchFake(200, ATIVO)
    await obterMetadadosToken(CFG, 'at-1', f.fn)
    expect(f.chamadas).toHaveLength(1)
    expect(f.chamadas[0].url).toBe('https://api.hubapi.com/oauth/2026-03/token/introspect')
    expect(f.chamadas[0].init?.method).toBe('POST')
    expect((f.chamadas[0].init?.headers as Record<string, string>)['Content-Type']).toBe('application/x-www-form-urlencoded')
    const body = new URLSearchParams(String(f.chamadas[0].init?.body))
    expect(Object.fromEntries(body)).toEqual({
      client_id: 'client-1',
      client_secret: 'segredo-app',
      token: 'at-1',
      token_type_hint: 'access_token',
    })
  })

  it('nunca chama nenhum endpoint OAuth v1', async () => {
    const f = fetchFake(200, ATIVO)
    await obterMetadadosToken(CFG, 'at-1', f.fn)
    for (const c of f.chamadas) expect(c.url).not.toContain('/oauth/v1/')
  })

  it('token ativo → hub_id, hub_domain, scopes, app_id, user_id, expires_in', async () => {
    const f = fetchFake(200, ATIVO)
    const r = await obterMetadadosToken(CFG, 'at-1', f.fn)
    expect(r).toEqual({
      ok: true,
      metadados: {
        hubId: 12345,
        hubDomain: 'empresa.hubspot.com',
        scopes: ['oauth', 'crm.objects.contacts.read'],
        appId: 54847041,
        userId: 777,
        expiresIn: 1799,
      },
    })
  })

  it('token inativo ({ active: false }) → erro', async () => {
    const f = fetchFake(200, { active: false })
    const r = await obterMetadadosToken(CFG, 'at-1', f.fn)
    expect(r).toEqual({ ok: false, mensagem: 'Token inativo na introspecção' })
  })

  it('ativo mas sem hub_id → erro', async () => {
    const f = fetchFake(200, { ...ATIVO, hub_id: undefined })
    const r = await obterMetadadosToken(CFG, 'at-1', f.fn)
    expect(r.ok).toBe(false)
  })

  it('provider responde não-2xx → erro', async () => {
    const f = fetchFake(400, { message: 'missing client_id' })
    const r = await obterMetadadosToken(CFG, 'at-1', f.fn)
    expect(r).toEqual({ ok: false, mensagem: 'HTTP 400' })
  })
})
