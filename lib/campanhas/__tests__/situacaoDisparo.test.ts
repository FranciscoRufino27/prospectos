import { describe, expect, it } from 'vitest'
import {
  aguardandoRespostasDoDisparo,
  execucoesPendentes,
  temFalhaOperacional,
  progressoCampanha,
  type ResumoExecucoesSituacao,
} from '../situacaoDisparo'

const resumo = (parcial: Partial<ResumoExecucoesSituacao> = {}): ResumoExecucoesSituacao => ({
  total: 4, emAndamento: 0, aguardando: 0, canceladas: 0, erros: 0, respostas: 0, ...parcial,
})

const disparoConcluido = {
  disparoUnico: true,
  status: 'ativa',
  emEnsaio: false,
  resumo: resumo(),
}

describe('situação do disparo', () => {
  it('marca aguardando respostas quando tudo saiu e ninguém respondeu', () => {
    expect(aguardandoRespostasDoDisparo(disparoConcluido)).toBe(true)
  })

  it('para de marcar assim que a primeira resposta chega', () => {
    expect(aguardandoRespostasDoDisparo({ ...disparoConcluido, resumo: resumo({ respostas: 1 }) })).toBe(false)
    expect(aguardandoRespostasDoDisparo({ ...disparoConcluido, resumo: resumo({ respostas: 4 }) })).toBe(false)
  })

  it('não marca campanha com cadência — o servidor não recusa concluir essas', () => {
    expect(aguardandoRespostasDoDisparo({ ...disparoConcluido, disparoUnico: false })).toBe(false)
  })

  it('não marca enquanto há envio na fila, nem quando algo falhou', () => {
    expect(aguardandoRespostasDoDisparo({ ...disparoConcluido, resumo: resumo({ aguardando: 1 }) })).toBe(false)
    expect(aguardandoRespostasDoDisparo({ ...disparoConcluido, resumo: resumo({ emAndamento: 1 }) })).toBe(false)
    expect(aguardandoRespostasDoDisparo({ ...disparoConcluido, resumo: resumo({ canceladas: 1 }) })).toBe(false)
    expect(aguardandoRespostasDoDisparo({ ...disparoConcluido, resumo: resumo({ erros: 1 }) })).toBe(false)
  })

  it('não marca simulação, campanha fora do ar ou disparo que nunca inscreveu ninguém', () => {
    expect(aguardandoRespostasDoDisparo({ ...disparoConcluido, emEnsaio: true })).toBe(false)
    expect(aguardandoRespostasDoDisparo({ ...disparoConcluido, status: 'pausada' })).toBe(false)
    expect(aguardandoRespostasDoDisparo({ ...disparoConcluido, resumo: resumo({ total: 0 }) })).toBe(false)
    expect(aguardandoRespostasDoDisparo({ ...disparoConcluido, resumo: null })).toBe(false)
  })

  it('trata resumo ausente sem quebrar os auxiliares', () => {
    expect(temFalhaOperacional(null)).toBe(false)
    expect(temFalhaOperacional(resumo({ erros: 2 }))).toBe(true)
    expect(execucoesPendentes(undefined)).toBe(0)
    expect(execucoesPendentes(resumo({ emAndamento: 2, aguardando: 3 }))).toBe(5)
  })
})

describe('progressoCampanha (lista de campanhas)', () => {
  it('números reais da PROSPECÇÃO 06/10: cada contato em um só segmento', () => {
    const p = progressoCampanha({
      total: 216, emAndamento: 0, aguardando: 205, aguardandoPrimeiroEnvio: 117, jaContatados: 99,
      concluidas: 0, canceladas: 11, devolvidos: 11, erros: 0, respostas: 0,
    })
    expect(p).toMatchObject({ contatados: 99, naFila: 117, emCadencia: 88, devolvidos: 11, sairam: 0, concluidos: 0, erros: 0 })
    expect(p.naFila + p.emCadencia + p.devolvidos + p.sairam + p.concluidos + p.erros).toBe(216)
    expect(p.taxaResposta).toBe(0)
    expect(p.taxaDevolucao).toBeCloseTo(11 / 99)
    expect(p.nivelDevolucao).toBe('alto')
  })

  it('níveis de devolução e campanha sem ninguém contatado', () => {
    const base = { total: 100, emAndamento: 0, aguardando: 0, canceladas: 0, erros: 0, respostas: 0, jaContatados: 100 }
    expect(progressoCampanha({ ...base, canceladas: 1, devolvidos: 1 }).nivelDevolucao).toBe('ok')
    expect(progressoCampanha({ ...base, canceladas: 3, devolvidos: 3 }).nivelDevolucao).toBe('atencao')
    expect(progressoCampanha({ ...base, canceladas: 6, devolvidos: 6 }).nivelDevolucao).toBe('alto')
    const nada = progressoCampanha({ ...base, aguardando: 100, aguardandoPrimeiroEnvio: 100, jaContatados: 0 })
    expect(nada).toMatchObject({ contatados: 0, naFila: 100, taxaResposta: null, taxaDevolucao: null, nivelDevolucao: 'ok' })
  })
})
