import { describe, expect, it } from 'vitest'
import { dominioDaEmpresa } from '@/lib/prospeccao/dominioEmpresa'
import { classificarEmail } from '@/lib/prospeccao/qualidadeEmail'

describe('dominioDaEmpresa', () => {
  it('tira o domínio do e-mail corporativo e confere com o nome', () => {
    expect(dominioDaEmpresa('erick@ResidencialPantanal.com.br', ['Residencial Pantanal LTDA'])).toEqual({
      dominio: 'residencialpantanal.com.br', confereComNome: true,
    })
  })

  it('caixa genérica no domínio próprio também vale', () => {
    expect(dominioDaEmpresa('reservas@hotelvilladapenha.com.br', [null, 'Mava Hotel e Turismo LTDA'])).toEqual({
      dominio: 'hotelvilladapenha.com.br', confereComNome: false,
    })
  })

  it('palavra genérica do nome não conta como conferência', () => {
    expect(dominioDaEmpresa('contato@hotelx.com.br', ['Hotel Aurora'])?.confereComNome).toBe(false)
    expect(dominioDaEmpresa('contato@aurorahotel.com.br', ['Hotel Aurora'])?.confereComNome).toBe(true)
  })

  it('provedor pessoal, contador, typo, terceiro e vazio não dão domínio', () => {
    expect(dominioDaEmpresa('joao@gmail.com', ['X'])).toBeNull()
    expect(dominioDaEmpresa('joao@superig.com.br', ['X'])).toBeNull()
    expect(dominioDaEmpresa('fiscal@contabilx.com.br', ['X'])).toBeNull()
    expect(dominioDaEmpresa('joao@hotmal.com', ['X'])).toBeNull()
    expect(dominioDaEmpresa('socio@ddadvogados.com.br', ['X'])).toBeNull()
    expect(dominioDaEmpresa('a@jcgconsultoria.com.br', ['X'])).toBeNull()
    expect(dominioDaEmpresa(null, ['X'])).toBeNull()
    expect(dominioDaEmpresa('hotel@uperig.com.b', ['X'])).toBeNull()
  })

  it('remove www. do domínio', () => {
    expect(dominioDaEmpresa('a@www.hotelmar.com.br', ['Hotel Mar'])?.dominio).toBe('hotelmar.com.br')
  })
})

describe('webmails novos contam como provedor pessoal', () => {
  it.each(['a@superig.com.br', 'a@163.com', 'a@bluewin.ch', 'a@aol.com'])('%s', (email) => {
    expect(classificarEmail(email)).toBe('pessoal')
  })
})
