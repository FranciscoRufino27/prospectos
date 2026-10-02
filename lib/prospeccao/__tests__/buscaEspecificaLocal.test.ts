// Busca de empresa específica com local: estado (obrigatório) e cidade
// (opcional) no catálogo da Receita e na Crustdata.
import { describe, expect, it } from 'vitest'
import { filtrosEspecificos } from '../filtros'
import { municipiosDaCidade } from '../municipios'
import { corpoCrustdata, normalizarBuscaInternacional } from '../crustdata'

describe('filtrosEspecificos com local', () => {
  it('restringe ao estado e aos municípios escolhidos; o resto do perfil fica aberto', () => {
    const f = filtrosEspecificos('Hotel Sol', ['5510801'], { ufs: ['SP'], municipios: ['7107'] })!
    expect(f).toMatchObject({ ufs: ['SP'], municipios: ['7107'], portes: [], soComEmail: false, incluirCnaesSecundarios: true })
  })
  it('estado inválido é descartado', () => {
    expect(filtrosEspecificos('Hotel Sol', ['5510801'], { ufs: ['XX'] })!.ufs).toEqual([])
  })
})

describe('municipiosDaCidade', () => {
  const lista = [
    { codigo: '1', nome: 'SANTOS', uf: 'SP' },
    { codigo: '2', nome: 'SANTOS DUMONT', uf: 'MG' },
    { codigo: '3', nome: 'SAO JOSE DOS CAMPOS', uf: 'SP' },
  ]
  it('nome exato vence o parcial', () => {
    expect(municipiosDaCidade(lista, 'SANTOS')).toEqual(['1'])
  })
  it('sem exato, valem todos os sugeridos (o banco já filtrou pelo texto)', () => {
    expect(municipiosDaCidade(lista.slice(1, 2), 'SANTOS')).toEqual(['2'])
  })
})

describe('Crustdata com estado e cidade', () => {
  it('estado e cidade viram filtros tolerantes (.) junto do país', () => {
    const b = normalizarBuscaInternacional({ nome: 'Inovacode', pais: 'BRA', estado: 'São Paulo', cidade: 'São Paulo' })!
    expect(b).toMatchObject({ estado: 'São Paulo', cidade: 'São Paulo' })
    expect(corpoCrustdata(b).filters).toEqual({
      op: 'and',
      conditions: [
        { field: 'locations.country', type: 'in', value: ['BRA'] },
        { field: 'locations.state', type: '(.)', value: 'São Paulo' },
        { field: 'locations.city', type: '(.)', value: 'São Paulo' },
      ],
    })
  })
  it('limpa caracteres estranhos e ignora local curto demais', () => {
    const b = normalizarBuscaInternacional({ nome: 'Acme', estado: 'Lis<bo>a"', cidade: 'x' })!
    expect(b.estado).toBe('Lisboa')
    expect(b).not.toHaveProperty('cidade')
  })
})

describe('busca específica pelo site', async () => {
  const { siteValido, nomeCasa } = await import('../crustdata')
  it('normaliza o site e recusa o que não é domínio', () => {
    expect(siteValido('https://www.BarkleyUS.com/contato')).toBe('barkleyus.com')
    expect(siteValido('cba.com.br')).toBe('cba.com.br')
    expect(siteValido('barkley')).toBeNull()
  })
  it('com o site, só ele filtra (nome e local não entram)', () => {
    const b = normalizarBuscaInternacional({ nome: 'Barkley', pais: 'USA', estado: 'Missouri', site: 'barkleyus.com' })!
    expect(corpoCrustdata(b).filters).toEqual({ field: 'basic_info.primary_domain', type: '=', value: 'barkleyus.com' })
  })
  it('só o site já basta para buscar', () => {
    expect(normalizarBuscaInternacional({ site: 'barkleyus.com' })).toMatchObject({ site: 'barkleyus.com', nome: '' })
  })
  it('descarta empresa sem o nome buscado no nome (a Crustdata casa descrição)', () => {
    expect(nomeCasa('GB Entertainment', 'Barkley')).toBe(false)
    expect(nomeCasa('BARKLEY HOLDINGS LIMITED', 'Barkley')).toBe(true)
    expect(nomeCasa('Companhia Brasileira de Alumínio S.A.', 'Companhia Brasileira de Aluminio')).toBe(true)
  })
})
