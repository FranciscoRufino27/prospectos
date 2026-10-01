import { describe, it, expect } from 'vitest'
import { cifrar, decifrar } from '../criptografia'

// Chave de teste fixa (32 bytes em base64) — nunca a real do ambiente.
const ENV_OK = { INTEGRACAO_ES: undefined, INTEGRACOES_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') }

describe('cifrar/decifrar', () => {
  it('round-trip: decifra exatamente o texto original', () => {
    const cifrado = cifrar('access-token-secreto-123', ENV_OK)
    expect(cifrado).not.toContain('access-token-secreto-123')
    expect(decifrar(cifrado, ENV_OK)).toBe('access-token-secreto-123')
  })

  it('duas cifragens do mesmo texto geram valores diferentes (IV aleatório)', () => {
    const a = cifrar('mesmo-texto', ENV_OK)
    const b = cifrar('mesmo-texto', ENV_OK)
    expect(a).not.toBe(b)
  })

  it('sem INTEGRACOES_ENCRYPTION_KEY, lança', () => {
    expect(() => cifrar('x', {})).toThrow('INTEGRACOES_ENCRYPTION_KEY')
    expect(() => decifrar('v1:a:b:c', {})).toThrow('INTEGRACOES_ENCRYPTION_KEY')
  })

  it('chave com tamanho errado, lança', () => {
    const envRuim = { INTEGRACOES_ENCRYPTION_KEY: Buffer.alloc(16, 1).toString('base64') }
    expect(() => cifrar('x', envRuim)).toThrow('32 bytes')
  })

  it('valor cifrado com formato inválido, lança', () => {
    expect(() => decifrar('nao-e-um-valor-cifrado', ENV_OK)).toThrow('inválido')
  })

  it('valor cifrado adulterado (tag/ciphertext trocados), lança na verificação de integridade', () => {
    const cifrado = cifrar('texto-original', ENV_OK)
    const partes = cifrado.split(':')
    // Troca um byte do ciphertext — GCM deve rejeitar na autenticação.
    const ctAdulterado = Buffer.from(partes[3], 'base64')
    ctAdulterado[0] = ctAdulterado[0] ^ 0xff
    const adulterado = [partes[0], partes[1], partes[2], ctAdulterado.toString('base64')].join(':')
    expect(() => decifrar(adulterado, ENV_OK)).toThrow()
  })
})
