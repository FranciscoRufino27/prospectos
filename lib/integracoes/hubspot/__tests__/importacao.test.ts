import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { cifrar } from '@/lib/seguranca/criptografia'
import { importarLote, montarPedido, ufDoEstado } from '../importacao'
import { limparCacheLeitura } from '../leituraLote'
import { supabaseFake, tocouSoOrg, type Chain } from './supabaseFake'

beforeAll(() => {
  process.env.INTEGRACOES_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
})
beforeEach(() => limparCacheLeitura())

const ORG = 'org-a'
const LOTE = '1f99b0e4-0000-4000-8000-000000000001'
const NATALIA = '229858160'
const CNPJ = '33000167000101'

describe('ufDoEstado', () => {
  it('sigla ou nome do estado → UF; fora do Brasil → null', () => {
    expect(ufDoEstado('SP')).toBe('SP')
    expect(ufDoEstado('rj')).toBe('RJ')
    expect(ufDoEstado('São Paulo')).toBe('SP')
    expect(ufDoEstado('Rio Grande do Sul')).toBe('RS')
    expect(ufDoEstado('Florida')).toBeNull()
    expect(ufDoEstado('')).toBeNull()
  })
})

describe('montarPedido', () => {
  const empresa = { id: '10', properties: { name: ' Hotel  Mar ', domain: 'https://www.hotelmar.com.br/', city: 'Santos', state: 'São Paulo', phone: '1133334444', telefone: '33.000.167/0001-01' } }
  it('só contatos com e-mail da empresa, sem repetir e-mail; CNPJ válido, domínio e UF normalizados', () => {
    const p = montarPedido(empresa, [
      { id: '1', properties: { firstname: 'Ana', lastname: 'Souza', email: 'Ana@HotelMar.com.br', jobtitle: 'Gerente', phone: null, mobilephone: '11999990000' } },
      { id: '2', properties: { firstname: 'Beto', lastname: null, email: 'beto@gmail.com', jobtitle: null, phone: null, mobilephone: null } },
      { id: '3', properties: { firstname: 'Ana', lastname: 'S.', email: 'ana@hotelmar.com.br', jobtitle: null, phone: null, mobilephone: null } },
      { id: '4', properties: { firstname: null, lastname: null, email: null, jobtitle: null, phone: null, mobilephone: null } },
    ], ['telefone', 'hs_tax_id'], 'u-nat')
    expect(p).toMatchObject({ hubspot_company_id: '10', nome: 'Hotel Mar', dominio: 'hotelmar.com.br', cnpj: CNPJ, cidade: 'Santos', estado: 'SP', responsavel_id: 'u-nat' })
    expect(p.contatos).toEqual([{ hubspot_contact_id: '1', nome: 'Ana Souza', cargo: 'Gerente', email: 'ana@hotelmar.com.br', telefone: '11999990000' }])
  })
  it('CPF ou dígito inválido no campo de CNPJ não vira CNPJ', () => {
    expect(montarPedido({ id: '11', properties: { telefone: '123.456.789-09' } }, [], ['telefone'], 'u').cnpj).toBeNull()
    expect(montarPedido({ id: '12', properties: { telefone: '33000167000100' } }, [], ['telefone'], 'u').cnpj).toBeNull()
  })
})

// HubSpot: empresas 1 (Natália), 2 (comercial sem mapeamento), 3 (Natália, sumiu do HubSpot).
function hubspot() {
  const chamadas: string[] = []
  const json = (d: unknown) => ({ ok: true, status: 200, headers: new Headers(), json: async () => d }) as unknown as Response
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url))
    chamadas.push(`${init?.method ?? 'GET'} ${u.pathname}`)
    const ids: string[] = (init?.body ? JSON.parse(String(init.body)).inputs ?? [] : []).map((i: { id: string }) => i.id)
    switch (u.pathname) {
      case '/crm/v3/properties/companies': return json({ results: [{ name: 'telefone', label: 'CNPJ' }, { name: 'phone', label: 'Telefone' }] })
      case '/crm/v3/objects/companies/batch/read':
        return json({ results: ids.filter((id) => id !== '3').map((id) => ({ id, properties: { name: `Empresa ${id}`, domain: `empresa${id}.com.br`, hubspot_owner_id: id === '2' ? '999' : NATALIA, telefone: id === '1' ? CNPJ : null } })) })
      case '/crm/v4/associations/companies/contacts/batch/read': return json({ results: ids.map((id) => ({ from: { id }, to: [{ toObjectId: Number(id) * 10 }, { toObjectId: Number(id) * 10 + 1 }] })) })
      case '/crm/v3/objects/contacts/batch/read':
        return json({ results: ids.map((id) => ({ id, properties: { firstname: `C${id}`, lastname: null, email: id.endsWith('1') ? `c${id}@gmail.com` : `c${id}@empresa${id.slice(0, -1)}.com.br`, jobtitle: null } })) })
      default: return { ok: false, status: 404, headers: new Headers(), json: async () => ({}) } as unknown as Response
    }
  })
  return { fn: fn as unknown as typeof fetch, chamadas }
}

