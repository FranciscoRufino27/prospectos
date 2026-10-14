import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  TEMPOS_SPLASH,
  marcarSplashCompleta,
  modoDaSplash,
  particulasDoAparelho,
} from '@/components/login/splashTempos'

function stubLocalStorage() {
  const dados = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => dados.get(k) ?? null,
    setItem: (k: string, v: string) => { dados.set(k, v) },
  })
}

function stubAparelho({ largura, altura, nucleos, memoria, toque }: {
  largura: number; altura: number; nucleos?: number; memoria?: number; toque?: boolean
}) {
  vi.stubGlobal('window', {
    innerWidth: largura,
    innerHeight: altura,
    matchMedia: (q: string) => ({ matches: q === '(pointer: coarse)' ? Boolean(toque) : false }),
  })
  vi.stubGlobal('navigator', { hardwareConcurrency: nucleos, deviceMemory: memoria })
}

describe('modoDaSplash', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 14, 10, 0))
    stubLocalStorage()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('é completa na primeira entrada do dia e curta nas seguintes', () => {
    expect(modoDaSplash()).toBe('completa')
    marcarSplashCompleta()
    expect(modoDaSplash()).toBe('curta')
  })

  it('volta a ser completa no dia seguinte', () => {
    marcarSplashCompleta()
    vi.setSystemTime(new Date(2026, 9, 15, 8, 0))
    expect(modoDaSplash()).toBe('completa')
  })

  it('sem localStorage (aba privada bloqueada), cai na completa sem quebrar', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('bloqueado') },
      setItem: () => { throw new Error('bloqueado') },
    })
    expect(() => marcarSplashCompleta()).not.toThrow()
    expect(modoDaSplash()).toBe('completa')
  })
})

describe('particulasDoAparelho', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('desktop folgado usa 40 mil', () => {
    stubAparelho({ largura: 1600, altura: 900, nucleos: 8, memoria: 8 })
    expect(particulasDoAparelho()).toBe(40000)
  })

  it('celular (tela pequena ou toque) usa 15 mil', () => {
    stubAparelho({ largura: 390, altura: 844, nucleos: 8, memoria: 8 })
    expect(particulasDoAparelho()).toBe(15000)
    stubAparelho({ largura: 1280, altura: 800, nucleos: 8, memoria: 8, toque: true })
    expect(particulasDoAparelho()).toBe(15000)
  })

  it('máquina com poucos núcleos ou pouca memória usa 15 mil', () => {
    stubAparelho({ largura: 1600, altura: 900, nucleos: 4, memoria: 8 })
    expect(particulasDoAparelho()).toBe(15000)
    stubAparelho({ largura: 1600, altura: 900, nucleos: 8, memoria: 4 })
    expect(particulasDoAparelho()).toBe(15000)
  })
})

describe('TEMPOS_SPLASH', () => {
  it('a curta é bem mais rápida que a completa e não tem pausa da bola', () => {
    const total = (m: keyof typeof TEMPOS_SPLASH) => TEMPOS_SPLASH[m].bolaFim + TEMPOS_SPLASH[m].explosao + TEMPOS_SPLASH[m].logoNaTela
    expect(total('curta')).toBeLessThan(2000)
    expect(total('completa')).toBeGreaterThan(total('curta') * 2)
    expect(TEMPOS_SPLASH.curta.bolaFim).toBe(TEMPOS_SPLASH.curta.succao)
  })
})
