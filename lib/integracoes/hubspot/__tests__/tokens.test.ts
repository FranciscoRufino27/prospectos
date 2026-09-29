// Isolamento multi-tenant e ciclo de vida do token, no nível do código —
// mesmo padrão de lib/renovacao/__tests__/multitenant.test.ts: client Supabase
// falso que registra .eq() e payloads; a garantia central é que NENHUMA
// chamada toca organizacao_id != org do chamador.
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { cifrar } from '@/lib/seguranca/criptografia'
import {
  getValidHubSpotAccessToken,
  salvarConexao,
  statusConexao,
  desconectar,
} from '../tokens'

beforeAll(() => {
  process.env.INTEGRACOES_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
  process.env.HUBSPOT_CLIENT_ID = 'client-1'
  process.env.HUBSPOT_CLIENT_SECRET = 'segredo-app'
  process.env.HUBSPOT_REDIRECT_URI = 'http://localhost:3000/api/integracoes/hubspot/callback'
})

const ORG = 'org-aaaa'

class Chain {
  eqCalls: [string, unknown][] = []
  payload: Record<string, unknown> | null = null
  mode: 'select' | 'upsert' | 'update' | 'delete' = 'select'
  constructor(public table: string, private linha: Record<string, unknown> | null) {}
  select() { this.mode = 'select'; return this }
  upsert(row: Record<string, unknown>) { this.mode = 'upsert'; this.payload = row; return this }
  update(row: Record<string, unknown>) { this.mode = 'update'; this.payload = row; return this }
  delete() { this.mode = 'delete'; return this }
  eq(c: string, v: unknown) { this.eqCalls.push([c, v]); return this }
  maybeSingle() { return this }
  temEq(col: string, val: unknown) { return this.eqCalls.some(([c, v]) => c === col && v === val) }
  then(resolve: (v: unknown) => void) {
    if (this.mode === 'select') resolve({ data: this.linha, error: null })
    else resolve({ error: null })
  }
}

function mockClient(linha: Record<string, unknown> | null) {
  const chains: Chain[] = []
  const client = {
    from(table: string) { const c = new Chain(table, linha); chains.push(c); return c },
  } as unknown as SupabaseClient
  return { client, chains }
}

function fetchFake(status: number, corpo: unknown) {
  return vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => corpo })) as unknown as typeof fetch
}

const linhaValida = (expiresAt: string) => ({
  access_token_cifrado: cifrar('access-atual'),
  refresh_token_cifrado: cifrar('refresh-atual'),
  expires_at: expiresAt,
  ativo: true,
})

