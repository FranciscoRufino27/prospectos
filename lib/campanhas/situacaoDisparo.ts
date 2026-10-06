// Situação exibida de um disparo — client-safe, usada pela lista e pelo detalhe.
//
// Existe porque as duas telas escreviam a própria versão da mesma pergunta e
// divergiram: a lista chegou a marcar "Aguardando respostas" em campanha com
// cadência, e ambas continuavam marcando depois de a resposta já ter chegado.
//
// O selo espelha a recusa do servidor em concluir um disparo único: enquanto
// `respostas === 0`, o PATCH de /api/campanhas/[id] devolve 409 e o botão
// Concluir não funcionaria. Assim que a primeira resposta chega, a recusa some
// e o selo tem de sumir junto. O servidor continua sendo a autoridade — esta
// função só evita prometer na tela um botão que o backend recusaria.

export interface ResumoExecucoesSituacao {
  total: number
  emAndamento: number
  aguardando: number
  /** Pendentes que ainda não receberam o 1º e-mail (ausente em respostas antigas). */
  aguardandoPrimeiroEnvio?: number
  canceladas: number
  erros: number
  respostas: number
}

export function temFalhaOperacional(resumo: ResumoExecucoesSituacao | null | undefined): boolean {
  return (resumo?.canceladas ?? 0) > 0 || (resumo?.erros ?? 0) > 0
}

export function execucoesPendentes(resumo: ResumoExecucoesSituacao | null | undefined): number {
  return (resumo?.emAndamento ?? 0) + (resumo?.aguardando ?? 0)
}

/** "117 aguardando 1º envio · 89 aguardando follow-up" — nunca "pendentes" somados. */
export function textoPendentes(resumo: ResumoExecucoesSituacao | null | undefined): string | null {
  const pendentes = execucoesPendentes(resumo)
  if (!pendentes) return null
  const primeiro = resumo?.aguardandoPrimeiroEnvio
  if (primeiro === undefined) return `${pendentes.toLocaleString('pt-BR')} pendentes`
  const followup = Math.max(0, pendentes - primeiro)
  return [
    primeiro ? `${primeiro.toLocaleString('pt-BR')} aguardando 1º envio` : null,
    followup ? `${followup.toLocaleString('pt-BR')} aguardando follow-up` : null,
  ].filter(Boolean).join(' · ')
}

export function aguardandoRespostasDoDisparo(params: {
  disparoUnico: boolean
  status: string
  emEnsaio: boolean
  resumo: ResumoExecucoesSituacao | null | undefined
}): boolean {
  const { disparoUnico, status, emEnsaio, resumo } = params
  if (!disparoUnico || status !== 'ativa' || emEnsaio) return false
  if ((resumo?.total ?? 0) === 0) return false
  if (execucoesPendentes(resumo) > 0) return false
  if (temFalhaOperacional(resumo)) return false
  return (resumo?.respostas ?? 0) === 0
}
