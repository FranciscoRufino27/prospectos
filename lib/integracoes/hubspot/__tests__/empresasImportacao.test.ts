import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { cifrar } from '@/lib/seguranca/criptografia'
import {
  parseFiltros,
  montarLinha,
  negocioEmDestaque,
  listarEmpresasParaImportacao,
  type FiltrosEmpresas,
  type ContextoLinha,
  type NegocioLido,
} from '../empresasImportacao'
import { limiteJanela } from '../situacao'
import { limparCacheLeitura } from '../leituraLote'
import { supabaseFake, tocouSoOrg, type Chain } from './supabaseFake'

beforeAll(() => {
  process.env.INTEGRACOES_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
})
beforeEach(() => limparCacheLeitura())

const AGORA = Date.UTC(2026, 8, 29)
const DIA = 86_400_000
const BASE: FiltrosEmpresas = { busca: '', owner: 'todos', situacao: 'todas', importada: 'todas', pagina: 1, tamanho: 25 }

describe('parseFiltros', () => {
  it('valores inválidos caem no padrão seguro', () => {
    expect(parseFiltros(new URLSearchParams('owner=abc&situacao=x&importada=1&pagina=-3&tamanho=5000'))).toEqual(BASE)
  })
  it('lê situação, comercial, importação e busca (máx. 100 caracteres)', () => {
    const f = parseFiltros(new URLSearchParams(`situacao=cliente&owner=229861376&importada=nao&busca=${'a'.repeat(150)}`))
    expect(f).toMatchObject({ situacao: 'cliente', owner: '229861376', importada: 'nao' })
    expect(f.busca).toHaveLength(100)
  })
})

describe('negocioEmDestaque', () => {
  const n = (id: string, x: Partial<NegocioLido>): NegocioLido => ({ id, nome: `N${id}`, estagio: null, pipeline: null, ganho: false, fechado: false, data: null, ...x })
  it('último ganho > aberto mais recente > último perdido', () => {
    expect(negocioEmDestaque([n('1', { fechado: true, data: '2026-01-01' }), n('2', { data: '2026-05-01' }), n('3', { ganho: true, fechado: true, data: '2024-01-01' })])?.tipo).toBe('ganho')
    expect(negocioEmDestaque([n('1', { fechado: true, data: '2026-01-01' }), n('2', { data: '2025-05-01' })])).toMatchObject({ tipo: 'aberto', nome: 'N2' })
    expect(negocioEmDestaque([n('1', { fechado: true, data: '2025-01-01' }), n('4', { fechado: true, data: '2026-01-01' })])).toMatchObject({ tipo: 'perdido', nome: 'N4' })
    expect(negocioEmDestaque([])).toBeNull()
  })
})

