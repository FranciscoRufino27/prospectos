import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { cifrar } from '@/lib/seguranca/criptografia'
import { classificarParaIndice, consultarIndice, sincronizarIndice, termoBusca, resumirIndice, disponiveisEntre, linhasDoFiltro } from '../indice'
import { limparCacheLeitura } from '../leituraLote'
import { supabaseFake, tocouSoOrg, type Chain } from './supabaseFake'

beforeAll(() => {
  process.env.INTEGRACOES_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
})
beforeEach(() => limparCacheLeitura())

const ORG = 'org-a'
const AGORA = Date.UTC(2026, 8, 29)
const CNPJ = '33000167000101'
const PROPS = ['telefone', 'hs_tax_id']
const emp = (p: Record<string, string | null>) => ({ id: '1', properties: { name: 'Empresa X', num_associated_contacts: '1', ...p } })
const corp = { email: 'ana@empresax.com.br', nome: 'Ana' }
const gmail = { email: 'joao@gmail.com', nome: 'João' }

describe('classificarParaIndice — o que fica disponível para importar', () => {
  it('apta: não cliente + CNPJ válido + contato com e-mail corporativo', () => {
    const l = classificarParaIndice(emp({ telefone: '33.000.167/0001-01' }), PROPS, [corp], AGORA)
    expect(l).toMatchObject({ disponivel: true, cliente: false, identificavel: true, cnpj: CNPJ, contatos_corporativos: 1, motivo_indisponivel: null })
  })
  it('apta pelo domínio (sem CNPJ)', () => {
    expect(classificarParaIndice(emp({ domain: 'empresax.com.br' }), PROPS, [corp], AGORA).disponivel).toBe(true)
  })
  it('só e-mail genérico (gmail) → indisponível: sem e-mail corporativo', () => {
    expect(classificarParaIndice(emp({ domain: 'empresax.com.br' }), PROPS, [gmail], AGORA))
      .toMatchObject({ disponivel: false, motivo_indisponivel: 'sem_email_corporativo' })
  })
  it('e-mail de escritório de contabilidade não conta como corporativo', () => {
    expect(classificarParaIndice(emp({ domain: 'empresax.com.br' }), PROPS, [{ email: 'fiscal@contabilidadeabc.com.br', nome: null }], AGORA).disponivel).toBe(false)
  })
  it('sem CNPJ e sem domínio, mas com e-mail corporativo → indisponível: sem CNPJ ou domínio', () => {
    expect(classificarParaIndice(emp({}), PROPS, [corp], AGORA)).toMatchObject({ disponivel: false, motivo_indisponivel: 'sem_cnpj_ou_dominio' })
  })
  it('nada para identificar → sem_evidencia; CPF no campo de CNPJ não conta', () => {
    expect(classificarParaIndice(emp({ telefone: '123.456.789-09' }), PROPS, [gmail], AGORA))
      .toMatchObject({ disponivel: false, motivo_indisponivel: 'sem_evidencia', cnpj: null })
  })
  it('cliente com qualquer e-mail (até gmail) → disponível para novidades', () => {
    expect(classificarParaIndice(emp({ recent_deal_close_date: '2025-01-01T00:00:00Z' }), PROPS, [gmail], AGORA))
      .toMatchObject({ disponivel: true, cliente: true, situacao: 'cliente' })
  })
  it('cliente sem e-mail nenhum → indisponível', () => {
    expect(classificarParaIndice(emp({ recent_deal_close_date: '2025-01-01T00:00:00Z' }), PROPS, [{ email: null, nome: 'Sem' }], AGORA))
      .toMatchObject({ disponivel: false, motivo_indisponivel: 'cliente_sem_email' })
  })
  it('texto de busca inclui nome, domínio, CNPJ e contatos (sem acento, minúsculo)', () => {
    const l = classificarParaIndice(emp({ name: 'Óticas José', domain: 'oticas.com.br', telefone: CNPJ }), PROPS, [corp], AGORA)
    expect(l.busca).toContain('oticas jose')
    expect(l.busca).toContain('oticas.com.br')
    expect(l.busca).toContain(CNPJ)
    expect(l.busca).toContain('ana@empresax.com.br')
  })
})

