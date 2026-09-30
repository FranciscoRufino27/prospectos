import { describe, expect, it } from 'vitest'
import { avaliarDecisor, porteAtingeCorte } from '@/lib/prospeccao/adequacaoDecisor'
import type { Socio } from '@/lib/prospeccao/socios'

const socio = (nome: string, qualificacao: string): Socio => ({ nome, qualificacao, desde: null })
const ADMIN = socio('Joao de Souza', 'Sócio-Administrador')
const PROCURADOR = socio('Ana Lima', 'Procurador')
const TITULAR = socio('Rita Alves', 'Titular Pessoa Física Residente ou Domiciliado no Brasil')
const MICRO = { porte: 'micro', mei: false }
const DEMAIS = { porte: 'demais', mei: false }

describe('avaliarDecisor', () => {
  it('sem cargos-alvo nem corte não avalia e mantém a sugestão atual', () => {
    const r = avaliarDecisor([PROCURADOR, ADMIN], MICRO, undefined)
    expect(r).toMatchObject({ status: 'sem_criterio', motivo: null, sugerido: ADMIN })
    expect(r.socios.every((s) => s.adequado === null)).toBe(true)
  })

  it('sócio com cargo-alvo serve e vira o sugerido', () => {
    const r = avaliarDecisor([PROCURADOR, TITULAR], MICRO, { cargosAlvo: ['proprietario'] })
    expect(r).toMatchObject({ status: 'socio_serve', motivo: null, sugerido: TITULAR })
    expect(r.socios.map((s) => s.adequado)).toEqual([false, true])
  })

  it('prefere o sócio com cargo-alvo ao administrador fora do alvo', () => {
    const r = avaliarDecisor([ADMIN, TITULAR], MICRO, { cargosAlvo: ['proprietario'] })
    expect(r.sugerido).toEqual(TITULAR)
  })

  it('nenhum sócio no cargo-alvo pede outro decisor, mas ainda sugere alguém', () => {
    const r = avaliarDecisor([PROCURADOR, ADMIN], MICRO, { cargosAlvo: ['gerente'] })
    expect(r).toMatchObject({ status: 'precisa_outro_decisor', motivo: 'cargo', sugerido: ADMIN })
  })

  it('quadro sem sócio pessoa física pede outro decisor', () => {
    expect(avaliarDecisor([], MICRO, { cargosAlvo: ['socio'] })).toMatchObject({ status: 'precisa_outro_decisor', motivo: 'sem_socio', sugerido: null })
  })

  it('porte no corte pede outro decisor mesmo com sócio no cargo-alvo', () => {
    const r = avaliarDecisor([ADMIN], DEMAIS, { cargosAlvo: ['socio'], porteOutroDecisor: 'demais' })
    expect(r).toMatchObject({ status: 'precisa_outro_decisor', motivo: 'porte', sugerido: ADMIN })
  })

  it('só o corte, abaixo dele, deixa o sócio servir', () => {
    expect(avaliarDecisor([ADMIN], MICRO, { porteOutroDecisor: 'pequeno' }).status).toBe('socio_serve')
  })

  it('MEI conta como micro mesmo com porte diferente', () => {
    expect(avaliarDecisor([ADMIN], { porte: 'demais', mei: true }, { porteOutroDecisor: 'pequeno' }).status).toBe('socio_serve')
  })
})

describe('porteAtingeCorte', () => {
  it.each([
    ['micro', 'pequeno', false],
    ['pequeno', 'pequeno', true],
    ['demais', 'pequeno', true],
    ['pequeno', 'demais', false],
    ['nao_informado', 'pequeno', false],
    [null, 'pequeno', false],
    ['demais', undefined, false],
  ] as const)('%s com corte %s → %s', (porte, corte, esperado) => {
    expect(porteAtingeCorte(porte, corte)).toBe(esperado)
  })
})
