import { describe, expect, it } from 'vitest'
import { chaveMunicipio, descricaoCnae, descricoesCnae, nomeMunicipioIbge } from '@/lib/prospeccao/referenciaIbge'
import { nomeSemSufixo } from '@/lib/prospeccao/rotulos'

describe('nomeMunicipioIbge', () => {
  it('devolve o nome oficial com acento a partir da grafia da Receita', () => {
    expect(nomeMunicipioIbge('SAO PAULO', 'SP')).toBe('São Paulo')
    expect(nomeMunicipioIbge('ALTA FLORESTA D OESTE', 'RO')).toBe("Alta Floresta D'Oeste")
    expect(nomeMunicipioIbge("ALTA FLORESTA D'OESTE", 'ro')).toBe("Alta Floresta D'Oeste")
  })

  it('não casa município de outra UF nem nome desconhecido', () => {
    expect(nomeMunicipioIbge('SAO PAULO', 'RJ')).toBeNull()
    expect(nomeMunicipioIbge('CIDADE INEXISTENTE', 'SP')).toBeNull()
    expect(nomeMunicipioIbge(null, 'SP')).toBeNull()
    expect(nomeMunicipioIbge('SAO PAULO', null)).toBeNull()
  })

  it('chave ignora acento, caixa e pontuação', () => {
    expect(chaveMunicipio("  Mogi-Guaçu ")).toBe('MOGI GUACU')
  })
})

describe('descricaoCnae', () => {
  it('descreve a subclasse com 7 dígitos, com ou sem máscara', () => {
    expect(descricaoCnae('5510801')).toBe('Hotéis')
    expect(descricaoCnae('5611-2/01')).toBe('Restaurantes e similares')
    expect(descricaoCnae('9999999')).toBeNull()
    expect(descricaoCnae(null)).toBeNull()
  })

  it('descricoesCnae só inclui os códigos conhecidos', () => {
    expect(descricoesCnae(['5510801', '9999999'])).toEqual({ '5510801': 'Hotéis' })
  })
})

describe('nomeSemSufixo', () => {
  it('tira o sufixo societário do fim do nome', () => {
    expect(nomeSemSufixo('Hotel Hcboi LTDA - EPP')).toBe('Hotel Hcboi')
    expect(nomeSemSufixo('Polar Rio Hotel LTDA')).toBe('Polar Rio Hotel')
    expect(nomeSemSufixo('Rede Hoteleira S/A')).toBe('Rede Hoteleira')
    expect(nomeSemSufixo('Pousada Mar EIRELI')).toBe('Pousada Mar')
    expect(nomeSemSufixo('Residencial Pantanal Ii LTDA')).toBe('Residencial Pantanal Ii')
  })

  it('preserva sigla no meio e nome feito só de sigla', () => {
    expect(nomeSemSufixo('Hotel Ltda Center Plaza')).toBe('Hotel Ltda Center Plaza')
    expect(nomeSemSufixo('Mesa Hotel')).toBe('Mesa Hotel')
    expect(nomeSemSufixo('LTDA')).toBe('LTDA')
  })
})
