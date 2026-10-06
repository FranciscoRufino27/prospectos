import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const mocks = vi.hoisted(() => ({
  buscarWorkflow: vi.fn(),
  buscarExecucao: vi.fn(),
  inscreverLeadManual: vi.fn(),
  agendarExecucoesCampanha: vi.fn(),
  buscarPreviaPublicoCampanha: vi.fn(),
}))

vi.mock('@/lib/workflows', () => ({
  SupabaseWorkflowStore: class {
    organizacaoId: string
    constructor(org: string) { this.organizacaoId = org }
    buscarWorkflow = mocks.buscarWorkflow
    buscarExecucao = mocks.buscarExecucao
  },
  inscreverLeadManual: mocks.inscreverLeadManual,
}))

vi.mock('@/lib/campanhas/filaDisparoServidor', () => ({
  agendarExecucoesCampanha: mocks.agendarExecucoesCampanha,
}))

vi.mock('@/lib/campanhas/publicoServidor', () => ({
  buscarPreviaPublicoCampanha: mocks.buscarPreviaPublicoCampanha,
}))

import { CadenciaRenovacaoAutomatica, chaveCicloRenovacao } from '../cadenciaAutomatica'

const travaOriginal = process.env.RENOVACAO_ENVIO_REAL

class ConsultaCampanhas {
  eqCalls: [string, unknown][] = []
  constructor(private readonly rows: Record<string, unknown>[]) {}
  select() { return this }
  eq(campo: string, valor: unknown) { this.eqCalls.push([campo, valor]); return this }
  not() { return this }
  order() { return this }
  limit() { return Promise.resolve({ data: this.rows, error: null }) }
}

function clientComCampanhas(rows: Record<string, unknown>[]) {
  const consulta = new ConsultaCampanhas(rows)
  const client = { from: () => consulta } as unknown as SupabaseClient
  return { client, consulta }
}

beforeEach(() => {
  process.env.RENOVACAO_ENVIO_REAL = 'true'
  vi.resetAllMocks()
  mocks.buscarWorkflow.mockResolvedValue({ id: 'workflow-1', status: 'publicado', versao_atual_id: 'versao-1' })
  mocks.inscreverLeadManual.mockResolvedValue({ jaInscrito: false, execucaoId: 'execucao-1' })
  mocks.buscarExecucao.mockResolvedValue({ id: 'execucao-1', status: 'em_andamento' })
  mocks.agendarExecucoesCampanha.mockResolvedValue({ agendadas: 1, ignoradas: 0 })
  mocks.buscarPreviaPublicoCampanha.mockResolvedValue({ idsElegiveis: ['lead-1'] })
})

afterAll(() => {
  if (travaOriginal === undefined) delete process.env.RENOVACAO_ENVIO_REAL
  else process.env.RENOVACAO_ENVIO_REAL = travaOriginal
})

describe('cadência automática de renovação', () => {
  it('gera uma única chave por empresa e competência', () => {
    expect(chaveCicloRenovacao({ empresaId: 'empresa-1', leadId: 'lead-1', vencimento: '2026-08-10' }))
      .toBe('empresa:empresa-1:2026-08')
    expect(chaveCicloRenovacao({ empresaId: null, leadId: 'lead-1', vencimento: '2026-08-28' }))
      .toBe('lead:lead-1:2026-08')
  })

  it('inscreve o ciclo com rastreabilidade e publica a execução na fila', async () => {
    const { client, consulta } = clientComCampanhas([{ id: 'campanha-1', workflow_id: 'workflow-1' }])
    const cadencia = await CadenciaRenovacaoAutomatica.preparar(client, 'org-1')
    expect(cadencia).not.toBeNull()
    expect(cadencia!.aceitaLead('lead-1')).toBe(true)
    expect(cadencia!.aceitaLead('lead-bloqueado')).toBe(false)

    const resultado = await cadencia!.inscrever({
      leadId: 'lead-1', empresaId: 'empresa-1', servicoId: 'servico-1', vencimento: '2026-08-10',
    })
    const agenda = await cadencia!.agendar([resultado.execucaoId])

    expect(consulta.eqCalls).toContainEqual(['organizacao_id', 'org-1'])
    expect(mocks.inscreverLeadManual).toHaveBeenCalledWith(
      expect.anything(),
      'workflow-1',
      'lead-1',
      'campanha-1',
      { cicloChave: 'empresa:empresa-1:2026-08', servicoId: 'servico-1' },
    )
    expect(resultado).toMatchObject({ jaInscrito: false, precisaAgendar: true })
    expect(agenda.agendadas).toBe(1)
    expect(mocks.agendarExecucoesCampanha).toHaveBeenCalledWith(
      expect.anything(), 'org-1', 'campanha-1', ['execucao-1'],
      { janela: null },
    )
  })

  it('não ativa sem campanha real e bloqueia duas campanhas para evitar duplicidade', async () => {
    const vazio = clientComCampanhas([])
    await expect(CadenciaRenovacaoAutomatica.preparar(vazio.client, 'org-1')).resolves.toBeNull()

    const duplicado = clientComCampanhas([
      { id: 'campanha-1', workflow_id: 'workflow-1' },
      { id: 'campanha-2', workflow_id: 'workflow-2' },
    ])
    await expect(CadenciaRenovacaoAutomatica.preparar(duplicado.client, 'org-1'))
      .rejects.toThrow('mais de uma automação real')
  })

  it('não publica na fila fora dos dias configurados', async () => {
    const { client } = clientComCampanhas([{
      id: 'campanha-1', workflow_id: 'workflow-1', publico: { agenda: { diasSemana: ['seg'] } },
    }])
    const cadencia = await CadenciaRenovacaoAutomatica.preparar(client, 'org-1')

    const resultado = await cadencia!.agendar(['execucao-1'], '2026-08-23T15:00:00.000Z')

    expect(resultado.agendadas).toBe(0)
    expect(mocks.agendarExecucoesCampanha).not.toHaveBeenCalled()
  })

  it('respeita o limite diário configurado ao publicar na fila', async () => {
    const { client } = clientComCampanhas([{
      id: 'campanha-1', workflow_id: 'workflow-1', publico: { agenda: { diasSemana: ['qui'], limiteDiario: 2 } },
    }])
    const cadencia = await CadenciaRenovacaoAutomatica.preparar(client, 'org-1')

    await cadencia!.agendar(['execucao-1', 'execucao-2', 'execucao-3'], '2026-08-27T15:00:00.000Z')

    expect(mocks.agendarExecucoesCampanha).toHaveBeenCalledWith(
      expect.anything(), 'org-1', 'campanha-1', ['execucao-1', 'execucao-2'],
      { janela: { diasSemana: ['qui'], horarioInicio: undefined, horarioFim: undefined } },
    )
  })

  it('preserva a trava global de emergência', async () => {
    process.env.RENOVACAO_ENVIO_REAL = 'false'
    const { client } = clientComCampanhas([{ id: 'campanha-1', workflow_id: 'workflow-1' }])
    await expect(CadenciaRenovacaoAutomatica.preparar(client, 'org-1')).rejects.toThrow('trava global')
  })
})
