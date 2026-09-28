import { describe, expect, it, vi } from 'vitest'
import { MemoryWorkflowStore } from '@/lib/workflows/store/memoryStore'
import type { AmbienteWorkflow } from '@/lib/workflows/ambiente'
import type { ControleExecucaoCampanha } from '@/lib/campanhas/controleExecucaoServidor'
import {
  LIMIAR_TRAVAMENTO_SEGUNDOS,
  reconciliarDisparosCampanhaTravados,
} from '../watchdogFilaCampanha'

const AGORA = new Date('2026-09-28T22:00:00.000Z')
const VENCIDO_HA_20MIN = new Date(AGORA.getTime() - 20 * 60_000).toISOString()
const VENCIDO_HA_5MIN = new Date(AGORA.getTime() - 5 * 60_000).toISOString()

function enfileirarFalso() {
  return vi.fn(async () => {}) as unknown as typeof import('@vercel/queue').send
}

function ambienteFake(tipoPorCampanha: Record<string, ControleExecucaoCampanha['tipo']>): AmbienteWorkflow {
  return {
    organizacaoId: 'org-a',
    simular: false,
    async buscarControleExecucaoCampanha(campanhaId: string) {
      const tipo = tipoPorCampanha[campanhaId]
      if (tipo === undefined) return null
      return { status: 'ativa', tipo, diasSemana: null, disparoUnico: false }
    },
    sincronizarConclusaoCampanha: async () => {},
  } as unknown as AmbienteWorkflow
}

async function criarExecucaoTravada(
  store: MemoryWorkflowStore,
  campanhaId: string,
  proximaVerificacaoEm: string,
) {
  const def = { gatilho: { tipo: 'manual', config: {} }, condicoes: [], acoes: [] }
  const wf = await store.criarWorkflow({ nome: 'Campanha', rascunho_definicao: def })
  const versao = await store.criarVersao({ workflow_id: wf.id, numero: 1, definicao: def })
  return store.criarExecucao({
    workflow_id: wf.id,
    versao_id: versao.id,
    lead_id: 'lead-1',
    campanha_id: campanhaId,
    status: 'aguardando',
    proxima_verificacao_em: proximaVerificacaoEm,
  })
}

describe('watchdog da fila de disparo de campanha', () => {
  it('reenfileira (mesma idempotencyKey) uma execução travada além do limiar e registra o evento', async () => {
    const store = new MemoryWorkflowStore('org-a')
    const ex = await criarExecucaoTravada(store, 'campanha-renovacao', VENCIDO_HA_20MIN)
    const ambiente = ambienteFake({ 'campanha-renovacao': 'renovacao' })
    const enfileirar = enfileirarFalso()

    const resultado = await reconciliarDisparosCampanhaTravados(store, ambiente, { agora: AGORA, enfileirar })

    expect(resultado).toMatchObject({ examinadas: 1, reenfileiradas: 1, ignoradasProspeccao: 0, falhas: 0 })
    expect(enfileirar).toHaveBeenCalledWith(
      'campanhas-email-v1',
      { organizacaoId: 'org-a', campanhaId: 'campanha-renovacao', execucaoId: ex.id },
      expect.objectContaining({
        delaySeconds: 0,
        idempotencyKey: `campanha:campanha-renovacao:execucao:${ex.id}`,
      }),
    )
    const eventos = await store.listarEventos(ex.id)
    expect(eventos.map((e) => e.tipo)).toContain('disparo_reenfileirado_watchdog')
  })

  it('não toca em execução ainda dentro do limiar de tolerância', async () => {
    const store = new MemoryWorkflowStore('org-a')
    await criarExecucaoTravada(store, 'campanha-renovacao', VENCIDO_HA_5MIN)
    const ambiente = ambienteFake({ 'campanha-renovacao': 'renovacao' })
    const enfileirar = enfileirarFalso()

    const resultado = await reconciliarDisparosCampanhaTravados(store, ambiente, { agora: AGORA, enfileirar })

    expect(resultado).toMatchObject({ examinadas: 0, reenfileiradas: 0 })
    expect(enfileirar).not.toHaveBeenCalled()
  })

  it('ignora campanha de prospecção — tem reconciliação própria e durável', async () => {
    const store = new MemoryWorkflowStore('org-a')
    await criarExecucaoTravada(store, 'campanha-prospeccao', VENCIDO_HA_20MIN)
    const ambiente = ambienteFake({ 'campanha-prospeccao': 'prospeccao' })
    const enfileirar = enfileirarFalso()

    const resultado = await reconciliarDisparosCampanhaTravados(store, ambiente, { agora: AGORA, enfileirar })

    expect(resultado).toMatchObject({ examinadas: 1, reenfileiradas: 0, ignoradasProspeccao: 1 })
    expect(enfileirar).not.toHaveBeenCalled()
  })

  it('uma falha isolada não impede o reenfileiramento das demais execuções travadas', async () => {
    const store = new MemoryWorkflowStore('org-a')
    const quebrada = await criarExecucaoTravada(store, 'campanha-com-erro', VENCIDO_HA_20MIN)
    const ok = await criarExecucaoTravada(store, 'campanha-renovacao', VENCIDO_HA_20MIN)
    const ambiente: AmbienteWorkflow = {
      organizacaoId: 'org-a',
      simular: false,
      async buscarControleExecucaoCampanha(campanhaId: string) {
        if (campanhaId === 'campanha-com-erro') throw new Error('falha simulada ao consultar campanha')
        return { status: 'ativa', tipo: 'renovacao', diasSemana: null, disparoUnico: false }
      },
      sincronizarConclusaoCampanha: async () => {},
    } as unknown as AmbienteWorkflow
    const enfileirar = enfileirarFalso()

    const resultado = await reconciliarDisparosCampanhaTravados(store, ambiente, { agora: AGORA, enfileirar })

    expect(resultado).toMatchObject({ examinadas: 2, reenfileiradas: 1, falhas: 1 })
    expect(enfileirar).toHaveBeenCalledTimes(1)
    expect(enfileirar).toHaveBeenCalledWith(
      'campanhas-email-v1',
      expect.objectContaining({ execucaoId: ok.id }),
      expect.anything(),
    )
    void quebrada
  })

  it('limiar de travamento fica acima do backoff total da fila (5 tentativas, ~12,5min)', () => {
    expect(LIMIAR_TRAVAMENTO_SEGUNDOS).toBeGreaterThan(30 + 60 + 120 + 240 + 300)
  })
})
