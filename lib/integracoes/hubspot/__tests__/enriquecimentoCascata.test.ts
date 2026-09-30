import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { cifrar } from '@/lib/seguranca/criptografia'
import { enriquecerEmpresas, validarIds, LIMITE_EMPRESAS_ENRIQUECIMENTO } from '../enriquecimento/cascata'
import { limparCacheLeitura } from '../leituraLote'
import { supabaseFake, tocouSoOrg, type Chain } from './supabaseFake'

beforeAll(() => {
  process.env.INTEGRACOES_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
})
beforeEach(() => limparCacheLeitura())

const ORG = 'org-a'
const AGORA = Date.UTC(2026, 8, 29)
// CNPJs válidos (dígitos verificadores corretos)
const CNPJ_OTICA = '33000167000101'
const CNPJ_OUTRO = '11222333000181'

type Empresa = { id: string; properties: Record<string, string | null> }
const RECEITA: Record<string, unknown> = {
  [CNPJ_OTICA]: { razao_social: 'OTICAS MARIA JOSE LTDA', nome_fantasia: 'OTICAS MARIA JOSE', situacao_cadastral: 'Ativa', cnae_principal: '5510801', cnaes: [{ codigo: '5510801', descricao: 'Hotéis', is_principal: true }], email: 'contato@oticasmariajose.com.br' },
  [CNPJ_OUTRO]: { razao_social: 'PADARIA BOM PAO LTDA', nome_fantasia: '', situacao_cadastral: 'Baixada', cnae_principal: '1091101', cnaes: [{ codigo: '1091101', descricao: 'Fabricação de produtos de panificação', is_principal: true }], email: 'x@gmail.com' },
}

// Banco falso com estado para o cache global e o upsert do preview.
function banco() {
  const cache = new Map<string, Record<string, unknown>>()
  const fake = supabaseFake((t: string, c: Chain) => {
    if (t === 'integracoes_hubspot') {
      return { data: { access_token_cifrado: cifrar('at'), refresh_token_cifrado: cifrar('rt'), expires_at: new Date(Date.now() + 3600_000).toISOString(), ativo: true } }
    }
    if (t === 'enriquecimento_cache') {
      if (c.mode === 'upsert') { const p = c.payload as Record<string, unknown>; cache.set(`${p.tipo}:${p.chave}`, p); return {} }
      const tipo = c.eqCalls.find(([k]) => k === 'tipo')?.[1]
      const chave = c.eqCalls.find(([k]) => k === 'chave')?.[1]
      return { data: cache.get(`${tipo}:${chave}`) ?? null }
    }
    return {}
  })
  return { ...fake, cache }
}

// HubSpot + OpenCNPJ + sites falsos; registra toda chamada de rede.
function rede(empresas: Empresa[], contatos: Record<string, string[]>, sites: Record<string, string>) {
  const chamadas: string[] = []
  const emails: Record<string, string> = {}
  for (const [emp, lista] of Object.entries(contatos)) lista.forEach((e, i) => { emails[`${emp}${i}`] = e })
  const fn = vi.fn(async (u: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(u))
    chamadas.push(`${init?.method ?? 'GET'} ${url.host}${url.pathname}`)
    const body = init?.body ? JSON.parse(String(init.body)) : {}
    const ids: string[] = (body.inputs ?? []).map((i: { id: string }) => i.id)
    const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } })
    if (url.host === 'api.hubapi.com') {
      if (url.pathname === '/crm/v3/properties/companies') return json({ results: [{ name: 'telefone', label: 'CNPJ' }, { name: 'name', label: 'Company name' }] })
      if (url.pathname === '/crm/v3/objects/companies/batch/read') return json({ results: empresas.filter((e) => ids.includes(e.id)) })
      if (url.pathname === '/crm/v4/associations/companies/contacts/batch/read') {
        return json({ results: ids.map((id) => ({ from: { id }, to: (contatos[id] ?? []).map((_, i) => ({ toObjectId: `${id}${i}` })) })) })
      }
      if (url.pathname === '/crm/v3/objects/contacts/batch/read') return json({ results: ids.map((id) => ({ id, properties: { email: emails[id] ?? null } })) })
      return json({ message: 'inesperado' }, 404)
    }
    if (url.host === 'api.opencnpj.org') {
      const c = url.pathname.slice(1)
      return RECEITA[c] ? json(RECEITA[c]) : new Response('', { status: 404 })
    }
    const dominio = url.host.replace(/^www\./, '')
    if (sites[dominio] !== undefined) return new Response(sites[dominio], { status: 200, headers: { 'content-type': 'text/html' } })
    throw new Error('ECONNREFUSED')
  })
  return { fn: fn as unknown as typeof fetch, chamadas }
}

