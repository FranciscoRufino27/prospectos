// Isolamento multi-tenant do outbox de avisos no NÍVEL DO CÓDIGO (service_role
// bypassa RLS → toda chamada filtra/grava organizacao_id) e a forma do
// compare-and-swap de reivindicação.
import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SupabaseAvisoRespostaRepository } from '../supabaseRepository'

const ORG = 'org-aaaa'
const OUTRA = 'org-bbbb'
const LINHA = {
  id: 'a1', organizacao_id: ORG, lead_id: 'l1', evento_id: 'email:<m1>', destino_tipo: 'responsavel', status: 'pendente',
  tentativas: 0, ultimo_erro: null,
  dados: { empresa: 'ACME', contato: 'Ana', canal: 'email', classificacao: 'neutro', trecho: 'oi', responsavelId: 'p1', responsavelNome: 'Bruno', link: null },
  destino: null, provider_message_id: null, enviado_em: null, criado_em: '2026-09-28T00:00:00Z',
}

class Chain {
  eqCalls: [string, unknown][] = []
  inCalls: [string, unknown[]][] = []
  gteCalls: [string, unknown][] = []
  upsertPayload: Record<string, unknown> | null = null
  upsertOpts: Record<string, unknown> | null = null
  updatePayload: Record<string, unknown> | null = null
  constructor(public table: string, private resposta: unknown) {}
  select() { return this }
  upsert(row: Record<string, unknown>, opts: Record<string, unknown>) { this.upsertPayload = row; this.upsertOpts = opts; return this }
  update(row: Record<string, unknown>) { this.updatePayload = row; return this }
  eq(c: string, v: unknown) { this.eqCalls.push([c, v]); return this }
  in(c: string, v: unknown[]) { this.inCalls.push([c, v]); return this }
  lt() { return this }
  gte(c: string, v: unknown) { this.gteCalls.push([c, v]); return this }
  order() { return this }
  limit() { return this }
  maybeSingle() { return this }
  temEq(col: string, val: unknown) { return this.eqCalls.some(([c, v]) => c === col && v === val) }
  then(resolve: (v: unknown) => void) { resolve({ data: this.resposta, error: null }) }
}

function mockClient(resposta: unknown = LINHA) {
  const chains: Chain[] = []
  const client = { from(table: string) { const c = new Chain(table, resposta); chains.push(c); return c } } as unknown as SupabaseClient
  return { client, chains }
}

describe('multi-tenant — SupabaseAvisoRespostaRepository', () => {
  it('registrar grava organizacao_id, ignora duplicata pelo índice (org, evento, destino) e relê pela org', async () => {
    const { client, chains } = mockClient()
    const repo = new SupabaseAvisoRespostaRepository(client)
    const a = await repo.registrar(ORG, { leadId: 'l1', eventoId: 'email:<m1>', destinoTipo: 'responsavel', dados: LINHA.dados as never })
    expect(chains[0].table).toBe('avisos_resposta_cliente')
    expect(chains[0].upsertPayload).toMatchObject({ organizacao_id: ORG, lead_id: 'l1', evento_id: 'email:<m1>', destino_tipo: 'responsavel', status: 'pendente' })
    expect(chains[0].upsertOpts).toMatchObject({ onConflict: 'organizacao_id,evento_id,destino_tipo', ignoreDuplicates: true })
    expect(chains[1].temEq('organizacao_id', ORG)).toBe(true)
    expect(a.dados.responsavelNome).toBe('Bruno')
    expect(a.dados.classificacao).toBe('neutro')
  })

  it('toda leitura filtra pela organização informada', async () => {
    const { client, chains } = mockClient([LINHA])
    const repo = new SupabaseAvisoRespostaRepository(client)
    await repo.listarPorEvento(OUTRA, 'email:<m1>')
    await repo.existeDesde(OUTRA, 'l1', '2026-09-28T00:00:00Z')
    await repo.listarReprocessaveis(OUTRA, 5, '2026-09-27T00:00:00Z', 10)
    for (const c of chains) {
      expect(c.temEq('organizacao_id', OUTRA)).toBe(true)
      expect(c.temEq('organizacao_id', ORG)).toBe(false)
    }
    expect(chains[1].temEq('lead_id', 'l1')).toBe(true)
    expect(chains[2].gteCalls).toContainEqual(['criado_em', '2026-09-27T00:00:00Z'])
  })

  it('buscar e todas as escritas por id filtram também pela organização', async () => {
    const { client, chains } = mockClient(LINHA)
    const repo = new SupabaseAvisoRespostaRepository(client)
    await repo.buscar(ORG, 'a1')
    await repo.marcarEnviada(ORG, 'a1', { destino: '5511999998888', providerMessageId: 'z1' })
    await repo.marcarFalha(ORG, 'a1', 'erro')
    await repo.marcarConfiguracaoAusente(ORG, 'a1', 'sem número')
    for (const c of chains) {
      expect(c.temEq('organizacao_id', ORG)).toBe(true)
      expect(c.temEq('id', 'a1')).toBe(true)
    }
    expect(chains[1].updatePayload).toMatchObject({ status: 'enviada', destino: '5511999998888' })
  })

  it('reivindicarEnvio é compare-and-swap: status reclamável + tentativas esperadas → enviando', async () => {
    const { client, chains } = mockClient([{ id: 'a1' }])
    const repo = new SupabaseAvisoRespostaRepository(client)
    expect(await repo.reivindicarEnvio(ORG, 'a1', 2)).toBe(true)
    const c = chains[0]
    expect(c.updatePayload).toMatchObject({ status: 'enviando', tentativas: 3 })
    expect(c.temEq('organizacao_id', ORG)).toBe(true)
    expect(c.temEq('tentativas', 2)).toBe(true)
    expect(c.inCalls[0]).toEqual(['status', ['pendente', 'falhou', 'configuracao_ausente']])

    const vazio = mockClient([])
    expect(await new SupabaseAvisoRespostaRepository(vazio.client).reivindicarEnvio(ORG, 'a1', 2)).toBe(false)
  })
})
