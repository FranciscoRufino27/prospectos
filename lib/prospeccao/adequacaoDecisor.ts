// Diz se o quadro societário (OpenCNPJ) já resolve o decisor da empresa ou se
// ela precisa de outro contato, segundo o perfil de busca da organização:
// cargos-alvo + corte por porte. Puro — roda no servidor, a tela só exibe.
// Hoje orienta a revisão humana; é o mesmo ponto em que um enriquecedor pago
// (docs/mapa-do-projeto.md §15c) seria chamado só quando o sócio não serve.

import type { CargoAlvoProspeccao, PorteCorteDecisor, ProspeccaoConfig } from '@/lib/config/workspaceConfig'
import { sugerirDecisor, type Socio } from './socios'

// Qualificações da Receita que contam como cada cargo-alvo. Procurador,
// liquidante, inventariante etc. não casam com nenhum: não são compradores.
const QUALIFICACOES_DO_CARGO: Record<CargoAlvoProspeccao, RegExp> = {
  proprietario: /titular|empres[áa]rio|propriet[áa]rio/i,
  socio: /s[óo]cio/i,
  founder: /fundador/i,
  diretor: /diretor|presidente|administrador|conselheiro/i,
  gerente: /gerente/i,
}

// MEI é microempresa; porte ausente/não informado nunca aciona o corte.
const ORDEM_PORTE: Record<string, number> = { micro: 1, pequeno: 2, demais: 3 }

export type StatusDecisor = 'socio_serve' | 'precisa_outro_decisor' | 'sem_criterio'
export type MotivoOutroDecisor = 'porte' | 'cargo' | 'sem_socio'

export interface SocioAvaliado extends Socio {
  /** null quando o perfil não tem cargos-alvo. */
  adequado: boolean | null
}

export interface AvaliacaoDecisor {
  status: StatusDecisor
  motivo: MotivoOutroDecisor | null
  socios: SocioAvaliado[]
  sugerido: Socio | null
}

export function socioTemCargoAlvo(socio: Socio, cargos: readonly CargoAlvoProspeccao[]): boolean {
  return cargos.some((c) => QUALIFICACOES_DO_CARGO[c].test(socio.qualificacao))
}

export function porteAtingeCorte(porte: string | null | undefined, corte: PorteCorteDecisor | undefined): boolean {
  if (!corte || !porte) return false
  const nivel = ORDEM_PORTE[porte]
  return nivel !== undefined && nivel >= ORDEM_PORTE[corte]
}

export function avaliarDecisor(
  socios: Socio[],
  empresa: { porte: string | null; mei: boolean | null },
  perfil: Pick<ProspeccaoConfig, 'cargosAlvo' | 'porteOutroDecisor'> | undefined,
  donoEmail: Socio | null = null,
): AvaliacaoDecisor {
  const cargos = perfil?.cargosAlvo ?? []
  const corte = perfil?.porteOutroDecisor
  const avaliados: SocioAvaliado[] = socios.map((s) => ({ ...s, adequado: cargos.length ? socioTemCargoAlvo(s, cargos) : null }))
  const adequados = cargos.length ? socios.filter((s) => socioTemCargoAlvo(s, cargos)) : socios
  // Dono do e-mail nominal vem primeiro se for adequado: é quem de fato lê a
  // mensagem. O sugerido continua preenchendo o contato mesmo quando o sócio
  // não serve: é melhor que nenhum, e a tela avisa que falta outro decisor.
  const sugerido =
    (donoEmail && adequados.some((s) => s.nome === donoEmail.nome) ? donoEmail : null) ??
    sugerirDecisor(adequados) ?? sugerirDecisor(socios)

  if (!cargos.length && !corte) return { status: 'sem_criterio', motivo: null, socios: avaliados, sugerido }

  const porte = empresa.mei ? 'micro' : empresa.porte
  const motivo: MotivoOutroDecisor | null =
    porteAtingeCorte(porte, corte) ? 'porte'
    : socios.length === 0 ? 'sem_socio'
    : adequados.length === 0 ? 'cargo'
    : null

  return { status: motivo ? 'precisa_outro_decisor' : 'socio_serve', motivo, socios: avaliados, sugerido }
}