describe('consultarIndice — universo e filtros no banco', () => {
  const base = { busca: '', owner: 'todos', situacao: 'todas' as const, importada: 'todas' as const, pagina: 2, tamanho: 25 }

  it('só disponíveis, só comerciais mapeados, ordenado com desempate e paginado', async () => {
    const { client, chains } = supabaseFake(() => ({ data: [{ hubspot_company_id: '7', situacao: 'reativar' }], count: 30 }))
    const r = await consultarIndice(client, ORG, base, ['111', '222'], [])
    expect(r).toEqual({ total: 30, linhas: [{ hubspot_company_id: '7', situacao: 'reativar' }] })
    const c = chains[0]
    expect(c.temEq('organizacao_id', ORG)).toBe(true)
    expect(c.temEq('disponivel', true)).toBe(true)
    expect(c.inCalls).toContainEqual(['owner_id', ['111', '222']])
    expect(c.orderCalls.map(([col]) => col)).toEqual(['nome', 'hubspot_company_id'])
    expect(c.rangeCall).toEqual([25, 49])
  })

  it('comercial não mapeado (ou nenhum mapeado) → vazio sem consultar', async () => {
    const { client, chains } = supabaseFake()
    expect(await consultarIndice(client, ORG, { ...base, owner: '999' }, ['111'], [])).toEqual({ total: 0, linhas: [] })
    expect(await consultarIndice(client, ORG, base, [], [])).toEqual({ total: 0, linhas: [] })
    expect(chains.every((c) => c.orderCalls.length === 0)).toBe(true)
  })

  it('situação, não importada e busca (termo saneado para o ilike)', async () => {
    const { client, chains } = supabaseFake(() => ({ data: [], count: 0 }))
    await consultarIndice(client, ORG, { ...base, situacao: 'cliente', importada: 'nao', busca: 'Óticas%_ (SP)' }, ['111'], ['10', '20'])
    const c = chains[0]
    expect(c.temEq('situacao', 'cliente')).toBe(true)
    expect(c.notCalls).toEqual([['hubspot_company_id', 'in', '("10","20")']])
    expect(c.ilikeCalls).toEqual([['busca', '%oticas%'], ['busca', '%sp%']])
  })

  it('termoBusca remove curingas e caracteres fora da lista', () => {
    expect(termoBusca('a%b_c*d,e')).toBe('a b c d e')
    expect(termoBusca('Ana@Empresa.com')).toBe('ana@empresa.com')
  })

  it('resumo conta por situação com os mesmos filtros e separa "sem responsável"', async () => {
    const { client } = supabaseFake((t, c) => {
      if (t === 'integracoes_hubspot') return { data: { indice_atualizado_em: '2026-09-29T00:00:00Z', indice_sincronizando_desde: null } }
      const dispo = c.temEq('disponivel', true)
      const mapeado = c.inCalls.some(([col]) => col === 'owner_id')
      return { count: !dispo ? 2837 : !mapeado ? 1400 : c.eqCalls.some(([col]) => col === 'situacao') ? 100 : 1300 }
    })
    const r = await resumirIndice(client, ORG, base, ['111'], [])
    expect(r).toMatchObject({ total: 2837, disponiveis: 1300, semResponsavel: 100, atualizadoEm: '2026-09-29T00:00:00Z', sincronizando: false })
    expect(r.porSituacao.cliente).toBe(100)
  })

  it('linhasDoFiltro: mesmos filtros e ordem da lista, lê em páginas de 1.000 até acabar', async () => {
    const todas = Array.from({ length: 1500 }, (_, i) => ({ hubspot_company_id: String(i + 1), nome: i === 0 ? null : `Empresa ${i + 1}` }))
    const { client, chains } = supabaseFake((_t, c) => ({ data: todas.slice(c.rangeCall![0], c.rangeCall![1] + 1) }))
    const r = await linhasDoFiltro(client, ORG, { ...base, situacao: 'reativar' }, ['111'], [])
    expect(r).toHaveLength(1500)
    expect(r[0]).toEqual({ id: '1', nome: '(sem nome) #1' })
    expect(chains.map((c) => c.rangeCall)).toEqual([[0, 999], [1000, 1999]])
    for (const c of chains) {
      expect(c.temEq('organizacao_id', ORG)).toBe(true)
      expect(c.temEq('disponivel', true)).toBe(true)
      expect(c.temEq('situacao', 'reativar')).toBe(true)
      expect(c.inCalls).toContainEqual(['owner_id', ['111']])
      expect(c.orderCalls.map(([col]) => col)).toEqual(['nome', 'hubspot_company_id'])
    }
  })

  it('linhasDoFiltro: comercial não mapeado → vazio sem consultar', async () => {
    const { client, chains } = supabaseFake()
    expect(await linhasDoFiltro(client, ORG, { ...base, owner: '999' }, ['111'], [])).toEqual([])
    expect(chains.every((c) => c.rangeCall === null)).toBe(true)
  })

  it('disponiveisEntre: filtra org, disponível, comercial mapeado e IDs pedidos', async () => {
    const { client, chains } = supabaseFake(() => ({ data: [{ hubspot_company_id: '1', cliente: true }] }))
    const r = await disponiveisEntre(client, ORG, ['1', '2'], ['111'])
    expect([...r]).toEqual([['1', { cliente: true }]])
    expect(chains[0].temEq('organizacao_id', ORG)).toBe(true)
    expect(chains[0].temEq('disponivel', true)).toBe(true)
  })
})

