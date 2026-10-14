// Distribuição dos contatos pelas etapas da cadência REAL da campanha
// (client-safe; o servidor monta os dados em distribuicaoCadenciaServidor.ts).
//
// Cada contato inscrito é uma execução do workflow. `passo_atual` aponta a
// próxima ação; o número de ações `enviar_email` antes dele é quantas
// mensagens o contato já recebeu na sequência. As etapas saem da definição
// publicada (1º contato + N follow-ups) — nunca de um número fixo.
//
//   ativa e 0 mensagens antes        → Aguardando 1º contato
//   ativa e N (1..total−1) mensagens → Follow-up N (recebeu N, aguarda o FUP N)
//   ativa e todas as mensagens       → Cadência enviada (aguarda encerramento)
//   cancelada + lead bounced         → Devolvidos
//   cancelada + lead respondeu       → Responderam
//   cancelada (outros)               → Saíram (descadastro/cancelamento)
//   concluída                        → Concluíram
//   erro                             → Com erro

export interface AcaoCadencia {
  tipo: string
}

export interface ExecucaoCadencia {
  id: string
  lead_id: string | null
  status: string
  passo_atual: number | null
  versao_id: string | null
  proxima_verificacao_em?: string | null
}

export type GrupoEtapa = 'sequencia' | 'final'

export interface EtapaCadencia {
  id: string
  rotulo: string
  descricao: string
  grupo: GrupoEtapa
  quantidade: number
  /** Parte da base da campanha (0–1); null com base vazia. */
  percentual: number | null
}

export interface DistribuicaoCadencia {
  total: number
  /** Follow-ups da cadência (mensagens − 1), lidos da definição publicada. */
  totalFollowups: number
  etapas: EtapaCadencia[]
}

const ATIVOS = new Set(['aguardando', 'em_andamento'])

export function totalMensagens(acoes: AcaoCadencia[]): number {
  return acoes.filter((a) => a.tipo === 'enviar_email').length
}

export function mensagensAntesDoPasso(acoes: AcaoCadencia[], passo: number): number {
  return acoes.slice(0, Math.max(0, passo)).filter((a) => a.tipo === 'enviar_email').length
}

export interface SinaisContato {
  devolvido: boolean
  respondeu: boolean
}

/** Etapa de UMA execução. `acoes` null = versão sem definição legível. */
export function etapaDaExecucao(ex: ExecucaoCadencia, acoes: AcaoCadencia[] | null, sinais: SinaisContato): string {
  if (ex.status === 'cancelado') return sinais.devolvido ? 'devolvido' : sinais.respondeu ? 'respondeu' : 'saiu'
  if (ex.status === 'concluido') return 'concluido'
  if (ex.status === 'erro') return 'erro'
  if (!ATIVOS.has(ex.status)) return 'indefinida'
  if (!acoes) return 'indefinida'
  const n = mensagensAntesDoPasso(acoes, ex.passo_atual ?? 0)
  if (n === 0) return 'primeiro_contato'
  if (n >= totalMensagens(acoes)) return 'cadencia_enviada'
  return `followup_${n}`
}

/** Rótulo curto do próximo envio de uma etapa da sequência (para a lista de contatos). */
export function proximoEnvioDaEtapa(etapaId: string): string | null {
  if (etapaId === 'primeiro_contato') return '1º contato'
  const m = /^followup_(\d+)$/.exec(etapaId)
  return m ? `Follow-up ${m[1]}` : null
}

const FINAIS: { id: string; rotulo: string; descricao: string; sempre: boolean }[] = [
  { id: 'respondeu', rotulo: 'Responderam', descricao: 'saíram da cadência por resposta', sempre: true },
  { id: 'devolvido', rotulo: 'Devolvidos', descricao: 'e-mail devolvido (bounce)', sempre: true },
  { id: 'concluido', rotulo: 'Concluíram', descricao: 'terminaram a cadência sem resposta', sempre: false },
  { id: 'saiu', rotulo: 'Saíram', descricao: 'descadastro ou cancelamento manual', sempre: false },
  { id: 'erro', rotulo: 'Com erro', descricao: 'a execução parou com erro', sempre: false },
  { id: 'indefinida', rotulo: 'Sem etapa', descricao: 'versão da cadência ilegível', sempre: false },
]

export function montarDistribuicaoCadencia(params: {
  execucoes: ExecucaoCadencia[]
  /** Definição (ações) por versão do workflow. */
  acoesPorVersao: Map<string, AcaoCadencia[]>
  /** Versão publicada atual — define as etapas mesmo sem ninguém nelas. */
  acoesReferencia: AcaoCadencia[] | null
  leadsDevolvidos: Set<string>
  leadsQueResponderam: Set<string>
}): DistribuicaoCadencia & { etapaPorExecucao: Map<string, string> } {
  const { execucoes, acoesPorVersao, acoesReferencia, leadsDevolvidos, leadsQueResponderam } = params
  const contagem = new Map<string, number>()
  const etapaPorExecucao = new Map<string, string>()
  let maxMensagens = acoesReferencia ? totalMensagens(acoesReferencia) : 0
  for (const ex of execucoes) {
    const acoes = ex.versao_id ? acoesPorVersao.get(ex.versao_id) ?? null : null
    if (acoes) maxMensagens = Math.max(maxMensagens, totalMensagens(acoes))
    const etapa = etapaDaExecucao(ex, acoes, {
      devolvido: !!ex.lead_id && leadsDevolvidos.has(ex.lead_id),
      respondeu: !!ex.lead_id && leadsQueResponderam.has(ex.lead_id),
    })
    etapaPorExecucao.set(ex.id, etapa)
    contagem.set(etapa, (contagem.get(etapa) ?? 0) + 1)
  }

  const total = execucoes.length
  const totalFollowups = Math.max(0, maxMensagens - 1)
  const pct = (q: number) => (total > 0 ? q / total : null)
  const etapa = (id: string, rotulo: string, descricao: string, grupo: GrupoEtapa): EtapaCadencia => {
    const quantidade = contagem.get(id) ?? 0
    return { id, rotulo, descricao, grupo, quantidade, percentual: pct(quantidade) }
  }

  const etapas: EtapaCadencia[] = [
    etapa('primeiro_contato', 'Aguardando 1º contato', 'ainda não recebeu nenhuma mensagem', 'sequencia'),
  ]
  for (let n = 1; n <= totalFollowups; n++) {
    etapas.push(etapa(`followup_${n}`, `Follow-up ${n}`,
      `recebeu ${n} ${n === 1 ? 'mensagem' : 'mensagens'} · aguarda o follow-up ${n}`, 'sequencia'))
  }
  if ((contagem.get('cadencia_enviada') ?? 0) > 0) {
    etapas.push(etapa('cadencia_enviada', 'Cadência enviada', 'recebeu todas as mensagens · aguarda encerramento', 'sequencia'))
  }
  for (const f of FINAIS) {
    if (f.sempre || (contagem.get(f.id) ?? 0) > 0) etapas.push(etapa(f.id, f.rotulo, f.descricao, 'final'))
  }
  return { total, totalFollowups, etapas, etapaPorExecucao }
}

/** Ativos que já receberam ao menos uma mensagem (todas as etapas de follow-up + cadência enviada). */
export function emFollowupDaDistribuicao(d: DistribuicaoCadencia): number {
  return d.etapas
    .filter((e) => e.grupo === 'sequencia' && e.id !== 'primeiro_contato')
    .reduce((soma, e) => soma + e.quantidade, 0)
}
