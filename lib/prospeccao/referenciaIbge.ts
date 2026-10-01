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
