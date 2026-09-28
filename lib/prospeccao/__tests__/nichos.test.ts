import { describe, expect, it } from 'vitest'
import { alternarNicho, gruposDoPerfil, ID_OUTRAS, NICHOS, nichoDaAtividade, nomeAtividade } from '@/lib/prospeccao/nichos'

describe('nichos da prospecção', () => {
  it('cada CNAE tem 7 dígitos e pertence a um único nicho', () => {
    const codigos = NICHOS.flatMap((n) => n.atividades.map((a) => a.codigo))
    expect(codigos.every((c) => /^\d{7}$/.test(c))).toBe(true)
    expect(new Set(codigos).size).toBe(codigos.length)
    expect(new Set(NICHOS.map((n) => n.id)).size).toBe(NICHOS.length)
  })

  it('dá nome e nicho à atividade conhecida; null à desconhecida', () => {
    expect(nomeAtividade('5510801')).toBe('Hotéis')
    expect(nichoDaAtividade('5620102')?.id).toBe('buffets')
    expect(nomeAtividade('0000000')).toBeNull()
    expect(nichoDaAtividade('0000000')).toBeNull()
  })

  it('agrupa o perfil na ordem dos nichos e manda o desconhecido para "Outras"', () => {
    const grupos = gruposDoPerfil(['5620102', '9999999', '5510802', '5510801'])
    expect(grupos).toEqual([
      { id: 'hotelaria', nome: 'Hotelaria', cnaes: ['5510802', '5510801'] },
      { id: 'buffets', nome: 'Buffets', cnaes: ['5620102'] },
      { id: ID_OUTRAS, nome: 'Outras atividades', cnaes: ['9999999'] },
    ])
  })

  it('perfil vazio não oferece nicho', () => {
    expect(gruposDoPerfil([])).toEqual([])
  })
})

describe('alternarNicho', () => {
  it('marca o nicho inteiro, mantendo o que já havia', () => {
    const r = alternarNicho(['5510801', '9999999'], 'lavanderias', 20)
    expect(r).toEqual({ ok: true, cnaes: ['5510801', '9999999', '9601701', '9601702', '9601703'] })
  })

  it('nicho completo sai inteiro; o resto do perfil fica', () => {
    const r = alternarNicho(['9601701', '9601702', '9601703', '5510801'], 'lavanderias', 20)
    expect(r).toEqual({ ok: true, cnaes: ['5510801'] })
  })

  it('nicho parcial é completado, não removido', () => {
    const r = alternarNicho(['9601701'], 'lavanderias', 20)
    expect(r).toEqual({ ok: true, cnaes: ['9601701', '9601702', '9601703'] })
  })

  it('não passa do limite: recusa e diz quantas vagas faltam', () => {
    const cheio = Array.from({ length: 19 }, (_, i) => String(1000000 + i))
    expect(alternarNicho(cheio, 'lavanderias', 20)).toEqual({ ok: false, motivo: 'limite', faltam: 2 })
  })

  it('nicho desconhecido não altera o perfil', () => {
    expect(alternarNicho(['5510801'], 'nao-existe', 20)).toEqual({ ok: true, cnaes: ['5510801'] })
  })
})
