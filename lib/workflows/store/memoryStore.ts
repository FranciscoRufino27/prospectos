// Store em memória para testes do versionamento — sem rede, determinístico.
// Espelha o contrato do WorkflowStore; não usa organizacao_id (o isolamento
// por org é testado no SupabaseStore/RLS, à parte).
import { randomUUID } from 'node:crypto'
import type {
  DefinicaoWorkflow,
  Workflow,
  WorkflowExecucao,
  WorkflowExecucaoEvento,
  WorkflowVersao,
  StatusExecucao,
} from '../types'
import type { PatchExecucao, PatchWorkflow, WorkflowStore } from './store'

export class MemoryWorkflowStore implements WorkflowStore {
  constructor(readonly organizacaoId?: string) {}
  private workflows = new Map<string, Workflow>()
  private versoes = new Map<string, WorkflowVersao>()
  private execucoes = new Map<string, WorkflowExecucao>()
  private eventos: WorkflowExecucaoEvento[] = []
  private seqEvento = 1

  private agora() {
    return new Date().toISOString()
  }

  async criarWorkflow(input: { nome: string; rascunho_definicao?: DefinicaoWorkflow | null }): Promise<Workflow> {
    const ts = this.agora()
    const wf: Workflow = {
      id: randomUUID(),
      organizacao_id: this.organizacaoId,
      nome: input.nome,
      status: 'rascunho',
      versao_atual_id: null,
      rascunho_definicao: input.rascunho_definicao ?? null,
      criado_em: ts,
      atualizado_em: ts,
    }
    this.workflows.set(wf.id, wf)
    return { ...wf }
  }

  async buscarWorkflow(id: string): Promise<Workflow | null> {
    const wf = this.workflows.get(id)
    return wf ? { ...wf } : null
  }

  async listarWorkflows(): Promise<Workflow[]> {
    return [...this.workflows.values()].map((w) => ({ ...w }))
  }

  async atualizarWorkflow(id: string, patch: PatchWorkflow): Promise<void> {
    const wf = this.workflows.get(id)
    if (!wf) throw new Error(`workflow ${id} não encontrado`)
    this.workflows.set(id, { ...wf, ...patch })
  }

  async proximoNumeroVersao(workflowId: string): Promise<number> {
    let max = 0
    for (const v of this.versoes.values()) if (v.workflow_id === workflowId && v.numero > max) max = v.numero
    return max + 1
  }

  async criarVersao(input: {
    workflow_id: string
    numero: number
    definicao: DefinicaoWorkflow
    publicado_por?: string | null
  }): Promise<WorkflowVersao> {
    // Guarda a unicidade (workflow_id, numero) como no banco.
    for (const v of this.versoes.values())
      if (v.workflow_id === input.workflow_id && v.numero === input.numero)
        throw new Error(`versão ${input.numero} já existe para o workflow ${input.workflow_id}`)
    const versao: WorkflowVersao = {
      id: randomUUID(),
      organizacao_id: this.organizacaoId,
      workflow_id: input.workflow_id,
      numero: input.numero,
      // Cópia profunda: a versão é imutável e não deve compartilhar referência
      // com o rascunho que continua sendo editado.
      definicao: structuredClone(input.definicao),
      publicado_em: this.agora(),
      publicado_por: input.publicado_por ?? null,
    }
    this.versoes.set(versao.id, versao)
    return structuredClone(versao)
  }

  async buscarVersao(id: string): Promise<WorkflowVersao | null> {
    const v = this.versoes.get(id)
    return v ? structuredClone(v) : null
  }

  async listarVersoes(workflowId: string): Promise<WorkflowVersao[]> {
    return [...this.versoes.values()]
      .filter((v) => v.workflow_id === workflowId)
      .sort((a, b) => a.numero - b.numero)
      .map((v) => structuredClone(v))
  }

  async criarExecucao(input: {
    workflow_id: string
    versao_id: string
    lead_id?: string | null
    campanha_id?: string | null
    ciclo_chave?: string | null
    servico_id?: string | null
    status?: StatusExecucao
    proxima_verificacao_em?: string | null
  }): Promise<WorkflowExecucao> {
    const ts = this.agora()
    const ex: WorkflowExecucao = {
      id: randomUUID(),
      organizacao_id: this.organizacaoId,
      workflow_id: input.workflow_id,
      versao_id: input.versao_id,
      lead_id: input.lead_id ?? null,
      campanha_id: input.campanha_id ?? null,
      ciclo_chave: input.ciclo_chave ?? null,
      servico_id: input.servico_id ?? null,
      passo_atual: 0,
      status: input.status ?? 'em_andamento',
      proxima_verificacao_em: input.proxima_verificacao_em ?? null,
      agendamento_geracao: 0,
      agendamento_publicado_em: null,
      agendamento_checkpoint_em: null,
      publicacao_token: null,
      publicacao_expira_em: null,
      claim_token: null,
      claim_expira_em: null,
      iniciado_em: ts,
      atualizado_em: ts,
    }
    this.execucoes.set(ex.id, ex)
    return { ...ex }
  }

