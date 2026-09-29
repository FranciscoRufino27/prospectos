import { describe, it, expect, vi, beforeAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { gerarState } from '../oauth'
import { processarCallbackHubspot } from '../callback'

// cifrar/decifrar (usados por salvarConexao) sempre leem process.env — não são
// injetáveis via deps.env como o resto deste fluxo. Ver lib/seguranca/criptografia.ts.
beforeAll(() => {
  process.env.INTEGRACOES_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
})

const ENV = {
  INTERNAL_SECRET: 'segredo-teste-interno',
  HUBSPOT_CLIENT_ID: 'client-1',
  HUBSPOT_CLIENT_SECRET: 'segredo-app',
  HUBSPOT_REDIRECT_URI: 'http://localhost:3000/api/integracoes/hubspot/callback',
  INTEGRACOES_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
}

function fetchSequencia(respostas: Array<{ status: number; corpo: unknown }>) {
  let i = 0
  return vi.fn(async () => {
    const r = respostas[Math.min(i, respostas.length - 1)]
    i++
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.corpo } as unknown as Response
  }) as unknown as typeof fetch
}

function adminFake() {
  const chamadas: Array<{ table: string; payload?: Record<string, unknown> }> = []
  const client = {
    from(table: string) {
      return {
        upsert(row: Record<string, unknown>) {
          chamadas.push({ table, payload: row })
          return { then: (resolve: (v: unknown) => void) => resolve({ error: null }) }
        },
      }
    },
  } as unknown as SupabaseClient
  return { client, chamadas }
}

describe('processarCallbackHubspot', () => {
  it('sem code → sem_code', async () => {
    const state = gerarState('org-1', 'perfil-1', ENV)
    const r = await processarCallbackHubspot({ code: null, state }, { env: ENV })
    expect(r).toEqual({ ok: false, motivo: 'sem_code' })
  })

  it('state ausente → state_formato_invalido', async () => {
    const r = await processarCallbackHubspot({ code: 'abc', state: null }, { env: ENV })
    expect(r).toEqual({ ok: false, motivo: 'state_formato_invalido' })
  })

  it('state adulterado → state_assinatura_invalida', async () => {
    const state = gerarState('org-1', 'perfil-1', ENV)
    const r = await processarCallbackHubspot({ code: 'abc', state: state.slice(0, -2) + 'zz' }, { env: ENV })
    expect(r).toEqual({ ok: false, motivo: 'state_assinatura_invalida' })
  })

  it('state expirado → state_expirado', async () => {
    const real = Date.now
    Date.now = () => real() - 11 * 60 * 1000
    const state = gerarState('org-1', 'perfil-1', ENV)
    Date.now = real
    const r = await processarCallbackHubspot({ code: 'abc', state }, { env: ENV })
    expect(r).toEqual({ ok: false, motivo: 'state_expirado' })
  })

  it('app não configurado (faltando env) → app_nao_configurado', async () => {
    const state = gerarState('org-1', 'perfil-1', ENV)
    const envSemApp = { ...ENV, HUBSPOT_CLIENT_ID: undefined }
    const r = await processarCallbackHubspot({ code: 'abc', state }, { env: envSemApp })
    expect(r).toEqual({ ok: false, motivo: 'app_nao_configurado' })
  })

  it('troca de code falha no provider → troca_falhou', async () => {
    const state = gerarState('org-1', 'perfil-1', ENV)
    const fetchMock = fetchSequencia([{ status: 400, corpo: { message: 'invalid code' } }])
    const r = await processarCallbackHubspot({ code: 'abc', state }, { env: ENV, fetch: fetchMock })
    expect(r).toEqual({ ok: false, motivo: 'troca_falhou' })
  })

  it('metadados (hub_id) falham → metadados_falharam', async () => {
    const state = gerarState('org-1', 'perfil-1', ENV)
    const fetchMock = fetchSequencia([
      { status: 200, corpo: { access_token: 'at', refresh_token: 'rt', expires_in: 1800 } },
      { status: 500, corpo: {} },
    ])
    const r = await processarCallbackHubspot({ code: 'abc', state }, { env: ENV, fetch: fetchMock })
    expect(r).toEqual({ ok: false, motivo: 'metadados_falharam' })
  })

  it('introspecção devolve token inativo → metadados_falharam, nada persistido', async () => {
    const state = gerarState('org-1', 'perfil-1', ENV)
    const fetchMock = fetchSequencia([
      { status: 200, corpo: { access_token: 'at', refresh_token: 'rt', expires_in: 1800 } },
      { status: 200, corpo: { active: false } },
    ])
    const { client, chamadas } = adminFake()
    const r = await processarCallbackHubspot({ code: 'abc', state }, { env: ENV, fetch: fetchMock, admin: client })
    expect(r).toEqual({ ok: false, motivo: 'metadados_falharam' })
    expect(chamadas).toHaveLength(0)
  })

  it('sucesso: persiste a conexão na ORGANIZAÇÃO DO STATE (não outra)', async () => {
    const state = gerarState('org-do-state', 'perfil-9', ENV)
    const fetchMock = fetchSequencia([
      { status: 200, corpo: { access_token: 'at', refresh_token: 'rt', expires_in: 1800 } },
      { status: 200, corpo: { active: true, hub_id: 999, scopes: ['oauth'] } },
    ])
    const { client, chamadas } = adminFake()
    const r = await processarCallbackHubspot({ code: 'abc', state }, { env: ENV, fetch: fetchMock, admin: client })
    expect(r).toEqual({ ok: true })
    const urls = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]))
    expect(urls).toEqual([
      'https://api.hubapi.com/oauth/2026-03/token',
      'https://api.hubapi.com/oauth/2026-03/token/introspect',
    ])
    expect(chamadas).toHaveLength(1)
    expect(chamadas[0].payload?.organizacao_id).toBe('org-do-state')
    expect(chamadas[0].payload?.hubspot_portal_id).toBe(999)
    // tokens nunca em texto puro no payload persistido
    expect(JSON.stringify(chamadas[0].payload)).not.toContain('"at"')
    expect(JSON.stringify(chamadas[0].payload)).not.toContain('"rt"')
  })
})