describe('montarLinha', () => {
  const ctx = (extra: Partial<ContextoLinha> = {}): ContextoLinha => ({
    agora: AGORA,
    nomesOwners: new Map([['229861376', 'Bruno Veloso'], ['76540616', 'Silmara Gonçalves']]),
    responsaveis: new Map([['229861376', 'u-bruno']]),
    nomesUsuarios: new Map([['u-bruno', 'Bruno Veloso']]),
    importadas: new Set(),
    emPreparo: new Set(),
    contatos: new Map(),
    negocios: new Map(),
    ...extra,
  })
  const emp = (id: string, p: Record<string, string | null>) => ({ id, properties: { name: 'Hotel X', num_associated_contacts: '0', ...p } })

  it('situação vem do índice quando informada (mesma dos contadores)', () => {
    const l = montarLinha(emp('1', { notes_last_updated: String(limiteJanela(AGORA) + 1) }), ctx({ situacoes: new Map([['1', 'reativar']]) }))
    expect(l.situacao).toBe('reativar')
  })

  it('cliente: ação de não prospectar; divergência quando os negócios não confirmam', () => {
    const l = montarLinha(emp('1', { recent_deal_close_date: '2025-06-01T00:00:00Z', num_associated_deals: '1' }), ctx({
      negocios: new Map([['1', { lista: [{ id: 'd1', nome: 'Deal', estagio: 'Ganho', pipeline: 'Vendas', ganho: true, fechado: true, data: '2025-06-01T00:00:00.000Z' }], truncado: false }]]),
    }))
    expect(l).toMatchObject({ situacao: 'cliente', destaque: { tipo: 'ganho', nome: 'Deal' }, divergenciaCliente: false })
    expect(l.acao).toMatch(/Não prospectar/)
    expect(montarLinha(emp('2', { recent_deal_close_date: '2025-06-01T00:00:00Z' }), ctx({ negocios: new Map([['2', { lista: [], truncado: false }]]) })).divergenciaCliente).toBe(true)
  })

  it('contato principal, contagem de corporativos e responsável mapeado', () => {
    const l = montarLinha(emp('3', { num_associated_contacts: '3', hubspot_owner_id: '229861376', notes_last_updated: String(AGORA - 200 * DIA), num_associated_deals: '1' }), ctx({
      contatos: new Map([['3', { lista: [
        { id: '11', nome: 'Ana', email: null, cargo: 'CEO', ultimoContato: null, ownerId: null },
        { id: '12', nome: 'Beto', email: 'beto@x.com.br', cargo: 'Gerente', ultimoContato: null, ownerId: null },
        { id: '13', nome: 'Caio', email: 'caio@gmail.com', cargo: null, ultimoContato: null, ownerId: null },
      ], truncado: false }]]),
    }))
    expect(l.contatoPrincipal).toMatchObject({ nome: 'Beto', email: 'beto@x.com.br', cargo: 'Gerente' })
    expect(l.contatos).toEqual({ total: 3, comEmail: 2, corporativos: 1, truncado: false })
    expect(l.responsavel).toEqual({ usuarioId: 'u-bruno', nome: 'Bruno Veloso' })
  })

  it('owner sem mapeamento → responsável null (nunca outro vendedor)', () => {
    const l = montarLinha(emp('4', { hubspot_owner_id: '76540616' }), ctx())
    expect(l.owner).toEqual({ id: '76540616', nome: 'Silmara Gonçalves' })
    expect(l.responsavel).toBeNull()
  })
})

