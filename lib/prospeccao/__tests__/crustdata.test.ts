// Busca internacional (Crustdata): validação do pedido, corpo enviado, leitura
// da resposta, falhas honestas e a rota (sessão obrigatória, chave só no servidor).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BancoFalso } from '@/lib/templates/__tests__/bancoFalso'
import {
  buscarEmpresasCrustdata, CAMPOS_CRUSTDATA, corpoCrustdata, LIMITE_INTERNACIONAL, mapearEmpresa, normalizarBuscaInternacional,
} from '@/lib/prospeccao/crustdata'
import { cnpjDoTexto, normalizarFiltros } from '@/lib/prospeccao/filtros'
import { NextRequest } from 'next/server'

const estado = vi.hoisted(() => ({ usuarioId: null as string | null, banco: null as unknown }))

vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: estado.usuarioId ? { id: estado.usuarioId } : null } }) },
  }),
}))
vi.mock('@/lib/supabase-admin', () => ({
  createSupabaseAdminClient: () => (estado.banco as BancoFalso).cliente(),
}))

import { POST } from '@/app/api/prospeccao/internacional/route'
import { GET as GET_CNPJ } from '@/app/api/prospeccao/cnpj/route'

const BRUTO = {
  crustdata_company_id: 1509192,
  basic_info: {
    name: 'Boeira Garden Hotel Porto',
    primary_domain: 'curiocollection.com',
    website: 'http://www.boeiragardenhotelporto.curiocollection.com/',
    professional_network_url: 'https://www.linkedin.com/company/boeira-garden-hotel',
    company_type: 'Privately Held',
    year_founded: 2019,
    employee_count_range: '51-200',
  },
  locations: { country: 'Portugal', headquarters: 'Porto, Porto District, Portugal', city: 'Porto' },
}

function resposta(status: number, corpo: unknown) {
  return new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } })
}

describe('normalizarBuscaInternacional', () => {
  it('exige nome com 2+ letras ou um país da lista', () => {
    expect(normalizarBuscaInternacional({})).toBeNull()
    expect(normalizarBuscaInternacional({ nome: 'H' })).toBeNull()
    expect(normalizarBuscaInternacional({ pais: 'XXX' })).toBeNull()
    expect(normalizarBuscaInternacional(null)).toBeNull()
    expect(normalizarBuscaInternacional({ nome: '  Hilton   Hotels ', pais: 'PRT' })).toEqual({ nome: 'Hilton Hotels', pais: 'PRT', cursor: null })
    expect(normalizarBuscaInternacional({ nome: 'H', pais: 'USA' })).toEqual({ nome: '', pais: 'USA', cursor: null })
  })

  it('aceita só cursor com cara de token', () => {
    expect(normalizarBuscaInternacional({ pais: 'USA', cursor: 'H4sI_AA-b+/=' })?.cursor).toBe('H4sI_AA-b+/=')
    expect(normalizarBuscaInternacional({ nome: 'Acme', cursor: 'eyJzZXNz:1xCNHW:xXEMw' })?.cursor).toBe('eyJzZXNz:1xCNHW:xXEMw')
    expect(normalizarBuscaInternacional({ pais: 'USA', cursor: 'x"; drop' })?.cursor).toBeNull()
    expect(normalizarBuscaInternacional({ pais: 'USA', cursor: 'a'.repeat(5000) })?.cursor).toBeNull()
  })
})

describe('corpoCrustdata', () => {
  it('nome vai na busca ranqueada e país no filtro; só campos básicos (sem custo premium)', () => {
    expect(corpoCrustdata({ nome: 'Hilton', pais: 'PRT', cursor: 'abc' })).toEqual({
      search: { query: 'Hilton', mode: 'lexical' },
      filters: { field: 'locations.country', type: '=', value: 'PRT' },
      fields: CAMPOS_CRUSTDATA,
      limit: LIMITE_INTERNACIONAL,
      cursor: 'abc',
    })
    expect(CAMPOS_CRUSTDATA.every((c) => /^(crustdata_company_id|basic_info\.|locations\.)/.test(c))).toBe(true)
  })

  it('só país é filtro puro; só nome não leva filtro', () => {
    const soPais = corpoCrustdata({ nome: '', pais: 'USA', cursor: null })
    expect(soPais.filters).toEqual({ field: 'locations.country', type: '=', value: 'USA' })
    expect(soPais).not.toHaveProperty('search')
    const soNome = corpoCrustdata({ nome: 'Inovacode', pais: '', cursor: null })
    expect(soNome.search).toEqual({ query: 'Inovacode', mode: 'lexical' })
    expect(soNome).not.toHaveProperty('filters')
    expect(soNome).not.toHaveProperty('cursor')
  })
})

