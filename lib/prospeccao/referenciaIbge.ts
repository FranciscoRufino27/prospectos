// Nomes oficiais do IBGE para exibir o que a Receita grava sem acento e só
// por código. Dados estáticos em ./dados (gerados das APIs públicas
// servicodados.ibge.gov.br: localidades/municipios e cnae/subclasses).
// Só servidor: os arquivos somam ~270 KB e não devem ir para o bundle.

import municipiosIbge from './dados/municipios-ibge.json'
import cnaeIbge from './dados/cnae-ibge.json'

const MUNICIPIOS = municipiosIbge as Record<string, string>
const CNAES = cnaeIbge as Record<string, string>

/** Chave de comparação: sem acento, maiúsculas, só letras/dígitos separados por espaço. */
export function chaveMunicipio(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
}

/**
 * "SAO PAULO" + "SP" → "São Paulo". null quando o IBGE não tem o nome (grafia
 * antiga na Receita, UF ausente): a tela cai no nome legível da própria RF.
 */
export function nomeMunicipioIbge(municipioRf: string | null | undefined, uf: string | null | undefined): string | null {
  if (!municipioRf || !uf) return null
  return MUNICIPIOS[`${uf.toUpperCase()}|${chaveMunicipio(municipioRf)}`] ?? null
}

/** "5510801" → "Hotéis". null para código fora da tabela de subclasses do IBGE. */
export function descricaoCnae(codigo: string | null | undefined): string | null {
  if (!codigo) return null
  return CNAES[codigo.replace(/\D/g, '').padStart(7, '0')] ?? null
}

/** Descrição de cada CNAE da lista, só dos que o IBGE conhece. */
export function descricoesCnae(codigos: readonly string[]): Record<string, string> {
  const saida: Record<string, string> = {}
  for (const codigo of codigos) {
    const descricao = descricaoCnae(codigo)
    if (descricao) saida[codigo] = descricao
  }
  return saida
}

/** Existe essa subclasse na tabela do IBGE? */
export function cnaeExiste(codigo: string): boolean {
  return /^\d{7}$/.test(codigo) && codigo in CNAES
}

const semAcento = (texto: string) => texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

interface AtividadeIndexada { codigo: string; nome: string; chave: string; termos: string }
let indiceBusca: Promise<AtividadeIndexada[]> | null = null

// Os termos populares (~600 KB) só carregam na primeira pesquisa: quem importa
// este módulo só para nomes de município/CNAE não paga por eles.
function carregarIndice(): Promise<AtividadeIndexada[]> {
  indiceBusca ??= import('./dados/cnae-termos-ibge.json').then((m) => {
    const termos = (m.default ?? m) as unknown as Record<string, string>
    return Object.entries(CNAES).map(([codigo, nome]) => ({ codigo, nome, chave: semAcento(nome), termos: termos[codigo] ?? '' }))
  })
  return indiceBusca
}

/**
 * Atividades (subclasses CNAE) que casam com o termo, sem acento: todas as
 * palavras no nome oficial ou num mesmo nome popular do IBGE ("academia" acha
 * "Atividades de condicionamento físico" por "academia de ginastica").
 * Dígitos procuram pelo código. Ordem: nome que começa com o termo, nome que
 * contém, depois só pelos nomes populares; empate pelo nome mais curto.
 */
export async function buscarAtividades(
  termo: string,
  limite = 30,
  opcoes: { soFortes?: boolean } = {},
): Promise<{ codigo: string; nome: string }[]> {
  const digitos = termo.replace(/[^\d]/g, '')
  if (digitos.length >= 4 && digitos.length === termo.replace(/[\s./-]/g, '').length) {
    return Object.entries(CNAES)
      .filter(([codigo]) => codigo.startsWith(digitos))
      .slice(0, limite)
      .map(([codigo, nome]) => ({ codigo, nome }))
  }
  // Plural simples sai ("academias" → "academia"): o IBGE escreve no singular
  // e "academia" continua casando com "academias".
  const palavras = semAcento(termo).split(/[^a-z0-9]+/).filter((p) => p.length >= 2)
    .map((p) => (p.length > 4 && p.endsWith('s') ? p.slice(0, -1) : p))
  if (!palavras.length) return []
  const inicio = palavras[0]
  const casa = (texto: string) => palavras.every((p) => texto.includes(p))
  // Entre as que casam só por nome popular, vale mais quem tem nomes que
  // COMEÇAM com o termo ("academia de ginastica") do que quem só o menciona
  // ("estadios ... academias de ginastica ... construcao de"), e mais nomes.
  const avaliar = (a: AtividadeIndexada) => {
    if (casa(a.chave)) return { p: a.chave.startsWith(inicio) ? 0 : 1, comeca: 0, total: 0 }
    const termos = a.termos.split('|').filter(casa)
    const comeca = termos.filter((t) => t.startsWith(inicio)).length
    return { p: termos.length ? 2 : -1, comeca, total: termos.length }
  }
  const avaliadas = (await carregarIndice()).map((a) => ({ a, ...avaliar(a) })).filter(({ p }) => p >= 0)
  // soFortes (nicho criado só com o nome): palavras inteiras, com plural. Se
  // algum nome oficial casa, só esses ("Hotéis" não puxa "Construção de
  // edifícios" por "hoteis ... construcao de"); senão, nomes populares que
  // começam pela primeira palavra ("academia de ginastica", "dentistas").
  // "escola" não casa "escolar".
  let fortes: Set<string> | null = null
  if (opcoes.soFortes) {
    const inteira = (texto: string, p: string) => new RegExp(`(^| )${p}(s|es)?( |$)`).test(texto)
    const todas = (texto: string) => palavras.every((p) => inteira(texto, p))
    // "Ensino de artes cênicas, exceto dança" não é dança: corta a exceção.
    const palavrasDe = (texto: string) => texto.replace(/(^|[^a-z])exceto([^a-z].*)?$/, '').replace(/[^a-z0-9]+/g, ' ').trim()
    const oficiais = avaliadas.filter(({ a }) => todas(palavrasDe(a.chave)))
    const populares = avaliadas.filter(({ a }) =>
      a.termos.split('|').some((t) => todas(t) && new RegExp(`^${inicio}(s|es)?( |$)`).test(t)))
    fortes = new Set((oficiais.length ? oficiais : populares).map(({ a }) => a.codigo))
  }
  return avaliadas
    .filter(({ a }) => !fortes || fortes.has(a.codigo))
    .sort((x, y) => x.p - y.p || y.comeca - x.comeca || y.total - x.total || x.a.nome.length - y.a.nome.length)
    .slice(0, limite)
    .map(({ a }) => ({ codigo: a.codigo, nome: a.nome }))
}
