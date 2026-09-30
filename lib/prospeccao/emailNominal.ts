// E-mail nominal: o e-mail cadastral da Receita pertence a um sócio do quadro
// (joao.silva@hotel.com.br para João Silva). Heurística grátis, sem consulta
// externa. É o sinal que, no desenho do enriquecimento (docs/mapa-do-projeto.md
// §15c), dispensa buscar e-mail em fonte paga. Não verifica entrega.

import { classificarEmail } from './qualidadeEmail'
import type { Socio } from './socios'

const PARTICULAS = new Set(['da', 'de', 'do', 'das', 'dos', 'e'])

export function soLetras(s: string): string {
  // NFD separa o acento da letra; o filtro de [a-z] descarta o acento solto.
  return s.normalize('NFD').toLowerCase().replace(/[^a-z]/g, '')
}

/**
 * A parte local do e-mail é uma forma usual do nome: "joao", "joaosilva",
 * "silvajoao", "jsilva", "joaos", "jpsilva". Separadores e números são ignorados
 * ("joao.silva2" = "joaosilva"). Sobrenome sozinho não conta: ambíguo demais.
 */
export function localCasaComNome(local: string, nome: string): boolean {
  const l = soLetras(local)
  const partes = nome.split(/\s+/).map(soLetras).filter((p) => p && !PARTICULAS.has(p))
  if (l.length < 3 || partes.length === 0) return false
  const [primeiro, ...sobrenomes] = partes
  if (primeiro.length >= 3 && l === primeiro) return true
  return sobrenomes.some((s, i) => {
    if (s.length < 2) return false
    if (l === s + primeiro || l === primeiro + s[0]) return true
    // Iniciais de nomes do meio entre o primeiro e o sobrenome: "soniaamcarvalho"
    // (Sonia Aparecida Martins Carvalho), "jpsilva" (João Pedro Silva).
    return iniciaisDoMeio(sobrenomes.slice(0, i)).some((meio) => l === primeiro + meio + s || l === primeiro[0] + meio + s)
  })
}

/** Todas as combinações, em ordem, das iniciais dos nomes do meio (inclui ''). */
function iniciaisDoMeio(meio: string[]): string[] {
  return meio.reduce<string[]>((acc, nome) => [...acc, ...acc.map((a) => a + nome[0])], [''])
}

/**
 * Sócio dono do e-mail, ou null. Só vale para e-mail corporativo ou de provedor
 * pessoal (joaosilva@gmail.com também chega à pessoa). Caixa genérica,
 * contador e typo nunca são nominais. Se casar com mais de um sócio, é ambíguo.
 */
export function donoDoEmail(email: string | null | undefined, socios: Socio[]): Socio | null {
  const qualidade = classificarEmail(email)
  if (qualidade !== 'corporativo' && qualidade !== 'pessoal') return null
  const local = email!.trim().slice(0, email!.trim().lastIndexOf('@'))
  const donos = socios.filter((s) => localCasaComNome(local, s.nome))
  return donos.length === 1 ? donos[0] : null
}
