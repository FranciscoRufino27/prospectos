import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { BancoFalso } from '@/lib/templates/__tests__/bancoFalso'

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

vi.mock('../filaDisparoServidor', () => ({
  agendarExecucoesCampanha: mocks.agendarExecucoesCampanha,
}))

vi.mock('../publicoServidor', () => ({
  buscarPreviaPublicoCampanha: mocks.buscarPreviaPublicoCampanha,
}))

import {
  CadenciaProspeccaoAutomatica,
  CICLO_PROSPECCAO_AUTOMATICA,
  encerrarProspeccaoSemResposta,
  processarProspeccaoAutomatica,
} from '../prospeccaoAutomatica'

const travaOriginal = process.env.PROSPECCAO_ENVIO_REAL

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
  process.env.PROSPECCAO_ENVIO_REAL = 'true'
  vi.resetAllMocks()
  mocks.buscarWorkflow.mockResolvedValue({ id: 'workflow-1', status: 'publicado', versao_atual_id: 'versao-1' })
  mocks.inscreverLeadManual.mockResolvedValue({ jaInscrito: false, execucaoId: 'execucao-1' })
  mocks.buscarExecucao.mockResolvedValue({ id: 'execucao-1', status: 'em_andamento' })
  mocks.agendarExecucoesCampanha.mockResolvedValue({ agendadas: 1, ignoradas: 0 })
  mocks.buscarPreviaPublicoCampanha.mockResolvedValue({ idsElegiveis: ['lead-1'] })
})

afterAll(() => {
  if (travaOriginal === undefined) delete process.env.PROSPECCAO_ENVIO_REAL
  else process.env.PROSPECCAO_ENVIO_REAL = travaOriginal
})

describe('CadenciaProspeccaoAutomatica', () => {
  it('inscreve o lead elegível e publica a execução na fila', async () => {
    const { client } = clientComCampanhas([{ id: 'campanha-1', workflow_id: 'workflow-1' }])
    const cadencia = await CadenciaProspeccaoAutomatica.preparar(client, 'org-1')
    expect(cadencia).not.toBeNull()
    expect(cadencia!.leadsElegiveis()).toEqual(['lead-1'])

    const resultado = await cadencia!.inscrever('lead-1')
    const agenda = await cadencia!.agendar([resultado.execucaoId])

    expect(mocks.inscreverLeadManual).toHaveBeenCalledWith(
      expect.anything(), 'workflow-1', 'lead-1', 'campanha-1', { cicloChave: CICLO_PROSPECCAO_AUTOMATICA },
    )
    expect(resultado).toMatchObject({ jaInscrito: false, precisaAgendar: true })
    expect(agenda.agendadas).toBe(1)
    expect(mocks.agendarExecucoesCampanha).toHaveBeenCalledWith(expect.anything(), 'org-1', 'campanha-1', ['execucao-1'],
      // Campanha sem agenda gravada: sem restrição de janela.
      { janela: null })
  })

  it('não ativa sem campanha real e bloqueia duas campanhas para evitar duplicidade', async () => {
    const vazio = clientComCampanhas([])
    await expect(CadenciaProspeccaoAutomatica.preparar(vazio.client, 'org-1')).resolves.toBeNull()

    const duplicado = clientComCampanhas([
      { id: 'campanha-1', workflow_id: 'workflow-1' },
      { id: 'campanha-2', workflow_id: 'workflow-2' },
    ])
    await expect(CadenciaProspeccaoAutomatica.preparar(duplicado.client, 'org-1'))
      .rejects.toThrow('mais de uma automação real')
  })

  it('não publica na fila fora dos dias configurados', async () => {
    const { client } = clientComCampanhas([{
      id: 'campanha-1', workflow_id: 'workflow-1', publico: { agenda: { diasSemana: ['seg'] } },
    }])
    const cadencia = await CadenciaProspeccaoAutomatica.preparar(client, 'org-1')
    const resultado = await cadencia!.agendar(['execucao-1'], '2026-08-23T15:00:00.000Z') // domingo
    expect(resultado.agendadas).toBe(0)
    expect(mocks.agendarExecucoesCampanha).not.toHaveBeenCalled()
  })

  it('preserva a trava global de emergência (desligada por padrão)', async () => {
    process.env.PROSPECCAO_ENVIO_REAL = 'false'
    const { client } = clientComCampanhas([{ id: 'campanha-1', workflow_id: 'workflow-1' }])
    await expect(CadenciaProspeccaoAutomatica.preparar(client, 'org-1')).rejects.toThrow('trava global')
  })
})

// buscarCampanhaAtivaProspeccao (interno deste arquivo) consulta o client REAL
// passado a processarProspeccaoAutomatica — não passa pelo mock de
// SupabaseWorkflowStore. Por isso cada teste abaixo semeia uma campanha ativa
// válida na mesma BancoFalso usada como `client`.
const CAMPANHA_ATIVA_SEED = {
  id: 'camp-1', organizacao_id: 'org-1', tipo: 'prospeccao',
  status: 'ativa', dry_run: false, workflow_id: 'workflow-1', publico: {},
}

