// Situação comercial de uma empresa do HubSpot — cálculo determinístico, sem
// IA. Calculada na sincronização do índice (lib/integracoes/hubspot/indice.ts),
// de onde saem os filtros e contadores da Central; a linha usa a mesma.
//
// Regra (primeira que casar, nesta ordem). JANELA = 90 dias.
//   1. cliente             — tem negócio ganho. Usa recent_deal_close_date,
//                            que o HubSpot só preenche com deal closed won
//                            (conferido em 29/09: 216 empresas com deal
//                            hs_is_closed_won=true = 216 com a propriedade).
//   2. em_andamento        — não é cliente e teve atividade na janela
//                            (notes_last_updated ≥ hoje − 90d). Negócio aberto
//                            sendo trabalhado ou contato recente: é do comercial.
//   3. precisa_enriquecer  — sem atividade recente e (sem contato associado OU
//                            nenhum contato com e-mail preenchido).
//   4. reativar            — sem atividade recente, com contato com e-mail e
//                            com histórico: algum negócio (aberto parado ou
//                            perdido) ou alguma atividade antes da janela.
//   5. prospectar          — sem atividade recente, com contato com e-mail e
//                            sem nenhum negócio nem atividade registrada.
//
// "E-mail utilizável" = e-mail preenchido no HubSpot (validação de entrega é
// do enriquecimento). Propriedades conferidas em 29/09: num_associated_contacts
// é sempre preenchida (0 quando não há contato); num_associated_deals fica
// AUSENTE quando não há negócio; notes_last_contacted nunca existe sem
// notes_last_updated.

export const SITUACOES = ['cliente', 'em_andamento', 'precisa_enriquecer', 'reativar', 'prospectar'] as const
export type Situacao = (typeof SITUACOES)[number]

export const JANELA_ATIVIDADE_DIAS = 90
const DIA_MS = 86_400_000

export const ROTULO_SITUACAO: Record<Situacao, string> = {
  cliente: 'Cliente',
  em_andamento: 'Em andamento',
  precisa_enriquecer: 'Precisa enriquecer',
  reativar: 'Reativar',
  prospectar: 'Prospectar',
}

export const ACAO_SUGERIDA: Record<Situacao, string> = {
  cliente: 'Não prospectar a frio — cadência de cliente (futura)',
  em_andamento: 'Deixar com o comercial responsável',
  precisa_enriquecer: 'Enriquecer contato antes de abordar',
  reativar: 'Cadência de reativação',
  prospectar: 'Prospecção fria',
}

export interface DadosSituacao {
  ganhou: boolean // recent_deal_close_date preenchido
  ultimaAtividade: number | null // notes_last_updated (ms)
  contatos: number // num_associated_contacts
  temNegocio: boolean // num_associated_deals preenchido e > 0
  semEmailUtilizavel: boolean // tem contato, mas nenhum com e-mail
}

export function limiteJanela(agora: number): number {
  return agora - JANELA_ATIVIDADE_DIAS * DIA_MS
}

export function classificarSituacao(d: DadosSituacao, agora: number): Situacao {
  if (d.ganhou) return 'cliente'
  if (d.ultimaAtividade !== null && d.ultimaAtividade >= limiteJanela(agora)) return 'em_andamento'
  if (d.contatos === 0 || d.semEmailUtilizavel) return 'precisa_enriquecer'
  if (d.temNegocio || d.ultimaAtividade !== null) return 'reativar'
  return 'prospectar'
}
