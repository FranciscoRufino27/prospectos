import { describe, expect, it } from 'vitest'
import { parseTema, TEMAS, TEMA_PADRAO } from '../tema'

describe('parseTema', () => {
  it('aceita os três temas', () => {
    for (const t of TEMAS) expect(parseTema(t)).toBe(t)
  })

  it('cai no Padrão sem cookie, com valor vazio ou desconhecido', () => {
    expect(TEMA_PADRAO).toBe('padrao')
    expect(parseTema(undefined)).toBe('padrao')
    expect(parseTema(null)).toBe('padrao')
    expect(parseTema('')).toBe('padrao')
    expect(parseTema('CLARO')).toBe('padrao')
    expect(parseTema('"><script>')).toBe('padrao')
  })
})
