// Ações rápidas de contato na tela de Prospecção: telefone legível com tipo
// (fixo/celular), link de WhatsApp e busca de pessoa no LinkedIn. Funções
// puras, sem I/O.

export type TipoTelefone = 'fixo' | 'celular'

export interface TelefoneFormatado {
  /** "(11) 5549-7787" ou "(11) 99876-5432". */
  exibicao: string
  tipo: TipoTelefone
  /** DDD + assinante, só dígitos ("1155497787"). */
  digitos: string
}

/**
 * Lê um telefone brasileiro em qualquer máscara ("(11) 55497787",
 * "+55 11 99876-5432", "(0011) 55497787"). Devolve null quando não dá para
 * reconhecer DDD + assinante: aí a tela mostra o texto original, sem tipo.
 *
 * Tipo pelo plano de numeração da Anatel: 8 dígitos começando em 2–5 = fixo;
 * 9 dígitos começando em 9 = celular. A Receita só guarda 8 dígitos (layout
 * anterior ao nono dígito), então celular vem como 8 dígitos começando em
 * 6–9: ganha o 9 da frente, que é o número discável hoje.
 */
export function formatarTelefone(bruto: string | null | undefined): TelefoneFormatado | null {
  const texto = (bruto ?? '').trim()
  // "(0011) 55497787": DDD entre parênteses, com zeros de operadora/catálogo.
  const comParenteses = texto.match(/^\(\s*0*(\d{2})\s*\)\s*([\d\s.-]+)$/)
  let d = comParenteses ? comParenteses[1] + comParenteses[2].replace(/\D/g, '') : texto.replace(/\D/g, '')
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2)
  d = d.replace(/^0+(?=\d{10,11}$)/, '')
  if (d.length !== 10 && d.length !== 11) return null
  const ddd = d.slice(0, 2)
  if (!/^[1-9][1-9]$/.test(ddd)) return null
  let assinante = d.slice(2)
  if (assinante.length === 8 && /^[6-9]/.test(assinante)) assinante = `9${assinante}`
  if (assinante.length === 9 && assinante[0] === '9') {
    return { exibicao: `(${ddd}) ${assinante.slice(0, 5)}-${assinante.slice(5)}`, tipo: 'celular', digitos: ddd + assinante }
  }
  if (assinante.length === 8 && /^[2-5]/.test(assinante)) {
    return { exibicao: `(${ddd}) ${assinante.slice(0, 4)}-${assinante.slice(4)}`, tipo: 'fixo', digitos: ddd + assinante }
  }
  return null
}

/** Link wa.me só para celular: fixo não recebe WhatsApp comum. */
export function linkWhatsApp(telefone: TelefoneFormatado | null): string | null {
  if (!telefone || telefone.tipo !== 'celular') return null
  return `https://wa.me/55${telefone.digitos}`
}

/** Busca de pessoas no LinkedIn por nome + empresa (sem API, abre no navegador). */
export function urlBuscaLinkedIn(nome: string, empresa: string | null | undefined): string {
  const termos = [nome.trim(), (empresa ?? '').trim()].filter(Boolean).join(' ')
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(termos)}`
}

/**
 * URL de perfil pessoal do LinkedIn em forma canônica
 * ("https://www.linkedin.com/in/<slug>"), a partir do que o usuário colar:
 * com ou sem https, subdomínio de país (br.), barra final ou query. Devolve
 * null para o que não for perfil /in/ (empresa, busca, post, outro site).
 */
export function normalizarPerfilLinkedIn(bruto: string | null | undefined): string | null {
  const texto = (bruto ?? '').trim()
  if (!texto) return null
  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(texto) ? texto : `https://${texto}`)
  } catch {
    return null
  }
  if (!/^([a-z]{2,3}\.|www\.)?linkedin\.com$/i.test(url.hostname)) return null
  const m = url.pathname.match(/^\/in\/([^/]+)\/?$/)
  if (!m) return null
  let slug: string
  try {
    slug = decodeURIComponent(m[1])
  } catch {
    return null
  }
  if (!/^[\p{L}\p{N}_-]{3,100}$/u.test(slug)) return null
  return `https://www.linkedin.com/in/${encodeURIComponent(slug)}`
}

/**
 * Roda `tarefa` para cada item com no máximo `concorrencia` em paralelo, na
 * ordem da lista. Erro de um item não interrompe os outros: cada um vira
 * `{ ok: false }` no resultado. `aoConcluir` recebe quantos já terminaram.
 */
export async function emLote<T, R>(
  itens: readonly T[],
  concorrencia: number,
  tarefa: (item: T) => Promise<R>,
  aoConcluir?: (concluidos: number) => void,
): Promise<Array<{ ok: true; valor: R } | { ok: false }>> {
  const resultados: Array<{ ok: true; valor: R } | { ok: false }> = new Array(itens.length)
  let proximo = 0
  let concluidos = 0
  async function trabalhador() {
    while (proximo < itens.length) {
      const indice = proximo++
      try {
        resultados[indice] = { ok: true, valor: await tarefa(itens[indice]) }
      } catch {
        resultados[indice] = { ok: false }
      }
      aoConcluir?.(++concluidos)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concorrencia, itens.length)) }, trabalhador))
  return resultados
}
