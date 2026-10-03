import { describe, it, expect, vi } from 'vitest'
import { extrairCnpjs, hostPermitido, enderecoPublico, cnpjsNoSite } from '../enriquecimento/siteCnpj'
import { mapearOpenCnpj, consultarOpenCnpj } from '../enriquecimento/opencnpj'

const PETROBRAS = '33000167000101'

describe('extrairCnpjs', () => {
  it('aceita CNPJ com máscara em qualquer lugar e sem máscara só após "CNPJ"', () => {
    expect(extrairCnpjs('<footer>CNPJ: 33.000.167/0001-01</footer>')).toEqual([PETROBRAS])
    expect(extrairCnpjs('<p>Nosso CNPJ 33000167000101</p>')).toEqual([PETROBRAS])
  })
  it('ignora número solto de 14 dígitos sem rótulo (timestamps, IDs) e DV inválido', () => {
    expect(extrairCnpjs('var x = 33000167000101;')).toEqual([])
    expect(extrairCnpjs('CNPJ 33.000.167/0001-02')).toEqual([])
  })
})

describe('proteção SSRF', () => {
  it('host: só nome de domínio público', () => {
    expect(hostPermitido('empresa.com.br')).toBe(true)
    for (const h of ['localhost', '127.0.0.1', '10.0.0.1', 'intranet.local', 'x.internal', 'semponto']) expect(hostPermitido(h)).toBe(false)
  })
  it('endereço resolvido: recusa privado, loopback, link-local, CGNAT e IPv6 interno', () => {
    for (const ip of ['10.1.2.3', '127.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) {
      expect(enderecoPublico(ip)).toBe(false)
    }
    expect(enderecoPublico('200.160.2.3')).toBe(true)
    expect(enderecoPublico('2804:1f4::1')).toBe(true)
  })

  const html = (corpo: string, status = 200, headers: Record<string, string> = { 'content-type': 'text/html' }) =>
    new Response(corpo, { status, headers })

  it('domínio que resolve para IP interno não é buscado', async () => {
    const f = vi.fn()
    const r = await cnpjsNoSite('empresa.com.br', { fetch: f as unknown as typeof fetch, resolver: async () => ['10.0.0.5'] })
    expect(r.status).toBe('falha')
    expect(f).not.toHaveBeenCalled()
  })

  it('redirect para host interno é recusado (validação em cada salto)', async () => {
    const f = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest' } }))
    const r = await cnpjsNoSite('empresa.com.br', { fetch: f as unknown as typeof fetch, resolver: async () => ['200.1.1.1'] })
    expect(r.status).toBe('falha')
  })

  it('segue redirect válido e acha o CNPJ; tenta www. quando o domínio puro falha', async () => {
    const chamadas: string[] = []
    const f = vi.fn(async (u: string | URL | Request) => {
      const url = String(u)
      chamadas.push(url)
      if (url === 'https://empresa.com.br/') throw new Error('ECONNREFUSED')
      if (url === 'https://www.empresa.com.br/') return new Response(null, { status: 301, headers: { location: '/inicio' } })
      return html('<footer>CNPJ 33.000.167/0001-01</footer>')
    })
    const r = await cnpjsNoSite('empresa.com.br', { fetch: f as unknown as typeof fetch, resolver: async () => ['200.1.1.1'] })
    expect(r).toEqual({ status: 'ok', cnpjs: [PETROBRAS], url: 'https://www.empresa.com.br/inicio' })
    expect(chamadas).toEqual(['https://empresa.com.br/', 'https://www.empresa.com.br/', 'https://www.empresa.com.br/inicio'])
  })

  it('página sem CNPJ → nao_encontrado; conteúdo não-HTML é ignorado', async () => {
    const semCnpj = vi.fn(async () => html('<p>olá</p>'))
    expect((await cnpjsNoSite('empresa.com.br', { fetch: semCnpj as unknown as typeof fetch, resolver: async () => ['200.1.1.1'] })).status).toBe('nao_encontrado')
    const pdf = vi.fn(async () => html('%PDF', 200, { 'content-type': 'application/pdf' }))
    expect((await cnpjsNoSite('empresa.com.br', { fetch: pdf as unknown as typeof fetch, resolver: async () => ['200.1.1.1'] })).status).toBe('falha')
  })
})

describe('OpenCNPJ', () => {
  it('mapeia razão, fantasia, situação, CNAE principal com descrição e e-mail', () => {
    expect(mapearOpenCnpj(PETROBRAS, {
      razao_social: 'PETROLEO BRASILEIRO S A PETROBRAS', nome_fantasia: '', situacao_cadastral: 'Ativa', cnae_principal: '0600001',
      cnaes: [{ codigo: '0600001', descricao: 'Extração de petróleo e gás natural', is_principal: true }], email: 'X@PETROBRAS.COM.BR', uf: 'RJ', municipio: 'RIO DE JANEIRO',
    })).toEqual({
      cnpj: PETROBRAS, razao_social: 'PETROLEO BRASILEIRO S A PETROBRAS', nome_fantasia: null, situacao_cadastral: 'Ativa',
      cnae_principal: '0600001', atividade_principal: 'Extração de petróleo e gás natural', email: 'x@petrobras.com.br', uf: 'RJ', municipio: 'RIO DE JANEIRO',
      socios: [],
    })
  })
  it('traz o quadro societário (pessoa física) junto, para o cache servir à Prospecção', () => {
    const d = mapearOpenCnpj(PETROBRAS, { QSA: [
      { nome_socio: 'MARIA SOUZA LIMA', qualificacao_socio: 'Sócio-Administrador', identificador_socio: 'Pessoa Física', data_entrada_sociedade: '2010-05-01' },
      { nome_socio: 'HOLDING X LTDA', qualificacao_socio: 'Sócio', identificador_socio: 'Pessoa Jurídica' },
    ] })
    expect(d.socios).toEqual([{ nome: 'Maria Souza Lima', qualificacao: 'Sócio-Administrador', desde: '2010-05-01' }])
  })
  it('404 = não encontrado; 5xx/rede = falha (nunca confundidos)', async () => {
    expect(await consultarOpenCnpj(PETROBRAS, vi.fn(async () => new Response('', { status: 404 })) as unknown as typeof fetch)).toEqual({ status: 'nao_encontrado' })
    expect((await consultarOpenCnpj(PETROBRAS, vi.fn(async () => new Response('', { status: 503 })) as unknown as typeof fetch)).status).toBe('falha')
    expect((await consultarOpenCnpj(PETROBRAS, vi.fn(async () => { throw new Error('timeout') }) as unknown as typeof fetch)).status).toBe('falha')
  })
  it('não consulta valor que não seja CNPJ de 14 dígitos', async () => {
    const f = vi.fn()
    expect(await consultarOpenCnpj('12345678909', f as unknown as typeof fetch)).toEqual({ status: 'nao_encontrado' })
    expect(f).not.toHaveBeenCalled()
  })
})