describe('mapearEmpresa', () => {
  it('lê os campos básicos', () => {
    expect(mapearEmpresa(BRUTO)).toEqual({
      id: 1509192,
      nome: 'Boeira Garden Hotel Porto',
      dominio: 'curiocollection.com',
      site: 'http://www.boeiragardenhotelporto.curiocollection.com/',
      linkedin: 'https://www.linkedin.com/company/boeira-garden-hotel',
      pais: 'Portugal',
      cidade: 'Porto',
      sede: 'Porto, Porto District, Portugal',
      fundacao: 2019,
      funcionarios: '51-200',
      tipo: 'Privately Held',
    })
  })

  it('descarta registro sem id/nome e link que não é http(s)', () => {
    expect(mapearEmpresa({ basic_info: { name: 'X' } })).toBeNull()
    expect(mapearEmpresa({ crustdata_company_id: 1, basic_info: {} })).toBeNull()
    const e = mapearEmpresa({ crustdata_company_id: 1, basic_info: { name: 'X', website: 'javascript:alert(1)', professional_network_url: 'linkedin.com/company/x' } })
    expect(e?.site).toBeNull()
    expect(e?.linkedin).toBe('https://linkedin.com/company/x')
  })
})

describe('buscarEmpresasCrustdata', () => {
  const busca = { nome: 'Hilton', pais: 'PRT' as const, cursor: null }

  it('sem chave não chama a API', async () => {
    const fetcher = vi.fn()
    expect(await buscarEmpresasCrustdata(busca, '', fetcher as unknown as typeof fetch)).toEqual({ ok: false, motivo: 'sem_chave' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('envia a chave no header e devolve itens, cursor e total', async () => {
    const fetcher = vi.fn(async () => resposta(200, { companies: [BRUTO, { lixo: true }], next_cursor: 'prox', total_count: 15 }))
    const r = await buscarEmpresasCrustdata(busca, 'cd_teste', fetcher as unknown as typeof fetch)
    expect(r.ok && r.resposta.itens.map((i) => i.id)).toEqual([1509192])
    expect(r.ok && [r.resposta.proximoCursor, r.resposta.total]).toEqual(['prox', 15])
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.crustdata.com/company/search')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer cd_teste')
    expect((init.headers as Record<string, string>)['x-api-version']).toBe('2025-11-01')
  })

  it.each([
    [401, 'sem_chave'],
    [402, 'sem_credito'],
    [403, 'sem_credito'],
    [429, 'limite'],
    [500, 'indisponivel'],
  ])('HTTP %i → %s', async (status, motivo) => {
    const fetcher = vi.fn(async () => resposta(status, { error: { message: 'x' } }))
    expect(await buscarEmpresasCrustdata(busca, 'k', fetcher as unknown as typeof fetch)).toEqual({ ok: false, motivo })
  })

  it('erro de rede vira indisponível', async () => {
    const fetcher = vi.fn(async () => { throw new Error('timeout') })
    expect(await buscarEmpresasCrustdata(busca, 'k', fetcher as unknown as typeof fetch)).toEqual({ ok: false, motivo: 'indisponivel' })
  })
})

describe('rota /api/prospeccao/internacional', () => {
  const ORG = 'aaaaaaaa-0000-4000-8000-000000000001'
  const USUARIO = 'aaaaaaaa-1111-4111-8111-00000000000c'
  const chamar = (corpo: unknown) =>
    POST(new Request('http://localhost/api/prospeccao/internacional', { method: 'POST', body: JSON.stringify(corpo), headers: { 'Content-Type': 'application/json' } }))
  const fetchOriginal = globalThis.fetch

  beforeEach(() => {
    estado.banco = new BancoFalso({
      perfis: [{ id: USUARIO, organizacao_id: ORG, role: 'usuario' }],
      perfil_permissoes: [{ organizacao_id: ORG, perfil_id: USUARIO, permissao: 'campaigns.view' }],
      organizacoes: [{ id: ORG, configuracoes: {} }],
    })
    estado.usuarioId = null
    vi.stubEnv('CRUSTDATA_API_KEY', 'cd_teste')
  })
  afterEach(() => {
    globalThis.fetch = fetchOriginal
    vi.unstubAllEnvs()
  })

  it('sem sessão não chega à Crustdata', async () => {
    const f = vi.fn()
    globalThis.fetch = f as unknown as typeof fetch
    expect((await chamar({ nome: 'Hilton' })).status).toBe(401)
    expect(f).not.toHaveBeenCalled()
  })

  it('pedido sem critério é recusado sem gastar crédito', async () => {
    estado.usuarioId = USUARIO
    const f = vi.fn()
    globalThis.fetch = f as unknown as typeof fetch
    expect((await chamar({ nome: 'x' })).status).toBe(400)
    expect(f).not.toHaveBeenCalled()
  })

  it('devolve as empresas e nunca a chave', async () => {
    estado.usuarioId = USUARIO
    globalThis.fetch = vi.fn(async () => resposta(200, { companies: [BRUTO], next_cursor: null, total_count: 1 })) as unknown as typeof fetch
    const res = await chamar({ nome: 'Boeira', pais: 'PRT' })
    const texto = await res.text()
    expect(res.status).toBe(200)
    expect(JSON.parse(texto).itens[0].nome).toBe('Boeira Garden Hotel Porto')
    expect(texto).not.toContain('cd_teste')
  })

  it('sem chave configurada responde 503 honesto', async () => {
    estado.usuarioId = USUARIO
    vi.stubEnv('CRUSTDATA_API_KEY', '')
    const res = await chamar({ pais: 'USA' })
    expect(res.status).toBe(503)
    expect((await res.json()).erro).toMatch(/não configurada/)
  })
})

describe('nome no catálogo da Receita', () => {
  it('tira acento e espaço duplo, mantendo o escape do ILIKE', () => {
    const f = normalizarFiltros({ texto: '  Pousada  São   João 100%_ ' }, { cnaes: ['5510801'] } as Parameters<typeof normalizarFiltros>[1])
    expect(f.texto).toBe('Pousada Sao Joao 100\\%\\_')
  })
})

describe('CNPJ fora do catálogo (OpenCNPJ)', () => {
  const ORG = 'aaaaaaaa-0000-4000-8000-000000000001'
  const USUARIO = 'aaaaaaaa-1111-4111-8111-00000000000c'
  const fetchOriginal = globalThis.fetch
  const chamar = (cnpj: string) => GET_CNPJ(new NextRequest(`http://localhost/api/prospeccao/cnpj?cnpj=${encodeURIComponent(cnpj)}`))

  beforeEach(() => {
    estado.banco = new BancoFalso({
      perfis: [{ id: USUARIO, organizacao_id: ORG, role: 'usuario' }],
      perfil_permissoes: [],
      organizacoes: [{ id: ORG, configuracoes: {} }],
    })
    estado.usuarioId = null
  })
  afterEach(() => { globalThis.fetch = fetchOriginal })

  it('cnpjDoTexto reconhece CNPJ com ou sem máscara e ignora nomes', () => {
    expect(cnpjDoTexto('12.345.678/0001-90')).toBe('12345678000190')
    expect(cnpjDoTexto('12345678000190')).toBe('12345678000190')
    expect(cnpjDoTexto('inovacode')).toBeNull()
    expect(cnpjDoTexto('1234')).toBeNull()
    expect(cnpjDoTexto('Loja 12345678000190')).toBeNull()
  })

  it('sem sessão não consulta', async () => {
    const f = vi.fn()
    globalThis.fetch = f as unknown as typeof fetch
    expect((await chamar('12345678000190')).status).toBe(401)
    expect(f).not.toHaveBeenCalled()
  })

  it('CNPJ inválido é recusado sem consultar', async () => {
    estado.usuarioId = USUARIO
    const f = vi.fn()
    globalThis.fetch = f as unknown as typeof fetch
    expect((await chamar('123')).status).toBe(400)
    expect(f).not.toHaveBeenCalled()
  })

  it('devolve os dados oficiais; 404 e falha viram erro honesto', async () => {
    estado.usuarioId = USUARIO
    globalThis.fetch = vi.fn(async () => resposta(200, {
      razao_social: 'INOVACODE LTDA', nome_fantasia: 'INOVACODE', situacao_cadastral: 'Ativa', cnae_principal: '6201501',
      cnaes: [{ codigo: '6201501', descricao: 'Desenvolvimento de programas', is_principal: true }],
      email: 'CONTATO@INOVACODE.COM.BR', uf: 'SP', municipio: 'SAO PAULO',
    })) as unknown as typeof fetch
    const ok = await chamar('12.345.678/0001-90')
    expect(ok.status).toBe(200)
    expect(await ok.json()).toMatchObject({ cnpj: '12345678000190', razao_social: 'INOVACODE LTDA', email: 'contato@inovacode.com.br', uf: 'SP' })

    globalThis.fetch = vi.fn(async () => new Response('', { status: 404 })) as unknown as typeof fetch
    expect((await chamar('12345678000190')).status).toBe(404)
    globalThis.fetch = vi.fn(async () => { throw new Error('timeout') }) as unknown as typeof fetch
    expect((await chamar('12345678000190')).status).toBe(502)
  })
})
