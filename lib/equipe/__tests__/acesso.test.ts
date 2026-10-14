import { describe, expect, it } from 'vitest'
import { estaBloqueado } from '../acesso'

describe('estaBloqueado', () => {
  const agora = Date.parse('2026-10-14T12:00:00Z')

  it('sem banned_until o acesso está livre', () => {
    expect(estaBloqueado(null, agora)).toBe(false)
    expect(estaBloqueado(undefined, agora)).toBe(false)
    expect(estaBloqueado('', agora)).toBe(false)
  })

  it('bloqueio no futuro vale; bloqueio vencido não', () => {
    expect(estaBloqueado('2126-10-14T12:00:00Z', agora)).toBe(true)
    expect(estaBloqueado('2026-10-14T11:59:59Z', agora)).toBe(false)
  })

  it('data inválida não conta como bloqueio', () => {
    expect(estaBloqueado('nao-e-data', agora)).toBe(false)
  })
})
