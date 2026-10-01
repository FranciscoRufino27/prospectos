// Rótulos de exibição da prospecção. Puro — usado no cliente e no servidor.

import type { PorteProspeccao } from '@/lib/config/workspaceConfig'

export const ROTULO_PORTE: Record<PorteProspeccao, string> = {
  micro: 'Microempresa',
  pequeno: 'Pequeno porte',
  demais: 'Médio/grande',
  nao_informado: 'Não informado',
}

/** '5510801' → '5510-8/01'. Devolve o valor original se não tiver 7 dígitos. */
export function formatarCnae(codigo: string): string {
  return /^\d{7}$/.test(codigo) ? `${codigo.slice(0, 4)}-${codigo.slice(4, 5)}/${codigo.slice(5)}` : codigo
}

const SIGLAS = new Set(['LTDA', 'ME', 'EPP', 'EIRELI', 'SA', 'S/A', 'S.A.', 'S.A', 'MEI', 'SPE', 'SS', 'EI', 'CIA', 'LTDA.', 'ME.'])
const MINUSCULAS = new Set(['da', 'de', 'do', 'das', 'dos', 'e', 'em', 'na', 'no', 'nas', 'nos', 'a', 'o', 'com', 'para'])

/**
 * A Receita grava tudo em CAIXA ALTA. Para leitura: "HOTEL DAS FLORES LTDA"
 * → "Hotel das Flores LTDA". Siglas societárias ficam em maiúsculas.
 */
export function nomeLegivel(bruto: string | null | undefined): string {
  if (!bruto) return ''
  return bruto
    .trim()
    .split(/\s+/)
    .map((palavra, i) => {
      const upper = palavra.toUpperCase()
      if (SIGLAS.has(upper)) return upper
      const lower = palavra.toLowerCase()
      if (i > 0 && MINUSCULAS.has(lower)) return lower
      // Mantém pontuação/apóstrofo: "IBERICA'S" → "Iberica's"; "D'AGUA" → "D'Agua".
      // Após apóstrofo só capitaliza se vier palavra ("D'Agua"), não letra solta ("Iberica's").
      return lower.replace(/(^|[\s\-/(]|['’](?=\p{L}{2}))(\p{L})/gu, (_, sep: string, letra: string) => sep + letra.toUpperCase())
    })
    .join(' ')
}

// Sufixos societários no fim do nome: "LTDA", "LTDA - ME", "- EPP", "S/A",
// "EIRELI", "ME"... Só para exibir na lista; a razão social completa segue
// no detalhe.
const SUFIXO_SOCIETARIO = /(?:[\s,.-]+(?:LTDA\.?|ME\.?|EPP|EIRELI|S\/A|S\.A\.?|SA|MEI|SPE|CIA\.?))+\.?\s*$/i

/**
 * "Hotel Hcboi LTDA - EPP" → "Hotel Hcboi". Se sobrar nada (nome só de
 * sigla), devolve o nome original.
 */
export function nomeSemSufixo(nome: string): string {
  const limpo = nome.replace(SUFIXO_SOCIETARIO, '').replace(/[\s,.-]+$/, '').trim()
  return limpo || nome.trim()
}

/** Duas letras para o avatar: iniciais das duas primeiras palavras significativas. */
export function iniciais(nome: string): string {
  const palavras = nome
    .split(/\s+/)
    .filter((p) => p && !MINUSCULAS.has(p.toLowerCase()) && !SIGLAS.has(p.toUpperCase()))
  const letras = (palavras.length ? palavras : nome.split(/\s+/)).slice(0, 2).map((p) => p[0] ?? '')
  return letras.join('').toUpperCase() || '?'
}

export function rotuloPorte(porte: string | null | undefined): string {
  return porte && porte in ROTULO_PORTE ? ROTULO_PORTE[porte as PorteProspeccao] : '—'
}
