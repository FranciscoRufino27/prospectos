// Municípios do perfil de busca e do filtro da tela. Guardamos o CÓDIGO da RF
// (catalogo_estabelecimentos.municipio_codigo); o nome vem do catálogo pela
// RPC prospeccao_municipios (migration 0052). Puro — cliente, servidor e testes.

export interface Municipio {
  codigo: string
  nome: string // como a RF grava: "SAO PAULO"
  uf: string
}

export const LIMITE_SUGESTOES_MUNICIPIO = 50
const TEXTO_MAX = 60

/**
 * Texto digitado → formato da RF: sem acento, caixa alta, espaços simples.
 * `%` e `_` são curingas do ILIKE: escapados para a busca ser literal.
 */
export function normalizarTextoMunicipio(texto: unknown): string {
  if (typeof texto !== 'string') return ''
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, TEXTO_MAX)
    .replace(/[\\%_]/g, (c) => `\\${c}`)
}

/**
 * Tira os municípios que ficaram fora dos estados escolhidos (a busca exige
 * UF e município ao mesmo tempo, então sobrariam zero resultados). Município
 * de UF desconhecida (nome ainda não carregado) fica; sem estado = Brasil todo.
 */
export function podarMunicipios(codigos: string[], ufs: string[], conhecidos: Record<string, Municipio>): string[] {
  if (ufs.length === 0) return codigos
  return codigos.filter((c) => {
    const m = conhecidos[c]
    return !m || ufs.includes(m.uf)
  })
}