describe('processarProspeccaoAutomatica', () => {
  it('com a trava desligada, não inscreve ninguém mas ainda encerra cadências concluídas', async () => {
    process.env.PROSPECCAO_ENVIO_REAL = 'false'
    const db = new BancoFalso({ campanhas: [CAMPANHA_ATIVA_SEED] })
    const r = await processarProspeccaoAutomatica('org-1', { client: db.cliente() })
    expect(r.automacaoConfigurada).toBe(false)
    expect(r.inscritos).toBe(0)
    expect(mocks.inscreverLeadManual).not.toHaveBeenCalled()
  })

  it('sem campanha real ativa, não inscreve ninguém', async () => {
    const db = new BancoFalso({})
    const r = await processarProspeccaoAutomatica('org-1', { client: db.cliente() })
    expect(r.automacaoConfigurada).toBe(false)
    expect(mocks.inscreverLeadManual).not.toHaveBeenCalled()
  })

  it('reprocessar o mesmo lead não duplica: 2ª chamada retorna jaInscrito', async () => {
    // 1ª chamada: inscrição nova.
    mocks.inscreverLeadManual.mockResolvedValueOnce({ jaInscrito: false, execucaoId: 'execucao-1' })
    // 2ª chamada (reprocessamento do cron): a idempotência real vive dentro de
    // inscreverLeadManual (já testada em lib/workflows/__tests__/executor.test.ts);
    // aqui provamos que processarProspeccaoAutomatica REAGE corretamente ao
    // resultado idempotente, sem tentar enviar de novo.
    mocks.inscreverLeadManual.mockResolvedValueOnce({ jaInscrito: true, execucaoId: 'execucao-1' })
    mocks.buscarExecucao.mockResolvedValue({ id: 'execucao-1', status: 'aguardando' })

    const db = new BancoFalso({ campanhas: [CAMPANHA_ATIVA_SEED] })
    const r1 = await processarProspeccaoAutomatica('org-1', { client: db.cliente() })
    const r2 = await processarProspeccaoAutomatica('org-1', { client: db.cliente() })

    expect(r1.inscritos).toBe(1)
    expect(r1.jaInscritos).toBe(0)
    expect(r2.inscritos).toBe(0)
    expect(r2.jaInscritos).toBe(1)
    // jaInscrito com execução 'aguardando' (nem erro nem em_andamento) não
    // precisa reagendar — não reenvia o que já está na fila.
    expect(mocks.agendarExecucoesCampanha).toHaveBeenCalledTimes(1)
  })

  it('transfere o lead importado (owner n8n) para o motor ao inscrever', async () => {
    const db = new BancoFalso({
      campanhas: [CAMPANHA_ATIVA_SEED],
      leads: [{ id: 'lead-1', organizacao_id: 'org-1', owner: 'n8n' }],
    })
    await processarProspeccaoAutomatica('org-1', { client: db.cliente() })
    expect(db.linhas('leads')[0].owner).toBe('engine')
  })

  it('uma falha ao inscrever um lead não impede os demais nem o encerramento', async () => {
    mocks.buscarPreviaPublicoCampanha.mockResolvedValue({ idsElegiveis: ['lead-1', 'lead-2'] })
    mocks.inscreverLeadManual
      .mockRejectedValueOnce(new Error('falha simulada'))
      .mockResolvedValueOnce({ jaInscrito: false, execucaoId: 'execucao-2' })

    const db = new BancoFalso({ campanhas: [CAMPANHA_ATIVA_SEED] })
    const r = await processarProspeccaoAutomatica('org-1', { client: db.cliente() })
    expect(r.falhas).toBe(1)
    expect(r.inscritos).toBe(1)
  })
})

