import { normalizarTelefone } from '@/lib/whatsapp/telefone'

// Número de WhatsApp para avisos, no formato que a Z-API espera (E.164 sem
// "+"). Aceita o que a pessoa digita ("(11) 99999-8888", "+55 11 ...").
//   - começou com "+": o código do país já veio — usa como está;
//   - senão, número BR sem DDI (10/11 dígitos) ganha o 55;
//   - 12 a 15 dígitos sem "+": já tem DDI.
// Inválido → null.
export function numeroWhatsappAvisos(bruto: string | null | undefined): string | null {
  const texto = (bruto ?? '').trim()
  const d = normalizarTelefone(texto)
  if (texto.startsWith('+')) return d.length >= 10 && d.length <= 15 ? d : null
  if (d.length === 10 || d.length === 11) return `55${d}`
  if (d.length >= 12 && d.length <= 15) return d
  return null
}
