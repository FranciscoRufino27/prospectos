// Implementação real do WorkflowStore sobre o Supabase (service_role).
//
// service_role BYPASSA a RLS — portanto o isolamento por organização NESTE
// caminho depende de o Store SEMPRE filtrar (.eq organizacao_id) nas leituras e
// GRAVAR organizacao_id nos inserts. Não é redundância com a RLS: é a única
// proteção do caminho service_role. Mesmo contrato do SupabaseStore do motor.
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import type {
  DefinicaoWorkflow,
  StatusExecucao,
  Workflow,
  WorkflowExecucao,
  WorkflowExecucaoEvento,
  WorkflowVersao,
} from '../types'
import type { PatchExecucao, PatchWorkflow, WorkflowStore } from './store'

export class SupabaseWorkflowStore implements WorkflowStore {
  constructor(
    public readonly organizacaoId: string,
    private db: SupabaseClient = createSupabaseAdminClient(),
  ) {
    if (!organizacaoId) throw new Error('SupabaseWorkflowStore exige organizacaoId (multi-tenant).')
  }

  // --- workflows ---
  async criarWorkflow(input: { nome: string; rascunho_definicao?: DefinicaoWorkflow | null }): Promise<Workflow> {
    const { data, error } = await this.db
      .from('workflows')
      .insert({
        organizacao_id: this.organizacaoId,
        nome: input.nome,
        status: 'rascunho',
        rascunho_definicao: input.rascunho_definicao ?? null,
      })
      .select('*')
      .single()
    if (error) throw error
    return data as Workflow
  }

  async buscarWorkflow(id: string): Promise<Workflow | null> {
    const { data, error } = await this.db
      .from('workflows')
      .select('*')
      .eq('organizacao_id', this.organizacaoId)
      .eq('id', id)
      .maybeSingle()
    if (error) throw error
    return (data as Workflow) ?? null
  }

  async listarWorkflows(): Promise<Workflow[]> {
    const { data, error } = await this.db
      .from('workflows')
      .select('*')
      .eq('organizacao_id', this.organizacaoId)
      .order('atualizado_em', { ascending: false })
    if (error) throw error
    return (data as Workflow[]) ?? []
  }

  async atualizarWorkflow(id: string, patch: PatchWorkflow): Promise<void> {
    const { error } = await this.db
      .from('workflows')
      .update(patch)
      .eq('organizacao_id', this.organizacaoId)
      .eq('id', id)
    if (error) throw error
  }

  // --- versões ---
  async proximoNumeroVersao(workflowId: string): Promise<number> {
    const { data, error } = await this.db
      .from('workflow_versoes')
      .select('numero')
      .eq('organizacao_id', this.organizacaoId)
      .eq('workflow_id', workflowId)
      .order('numero', { ascending: false })
      .limit(1)
    if (error) throw error
    const max = data && data.length > 0 ? (data[0].numero as number) : 0
    return max + 1
  }

  async criarVersao(input: {
    workflow_id: string
    numero: number
    definicao: DefinicaoWorkflow
    publicado_por?: string | null
  }): Promise<WorkflowVersao> {
    const { data, error } = await this.db
      .from('workflow_versoes')
      .insert({
        organizacao_id: this.organizacaoId,
        workflow_id: input.workflow_id,
        numero: input.numero,
        definicao: input.definicao,
        publicado_por: input.publicado_por ?? null,
      })
      .select('*')
      .single()
    if (error) throw error
    return data as WorkflowVersao
  }

  async buscarVersao(id: string): Promise<WorkflowVersao | null> {
    const { data, error } = await this.db
      .from('workflow_versoes')
      .select('*')
      .eq('organizacao_id', this.organizacaoId)
      .eq('id', id)
      .maybeSingle()
    if (error) throw error
    return (data as WorkflowVersao) ?? null
  }

  async listarVersoes(workflowId: string): Promise<WorkflowVersao[]> {
    const { data, error } = await this.db
      .from('workflow_versoes')
      .select('*')
      .eq('organizacao_id', this.organizacaoId)
      .eq('workflow_id', workflowId)
      .order('numero', { ascending: true })
    if (error) throw error
    return (data as WorkflowVersao[]) ?? []
  }

