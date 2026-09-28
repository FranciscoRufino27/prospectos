// Watchdog do disparo inicial de campanha (Fase de correção — fila silenciosa).
//
// O disparo inicial de uma campanha (agendarExecucoesCampanha, em
// filaDisparoServidor.ts) manda a execução para a fila @vercel/queue e marca a
// execução 'aguardando'. Se a fila aceitar a mensagem mas nunca entregar o
// callback (falha de infraestrutura, não do nosso código — já observado em
// produção: mensagem aceita, zero tentativa registrada no lado do handler), a
// execução fica 'aguardando' para sempre e SÓ seria pega pelo poll diário
// (/api/workflows/processar, uma vez por dia, sujeito a dias úteis da agenda).
//
// Este watchdog varre, com frequência curta, as execuções cuja 1ª ação nunca
// avançou (passo_atual=0) muito além do vencimento e as REENFILEIRA (nunca
// reprocessa direto): reenfileirar com a MESMA idempotencyKey do disparo
// original é a forma seguro-por-desenho de evitar envio duplicado caso a
// entrega original apenas estivesse atrasada (a própria fila deduplica pela
// chave) — não inventamos lock novo. Prospecção fica de fora: já tem
// reconciliação própria e durável (lib/workflows/retomadaProspeccao.ts).
import 'server-only'
import { send } from '@vercel/queue'
import type { WorkflowStore } from '@/lib/workflows/store/store'
import type { AmbienteWorkflow } from '@/lib/workflows/ambiente'
import { log } from '@/lib/engine/logger'
import { RETENCAO_FILA_CAMPANHA_SEGUNDOS, TOPICO_FILA_CAMPANHA } from './filaDisparoServidor'

// Abaixo do backoff total da fila (5 tentativas, até 300s cada ≈ 12,5min): só
// consideramos travada uma execução cuja entrega original já teve tempo de
// esgotar as próprias tentativas, para não reenfileirar em cima de uma
// entrega ainda em voo.
export const LIMIAR_TRAVAMENTO_SEGUNDOS = 15 * 60

type Enfileirar = typeof send

export interface ResultadoWatchdogFilaCampanha {
  examinadas: number
  reenfileiradas: number
  ignoradasProspeccao: number
  falhas: number
}

export async function reconciliarDisparosCampanhaTravados(
  store: WorkflowStore,
  ambiente: AmbienteWorkflow,
  opcoes: { agora?: Date; enfileirar?: Enfileirar } = {},
): Promise<ResultadoWatchdogFilaCampanha> {
  const resultado: ResultadoWatchdogFilaCampanha = {
    examinadas: 0, reenfileiradas: 0, ignoradasProspeccao: 0, falhas: 0,
  }
  if (!store.execucoesCampanhaTravadas) return resultado

  const agora = opcoes.agora ?? new Date()
  const limiteEm = new Date(agora.getTime() - LIMIAR_TRAVAMENTO_SEGUNDOS * 1_000).toISOString()
  const travadas = await store.execucoesCampanhaTravadas(limiteEm)
  resultado.examinadas = travadas.length
  const enfileirar = opcoes.enfileirar ?? send

  for (const ex of travadas) {
    if (!ex.campanha_id) continue
    // Cinto e suspensório: o store já filtra por organização, mas o watchdog
    // nunca pode reenfileirar execução de outro tenant.
    if (ex.organizacao_id && store.organizacaoId && ex.organizacao_id !== store.organizacaoId) {
      throw new Error('Watchdog de fila de campanha recebeu execução de outra organização.')
    }
    try {
      const controle = await ambiente.buscarControleExecucaoCampanha(ex.campanha_id)
      if (controle?.tipo === 'prospeccao') { resultado.ignoradasProspeccao++; continue }

      await enfileirar(TOPICO_FILA_CAMPANHA, {
        organizacaoId: store.organizacaoId ?? ex.organizacao_id ?? '',
        campanhaId: ex.campanha_id,
        execucaoId: ex.id,
      }, {
        delaySeconds: 0,
        retentionSeconds: RETENCAO_FILA_CAMPANHA_SEGUNDOS,
        idempotencyKey: `campanha:${ex.campanha_id}:execucao:${ex.id}`,
      })
      await store.registrarEvento({
        execucao_id: ex.id,
        tipo: 'disparo_reenfileirado_watchdog',
        detalhe: {
          campanha_id: ex.campanha_id,
          vencido_em: ex.proxima_verificacao_em,
          limiar_segundos: LIMIAR_TRAVAMENTO_SEGUNDOS,
        },
      })
      resultado.reenfileiradas++
    } catch (erro) {
      resultado.falhas++
      log.erro('Watchdog de fila de campanha falhou ao reenfileirar uma execução.', {
        organizacaoId: store.organizacaoId,
        execucaoId: ex.id,
        campanhaId: ex.campanha_id,
        erro: erro instanceof Error ? erro.message : String(erro),
      })
    }
  }
  return resultado
}
