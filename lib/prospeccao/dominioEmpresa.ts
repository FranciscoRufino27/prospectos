// Domínio provável da empresa, tirado do e-mail cadastral da Receita
// (reservas@hotelmar.com.br → hotelmar.com.br). O catálogo RF não tem site, e
// é o domínio que um enriquecedor de pessoas/e-mail precisaria
// (docs/mapa-do-projeto.md §15c). Heurística grátis: não visita o site.

import { classificarEmail } from './qualidadeEmail'
import { soLetras } from './emailNominal'

export interface DominioEmpresa {
  dominio: string
  /** Uma palavra distintiva do nome da empresa aparece no domínio. */
  confereComNome: boolean
}

// Domínio de quem cuida da empresa, não dela: escritório de advocacia,
// consultoria, auditoria. (Contador já cai em 'contabilidade'.)
const DOMINIO_DE_TERCEIRO = /advog|advocacia|consultoria|auditoria|auditores|mazars/

// Palavras comuns demais no nome para provar que o domínio é da empresa.
const PALAVRAS_GENERICAS = new Set([
  'hotel', 'hoteis', 'hotelaria', 'pousada', 'pousadas', 'turismo', 'residencial', 'flat', 'flats',
  'empreendimentos', 'empreendimento', 'servicos', 'comercio', 'participacoes', 'administracao',
  'grupo', 'ltda', 'eireli', 'hospedagem', 'hospedagens', 'motel', 'hostel', 'resort', 'brasil',
  'imobiliaria', 'imoveis', 'alimentacao', 'restaurante', 'eventos', 'viagens', 'internacional',
])

// Terminação com 2+ letras: a Receita tem e-mail truncado ("x@uperig.com.b").
const DOMINIO_VALIDO = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/

export function dominioDaEmpresa(email: string | null | undefined, nomes: (string | null | undefined)[]): DominioEmpresa | null {
  // Caixa genérica no domínio próprio (reservas@) prova o domínio tão bem
  // quanto um e-mail corporativo. Pessoal, contador e typo não são da empresa.
  const qualidade = classificarEmail(email)
  if (qualidade !== 'corporativo' && qualidade !== 'generico') return null
  const e = email!.trim().toLowerCase()
  const dominio = e.slice(e.lastIndexOf('@') + 1).replace(/^www\./, '')
  if (!DOMINIO_VALIDO.test(dominio) || DOMINIO_DE_TERCEIRO.test(dominio)) return null

  const rotulo = soLetras(dominio.split('.')[0])
  const palavras = nomes.flatMap((n) => (n ?? '').split(/\s+/)).map(soLetras)
  const confereComNome = palavras.some((p) => p.length >= 4 && !PALAVRAS_GENERICAS.has(p) && rotulo.includes(p))
  return { dominio, confereComNome }
}
