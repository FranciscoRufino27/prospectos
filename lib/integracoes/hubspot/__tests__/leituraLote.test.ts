import { describe, it, expect, vi } from 'vitest'
import { lerAssociacoes, lerObjetosPorIds } from '../leituraLote'
import { consultarHubspot } from '../client'

const resp = (d: unknown, status = 200, headers: Record<string, string> = {}) =>
  ({ ok: status < 300, status, headers: new Headers(headers), json: async () => d }) as unknown as Response

describe('lerObjetosPorIds / lerAssociacoes — lotes de 100, sem N+1', () => {
  it('250 IDs → 3 chamadas de batch/read', async () => {
    const fn = vi.fn(async (_u: string | URL | Request, init?: RequestInit) => {
      const ids = JSON.parse(String(init?.body)).inputs.map((i: { id: string }) => i.id)
      return resp({ results: ids.map((id: string) => ({ id, properties: {} })) })
    }) as unknown as typeof fetch
    const ids = Array.from({ length: 250 }, (_, i) => String(i + 1))
    const r = await lerObjetosPorIds('contacts', 'tk', ids, ['email'], fn)
    expect(r.ok && r.dados.length).toBe(250)
    expect((fn as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(3)
  })

  it('associações: ordena por ID numérico, aplica limite por objeto e marca truncado', async () => {
    const fn = vi.fn(async () => resp({
      results: [{ from: { id: '1' }, to: [{ toObjectId: 30 }, { toObjectId: 4 }, { toObjectId: 100 }] }],
    }, 207)) as unknown as typeof fetch
    const r = await lerAssociacoes('companies', 'contacts', 'tk', ['1', '2'], 2, fn)
    expect(r.ok && r.dados.get('1')).toEqual({ ids: ['4', '30'], truncado: true })
    expect(r.ok && r.dados.get('2')).toEqual({ ids: [], truncado: false }) // sem associação
  })
})

describe('client — 429 (limite da search API)', () => {
  it('tenta de novo e devolve o sucesso', async () => {
    let n = 0
    const fn = vi.fn(async () => (++n === 1 ? resp({ message: 'rate' }, 429, { 'retry-after': '0' }) : resp({ total: 1 }))) as unknown as typeof fetch
    const r = await consultarHubspot('/crm/v3/objects/companies/search', 'tk', {}, fn)
    expect(r).toEqual({ ok: true, dados: { total: 1 } })
    expect(n).toBe(2)
  })
  it('persistindo o 429, devolve erro depois de 3 tentativas', async () => {
    const fn = vi.fn(async () => resp({ message: 'rate' }, 429)) as unknown as typeof fetch
    const r = await consultarHubspot('/x', 'tk', {}, fn)
    expect(r).toMatchObject({ ok: false, codigo: 'erro_provider', status: 429 })
    expect((fn as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(3)
  })
})

