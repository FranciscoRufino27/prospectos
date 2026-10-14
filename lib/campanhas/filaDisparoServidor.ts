import 'server-only'
import { send } from '@vercel/queue'
import type { WorkflowStore } from '@/lib/workflows'
import { encaixarNaJanela, type JanelaCampanha } from './agenda'

export const TOPICO_FILA_CAMPANHA = 'campanhas-email-v1'
export const INTERVALO_ENVIO_CAMPANHA_SEGUNDOS = 120
export const RETENCAO_FILA_CAMPANHA_SEGUNDOS = 7 * 24 * 60 * 60

export interface MensagemFilaCampanha {
  organizacaoId: string
  campanhaId: string
  execucaoId: string
}

export interface ItemAgendaCampanha extends MensagemFilaCampanha {
  agendadoPara: string
  delaySeconds: number
  idempotencyKey: string
}

type Enfileirar = (
  topico: string,
  mensagem: MensagemFilaCampanha,
  opcoes: {
    delaySeconds: number
    retentionSeconds: number
    idempotencyKey: string
  },
) => Promise<unknown>

function valorNaoVazio(valor: unknown): valor is string {
  return typeof valor === 'string' && valor.trim().length > 0
}

export class MensagemFilaCampanhaInvalida extends Error {}

export function validarMensagemFilaCampanha(valor: unknown): MensagemFilaCampanha {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
    throw new MensagemFilaCampanhaInvalida('Mensagem da fila de campanha inválida.')
  }
  const mensagem = valor as Record<string, unknown>
  if (
    !valorNaoVazio(mensagem.organizacaoId)
    || !valorNaoVazio(mensagem.campanhaId)
    || !valorNaoVazio(mensagem.execucaoId)
  ) {
    throw new MensagemFilaCampanhaInvalida('Mensagem da fila de campanha incompleta.')
  }
  return {
    organizacaoId: mensagem.organizacaoId,
    campanhaId: mensagem.campanhaId,
    execucaoId: mensagem.execucaoId,
  }
}

export function montarAgendaDisparoCampanha(
  organizacaoId: string,
  campanhaId: string,
  execucaoIds: string[],
  agora: Date = new Date(),
  janela?: JanelaCampanha | null,
  sufixoChave?: string,
): ItemAgendaCampanha[] {
  const ids = [...new Set(execucaoIds.filter(valorNaoVazio))]
  // Um envio a cada INTERVALO, sempre dentro da janela da campanha (dias +
  // horário de Brasília): o que não cabe hoje continua na próxima abertura.
  let cursor = agora.getTime()
  return ids.map((execucaoId) => {
    const slot = encaixarNaJanela(new Date(cursor), janela).getTime()
    cursor = slot + INTERVALO_ENVIO_CAMPANHA_SEGUNDOS * 1_000
    return {
      organizacaoId,
      campanhaId,
      execucaoId,
      agendadoPara: new Date(slot).toISOString(),
      delaySeconds: Math.max(0, Math.round((slot - agora.getTime()) / 1_000)),
      idempotencyKey: `campanha:${campanhaId}:execucao:${execucaoId}${sufixoChave ? `:${sufixoChave}` : ''}`,
    }
  })
}

