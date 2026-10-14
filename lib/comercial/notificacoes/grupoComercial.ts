// Serviço do aviso ao grupo comercial. Regras aqui; dados no repository;
// transporte injetado (EnviadorGrupo = Z-API em produção, fake nos testes).
//
// Invariantes:
//   - nunca toca o handoff nem o cursor: falha aqui é falha do AVISO, o lead
//     continua atribuído;
//   - uma intenção por (handoff, tipo) → no máximo UMA mensagem por handoff;
//   - só quem vence o compare-and-swap pendente→enviando chama o provedor;
//   - teto de tentativas (sem retry infinito); grupo não configurado não
//     consome tentativa;
//   - 'enviando' preso (morreu entre enviar e marcar) nunca é reenviado aqui.
import { montarMensagemNotificacao } from './mensagens'
import type { NotificacaoHandoffRepository } from './repository'
import type { DadosAlertaHandoff, EnviadorGrupo, NotificacaoHandoff, TipoNotificacaoHandoff } from './types'

export const MAX_TENTATIVAS_NOTIFICACAO = 5

export interface DepsNotificacaoGrupo {
  repo: NotificacaoHandoffRepository
  enviar: EnviadorGrupo
  // Config da organização: id do grupo (null = não configurado).
  lerGrupoId: (organizacaoId: string) => Promise<string | null>
}

export type ResultadoNotificacaoGrupo =
  | { tipo: 'enviada'; notificacao: NotificacaoHandoff }
  | { tipo: 'ja_enviada'; notificacao: NotificacaoHandoff }
  | { tipo: 'falhou'; notificacao: NotificacaoHandoff; erro: string; retentavel: boolean }
  | { tipo: 'configuracao_ausente'; notificacao: NotificacaoHandoff }
  | { tipo: 'esgotada'; notificacao: NotificacaoHandoff }
  // 'enviando' sem desfecho: pode estar em andamento em outro processo, ou ter
  // morrido depois do envio. Não reenvia — decisão humana.
  | { tipo: 'incerta'; notificacao: NotificacaoHandoff }
  | { tipo: 'concorrente' }
  | { tipo: 'nao_encontrada' }

// Registra (idempotente) a intenção de uma notificação de um handoff — uma
// por (handoff, tipo): aviso inicial (grupo_comercial) ou check-in (handoff_checkin).
export async function registrarNotificacaoGrupo(
  deps: DepsNotificacaoGrupo,
  organizacaoId: string,
  handoffId: string,
  tipo: TipoNotificacaoHandoff,
  dados: DadosAlertaHandoff,
): Promise<NotificacaoHandoff> {
  return deps.repo.registrarIntencao(organizacaoId, handoffId, tipo, dados)
}

// Aviso inicial do handoff (Fase 2).
export async function registrarAlertaGrupo(
  deps: DepsNotificacaoGrupo,
  organizacaoId: string,
  handoffId: string,
  dados: DadosAlertaHandoff,
): Promise<NotificacaoHandoff> {
  return registrarNotificacaoGrupo(deps, organizacaoId, handoffId, 'grupo_comercial', dados)
}

// Tenta entregar UMA notificação. Seguro para chamar várias vezes.
export async function processarNotificacaoGrupo(
  deps: DepsNotificacaoGrupo,
  organizacaoId: string,
  id: string,
): Promise<ResultadoNotificacaoGrupo> {
  const n = await deps.repo.buscar(organizacaoId, id)
  if (!n) return { tipo: 'nao_encontrada' }
  if (n.status === 'enviada') return { tipo: 'ja_enviada', notificacao: n }
  if (n.status === 'enviando') return { tipo: 'incerta', notificacao: n }
  if (n.tentativas >= MAX_TENTATIVAS_NOTIFICACAO) return { tipo: 'esgotada', notificacao: n }

  const grupoId = await deps.lerGrupoId(organizacaoId)
  if (!grupoId) {
    await deps.repo.marcarConfiguracaoAusente(organizacaoId, id, 'Grupo de avisos comercial não configurado (Configurações > Distribuição).')
    return { tipo: 'configuracao_ausente', notificacao: { ...n, status: 'configuracao_ausente' } }
  }

  const venceu = await deps.repo.reivindicarEnvio(organizacaoId, id, n.tentativas)
  if (!venceu) return { tipo: 'concorrente' }

  const mensagem = montarMensagemNotificacao(n.tipo, n.dados, n.codigoRef)
  let resultado: Awaited<ReturnType<EnviadorGrupo>>
  try {
    resultado = await deps.enviar(grupoId, mensagem)
  } catch (e) {
    resultado = { ok: false, codigo: 'excecao', mensagem: e instanceof Error ? e.message : String(e) }
  }

  if (resultado.ok) {
    await deps.repo.marcarEnviada(organizacaoId, id, { destino: grupoId, providerMessageId: resultado.providerMessageId })
    const atual = await deps.repo.buscar(organizacaoId, id)
    return { tipo: 'enviada', notificacao: atual ?? { ...n, status: 'enviada', tentativas: n.tentativas + 1 } }
  }

  const erro = `${resultado.codigo}: ${resultado.mensagem}`
  await deps.repo.marcarFalha(organizacaoId, id, erro)
  const tentativas = n.tentativas + 1
  return {
    tipo: 'falhou',
    notificacao: { ...n, status: 'falhou', tentativas, ultimoErro: erro },
    erro,
    retentavel: tentativas < MAX_TENTATIVAS_NOTIFICACAO,
  }
}

// Recuperação: reprocessa o que ficou pendente/falhou/sem configuração na org.
export async function reprocessarNotificacoesGrupo(
  deps: DepsNotificacaoGrupo,
  organizacaoId: string,
  limite = 20,
): Promise<{ processadas: number; enviadas: number; falhas: number; semConfiguracao: number }> {
  const pendentes = await deps.repo.listarReprocessaveis(organizacaoId, MAX_TENTATIVAS_NOTIFICACAO, limite)
  const contagem = { processadas: 0, enviadas: 0, falhas: 0, semConfiguracao: 0 }
  for (const n of pendentes) {
    contagem.processadas++
    const r = await processarNotificacaoGrupo(deps, organizacaoId, n.id)
    if (r.tipo === 'enviada') contagem.enviadas++
    else if (r.tipo === 'falhou') contagem.falhas++
    else if (r.tipo === 'configuracao_ausente') { contagem.semConfiguracao++; break } // sem grupo, não adianta seguir
  }
  return contagem
}
