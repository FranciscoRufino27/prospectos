// Isolamento multi-tenant no NÍVEL DO CÓDIGO (migration 0006).
//
// O SupabaseStore usa service_role, que BYPASSA a RLS do Postgres — então o
// isolamento nesse caminho depende de o Store SEMPRE filtrar/gravar
// organizacao_id. Estes testes provam exatamente isso com um client Supabase
// falso que grava as chamadas .eq()/.insert(). (O isolamento por RLS de
// verdade, com 2 orgs, é testado à parte no Supabase — service_role não passa
// por RLS.)
import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SupabaseStore } from '../store/supabaseStore'

const ORG = 'org-aaaa'

// Builder falso do supabase-js: todo método encadeável devolve a si mesmo e
// registra os .eq(); é "thenable" pra funcionar com await. Um por tabela.
class MockChain {
  eqCalls: [string, unknown][] = []
  insertPayload: Record<string, unknown> | null = null
  updatePayload: Record<string, unknown> | null = null
  upsertPayload: Record<string, unknown> | null = null
  ilikeCalls: [string, string][] = []
  constructor(private result: { data?: unknown; count?: number } = { data: [] }) {}
  select() { return this }
  update(row: Record<string, unknown>) { this.updatePayload = row; return this }
  insert(row: Record<string, unknown>) { this.insertPayload = row; return this }
  upsert(row: Record<string, unknown>) { this.upsertPayload = row; return this }
  eq(c: string, v: unknown) { this.eqCalls.push([c, v]); return this }
  in() { return this }
  ilike(c: string, v: string) { this.ilikeCalls.push([c, v]); return this }
  is() { return this }
  gte() { return this }
  order() { return this }
  limit() { return this }
  maybeSingle() { return this }
  then(resolve: (v: unknown) => void) {
    resolve({ data: this.result.data ?? [], error: null, count: this.result.count ?? 0 })
  }
  temEq(col: string, val: unknown) {
    return this.eqCalls.some(([c, v]) => c === col && v === val)
  }
}

function mockClient() {
  const chains: Record<string, MockChain> = {}
  const client = {
    from(table: string) {
      const c = new MockChain({ data: [] })
      chains[table] = c // guarda o ÚLTIMO chain daquela tabela
      return c
    },
  } as unknown as SupabaseClient
  return { client, chains }
}

describe('multi-tenant — SupabaseStore filtra/grava organizacao_id', () => {
  it('buscarLead filtra por organizacao_id (além do id)', async () => {
    const { client, chains } = mockClient()
    await new SupabaseStore(ORG, client).buscarLead('L1')
    expect(chains.leads.temEq('organizacao_id', ORG)).toBe(true)
    expect(chains.leads.temEq('id', 'L1')).toBe(true)
  })

  it('atualizarLead filtra por organizacao_id', async () => {
    const { client, chains } = mockClient()
    await new SupabaseStore(ORG, client).atualizarLead('L1', { estagio: 'follow_up' })
    expect(chains.leads.temEq('organizacao_id', ORG)).toBe(true)
    expect(chains.leads.temEq('id', 'L1')).toBe(true)
  })

  it('registrarInteracao GRAVA organizacao_id e atualiza o último contato por e-mail', async () => {
    const { client, chains } = mockClient()
    await new SupabaseStore(ORG, client).registrarInteracao({
      lead_id: 'L1', tipo: 'follow_up', canal: 'email', descricao: 'x', origem_acao: 'ia',
    })
    expect(chains.interacoes.insertPayload?.organizacao_id).toBe(ORG)
    expect(chains.leads.updatePayload?.ultimo_contato).toEqual(expect.any(String))
    expect(chains.leads.temEq('id', 'L1')).toBe(true)
    expect(chains.leads.temEq('organizacao_id', ORG)).toBe(true)
  })

  it('leadsParaFollowup filtra por organizacao_id + owner', async () => {
    const { client, chains } = mockClient()
    await new SupabaseStore(ORG, client).leadsParaFollowup()
    expect(chains.leads.temEq('organizacao_id', ORG)).toBe(true)
    expect(chains.leads.temEq('owner', 'engine')).toBe(true)
  })

  it('contarInteracoes / enviosHoje filtram por organizacao_id', async () => {
    const { client, chains } = mockClient()
    const store = new SupabaseStore(ORG, client)
    await store.contarInteracoes('L1', 'follow_up')
    expect(chains.interacoes.temEq('organizacao_id', ORG)).toBe(true)
    await store.enviosHoje()
    expect(chains.interacoes.temEq('organizacao_id', ORG)).toBe(true)
  })

  it('buscarUsuario filtra por organizacao_id', async () => {
    const { client, chains } = mockClient()
    await new SupabaseStore(ORG, client).buscarUsuario('u1')
    expect(chains.usuarios.temEq('organizacao_id', ORG)).toBe(true)
  })

  it('buscarTemplateEmail filtra por organizacao_id', async () => {
    const { client, chains } = mockClient()
    await new SupabaseStore(ORG, client).buscarTemplateEmail('oticas', 'primeiro_contato')
    expect(chains.templates.temEq('organizacao_id', ORG)).toBe(true)
  })

  it('buscarLeadsPorEmail filtra por organizacao_id, sem trava de owner, e escapa curingas', async () => {
    const { client, chains } = mockClient()
    await new SupabaseStore(ORG, client).buscarLeadsPorEmail(' Leandro_Pedro7@Hotmail.com ')
    expect(chains.leads.temEq('organizacao_id', ORG)).toBe(true)
    expect(chains.leads.eqCalls.some(([c]) => c === 'owner')).toBe(false)
    expect(chains.leads.ilikeCalls).toEqual([['contato_email', 'leandro\\_pedro7@hotmail.com']])
  })

  it('registrarEmailInvalido GRAVA organizacao_id e o e-mail normalizado', async () => {
    const { client, chains } = mockClient()
    await new SupabaseStore(ORG, client).registrarEmailInvalido(' Fulano@Yahoo.com.br ', '5.1.1')
    expect(chains.emails_invalidos.upsertPayload).toEqual({
      organizacao_id: ORG, email: 'fulano@yahoo.com.br', motivo: '5.1.1', origem: 'bounce',
    })
  })

  it('expõe organizacaoId (os fluxos leem daqui p/ a config da org certa)', () => {
    expect(new SupabaseStore(ORG, mockClient().client).organizacaoId).toBe(ORG)
  })
})