  // --- execuções ---
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
    const { data, error } = await this.db
      .from('workflow_execucoes')
      .insert({
        organizacao_id: this.organizacaoId,
        workflow_id: input.workflow_id,
        versao_id: input.versao_id,
        lead_id: input.lead_id ?? null,
        campanha_id: input.campanha_id ?? null,
        ciclo_chave: input.ciclo_chave ?? null,
        servico_id: input.servico_id ?? null,
        status: input.status ?? 'em_andamento',
        proxima_verificacao_em: input.proxima_verificacao_em ?? null,
      })
      .select('*')
      .single()
    if (error) throw error
    return data as WorkflowExecucao
  }

  async buscarExecucao(id: string): Promise<WorkflowExecucao | null> {
    const { data, error } = await this.db
      .from('workflow_execucoes')
      .select('*')
      .eq('organizacao_id', this.organizacaoId)
      .eq('id', id)
      .maybeSingle()
    if (error) throw error
    return (data as WorkflowExecucao) ?? null
  }

  async atualizarExecucao(id: string, patch: PatchExecucao): Promise<void> {
    // 'cancelado' é TERMINAL: uma resposta do lead cancela a execução (Fluxo 2)
    // possivelmente no meio de um tick do executor, e as escritas de status do
    // próprio executor (em_andamento/aguardando/concluido) não podem reviver a
    // cadência. Só um patch que cancela passa sobre uma execução cancelada.
    let q = this.db
      .from('workflow_execucoes')
      .update(patch)
      .eq('organizacao_id', this.organizacaoId)
      .eq('id', id)
    if (patch.status !== 'cancelado') q = q.neq('status', 'cancelado')
    const { error } = await q
    if (error) throw error
  }

  private async rpcRetomada<T>(nome: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.db.rpc(nome, { p_org: this.organizacaoId, ...args })
    if (error) throw error
    return data as T
  }

  // As funções de linha da 0047 são `setof`: nada casou = lista vazia. Nunca
  // tratar objeto sem `id` como sucesso — seria avançar a espera às cegas.
  private async rpcExecucao(nome: string, args: Record<string, unknown>): Promise<WorkflowExecucao | null> {
    const linhas = await this.rpcRetomada<WorkflowExecucao[] | WorkflowExecucao | null>(nome, args)
    const linha = Array.isArray(linhas) ? linhas[0] : linhas
    return linha && linha.id ? linha : null
  }

  agendarEsperaProspeccao(id: string, passoEsperado: number, proximoPasso: number, ate: string, claimToken?: string) {
    return this.rpcExecucao('workflow_prospeccao_agendar_espera', {
      p_id: id, p_passo_esperado: passoEsperado, p_proximo_passo: proximoPasso,
      p_ate: ate, p_claim_token: claimToken ?? null,
    })
  }

  reivindicarRetomadaProspeccao(id: string, geracao: number, passo: number, token: string) {
    return this.rpcExecucao('workflow_prospeccao_claim', {
      p_id: id, p_geracao: geracao, p_passo: passo, p_token: token,
    })
  }

  async liberarRetomadaProspeccao(id: string, token: string) {
    await this.rpcRetomada('workflow_prospeccao_liberar_claim', { p_id: id, p_token: token })
  }

  reivindicarPublicacaoProspeccao(id: string, geracao: number, token: string, checkpoint: string) {
    return this.rpcRetomada<boolean>('workflow_prospeccao_claim_publicacao', {
      p_id: id, p_geracao: geracao, p_token: token, p_checkpoint: checkpoint,
    })
  }

  async confirmarPublicacaoProspeccao(id: string, geracao: number, token: string) {
    await this.rpcRetomada('workflow_prospeccao_confirmar_publicacao', {
      p_id: id, p_geracao: geracao, p_token: token,
    })
  }

  async liberarPublicacaoProspeccao(id: string, geracao: number, token: string) {
    await this.rpcRetomada('workflow_prospeccao_liberar_publicacao', {
      p_id: id, p_geracao: geracao, p_token: token,
    })
  }

  rearmarRetomadaProspeccao(id: string, geracao: number) {
    return this.rpcExecucao('workflow_prospeccao_rearmar', {
      p_id: id, p_geracao: geracao,
    })
  }

  async listarRetomadasProspeccao(depois: string | null, limite: number) {
    const linhas = await this.rpcRetomada<WorkflowExecucao[] | null>('workflow_prospeccao_reconciliar_lote', {
      p_depois: depois, p_limite: limite,
    })
    return (linhas ?? []).filter((linha) => !!linha?.id)
  }

  async buscarExecucaoParaLead(workflowId: string, leadId: string): Promise<WorkflowExecucao | null> {
    const { data, error } = await this.db
      .from('workflow_execucoes')
      .select('*')
      .eq('organizacao_id', this.organizacaoId)
      .eq('workflow_id', workflowId)
      .eq('lead_id', leadId)
      .neq('status', 'cancelado')
      .order('iniciado_em', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    return (data as WorkflowExecucao) ?? null
  }

  async buscarExecucaoParaCiclo(workflowId: string, leadId: string, cicloChave: string): Promise<WorkflowExecucao | null> {
    const { data, error } = await this.db
      .from('workflow_execucoes')
      .select('*')
      .eq('organizacao_id', this.organizacaoId)
      .eq('workflow_id', workflowId)
      .eq('lead_id', leadId)
      .eq('ciclo_chave', cicloChave)
      .order('iniciado_em', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    return (data as WorkflowExecucao) ?? null
  }

  async existeExecucaoParaLead(workflowId: string, leadId: string): Promise<boolean> {
    // Exclui canceladas: execução cancelada não bloqueia re-enrollment (o lead
    // pode ser reinscrito em nova versão do workflow após cancelamento explícito).
    const { count, error } = await this.db
      .from('workflow_execucoes')
      .select('id', { count: 'exact', head: true })
      .eq('organizacao_id', this.organizacaoId)
      .eq('workflow_id', workflowId)
      .eq('lead_id', leadId)
      .neq('status', 'cancelado')
    if (error) throw error
    return (count ?? 0) > 0
  }

  async execucoesPendentes(agoraISO: string): Promise<WorkflowExecucao[]> {
    // Duas populações: em_andamento (seguir já) e aguardando vencidas. PostgREST
    // não faz esse OR com um filtro de nulo limpo, então buscamos as duas e
    // juntamos — volume por org/tick é baixo (poll diário).
    const emAndamento = await this.db
      .from('workflow_execucoes')
      .select('*')
      .eq('organizacao_id', this.organizacaoId)
      .eq('status', 'em_andamento')
    if (emAndamento.error) throw emAndamento.error
    const aguardando = await this.db
      .from('workflow_execucoes')
      .select('*')
      .eq('organizacao_id', this.organizacaoId)
      .eq('status', 'aguardando')
      .eq('agendamento_geracao', 0)
      .lte('proxima_verificacao_em', agoraISO)
    if (aguardando.error) throw aguardando.error
    return [...(emAndamento.data ?? []), ...(aguardando.data ?? [])]
      .sort((a, b) => String(a.iniciado_em).localeCompare(String(b.iniciado_em))) as WorkflowExecucao[]
  }

  async execucoesCampanhaTravadas(limiteEm: string): Promise<WorkflowExecucao[]> {
    const { data, error } = await this.db
      .from('workflow_execucoes')
      .select('*')
      .eq('organizacao_id', this.organizacaoId)
      .eq('status', 'aguardando')
      .eq('passo_atual', 0)
      .eq('agendamento_geracao', 0)
      .not('campanha_id', 'is', null)
      .lte('proxima_verificacao_em', limiteEm)
      .order('iniciado_em', { ascending: true })
    if (error) throw error
    return (data ?? []) as WorkflowExecucao[]
  }

  async workflowsPublicados(): Promise<Workflow[]> {
    const { data, error } = await this.db
      .from('workflows')
      .select('*')
      .eq('organizacao_id', this.organizacaoId)
      .eq('status', 'publicado')
    if (error) throw error
    return (data as Workflow[]) ?? []
  }

  async contarExecucoesAtivasPorWorkflow(): Promise<Record<string, number>> {
    const { data, error } = await this.db
      .from('workflow_execucoes')
      .select('workflow_id')
      .eq('organizacao_id', this.organizacaoId)
      .in('status', ['em_andamento', 'aguardando'])
    if (error) throw error
    const contagem: Record<string, number> = {}
    for (const row of data ?? []) {
      const id = (row as { workflow_id: string }).workflow_id
      contagem[id] = (contagem[id] ?? 0) + 1
    }
    return contagem
  }

  // --- eventos ---
  async registrarEvento(evento: WorkflowExecucaoEvento): Promise<void> {
    const { error } = await this.db.from('workflow_execucao_eventos').insert({
      organizacao_id: this.organizacaoId,
      execucao_id: evento.execucao_id,
      tipo: evento.tipo,
      detalhe: evento.detalhe ?? null,
    })
    if (error) throw error
  }

  async listarEventos(execucaoId: string): Promise<WorkflowExecucaoEvento[]> {
    const { data, error } = await this.db
      .from('workflow_execucao_eventos')
      .select('*')
      .eq('organizacao_id', this.organizacaoId)
      .eq('execucao_id', execucaoId)
      .order('id', { ascending: true })
    if (error) throw error
    return (data as WorkflowExecucaoEvento[]) ?? []
  }
}
