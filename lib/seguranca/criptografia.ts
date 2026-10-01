import 'server-only'
import crypto from 'node:crypto'

// Cifra simétrica genérica (AES-256-GCM) para segredos que precisam persistir
// no banco — hoje: tokens OAuth de integrações (lib/integracoes/hubspot).
// Formato do valor cifrado: "v1:<iv_b64>:<tag_b64>:<ciphertext_b64>".
// Chave: INTEGRACOES_ENCRYPTION_KEY (32 bytes em base64). Sem ela, cifrar/
// decifrar lança — não existe fallback "sem cifra".

export type EnvCripto = Record<string, string | undefined>

function obterChave(env: EnvCripto): Buffer {
  const bruta = env.INTEGRACOES_ENCRYPTION_KEY
  if (!bruta) throw new Error('INTEGRACOES_ENCRYPTION_KEY não configurada')
  const chave = Buffer.from(bruta, 'base64')
  if (chave.length !== 32) throw new Error('INTEGRACOES_ENCRYPTION_KEY deve decodificar para 32 bytes (base64 de uma chave AES-256)')
  return chave
}

export function cifrar(texto: string, env: EnvCripto = process.env): string {
  const chave = obterChave(env)
  const iv = crypto.randomBytes(12)
  const cifra = crypto.createCipheriv('aes-256-gcm', chave, iv)
  const ct = Buffer.concat([cifra.update(texto, 'utf8'), cifra.final()])
  const tag = cifra.getAuthTag()
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`
}

export function decifrar(valor: string, env: EnvCripto = process.env): string {
  const chave = obterChave(env)
  const partes = valor.split(':')
  if (partes.length !== 4 || partes[0] !== 'v1') throw new Error('Formato de valor cifrado inválido')
  const [, ivB64, tagB64, ctB64] = partes
  const decifra = crypto.createDecipheriv('aes-256-gcm', chave, Buffer.from(ivB64, 'base64'))
  decifra.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([decifra.update(Buffer.from(ctB64, 'base64')), decifra.final()]).toString('utf8')
}
