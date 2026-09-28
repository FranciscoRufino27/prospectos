import { describe, it, expect } from 'vitest'
import { extrairTrecho, montarMensagemAviso, TAMANHO_TRECHO } from '../mensagem'
import { numeroWhatsappAvisos } from '../numero'
import type { DadosAvisoResposta } from '../types'

const dados = (over: Partial<DadosAvisoResposta> = {}): DadosAvisoResposta => ({
  empresa: 'ACME', contato: 'Ana', canal: 'email', classificacao: 'positivo', trecho: 'Tenho interesse',
  responsavelId: 'bruno', responsavelNome: 'Bruno', link: null, ...over,
})

describe('extrairTrecho', () => {
  it('corta o histórico citado (pt, en, ">" e "De:")', () => {
    expect(extrairTrecho('Sim, pode ligar.\n\nEm seg., 10 de set. de 2026, Vendas escreveu:\n> texto antigo')).toBe('Sim, pode ligar.')
    expect(extrairTrecho('Ok\nOn Mon, Sep 10, 2026 Sales wrote:\nold')).toBe('Ok')
    expect(extrairTrecho('Certo\n> citado')).toBe('Certo')
    expect(extrairTrecho('Beleza\nDe: vendas@x.com\nEnviado: ontem')).toBe('Beleza')
  })

  it('junta linhas e corta no limite sem quebrar palavra', () => {
    const longo = 'palavra '.repeat(100)
    const t = extrairTrecho(longo)
    expect(t.length).toBeLessThanOrEqual(TAMANHO_TRECHO + 1)
    expect(t.endsWith('palavra…')).toBe(true)
    expect(extrairTrecho('  linha 1 \n\n linha 2  ')).toBe('linha 1 linha 2')
    expect(extrairTrecho('')).toBe('')
  })
})

describe('montarMensagemAviso', () => {
  it('privado: sem menção e sem linha de responsável', () => {
    const m = montarMensagemAviso(dados(), 'responsavel')
    expect(m).toContain('ACME respondeu por e-mail.')
    expect(m).toContain('Leitura automática: com interesse')
    expect(m).not.toContain('@')
    expect(m).not.toContain('Responsável:')
  })

  it('grupo: menciona e nomeia o responsável; sem responsável não inventa', () => {
    expect(montarMensagemAviso(dados(), 'grupo')).toContain('@Bruno, ACME respondeu')
    const sem = montarMensagemAviso(dados({ responsavelNome: '' }), 'grupo')
    expect(sem).toContain('@Sem responsável')
    expect(sem).toContain('Responsável: sem responsável')
  })

  it('sem classificação (WhatsApp) não mostra leitura automática; sem empresa usa o contato', () => {
    const m = montarMensagemAviso(dados({ canal: 'whatsapp', classificacao: null, empresa: '' }), 'responsavel')
    expect(m).toContain('Ana respondeu por WhatsApp.')
    expect(m).not.toContain('Leitura automática')
    expect(m).not.toContain('Empresa:')
  })
})

describe('numeroWhatsappAvisos', () => {
  it('aceita número BR com máscara e completa o DDI', () => {
    expect(numeroWhatsappAvisos('(11) 99999-8888')).toBe('5511999998888')
    expect(numeroWhatsappAvisos('+55 11 3239-0777')).toBe('551132390777')
    expect(numeroWhatsappAvisos('+1 415 555 0100')).toBe('14155550100')
  })

  it('recusa vazio e lixo', () => {
    expect(numeroWhatsappAvisos('')).toBeNull()
    expect(numeroWhatsappAvisos(null)).toBeNull()
    expect(numeroWhatsappAvisos('99887')).toBeNull()
    expect(numeroWhatsappAvisos('2196902361521979393105')).toBeNull()
  })
})