describe('encerrarProspeccaoSemResposta', () => {
  it('move para sem_resposta um lead cuja execução do NOVO fluxo automático concluiu sem resposta', async () => {
    const db = new BancoFalso({
      campanhas: [{ id: 'camp-1', organizacao_id: 'org-1', tipo: 'prospeccao' }],
      workflow_execucoes: [{
        id: 'exec-1', organizacao_id: 'org-1', campanha_id: 'camp-1', lead_id: 'lead-1',
        status: 'concluido', ciclo_chave: CICLO_PROSPECCAO_AUTOMATICA,
      }],
      leads: [{ id: 'lead-1', organizacao_id: 'org-1', estagio: 'follow_up' }],
    })
    const r = await encerrarProspeccaoSemResposta(db.cliente(), 'org-1')
    expect(r.encerrados).toBe(1)
    expect(db.linhas('leads')[0].estagio).toBe('sem_resposta')
    expect(db.linhas('interacoes')).toHaveLength(1)
  })

  // REGRESSÃO OBRIGATÓRIA (achado do banco real: 157 leads de "CAMPANHA
  // INICIAL", LAUDO DE BRINQUEDOS, campanha já concluída antes desta entrega).
  // Execução histórica/manual = ciclo_chave nulo (inscreverCampanhaReal nunca
  // passou cicloChave). Sem este critério, encerrarProspeccaoSemResposta faria
  // saneamento de histórico no primeiro tick pós-deploy — exatamente o que foi
  // pedido para eliminar.
  it('NÃO mexe em execução histórica/manual (ciclo_chave nulo), mesmo com status concluído', async () => {
    const db = new BancoFalso({
      campanhas: [{ id: 'camp-1', organizacao_id: 'org-1', tipo: 'prospeccao', status: 'concluida' }],
      workflow_execucoes: [{
        id: 'exec-historica', organizacao_id: 'org-1', campanha_id: 'camp-1', lead_id: 'lead-1',
        status: 'concluido', ciclo_chave: null,
      }],
      leads: [{ id: 'lead-1', organizacao_id: 'org-1', estagio: 'primeiro_contato' }],
    })
    const r = await encerrarProspeccaoSemResposta(db.cliente(), 'org-1')
    expect(r.encerrados).toBe(0)
    expect(db.linhas('leads')[0].estagio).toBe('primeiro_contato')
    expect(db.escritas('leads')).toHaveLength(0)
    expect(db.linhas('interacoes')).toHaveLength(0)
  })

  it('não mexe em lead que já respondeu (fora de ESTAGIOS_EM_CADENCIA)', async () => {
    const db = new BancoFalso({
      campanhas: [{ id: 'camp-1', organizacao_id: 'org-1', tipo: 'prospeccao' }],
      workflow_execucoes: [{
        id: 'exec-1', organizacao_id: 'org-1', campanha_id: 'camp-1', lead_id: 'lead-1',
        status: 'concluido', ciclo_chave: CICLO_PROSPECCAO_AUTOMATICA,
      }],
      leads: [{ id: 'lead-1', organizacao_id: 'org-1', estagio: 'interessado' }],
    })
    const r = await encerrarProspeccaoSemResposta(db.cliente(), 'org-1')
    expect(r.encerrados).toBe(0)
    expect(db.linhas('leads')[0].estagio).toBe('interessado')
  })

  it('não mexe em execução ainda ativa (em_andamento/aguardando)', async () => {
    const db = new BancoFalso({
      campanhas: [{ id: 'camp-1', organizacao_id: 'org-1', tipo: 'prospeccao' }],
      workflow_execucoes: [{
        id: 'exec-1', organizacao_id: 'org-1', campanha_id: 'camp-1', lead_id: 'lead-1',
        status: 'aguardando', ciclo_chave: CICLO_PROSPECCAO_AUTOMATICA,
      }],
      leads: [{ id: 'lead-1', organizacao_id: 'org-1', estagio: 'follow_up' }],
    })
    const r = await encerrarProspeccaoSemResposta(db.cliente(), 'org-1')
    expect(r.encerrados).toBe(0)
  })

  it('não mexe em execuções de renovação (regressão obrigatória)', async () => {
    const db = new BancoFalso({
      campanhas: [{ id: 'camp-renovacao', organizacao_id: 'org-1', tipo: 'renovacao' }],
      workflow_execucoes: [{
        id: 'exec-1', organizacao_id: 'org-1', campanha_id: 'camp-renovacao', lead_id: 'lead-1',
        status: 'concluido', ciclo_chave: CICLO_PROSPECCAO_AUTOMATICA,
      }],
      leads: [{ id: 'lead-1', organizacao_id: 'org-1', estagio: 'follow_up' }],
    })
    const r = await encerrarProspeccaoSemResposta(db.cliente(), 'org-1')
    expect(r.encerrados).toBe(0)
    expect(db.linhas('leads')[0].estagio).toBe('follow_up')
  })

  it('não mexe em leads de outra organização (multi-tenant)', async () => {
    const db = new BancoFalso({
      campanhas: [
        { id: 'camp-org1', organizacao_id: 'org-1', tipo: 'prospeccao' },
        { id: 'camp-org2', organizacao_id: 'org-2', tipo: 'prospeccao' },
      ],
      workflow_execucoes: [
        {
          id: 'exec-org2', organizacao_id: 'org-2', campanha_id: 'camp-org2', lead_id: 'lead-2',
          status: 'concluido', ciclo_chave: CICLO_PROSPECCAO_AUTOMATICA,
        },
      ],
      leads: [{ id: 'lead-2', organizacao_id: 'org-2', estagio: 'follow_up' }],
    })
    const r = await encerrarProspeccaoSemResposta(db.cliente(), 'org-1')
    expect(r.encerrados).toBe(0)
    expect(db.linhas('leads')[0].estagio).toBe('follow_up')
  })
})