const deps = (b: ReturnType<typeof banco>, r: ReturnType<typeof rede>) => ({
  admin: b.client, fetch: r.fn, agora: AGORA, pausaOpenCnpjMs: 0, site: { resolver: async () => ['200.1.1.1'] },
})

describe('validarIds', () => {
  it(`vazio, inválido e acima de ${LIMITE_EMPRESAS_ENRIQUECIMENTO}`, () => {
    expect(validarIds([])).toEqual({ ok: false, motivo: 'selecao_vazia' })
    expect(validarIds(['1', 'x'])).toEqual({ ok: false, motivo: 'id_invalido' })
    expect(validarIds(Array.from({ length: 21 }, (_, i) => String(i + 1)))).toEqual({ ok: false, motivo: 'selecao_excede_limite' })
    expect(validarIds(['1', '1', '2'])).toEqual({ ok: true, ids: ['1', '2'] })
  })
})

describe('enriquecerEmpresas — cascata em preview', () => {
  it('A: CNPJ do HubSpot (propriedade descoberta pelo rótulo "CNPJ") + nome parecido → alta; nicho pelo CNAE', async () => {
    const b = banco()
    const r = rede([{ id: '1', properties: { name: 'Óticas Maria José', telefone: '33.000.167/0001-01' } }], {}, {})
    const res = await enriquecerEmpresas(ORG, 'p1', { companyIds: ['1'] }, deps(b, r))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.propriedadesCnpj).toContain('telefone')
    expect(res.itens[0]).toMatchObject({
      cnpj: CNPJ_OTICA, fonte: 'hubspot_cnpj', confianca: 'alta', status_enriquecimento: 'resolvida',
      razao_social: 'OTICAS MARIA JOSE LTDA', atividade_principal: 'Hotéis', nicho_sugerido: 'Hotelaria',
    })
  })

  it('A sem evidência independente → média; site com OUTRO CNPJ → ambígua/baixa', async () => {
    const b1 = banco()
    const r1 = rede([{ id: '1', properties: { name: 'Nome Diferente', telefone: CNPJ_OTICA } }], {}, {})
    const m = await enriquecerEmpresas(ORG, 'p1', { companyIds: ['1'] }, deps(b1, r1))
    expect(m.ok && m.itens[0]).toMatchObject({ confianca: 'media', status_enriquecimento: 'resolvida' })

    const b2 = banco()
    const r2 = rede([{ id: '1', properties: { name: 'Nome Diferente', telefone: CNPJ_OTICA, domain: 'padaria.com.br' } }], {}, { 'padaria.com.br': 'CNPJ 11.222.333/0001-81' })
    const a = await enriquecerEmpresas(ORG, 'p1', { companyIds: ['1'] }, deps(b2, r2))
    expect(a.ok && a.itens[0]).toMatchObject({ confianca: 'baixa', status_enriquecimento: 'ambigua' })
  })

  it('CPF (11 dígitos) no campo de CNPJ nunca é consultado', async () => {
    const b = banco()
    const r = rede([{ id: '1', properties: { name: 'Pessoa Física', telefone: '123.456.789-09' } }], {}, {})
    const res = await enriquecerEmpresas(ORG, 'p1', { companyIds: ['1'] }, deps(b, r))
    expect(res.ok && res.itens[0].cadastro_atual.documento).toBe('cpf')
    expect(r.chamadas.some((c) => c.includes('opencnpj'))).toBe(false)
  })

  it('B: domínio da empresa → CNPJ no site → e-mail da Receita no mesmo domínio → alta', async () => {
    const b = banco()
    const r = rede([{ id: '1', properties: { name: 'Loja', domain: 'oticasmariajose.com.br' } }], {}, { 'oticasmariajose.com.br': '<footer>CNPJ: 33.000.167/0001-01</footer>' })
    const res = await enriquecerEmpresas(ORG, 'p1', { companyIds: ['1'] }, deps(b, r))
    expect(res.ok && res.itens[0]).toMatchObject({ fonte: 'site_dominio_empresa', confianca: 'alta', cnpj: CNPJ_OTICA, dominio: 'oticasmariajose.com.br' })
  })

  it('C: e-mail corporativo do contato (genérico ignorado); situação não ativa vira evidência', async () => {
    const b = banco()
    const r = rede([{ id: '1', properties: { name: 'X' } }], { '1': ['a@gmail.com', 'b@bompao.com.br'] }, { 'bompao.com.br': 'CNPJ 11.222.333/0001-81' })
    const res = await enriquecerEmpresas(ORG, 'p1', { companyIds: ['1'] }, deps(b, r))
    if (!res.ok) throw new Error('falhou')
    expect(res.itens[0]).toMatchObject({ fonte: 'site_email_contato', cnpj: CNPJ_OUTRO, situacao_cadastral: 'Baixada' })
    expect(res.itens[0].evidencias.join(' ')).toMatch(/Baixada/)
    expect(r.chamadas.some((c) => c.includes('gmail.com'))).toBe(false)
  })

  it('D: só nome + e-mail genérico → não resolvida, sem nenhuma consulta externa (não infere pelo nome)', async () => {
    const b = banco()
    const r = rede([{ id: '1', properties: { name: 'Hotel Bonito' } }], { '1': ['joao@hotmail.com'] }, {})
    const res = await enriquecerEmpresas(ORG, 'p1', { companyIds: ['1'] }, deps(b, r))
    expect(res.ok && res.itens[0]).toMatchObject({ status_enriquecimento: 'nao_resolvida', cnpj: null, cadastro_atual: { email_contato: 'apenas_generico' } })
    expect(r.chamadas.filter((c) => !c.includes('api.hubapi.com'))).toEqual([])
  })

  it('OpenCNPJ fora do ar → erro_fonte (não "não resolvida")', async () => {
    const b = banco()
    const r = rede([{ id: '1', properties: { name: 'Óticas Maria José', telefone: CNPJ_OTICA } }], {}, {})
    const falhando = vi.fn(async (u: string | URL | Request, i?: RequestInit) =>
      String(u).includes('opencnpj') ? new Response('', { status: 503 }) : r.fn(u, i)) as unknown as typeof fetch
    const res = await enriquecerEmpresas(ORG, 'p1', { companyIds: ['1'] }, { ...deps(b, r), fetch: falhando })
    expect(res.ok && res.itens[0].status_enriquecimento).toBe('erro_fonte')
  })

  it('sem consultas duplicadas: mesmo CNPJ em 2 empresas = 1 chamada; 2ª execução usa o cache persistente', async () => {
    const b = banco()
    const empresas = [
      { id: '1', properties: { name: 'Óticas Maria José', telefone: CNPJ_OTICA } },
      { id: '2', properties: { name: 'Óticas Maria José filial', telefone: CNPJ_OTICA } },
    ]
    const r = rede(empresas, {}, {})
    await enriquecerEmpresas(ORG, 'p1', { companyIds: ['1', '2'] }, deps(b, r))
    expect(r.chamadas.filter((c) => c.includes('opencnpj'))).toHaveLength(1)
    const r2 = rede(empresas, {}, {})
    await enriquecerEmpresas(ORG, 'p1', { companyIds: ['1', '2'] }, deps(b, r2))
    expect(r2.chamadas.filter((c) => c.includes('opencnpj'))).toHaveLength(0)
  })

  it('nada é escrito no HubSpot; o preview é gravado só na organização do chamador', async () => {
    const b = banco()
    const r = rede([{ id: '1', properties: { name: 'Óticas Maria José', telefone: CNPJ_OTICA } }], {}, {})
    await enriquecerEmpresas(ORG, 'p1', { companyIds: ['1'] }, deps(b, r))
    const hubspot = r.chamadas.filter((c) => c.includes('api.hubapi.com'))
    for (const c of hubspot) expect(c).toMatch(/^GET |batch\/read$/) // só leituras
    const preview = b.chains.find((c) => c.table === 'hubspot_enriquecimentos' && c.mode === 'upsert')
    expect((preview?.payload as Record<string, unknown>[])[0]).toMatchObject({ organizacao_id: ORG, hubspot_company_id: '1', cnpj: CNPJ_OTICA, executado_por: 'p1' })
    expect(preview?.upsertOpts).toEqual({ onConflict: 'organizacao_id,hubspot_company_id' })
    expect(tocouSoOrg(b.chains, ORG)).toBe(true)
    expect(b.chains.some((c) => ['empresas', 'leads', 'contatos'].includes(c.table))).toBe(false)
  })
})