describe('sincronizarIndice', () => {
  function banco(opts: { travadaDesde?: string } = {}) {
    return supabaseFake((t: string, c: Chain) => {
      if (t === 'integracoes_hubspot' && c.mode === 'select') {
        return {
          data: {
            access_token_cifrado: cifrar('at'), refresh_token_cifrado: cifrar('rt'),
            expires_at: new Date(Date.now() + 3600_000).toISOString(), ativo: true,
            indice_sincronizando_desde: opts.travadaDesde ?? null,
          },
        }
      }
      return {}
    })
  }
  function hubspot(falharContatos = false) {
    const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } })
    return vi.fn(async (u: string | URL | Request, init?: RequestInit) => {
      const p = new URL(String(u)).pathname
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      const ids: string[] = (body.inputs ?? []).map((i: { id: string }) => i.id)
      if (p === '/crm/v3/properties/companies') return json({ results: [{ name: 'telefone', label: 'CNPJ' }] })
      if (p === '/crm/v3/objects/companies/search') {
        return json({ total: 2, results: [
          { id: '1', properties: { name: 'Apta', telefone: CNPJ, num_associated_contacts: '1', hubspot_owner_id: '111' } },
          { id: '2', properties: { name: 'Sem nada', num_associated_contacts: '0', hubspot_owner_id: '111' } },
        ] })
      }
      if (p === '/crm/v4/associations/companies/contacts/batch/read') return json({ results: ids.map((id) => ({ from: { id }, to: id === '1' ? [{ toObjectId: 91 }] : [] })) })
      if (p === '/crm/v3/objects/contacts/batch/read') {
        return falharContatos ? json({ message: 'x' }, 500) : json({ results: ids.map((id) => ({ id, properties: { email: 'ana@apta.com.br', firstname: 'Ana' } })) })
      }
      return json({}, 404)
    }) as unknown as typeof fetch
  }

  it('grava todas as empresas da org, remove as que sumiram e registra a data', async () => {
    const b = banco()
    const r = await sincronizarIndice(ORG, { admin: b.client, fetch: hubspot(), agora: AGORA })
    expect(r).toMatchObject({ ok: true, total: 2, disponiveis: 1, aptas: 1, clientes: 0 })
    const upsert = b.chains.find((c) => c.table === 'hubspot_empresas_indice' && c.mode === 'upsert')
    const linhas = upsert?.payload as Record<string, unknown>[]
    expect(linhas.map((l) => [l.hubspot_company_id, l.disponivel, l.organizacao_id])).toEqual([['1', true, ORG], ['2', false, ORG]])
    const limpeza = b.chains.find((c) => c.table === 'hubspot_empresas_indice' && c.mode === 'delete')
    expect(limpeza?.temEq('organizacao_id', ORG)).toBe(true)
    expect(limpeza?.ltCalls[0]?.[0]).toBe('sincronizado_em')
    const fim = b.chains.filter((c) => c.table === 'integracoes_hubspot' && c.mode === 'update').pop()
    expect(fim?.payload).toMatchObject({ indice_total: 2, indice_sincronizando_desde: null })
    expect(tocouSoOrg(b.chains, ORG)).toBe(true)
  })

  it('outra sincronização em andamento (< 10 min) → recusa sem ler o HubSpot', async () => {
    const b = banco({ travadaDesde: new Date(AGORA - 60_000).toISOString() })
    const f = hubspot()
    const r = await sincronizarIndice(ORG, { admin: b.client, fetch: f, agora: AGORA })
    expect(r).toEqual({ ok: false, motivo: 'sincronizacao_em_andamento' })
    expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0)
  })

  it('falha no meio libera a trava', async () => {
    const b = banco()
    const r = await sincronizarIndice(ORG, { admin: b.client, fetch: hubspot(true), agora: AGORA })
    expect(r.ok).toBe(false)
    const ultima = b.chains.filter((c) => c.table === 'integracoes_hubspot' && c.mode === 'update').pop()
    expect(ultima?.payload).toEqual({ indice_sincronizando_desde: null })
    expect(b.chains.some((c) => c.table === 'hubspot_empresas_indice' && c.mode === 'upsert')).toBe(false)
  })
})
