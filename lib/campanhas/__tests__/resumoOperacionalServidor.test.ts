import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buscarContextoResumoOperacional } from '../resumoOperacionalServidor'

class Query {
  eqCalls: [string, unknown][] = []

  constructor(
    public table: string,
    private data: unknown,
  ) {}

  select() { return this }
  eq(coluna: string, valor: unknown) { this.eqCalls.push([coluna, valor]); return this }
  async maybeSingle() { return { data: this.data, error: null } }
  temEq(coluna: string, valor: unknown) { return this.eqCalls.some(([c, v]) => c === coluna && v === valor) }
}

function criarClient() {
  const definicaoPublicada = {
    gatilho: { tipo: 'manual', config: {} },
    condicoes: [],
    acoes: [{ id: 'a1', tipo: 'enviar_email', config: { template: 'reativacao_1' } }],
  }
  const dados: Record<string, unknown> = {
    perfis: { nome: 'Ana Comercial' },
    organizacoes: { configuracoes: { nomenclaturas: { email_conta_key: 'LAUDO' } } },
    workflows: {
      id: 'wf-1', nome: 'Reativação', status: 'publicado', versao_atual_id: 'v-2',
      rascunho_definicao: { gatilho: { tipo: 'manual', config: {} }, condicoes: [], acoes: [] },
    },
    workflow_versoes: { definicao: definicaoPublicada },
  }
  const queries: Query[] = []
  const client = {
    from(table: string) {
      const query = new Query(table, dados[table] ?? null)
      queries.push(query)
      return query
    },
  } as unknown as SupabaseClient
  return { client, queries, definicaoPublicada }
}

describe('contexto server do Resumo operacional', () => {
  it('resolve responsável, remetente e versão vigente sem sair da organização', async () => {
    const { client, queries, definicaoPublicada } = criarClient()
    const contas: string[] = []
    const resumo = await buscarContextoResumoOperacional(
      client,
      'org-a',
      { workflow_id: 'wf-1', publico: { responsavel_id: 'user-1' } },
      { resolverRemetente: (conta) => { contas.push(conta); return 'laudos@empresa.com.br' } },
    )

    expect(contas).toEqual(['LAUDO'])
    expect(resumo.remetente).toBe('laudos@empresa.com.br')
    expect(resumo.responsavel).toBe('Ana Comercial')
    expect(resumo.workflow).toEqual({
      id: 'wf-1', nome: 'Reativação', status: 'publicado', definicao: definicaoPublicada,
    })

    for (const query of queries.filter((q) => q.table !== 'organizacoes')) {
      expect(query.temEq('organizacao_id', 'org-a')).toBe(true)
      expect(query.temEq('organizacao_id', 'org-b')).toBe(false)
    }
    expect(queries.find((q) => q.table === 'organizacoes')?.temEq('id', 'org-a')).toBe(true)
  })

  it('mantém campos ausentes como null em vez de inventar configuração', async () => {
    const queries: Query[] = []
    const client = {
      from(table: string) {
        const query = new Query(table, table === 'organizacoes' ? { configuracoes: {} } : null)
        queries.push(query)
        return query
      },
    } as unknown as SupabaseClient

    const resumo = await buscarContextoResumoOperacional(
      client,
      'org-a',
      { workflow_id: null, publico: null },
      { resolverRemetente: () => null },
    )

    expect(resumo).toEqual({ remetente: null, responsavel: null, workflow: null })
    // organizacoes + conta conectada (filtrada pela org), nada mais.
    expect(queries.map((q) => q.table).sort()).toEqual(['organizacao_remetentes_email', 'organizacoes'])
    expect(queries.find((q) => q.table === 'organizacao_remetentes_email')?.temEq('organizacao_id', 'org-a')).toBe(true)
  })
})