// Orquestração: lista do índice, detalhes da página em lote no HubSpot.
describe('listarEmpresasParaImportacao — índice + detalhes em lote', () => {
  const ORG = 'org-a'
  function admin(linhasIndice: Array<{ hubspot_company_id: string; situacao: string }>, total = linhasIndice.length) {
    return supabaseFake((t: string, c: Chain) => {
      if (t === 'integracoes_hubspot') {
        return { data: { access_token_cifrado: cifrar('at'), refresh_token_cifrado: cifrar('rt'), expires_at: new Date(Date.now() + 3600_000).toISOString(), ativo: true } }
      }
      if (t === 'hubspot_empresas_indice') return { data: linhasIndice, count: total }
      if (t === 'usuarios') return { data: [{ id: 'u-bruno', nome: 'Bruno Veloso', email: 'e@x', ativo: true }] }
      if (t === 'hubspot_owners_mapeamento') return { data: [{ hubspot_owner_id: '229861376', usuario_id: 'u-bruno', ativo: true }] }
      void c
      return { data: [] }
    })
  }
  function hubspot() {
    const chamadas: string[] = []
    const lidos: string[][] = []
    const json = (d: unknown, status = 200) => ({ ok: status < 300, status, headers: new Headers(), json: async () => d }) as unknown as Response
    const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = new URL(String(url))
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      chamadas.push(`${init?.method ?? 'GET'} ${u.pathname}`)
      const ids: string[] = (body.inputs ?? []).map((i: { id: string }) => i.id)
      switch (u.pathname) {
        case '/crm/v3/objects/companies/batch/read':
          lidos.push(ids)
          return json({ results: ids.filter((id) => id !== '99').map((id) => ({ id, properties: { name: `Empresa ${id}`, num_associated_contacts: '1', hubspot_owner_id: '229861376', recent_deal_close_date: id === '1' ? '2025-06-01T00:00:00Z' : null, num_associated_deals: id === '1' ? '1' : null } })) })
        case '/crm/v4/associations/companies/contacts/batch/read': return json({ results: ids.map((id) => ({ from: { id }, to: [{ toObjectId: Number(id) * 10 }] })) })
        case '/crm/v4/associations/companies/deals/batch/read': return json({ results: ids.map((id) => ({ from: { id }, to: id === '1' ? [{ toObjectId: 21 }] : [] })) })
        case '/crm/v3/objects/contacts/batch/read': return json({ results: ids.map((id) => ({ id, properties: { firstname: `Nome${id}`, email: `n${id}@empresa.com.br`, jobtitle: 'Diretor' } })) })
        case '/crm/v3/objects/deals/batch/read': return json({ results: ids.map((id) => ({ id, properties: { dealname: 'Contrato', pipeline: 'default', dealstage: '96089399', hs_is_closed_won: 'true', hs_is_closed: 'true', closedate: '2025-06-01T00:00:00Z' } })) })
        case '/crm/v3/pipelines/deals': return json({ results: [{ id: 'default', label: 'Pipeline de vendas', stages: [{ id: '96089399', label: 'Fechado ganho' }] }] })
        case '/crm/v3/owners': return json({ results: [{ id: '229861376', firstName: 'Bruno', lastName: 'Veloso' }] })
        default: return json({ message: `não mapeado ${u.pathname}` }, 404)
      }
    })
    return { fn: fn as unknown as typeof fetch, chamadas, lidos }
  }

  it('lista na ordem do índice, lê só as empresas da página em lote e usa a situação do índice', async () => {
    const a = admin([{ hubspot_company_id: '5', situacao: 'prospectar' }, { hubspot_company_id: '1', situacao: 'cliente' }], 1300)
    const h = hubspot()
    const r = await listarEmpresasParaImportacao(ORG, BASE, { admin: a.client, fetch: h.fn, agora: AGORA })
    if (!r.ok) throw new Error(r.motivo)
    expect(r.total).toBe(1300)
    expect(r.itens.map((l) => [l.id, l.situacao])).toEqual([['5', 'prospectar'], ['1', 'cliente']])
    expect(r.itens[1]).toMatchObject({ destaque: { tipo: 'ganho', estagio: 'Fechado ganho' }, responsavel: { nome: 'Bruno Veloso' } })
    expect(h.lidos).toEqual([['5', '1']])
    expect(h.chamadas.some((c) => c.includes('/search'))).toBe(false)
    const conta = (p: string) => h.chamadas.filter((c) => c.endsWith(p)).length
    expect(conta('/crm/v4/associations/companies/contacts/batch/read')).toBe(1)
    expect(conta('/crm/v4/associations/companies/deals/batch/read')).toBe(1)
    expect(tocouSoOrg(a.chains, ORG)).toBe(true)
  })

  it('índice vazio → lista vazia sem chamar o HubSpot', async () => {
    const h = hubspot()
    const r = await listarEmpresasParaImportacao(ORG, BASE, { admin: admin([]).client, fetch: h.fn, agora: AGORA })
    expect(r).toMatchObject({ ok: true, total: 0, itens: [] })
    expect(h.chamadas).toEqual([])
  })

  it('empresa apagada no HubSpot desde a sincronização some da página e é contada', async () => {
    const r = await listarEmpresasParaImportacao(ORG, BASE, { admin: admin([{ hubspot_company_id: '99', situacao: 'reativar' }, { hubspot_company_id: '5', situacao: 'reativar' }]).client, fetch: hubspot().fn, agora: AGORA })
    expect(r.ok && r.itens.map((l) => l.id)).toEqual(['5'])
    expect(r.ok && r.foraDoHubspot).toBe(1)
  })
})
