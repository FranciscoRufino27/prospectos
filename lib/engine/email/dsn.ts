// Leitura do aviso de falha de entrega (DSN, RFC 3464) a partir da mensagem
// BRUTA. O texto legível do aviso muda de servidor para servidor (Gmail,
// Office 365, GoDaddy…) e costuma citar outros endereços antes do que falhou —
// o remetente, o postmaster, os cabeçalhos da mensagem original. A parte
// message/delivery-status diz exatamente QUEM falhou e se a falha é definitiva.
import type { FalhaEntrega } from '../types'

const RE_DESTINATARIO = /^(?:Final|Original)-Recipient:\s*rfc822\s*;\s*<?([^\s<>;]+@[^\s<>;]+?)>?\s*$/gim
const RE_FALHOS_CABECALHO = /^X-Failed-Recipients:\s*([^\r\n]+)/gim
const RE_ACAO = /^Action:\s*([a-z]+)/gim
const RE_STATUS = /^Status:\s*([245]\.\d{1,3}\.\d{1,3})/gim

// Endereços que aparecem no aviso mas nunca são o destinatário que falhou.
const ENDERECOS_DO_SISTEMA = ['mailer-daemon@', 'postmaster@']

function limpar(email: string): string {
  return email.trim().toLowerCase().replace(/^<|>$/g, '')
}

// Devolve null quando a mensagem não tem nenhum campo de DSN (não é um aviso
// estruturado): aí quem chama decide pelo texto, como antes.
export function lerFalhaEntrega(fonte: string, ignorar: string[] = []): FalhaEntrega | null {
  const proprios = new Set(ignorar.map(limpar))
  const destinatarios = new Set<string>()
  const adicionar = (bruto: string) => {
    const email = limpar(bruto)
    if (!email.includes('@') || proprios.has(email)) return
    if (ENDERECOS_DO_SISTEMA.some((p) => email.startsWith(p))) return
    destinatarios.add(email)
  }

  for (const m of fonte.matchAll(RE_DESTINATARIO)) adicionar(m[1])
  for (const m of fonte.matchAll(RE_FALHOS_CABECALHO)) {
    for (const parte of m[1].split(/[,\s]+/)) adicionar(parte)
  }
  const acoes = [...fonte.matchAll(RE_ACAO)].map((m) => m[1].toLowerCase())
  const status = [...new Set([...fonte.matchAll(RE_STATUS)].map((m) => m[1]))]

  if (destinatarios.size === 0 && acoes.length === 0) return null
  return {
    destinatarios: [...destinatarios],
    status,
    somenteAtraso: acoes.length > 0 && acoes.every((a) => a === 'delayed'),
  }
}
