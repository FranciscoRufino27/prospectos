import { describe, it, expect, vi } from 'vitest'
import { listarGruposZapi } from '../zapi'

// Nenhum teste aqui toca a rede: `fetch` é sempre injetado via deps.

const ENV_OK = { ZAPI_INSTANCE_ID: 'inst-1', ZAPI_TOKEN: 'tok-SECRETO', ZAPI_CLIENT_TOKEN: 'ct-SECRETO' }

function fetchFake(status: number, corpo: unknown) {
  const chamadas: Array<{ url: string; init: RequestInit }> = []
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    chamadas.push({ url: String(url), init: init ?? {} })
    return { ok: status >= 200 && status < 300, status, json: async () => corpo } as unknown as Response
  })
  return { fn: fn as unknown as typeof fetch, chamadas }
}

describe('listarGruposZapi', () => {
  it('env ausente → config_ausente, sem rede', async () => {
    const f = fetchFake(200, [])
    expect(await listarGruposZapi({ fetch: f.fn, env: {} })).toMatchObject({ ok: false, codigo: 'config_ausente' })
    expect(f.chamadas).toHaveLength(0)
  })

  it('GET /groups com Client-Token; devolve só id e nome dos grupos, em ordem alfabética', async () => {
    const f = fetchFake(200, [
      { phone: '120363430808664972-group', name: 'Teste', isGroup: true, messagesUnread: 3, about: 'segredo' },
      { phone: '5511999990000', name: 'Pessoa', isGroup: false },
      { phone: '120363428777776420-group', name: '  Laudos   iA ', isGroup: true },
      { phone: '120363428777776420-group', name: 'Repetido', isGroup: true },
      { phone: '120363000000000001-group', name: '', isGroup: true },
      { phone: 'lixo-group', name: 'Inválido', isGroup: true },
    ])
    const r = await listarGruposZapi({ fetch: f.fn, env: ENV_OK })
    expect(r).toEqual({ ok: true, grupos: [
      { id: '120363000000000001-group', nome: '120363000000000001-group' },
      { id: '120363428777776420-group', nome: 'Laudos iA' },
      { id: '120363430808664972-group', nome: 'Teste' },
    ] })
    const { url, init } = f.chamadas[0]
    expect(url).toMatch(/\/instances\/inst-1\/token\/tok-SECRETO\/groups\?page=1&pageSize=100$/)
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>)['Client-Token']).toBe('ct-SECRETO')
  })

  it('erro da Z-API → erro_provider sem vazar credenciais', async () => {
    const r = await listarGruposZapi({ fetch: fetchFake(401, { error: 'Unauthorized' }).fn, env: ENV_OK })
    expect(r).toMatchObject({ ok: false, codigo: 'erro_provider', status: 401 })
    expect(JSON.stringify(r)).not.toContain('SECRETO')
  })

  it('corpo que não é lista → resposta_invalida', async () => {
    expect(await listarGruposZapi({ fetch: fetchFake(200, { value: 'x' }).fn, env: ENV_OK })).toMatchObject({ ok: false, codigo: 'resposta_invalida' })
  })
})
