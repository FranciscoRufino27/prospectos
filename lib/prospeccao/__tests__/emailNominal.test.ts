import { describe, expect, it } from 'vitest'
import { donoDoEmail, localCasaComNome } from '@/lib/prospeccao/emailNominal'
import { avaliarDecisor } from '@/lib/prospeccao/adequacaoDecisor'
import type { Socio } from '@/lib/prospeccao/socios'

const socio = (nome: string, qualificacao = 'Sócio'): Socio => ({ nome, qualificacao, desde: null })
const JOAO = socio('João da Silva', 'Sócio-Administrador')
const MARIA = socio('Maria Souza')

describe('localCasaComNome', () => {
  it.each([
    ['joao', true],
    ['joao.silva', true],
    ['joaosilva', true],
    ['silva.joao', true],
    ['jsilva', true],
    ['joaos', true],
    ['joao_silva2', true],
    ['silva', false], // sobrenome sozinho é ambíguo
    ['jo', false],
    ['reservas', false],
    ['joaopedro', false],
  ])('%s → %s', (local, esperado) => {
    expect(localCasaComNome(local, 'João da Silva')).toBe(esperado)
  })

  it('aceita iniciais dos nomes do meio', () => {
    expect(localCasaComNome('soniaamcarvalho', 'Sonia Aparecida Martins Carvalho')).toBe(true)
    expect(localCasaComNome('soniacarvalho', 'Sonia Aparecida Martins Carvalho')).toBe(true)
    expect(localCasaComNome('jpsilva', 'João Pedro Silva')).toBe(true)
    // Inicial diferente do primeiro nome: outra pessoa da família.
    expect(localCasaComNome('d.domingues', 'Fernando Pedrosa Domingues')).toBe(false)
    expect(localCasaComNome('soniamacarvalho', 'Sonia Aparecida Martins Carvalho')).toBe(false)
  })

  it('ignora acentos no nome e partículas', () => {
    expect(localCasaComNome('conceicao.ramos', 'Conceição dos Ramos')).toBe(true)
  })
})

describe('donoDoEmail', () => {
  it('acha o sócio pelo e-mail corporativo', () => {
    expect(donoDoEmail('Joao.Silva@hotelmar.com.br', [MARIA, JOAO])).toEqual(JOAO)
  })

  it('aceita provedor pessoal: chega à pessoa', () => {
    expect(donoDoEmail('mariasouza@gmail.com', [MARIA, JOAO])).toEqual(MARIA)
  })

  it('caixa genérica, contador, typo e vazio nunca são nominais', () => {
    expect(donoDoEmail('reservas@hotel.com.br', [JOAO])).toBeNull()
    expect(donoDoEmail('joao@contabilidadex.com.br', [JOAO])).toBeNull()
    expect(donoDoEmail('joao@hotmal.com', [JOAO])).toBeNull()
    expect(donoDoEmail(null, [JOAO])).toBeNull()
  })

  it('e-mail que casa com dois sócios é ambíguo', () => {
    expect(donoDoEmail('joao@hotel.com.br', [JOAO, socio('João Pereira')])).toBeNull()
  })

  it('e-mail sem sócio correspondente não é nominal', () => {
    expect(donoDoEmail('carlos@hotel.com.br', [JOAO, MARIA])).toBeNull()
  })
})

describe('avaliarDecisor com dono do e-mail', () => {
  const EMPRESA = { porte: 'micro', mei: false }

  it('sugere o dono do e-mail quando ele é adequado', () => {
    expect(avaliarDecisor([JOAO, MARIA], EMPRESA, undefined, MARIA).sugerido).toEqual(MARIA)
    expect(avaliarDecisor([JOAO, MARIA], EMPRESA, { cargosAlvo: ['socio'] }, MARIA).sugerido).toEqual(MARIA)
  })

  it('não troca o sugerido por dono do e-mail fora do cargo-alvo', () => {
    expect(avaliarDecisor([JOAO, MARIA], EMPRESA, { cargosAlvo: ['diretor'] }, MARIA).sugerido).toEqual(JOAO)
  })
})