  async buscarExecucao(id: string): Promise<WorkflowExecucao | null> {
    const ex = this.execucoes.get(id)
    return ex ? { ...ex } : null
  }

  async atualizarExecucao(id: string, patch: PatchExecucao): Promise<void> {
    const ex = this.execucoes.get(id)
    if (!ex) throw new Error(`execução ${id} não encontrada`)
    // Espelha o Supabase: 'cancelado' é terminal (só outro cancelamento passa).
    if (ex.status === 'cancelado' && patch.status !== 'cancelado') return
    this.execucoes.set(id, { ...ex, ...patch })
  }

  // Espelho síncrono das operações atômicas SQL, usado pelos testes de corrida.
  async agendarEsperaProspeccao(id: string, passoEsperado: number, proximoPasso: number, ate: string, claimToken?: string): Promise<WorkflowExecucao | null> {
    const ex = this.execucoes.get(id)
    if (!ex || ex.passo_atual !== passoEsperado || ex.status === 'cancelado'
      || (claimToken ? ex.claim_token !== claimToken || !ex.claim_expira_em || new Date(ex.claim_expira_em).getTime() <= Date.now()
        : ex.status !== 'em_andamento' || !!ex.claim_token)) return null
    Object.assign(ex, { passo_atual: proximoPasso, status: 'aguardando', proxima_verificacao_em: ate,
      agendamento_geracao: (ex.agendamento_geracao ?? 0) + 1,
      agendamento_publicado_em: null, agendamento_checkpoint_em: null,
      publicacao_token: null, publicacao_expira_em: null,
      claim_token: null, claim_expira_em: null })
    return { ...ex }
  }

  async reivindicarRetomadaProspeccao(id: string, geracao: number, passo: number, token: string): Promise<WorkflowExecucao | null> {
    const ex = this.execucoes.get(id)
    if (!ex || ex.status !== 'aguardando' || ex.passo_atual !== passo
      || (ex.agendamento_geracao ?? 0) !== geracao || !ex.proxima_verificacao_em
      || new Date(ex.proxima_verificacao_em).getTime() > Date.now()
      || ex.claim_token && ex.claim_expira_em && new Date(ex.claim_expira_em).getTime() > Date.now()) return null
    ex.claim_token = token
    ex.claim_expira_em = new Date(Date.now() + 600_000).toISOString()
    return { ...ex }
  }

  async liberarRetomadaProspeccao(id: string, token: string): Promise<void> {
    const ex = this.execucoes.get(id)
    if (ex?.claim_token === token) { ex.claim_token = null; ex.claim_expira_em = null }
  }

  async reivindicarPublicacaoProspeccao(id: string, geracao: number, token: string, checkpoint: string): Promise<boolean> {
    const ex = this.execucoes.get(id)
    if (!ex || ex.status !== 'aguardando' || ex.agendamento_geracao !== geracao
      || ex.agendamento_publicado_em
      || ex.publicacao_token && ex.publicacao_expira_em
        && new Date(ex.publicacao_expira_em).getTime() > Date.now()) return false
    Object.assign(ex, { publicacao_token: token, agendamento_checkpoint_em: checkpoint,
      publicacao_expira_em: new Date(Date.now() + 300_000).toISOString() })
    return true
  }

  async confirmarPublicacaoProspeccao(id: string, geracao: number, token: string): Promise<void> {
    const ex = this.execucoes.get(id)
    if (ex?.agendamento_geracao === geracao && ex.publicacao_token === token) {
      ex.agendamento_publicado_em = new Date().toISOString()
      ex.publicacao_token = null; ex.publicacao_expira_em = null
    }
  }

  async liberarPublicacaoProspeccao(id: string, geracao: number, token: string): Promise<void> {
    const ex = this.execucoes.get(id)
    if (ex?.agendamento_geracao === geracao && ex.publicacao_token === token) {
      ex.publicacao_token = null; ex.publicacao_expira_em = null; ex.agendamento_checkpoint_em = null
    }
  }

  async rearmarRetomadaProspeccao(id: string, geracao: number): Promise<WorkflowExecucao | null> {
    const ex = this.execucoes.get(id)
    if (!ex || ex.status !== 'aguardando' || ex.agendamento_geracao !== geracao
      || ex.claim_token && ex.claim_expira_em && new Date(ex.claim_expira_em).getTime() > Date.now()) return null
    Object.assign(ex, { agendamento_geracao: geracao + 1, agendamento_publicado_em: null,
      agendamento_checkpoint_em: null, publicacao_token: null, publicacao_expira_em: null,
      claim_token: null, claim_expira_em: null })
    return { ...ex }
  }

