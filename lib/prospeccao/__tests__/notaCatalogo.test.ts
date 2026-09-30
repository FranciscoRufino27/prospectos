import { describe, expect, it } from 'vitest'
import { notaDoCatalogo } from '@/lib/prospeccao/notaCatalogo'

const base = { telefone: null, razao_social: 'RESIDENCIAL PANTANAL LTDA', nome_fantasia: null }

describe('notaDoCatalogo', () => {
  it.each([
    ['erick@residencialpantanal.com.br', 'corporativo', 50],
    ['erick@outrodominio.com.br', 'corporativo', 40],
    ['reservas@residencialpantanal.com.br', 'generico', 30],
    ['erick@gmail.com', 'pessoal', 20],
    ['fiscal@contabilx.com.br', 'contabilidade', 10],
    ['erick@hotmal.com', 'digitacao', 10],
    [null, 'sem_email', 10],
  ] as const)('%s → %s, nota %i', (email, qualidade, nota) => {
    expect(notaDoCatalogo({ ...base, email })).toEqual({ qualidade_email: qualidade, nota })
  })

  it('telefone desempata dentro da faixa, sem subir de faixa', () => {
    expect(notaDoCatalogo({ ...base, email: 'erick@gmail.com', telefone: '(11) 5549-7787' }).nota).toBe(21)
    expect(notaDoCatalogo({ ...base, email: 'erick@gmail.com', telefone: '  ' }).nota).toBe(20)
    expect(notaDoCatalogo({ ...base, email: null, telefone: '1155497787' }).nota).toBe(11)
  })

  it('a pior nota com telefone continua abaixo da pior faixa seguinte', () => {
    expect(notaDoCatalogo({ ...base, email: null, telefone: '1' }).nota)
      .toBeLessThan(notaDoCatalogo({ ...base, email: 'erick@gmail.com' }).nota)
  })
})