describe('getValidHubSpotAccessToken', () => {
  it('não conectado → nao_conectado, sem chamar refresh', async () => {
    const { client } = mockClient(null)
    const r = await getValidHubSpotAccessToken(ORG, { admin: client })
    expect(r).toEqual({ ok: false, motivo: 'nao_conectado' })
  })

  it('inativo → inativo', async () => {
    const { client } = mockClient({ ...linhaValida(new Date(Date.now() + 3600_000).toISOString()), ativo: false })
    const r = await getValidHubSpotAccessToken(ORG, { admin: client })
    expect(r).toEqual({ ok: false, motivo: 'inativo' })
  })

  it('token ainda longe de expirar → devolve decifrado, sem chamar a rede', async () => {
    const { client } = mockClient(linhaValida(new Date(Date.now() + 3600_000).toISOString()))
    const fetchMock = fetchFake(200, {})
    const r = await getValidHubSpotAccessToken(ORG, { admin: client, fetch: fetchMock })
    expect(r).toEqual({ ok: true, accessToken: 'access-atual' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('token expirado → renova, persiste os novos tokens cifrados e devolve o novo', async () => {
    const { client, chains } = mockClient(linhaValida(new Date(Date.now() - 1000).toISOString()))
    const fetchMock = fetchFake(200, { access_token: 'access-novo', refresh_token: 'refresh-novo', expires_in: 1800 })
    const r = await getValidHubSpotAccessToken(ORG, { admin: client, fetch: fetchMock })
    expect(r).toEqual({ ok: true, accessToken: 'access-novo' })
    expect(fetchMock).toHaveBeenCalledOnce()
    const body = String((fetchMock as ReturnType<typeof vi.fn>).mock.calls[0][1]?.body)
    expect(body).toContain('grant_type=refresh_token')
    expect(body).toContain('refresh_token=refresh-atual')

    const update = chains.find((c) => c.table === 'integracoes_hubspot' && c.mode === 'update')
    expect(update?.temEq('organizacao_id', ORG)).toBe(true)
    // nunca em texto puro
    expect(JSON.stringify(update?.payload)).not.toContain('access-novo')
    expect(JSON.stringify(update?.payload)).not.toContain('refresh-novo')
  })

  it('falha no refresh → erro_refresh', async () => {
    const { client } = mockClient(linhaValida(new Date(Date.now() - 1000).toISOString()))
    const fetchMock = fetchFake(400, { message: 'invalid refresh token' })
    const r = await getValidHubSpotAccessToken(ORG, { admin: client, fetch: fetchMock })
    expect(r).toEqual({ ok: false, motivo: 'erro_refresh' })
  })

  it('app não configurado no servidor (falta env) → app_nao_configurado', async () => {
    const antigo = process.env.HUBSPOT_CLIENT_ID
    delete process.env.HUBSPOT_CLIENT_ID
    const { client } = mockClient(linhaValida(new Date(Date.now() - 1000).toISOString()))
    const r = await getValidHubSpotAccessToken(ORG, { admin: client, fetch: fetchFake(200, {}) })
    expect(r).toEqual({ ok: false, motivo: 'app_nao_configurado' })
    process.env.HUBSPOT_CLIENT_ID = antigo
  })

  it('isolamento: toda chamada ao Supabase filtra a organização do chamador, nunca outra', async () => {
    const { client, chains } = mockClient(linhaValida(new Date(Date.now() + 3600_000).toISOString()))
    await getValidHubSpotAccessToken(ORG, { admin: client })
    for (const c of chains) {
      for (const [col, val] of c.eqCalls) {
        if (col === 'organizacao_id') expect(val).toBe(ORG)
      }
    }
  })
})

describe('statusConexao / salvarConexao / desconectar — escopo por organização', () => {
  it('statusConexao: integração inexistente → conectado false', async () => {
    const { client } = mockClient(null)
    const r = await statusConexao(ORG, client)
    expect(r).toEqual({ conectado: false })
  })

  it('salvarConexao: grava tokens CIFRADOS (nunca texto puro) e filtra a org no upsert', async () => {
    const { client, chains } = mockClient(null)
    const r = await salvarConexao({
      organizacaoId: ORG,
      perfilId: 'perfil-1',
      hubspotPortalId: 12345,
      scopes: ['oauth', 'crm.objects.contacts.read'],
      tokens: { accessToken: 'novo-access', refreshToken: 'novo-refresh', expiresAt: new Date().toISOString() },
      admin: client,
    })
    expect(r).toEqual({ ok: true })
    const upsert = chains.find((c) => c.mode === 'upsert')
    expect(upsert?.payload?.organizacao_id).toBe(ORG)
    expect(upsert?.payload?.hubspot_portal_id).toBe(12345)
    expect(JSON.stringify(upsert?.payload)).not.toContain('novo-access')
    expect(JSON.stringify(upsert?.payload)).not.toContain('novo-refresh')
  })

  it('desconectar: DELETE filtrado pela organização do chamador', async () => {
    const { client, chains } = mockClient(null)
    const r = await desconectar(ORG, client)
    expect(r).toEqual({ ok: true })
    const del = chains.find((c) => c.mode === 'delete')
    expect(del?.temEq('organizacao_id', ORG)).toBe(true)
  })
})