  // Espelha workflow_prospeccao_reconciliar_lote. O filtro por campanha de
  // prospecção só existe no SQL (este store não conhece campanhas).
  async listarRetomadasProspeccao(depois: string | null, limite: number): Promise<WorkflowExecucao[]> {
    return [...this.execucoes.values()]
      .filter((ex) => ex.status === 'aguardando' && (!depois || ex.id > depois)
        && (!!ex.proxima_verificacao_em && new Date(ex.proxima_verificacao_em).getTime() <= Date.now()
          || !!ex.agendamento_checkpoint_em && new Date(ex.agendamento_checkpoint_em).getTime() <= Date.now()
          || (ex.agendamento_geracao ?? 0) > 0 && !ex.agendamento_publicado_em
          || !!ex.claim_token && !!ex.claim_expira_em && new Date(ex.claim_expira_em).getTime() <= Date.now()))
      .sort((a, b) => a.id.localeCompare(b.id)).slice(0, limite).map((ex) => ({ ...ex }))
  }

  async buscarExecucaoParaLead(workflowId: string, leadId: string): Promise<WorkflowExecucao | null> {
    const execucoes = [...this.execucoes.values()]
      .filter((ex) => ex.workflow_id === workflowId && ex.lead_id === leadId && ex.status !== 'cancelado')
      .sort((a, b) => b.iniciado_em.localeCompare(a.iniciado_em))
    return execucoes[0] ? { ...execucoes[0] } : null
  }

  async buscarExecucaoParaCiclo(workflowId: string, leadId: string, cicloChave: string): Promise<WorkflowExecucao | null> {
    const execucoes = [...this.execucoes.values()]
      .filter((ex) => ex.workflow_id === workflowId && ex.lead_id === leadId && ex.ciclo_chave === cicloChave)
      .sort((a, b) => b.iniciado_em.localeCompare(a.iniciado_em))
    return execucoes[0] ? { ...execucoes[0] } : null
  }

  async existeExecucaoParaLead(workflowId: string, leadId: string): Promise<boolean> {
    for (const ex of this.execucoes.values())
      if (ex.workflow_id === workflowId && ex.lead_id === leadId) return true
    return false
  }

  async execucoesPendentes(agoraISO: string): Promise<WorkflowExecucao[]> {
    const agora = new Date(agoraISO).getTime()
    return [...this.execucoes.values()]
      .filter(
        (ex) =>
          ex.status === 'em_andamento' ||
          (ex.status === 'aguardando' &&
            ex.proxima_verificacao_em != null &&
            new Date(ex.proxima_verificacao_em).getTime() <= agora),
      )
      .sort((a, b) => a.iniciado_em.localeCompare(b.iniciado_em))
      .map((ex) => ({ ...ex }))
  }

  async execucoesCampanhaTravadas(limiteEm: string): Promise<WorkflowExecucao[]> {
    const limite = new Date(limiteEm).getTime()
    return [...this.execucoes.values()]
      .filter((ex) =>
        ex.status === 'aguardando'
        && ex.passo_atual === 0
        && (ex.agendamento_geracao ?? 0) === 0
        && !!ex.campanha_id
        && ex.proxima_verificacao_em != null
        && new Date(ex.proxima_verificacao_em).getTime() <= limite)
      .sort((a, b) => a.iniciado_em.localeCompare(b.iniciado_em))
      .map((ex) => ({ ...ex }))
  }

  async workflowsPublicados(): Promise<Workflow[]> {
    return [...this.workflows.values()].filter((w) => w.status === 'publicado').map((w) => ({ ...w }))
  }

  async contarExecucoesAtivasPorWorkflow(): Promise<Record<string, number>> {
    const contagem: Record<string, number> = {}
    for (const ex of this.execucoes.values()) {
      if (ex.status === 'em_andamento' || ex.status === 'aguardando') {
        contagem[ex.workflow_id] = (contagem[ex.workflow_id] ?? 0) + 1
      }
    }
    return contagem
  }

  async registrarEvento(evento: WorkflowExecucaoEvento): Promise<void> {
    this.eventos.push({ ...evento, id: this.seqEvento++, criado_em: evento.criado_em ?? this.agora() })
  }

  async listarEventos(execucaoId: string): Promise<WorkflowExecucaoEvento[]> {
    return this.eventos.filter((e) => e.execucao_id === execucaoId).map((e) => ({ ...e }))
  }
}
