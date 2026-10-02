// Nichos da prospecção na busca internacional: cada nicho (o mesmo do Brasil,
// definido por CNAE em nichos.ts) vira setores do LinkedIn que a Crustdata
// filtra em `basic_info.industries`. Valores tirados da lista oficial de
// setores da Crustdata (433 rótulos, "static-linkedin-industries.json").
//
// "Hospitality" é o setor que a maioria dos hotéis usa no LinkedIn, mas também
// traz fornecedores de hotelaria (software, consultoria); "Hotels and Motels"
// sozinho é preciso porém raro (131 empresas em Portugal contra 4.027).
// Preferimos cobertura: quem revisa a lista descarta o fornecedor.
// Puro — usado no cliente, na rota e nos testes.

import { gruposDoPerfil, ID_OUTRAS } from './nichos'

export const SETORES_DO_NICHO: Readonly<Record<string, readonly string[]>> = {
  hotelaria: ['Hotels and Motels', 'Hospitality'],
  saude: ['Hospitals and Health Care', 'Hospitals', 'Nursing Homes and Residential Care Facilities', 'Services for the Elderly and Disabled'],
  lavanderias: ['Laundry and Drycleaning Services', 'Personal and Laundry Services'],
  alimentacao: ['Food and Beverage Services'],
  buffets: ['Food and Beverage Services', 'Events Services'],
  restaurantes: ['Restaurants', 'Bars, Taverns, and Nightclubs'],
  eventos: ['Events Services'],
}

/** Todo setor que a busca aceita: o servidor recusa qualquer outro. */
export const SETORES_VALIDOS: ReadonlySet<string> = new Set(Object.values(SETORES_DO_NICHO).flat())

export interface NichoInternacional {
  id: string
  nome: string
  setores: string[]
}

/**
 * Nichos do perfil (pelos CNAEs) que têm setor equivalente lá fora, na mesma
 * ordem da aba Brasil. "Outras atividades" (CNAE solto) não tem tradução.
 */
export function nichosInternacionaisDoPerfil(cnaes: readonly string[]): NichoInternacional[] {
  return gruposDoPerfil(cnaes)
    .filter((g) => g.id !== ID_OUTRAS && SETORES_DO_NICHO[g.id])
    .map((g) => ({ id: g.id, nome: g.nome, setores: [...SETORES_DO_NICHO[g.id]] }))
}

/** Setores (sem repetição) de uma lista de nichos. */
export function setoresDosNichos(nichos: readonly NichoInternacional[]): string[] {
  return [...new Set(nichos.flatMap((n) => n.setores))]
}