export async function agendarExecucoesCampanha(
  store: WorkflowStore,
  organizacaoId: string,
  campanhaId: string,
  execucaoIds: string[],
  opcoes: {
    agora?: Date
    enfileirar?: Enfileirar
    /** Janela da campanha (publico.agenda). Sem ela, agenda sem restrição de horário. */
    janela?: JanelaCampanha | null
    /** Reagendamento (ex.: ao retomar): chave nova para a fila não deduplicar. */
    sufixoChave?: string
  } = {},
): Promise<{
  agendadas: number
  ignoradas: number
  primeiraExecucaoEm: string | null
  ultimaExecucaoEm: string | null
}> {
  if (store.organizacaoId && store.organizacaoId !== organizacaoId) {
    throw new Error('A fila não pode misturar execuções de organizações diferentes.')
  }
  const agora = opcoes.agora ?? new Date()
  const enfileirar = opcoes.enfileirar ?? send
  const agenda = montarAgendaDisparoCampanha(organizacaoId, campanhaId, execucaoIds, agora, opcoes.janela, opcoes.sufixoChave)
  let agendadas = 0
  let ignoradas = 0
  let primeiraExecucaoEm: string | null = null
  let ultimaExecucaoEm: string | null = null

  for (const item of agenda) {
    const execucao = await store.buscarExecucao(item.execucaoId)
    if (
      !execucao
      || execucao.campanha_id !== campanhaId
      || execucao.status === 'concluido'
      || execucao.status === 'cancelado'
    ) {
      ignoradas += 1
      continue
    }

    await store.atualizarExecucao(item.execucaoId, {
      status: 'aguardando',
      proxima_verificacao_em: item.agendadoPara,
      atualizado_em: agora.toISOString(),
    })

    const atrasoAtual = Math.max(
      0,
      Math.ceil((new Date(item.agendadoPara).getTime() - Date.now()) / 1_000),
    )
    await enfileirar(TOPICO_FILA_CAMPANHA, {
      organizacaoId: item.organizacaoId,
      campanhaId: item.campanhaId,
      execucaoId: item.execucaoId,
    }, {
      delaySeconds: atrasoAtual,
      retentionSeconds: RETENCAO_FILA_CAMPANHA_SEGUNDOS,
      idempotencyKey: item.idempotencyKey,
    })
    await store.registrarEvento({
      execucao_id: item.execucaoId,
      tipo: 'disparo_enfileirado',
      detalhe: {
        campanha_id: campanhaId,
        agendado_para: item.agendadoPara,
        intervalo_segundos: INTERVALO_ENVIO_CAMPANHA_SEGUNDOS,
      },
    })
    primeiraExecucaoEm ??= item.agendadoPara
    ultimaExecucaoEm = item.agendadoPara
    agendadas += 1
  }

  return { agendadas, ignoradas, primeiraExecucaoEm, ultimaExecucaoEm }
}

/**
 * Ao RETOMAR uma campanha pausada: quem ainda não recebeu o 1º e-mail
 * (aguardando, passo 0, nunca agendado como espera) volta para a fila, na ordem
 * original e dentro da janela. Sem isso, o que venceu durante a pausa ficava
 * parado para sempre (o callback pausado não reenfileira). Chave nova na fila;
 * mensagens antigas ainda em voo não enviam antes do novo horário (o executor
 * só age com o vencimento gravado e a prospecção exige claim atômico).
 */
export async function reagendarPrimeirosEnviosAoRetomar(
  store: WorkflowStore,
  admin: import('@supabase/supabase-js').SupabaseClient,
  organizacaoId: string,
  campanhaId: string,
  janela: JanelaCampanha | null,
  opcoes: { agora?: Date; enfileirar?: Enfileirar } = {},
) {
  const { data, error } = await admin
    .from('workflow_execucoes')
    .select('id, agendamento_geracao')
    .eq('organizacao_id', organizacaoId)
    .eq('campanha_id', campanhaId)
    .eq('status', 'aguardando')
    .eq('passo_atual', 0)
    .order('proxima_verificacao_em', { ascending: true })
    .order('id', { ascending: true })
  if (error) throw error
  const ids = (data ?? [])
    .filter((ex) => !((ex as { agendamento_geracao?: number | null }).agendamento_geracao ?? 0))
    .map((ex) => (ex as { id: string }).id)
  if (!ids.length) return { agendadas: 0, ignoradas: 0, primeiraExecucaoEm: null, ultimaExecucaoEm: null }
  const agora = opcoes.agora ?? new Date()
  return agendarExecucoesCampanha(store, organizacaoId, campanhaId, ids, {
    ...opcoes,
    agora,
    janela,
    sufixoChave: `retomada:${agora.getTime()}`,
  })
}
