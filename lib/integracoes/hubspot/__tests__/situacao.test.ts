import { describe, it, expect } from 'vitest'
import { classificarSituacao, limiteJanela, type DadosSituacao } from '../situacao'

const AGORA = Date.UTC(2026, 8, 29)
const DIA = 86_400_000
const base: DadosSituacao = { ganhou: false, ultimaAtividade: null, contatos: 2, temNegocio: false, semEmailUtilizavel: false }

describe('classificarSituacao — precedência documentada', () => {
  it('cliente domina tudo (mesmo com atividade recente e sem e-mail)', () => {
    expect(classificarSituacao({ ...base, ganhou: true, ultimaAtividade: AGORA, contatos: 0 }, AGORA)).toBe('cliente')
  })
  it('atividade dentro de 90 dias → em_andamento (vence precisa_enriquecer)', () => {
    expect(classificarSituacao({ ...base, ultimaAtividade: AGORA - 10 * DIA, contatos: 0 }, AGORA)).toBe('em_andamento')
  })
  it('borda: exatamente 90 dias ainda é recente; 91 dias não', () => {
    expect(classificarSituacao({ ...base, ultimaAtividade: limiteJanela(AGORA) }, AGORA)).toBe('em_andamento')
    expect(classificarSituacao({ ...base, ultimaAtividade: AGORA - 91 * DIA }, AGORA)).toBe('reativar')
  })
  it('sem contato ou sem e-mail utilizável → precisa_enriquecer', () => {
    expect(classificarSituacao({ ...base, contatos: 0 }, AGORA)).toBe('precisa_enriquecer')
    expect(classificarSituacao({ ...base, semEmailUtilizavel: true, temNegocio: true }, AGORA)).toBe('precisa_enriquecer')
  })
  it('com e-mail e histórico (negócio ou atividade antiga) → reativar', () => {
    expect(classificarSituacao({ ...base, temNegocio: true }, AGORA)).toBe('reativar')
    expect(classificarSituacao({ ...base, ultimaAtividade: AGORA - 400 * DIA }, AGORA)).toBe('reativar')
  })
  it('com e-mail, sem negócio e sem atividade → prospectar', () => {
    expect(classificarSituacao(base, AGORA)).toBe('prospectar')
  })
})

