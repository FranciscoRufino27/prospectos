import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buscarResumosExecucoesCampanhas } from '../resumoExecucoesServidor'

// Mock do query builder que respeita `eq`/`in`/`range` como o PostgREST real,
// inclusive o teto de 1000 linhas por resposta — é o teto que o resumo precisa
// paginar para não cortar a contagem de campanha grande.
const TETO_POSTGREST = 1000

class Query {
  eqCalls: [string, unknown][] = []
  inCalls: [string, unknown[]][] = []
  private intervalo: [number, number] | null = null

  constructor(public table: string, private linhas: Record<string, unknown>[]) {}

  select() { return this }
  order() { return this }
  gte() { return this }
  eq(coluna: string, valor: unknown) { this.eqCalls.push([coluna, valor]); return this }
  in(coluna: string, valores: unknown[]) { this.inCalls.push([coluna, valores]); return this }
  range(de: number, ate: number) { this.intervalo = [de, ate]; return this }
  then(resolve: (r: { data: unknown[]; error: null }) => unknown) {
    const filtradas = this.linhas.filter((linha) =>
      this.eqCalls.every(([c, v]) => !(c in linha) || linha[c] === v)
      && this.inCalls.every(([c, vs]) => vs.includes(linha[c])))
    const [de, ate] = this.intervalo ?? [0, Infinity]
    const pagina = filtradas.slice(de, Math.min(ate + 1, de + TETO_POSTGREST))
    return Promise.resolve(resolve({ data: pagina, error: null }))
  }

  temEq(coluna: string, valor: unknown) { return this.eqCalls.some(([c, v]) => c === coluna && v === valor) }
}

const INICIO = '2026-09-09T12:00:00.000Z'

function criarClient(dados: Record<string, Record<string, unknown>[]>) {
  const queries: Query[] = []
  const client = {
    from(table: string) {
      const query = new Query(table, dados[table] ?? [])
      queries.push(query)
      return query
    },
  } as unknown as SupabaseClient
  return { client, queries }
}

function execucao(i: number, campanha = 'camp-1', status = 'concluido') {
  return { id: `ex-${i}`, organizacao_id: 'org-a', campanha_id: campanha, lead_id: `lead-${i}`, status, iniciado_em: INICIO }
}

function envio(execucaoId: string, enviado: boolean) {
  return { execucao_id: execucaoId, organizacao_id: 'org-a', tipo: 'email_enviado', detalhe: { enviado } }
}

describe('resumo de execuções das campanhas', () => {
  it('conta mensagens enviadas por passo, não por contato, e ignora ensaio', async () => {
    const { client } = criarClient({
      workflow_execucoes: [execucao(1), execucao(2, 'camp-1', 'aguardando')],
      workflow_execucao_eventos: [
        envio('ex-1', true), envio('ex-1', true), // abordagem + follow-up
        envio('ex-2', true),
        envio('ex-2', false), // ensaio/recusado: não saiu
      ],
      interacoes: [],
    })
    const resumos = await buscarResumosExecucoesCampanhas(client, 'org-a', ['camp-1'])

    expect(resumos['camp-1']).toMatchObject({ total: 2, aguardando: 1, concluidas: 1, emailsEnviados: 3 })
  })

  it('pagina além do teto de 1000 linhas do PostgREST', async () => {
    const execucoes = Array.from({ length: 1200 }, (_, i) => execucao(i))
    const { client } = criarClient({
      workflow_execucoes: execucoes,
      workflow_execucao_eventos: execucoes.flatMap((e) => [envio(e.id, true), envio(e.id, true)]),
      interacoes: execucoes.slice(0, 1100).map((e) => ({
        lead_id: e.lead_id, organizacao_id: 'org-a', tipo: 'resposta', created_at: '2026-09-10T08:00:00.000Z',
      })),
    })
    const resumos = await buscarResumosExecucoesCampanhas(client, 'org-a', ['camp-1'])

    expect(resumos['camp-1'].total).toBe(1200)
    expect(resumos['camp-1'].emailsEnviados).toBe(2400)
    expect(resumos['camp-1'].respostas).toBe(1100)
  })

  it('separa envios por campanha e filtra toda consulta pela organização', async () => {
    const { client, queries } = criarClient({
      workflow_execucoes: [execucao(1, 'camp-1'), execucao(2, 'camp-2')],
      workflow_execucao_eventos: [envio('ex-1', true), envio('ex-2', true), envio('ex-2', true)],
      interacoes: [],
    })
    const resumos = await buscarResumosExecucoesCampanhas(client, 'org-a', ['camp-1', 'camp-2'])

    expect(resumos['camp-1'].emailsEnviados).toBe(1)
    expect(resumos['camp-2'].emailsEnviados).toBe(2)
    expect(queries.length).toBeGreaterThan(0)
    for (const query of queries) expect(query.temEq('organizacao_id', 'org-a')).toBe(true)
  })

  it('não lê execução de outra organização', async () => {
    const { client } = criarClient({
      workflow_execucoes: [execucao(1), { ...execucao(2), organizacao_id: 'org-b' }],
      workflow_execucao_eventos: [envio('ex-1', true), { ...envio('ex-2', true), organizacao_id: 'org-b' }],
      interacoes: [],
    })
    const resumos = await buscarResumosExecucoesCampanhas(client, 'org-a', ['camp-1'])

    expect(resumos['camp-1']).toMatchObject({ total: 1, emailsEnviados: 1 })
  })
})

describe('resumo: fila do 1º envio, contatados e devoluções', () => {
  it('separa quem ainda não recebeu o 1º e-mail e conta como devolução só o lead bounced da org', async () => {
    const ex = (i: number, status: string, passo: number) => ({ ...execucao(i, 'camp-1', status), passo_atual: passo })
    const { client, queries } = criarClient({
      workflow_execucoes: [
        ex(1, 'aguardando', 0), ex(2, 'aguardando', 0),   // na fila do 1º envio
        ex(3, 'aguardando', 2),                          // contatado, na cadência
        ex(4, 'cancelado', 2), ex(5, 'cancelado', 2),    // 4 devolvido; 5 saiu por resposta
        ex(6, 'concluido', 5),
      ],
      workflow_execucao_eventos: [],
      interacoes: [],
      leads: [
        { id: 'lead-4', organizacao_id: 'org-a', bounced: true },
        { id: 'lead-5', organizacao_id: 'org-a', bounced: false },
        // Mesmo id em outra organização marcado como bounced: não conta.
        { id: 'lead-5', organizacao_id: 'org-b', bounced: true },
      ],
    })
    const r = (await buscarResumosExecucoesCampanhas(client, 'org-a', ['camp-1']))['camp-1']

    expect(r).toMatchObject({ total: 6, aguardando: 3, aguardandoPrimeiroEnvio: 2, jaContatados: 4, canceladas: 2, devolvidos: 1, concluidas: 1 })
    expect(queries.find((q) => q.table === 'leads')?.temEq('organizacao_id', 'org-a')).toBe(true)
  })
})
