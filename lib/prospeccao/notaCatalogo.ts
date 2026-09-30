// Nota de qualidade de uma empresa do catálogo RF, gravada na carga (migration
// 0054) para a busca trazer primeiro as de dado melhor: pedindo 10, vêm as 10
// melhores. Só usa o que está no próprio catálogo; sócio e e-mail nominal
// dependem da OpenCNPJ e seguem confirmados no "analisar".
//
// nota = faixa * 10 + (tem telefone ? 1 : 0). Faixas, da melhor para a pior:
//   5 corporativo com domínio que confere com o nome
//   4 corporativo
//   3 caixa genérica no domínio da empresa
//   2 provedor pessoal
//   1 contador, typo ou sem e-mail

import { classificarEmail, type QualidadeEmail } from './qualidadeEmail'
import { dominioDaEmpresa } from './dominioEmpresa'

/** E-mail que conta como válido no filtro "E-mail válido obrigatório". */
export const QUALIDADES_VALIDAS: readonly QualidadeEmail[] = ['corporativo', 'generico', 'pessoal']

export interface DadosNota {
  email: string | null
  telefone: string | null
  razao_social: string | null
  nome_fantasia: string | null
}

export function notaDoCatalogo(r: DadosNota): { qualidade_email: QualidadeEmail; nota: number } {
  const qualidade = classificarEmail(r.email)
  const faixa =
    qualidade === 'corporativo' ? (dominioDaEmpresa(r.email, [r.nome_fantasia, r.razao_social])?.confereComNome ? 5 : 4)
    : qualidade === 'generico' ? 3
    : qualidade === 'pessoal' ? 2
    : 1
  return { qualidade_email: qualidade, nota: faixa * 10 + (r.telefone?.trim() ? 1 : 0) }
}