function banco(opts: { statusLote?: string; itens?: Array<{ hubspot_company_id: string; cliente: boolean }>; linhasRpc?: unknown[]; erroRpc?: boolean } = {}) {
  return supabaseFake((t: string, c: Chain) => {
    if (t === 'integracoes_hubspot') {
      return { data: { access_token_cifrado: cifrar('at'), refresh_token_cifrado: cifrar('rt'), expires_at: new Date(Date.now() + 3600_000).toISOString(), ativo: true } }
    }
    if (t === 'hubspot_importacao_lotes') return { data: { id: LOTE, status: opts.statusLote ?? 'preparado' } }
    if (t === 'hubspot_importacao_itens') {
      return { data: opts.itens ?? [{ hubspot_company_id: '1', cliente: false }, { hubspot_company_id: '2', cliente: false }, { hubspot_company_id: '3', cliente: false }, { hubspot_company_id: '4', cliente: true }] }
    }
    if (t === 'hubspot_owners_mapeamento') return { data: [{ hubspot_owner_id: NATALIA, usuario_id: 'u-nat', ativo: true }] }
    if (t === 'usuarios') return { data: [{ id: 'u-nat', nome: 'Natalia Yume' }] }
    if (t === 'rpc:hubspot_importar') {
      if (opts.erroRpc) return { error: { message: 'falhou' } }
      const args = c.payload as { p_simular: boolean }
      return { data: opts.linhasRpc ?? [
        { hubspot_company_id: '1', email: 'c10@empresa1.com.br', status: args.p_simular ? 'importavel' : 'importado', lead_id: args.p_simular ? null : 'lead-1' },
      ] }
    }
    return { data: [] }
  })
}

describe('importarLote', () => {
  it('simulação: só empresas com comercial mapeado vão ao banco, com contatos corporativos e responsável pelo mapeamento', async () => {
    const { client, chains } = banco()
    const h = hubspot()
    const r = await importarLote(ORG, LOTE, { simular: true }, { admin: client, fetch: h.fn })
    if (!r.ok) throw new Error(r.motivo)
    expect(r.resumo).toMatchObject({ simulado: true, empresasTotal: 4, empresasComLead: 1, leads: 1, clientes: 1, semResponsavel: 1, naoEncontradas: 1, responsaveis: [{ nome: 'Natalia Yume', leads: 1 }] })

    const rpc = chains.find((c) => c.table === 'rpc:hubspot_importar')
    const args = rpc?.payload as { p_org: string; p_lote: string; p_simular: boolean; p_itens: Array<Record<string, unknown>> }
    expect(args).toMatchObject({ p_org: ORG, p_lote: LOTE, p_simular: true })
    expect(args.p_itens).toEqual([expect.objectContaining({
      hubspot_company_id: '1', responsavel_id: 'u-nat', cnpj: CNPJ, dominio: 'empresa1.com.br',
      contatos: [expect.objectContaining({ hubspot_contact_id: '10', email: 'c10@empresa1.com.br' })],
    })])
    // Nada é escrito por fora da função do banco.
    expect(chains.filter((c) => c.mode !== 'select').map((c) => c.table)).toEqual([])
    expect(tocouSoOrg(chains, ORG)).toBe(true)
    expect(h.chamadas.some((c) => c.startsWith('PATCH') || c.startsWith('DELETE') || c.startsWith('PUT'))).toBe(false)
  })

  it('importação de verdade: chama a função com p_simular=false e conta o que foi criado e o que já era lead', async () => {
    const { client, chains } = banco({ linhasRpc: [
      { hubspot_company_id: '1', email: 'c10@empresa1.com.br', status: 'importado', lead_id: 'lead-1' },
      { hubspot_company_id: '1', email: 'x@empresa1.com.br', status: 'ja_e_lead', lead_id: null },
    ] })
    const r = await importarLote(ORG, LOTE, { simular: false }, { admin: client, fetch: hubspot().fn })
    expect(r).toMatchObject({ ok: true, resumo: { simulado: false, leads: 1, jaEramLead: 1, empresasComLead: 1 } })
    expect((chains.find((c) => c.table === 'rpc:hubspot_importar')?.payload as { p_simular: boolean }).p_simular).toBe(false)
  })

  it('lote já importado → 409 sem ler o HubSpot (a simulação continua permitida)', async () => {
    const h = hubspot()
    const r = await importarLote(ORG, LOTE, { simular: false }, { admin: banco({ statusLote: 'importado' }).client, fetch: h.fn })
    expect(r).toEqual({ ok: false, motivo: 'lote_ja_importado', status: 409 })
    expect(h.chamadas).toEqual([])
    expect((await importarLote(ORG, LOTE, { simular: true }, { admin: banco({ statusLote: 'importado' }).client, fetch: hubspot().fn })).ok).toBe(true)
  })

  it('ID inválido → 400; lote de outra organização (não achado) → 404', async () => {
    expect(await importarLote(ORG, 'abc', { simular: true }, { admin: banco().client })).toEqual({ ok: false, motivo: 'lote_invalido', status: 400 })
    const { client, chains } = supabaseFake(() => ({ data: null }))
    expect(await importarLote(ORG, LOTE, { simular: true }, { admin: client })).toEqual({ ok: false, motivo: 'lote_nao_encontrado', status: 404 })
    expect(chains[0].temEq('organizacao_id', ORG)).toBe(true)
    expect(chains[0].temEq('id', LOTE)).toBe(true)
  })

  it('só clientes no lote → nada a importar, sem chamar o HubSpot nem o banco', async () => {
    const h = hubspot()
    const { client, chains } = banco({ itens: [{ hubspot_company_id: '4', cliente: true }] })
    const r = await importarLote(ORG, LOTE, { simular: true }, { admin: client, fetch: h.fn })
    expect(r).toMatchObject({ ok: true, resumo: { leads: 0, clientes: 1 } })
    expect(h.chamadas).toEqual([])
    expect(chains.some((c) => c.table === 'rpc:hubspot_importar')).toBe(false)
  })

  it('falha na função do banco → erro_banco (a transação desfaz tudo)', async () => {
    const r = await importarLote(ORG, LOTE, { simular: false }, { admin: banco({ erroRpc: true }).client, fetch: hubspot().fn })
    expect(r).toEqual({ ok: false, motivo: 'erro_banco', status: 500 })
  })
})
