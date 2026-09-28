// Interface de persistência do módulo de Workflows. O resto do módulo só conhece
// esta interface — nunca o Supabase direto — para ser testável contra um
// MemoryStore, no mesmo espírito do Store do motor de cadência (lib/engine).
import type {
  DefinicaoWorkflow,
  Workflow,
  WorkflowExecucao,
  WorkflowExecucaoEvento,
  WorkflowVersao,
  StatusExecucao,
} from '../types'

// Campos do workflow que o versionamento pode alterar (o resto é imutável).
export type PatchWorkflow = Partial<
  Pick<Workflow, 'nome' | 'status' | 'versao_atual_id' | 'rascunho_definicao' | 'atualizado_em'>
>

export type PatchExecucao = Partial<
  Pick<WorkflowExecucao, 'passo_atual' | 'status' | 'proxima_verificacao_em' | 'atualizado_em'>
>

export interface WorkflowStore {
  // Organização à qual este Store está preso. O SupabaseStore filtra/grava
  // sempre esta org (service_role bypassa RLS — o filtro no código é o que
  // isola). O MemoryStore (testes) deixa undefined.
  readonly organizacaoId?: string

  // --- workflows ---
  criarWorkflow(input: { nome: string; rascunho_definicao?: DefinicaoWorkflow | null }): Promise<Workflow>
  buscarWorkflow(id: string): Promise<Workflow | null>
  listarWorkflows(): Promise<Workflow[]>
  atualizarWorkflow(id: string, patch: PatchWorkflow): Promise<void>

  // --- versões (imutáveis) ---
  // Próximo `numero` de versão para o workflow (max + 1; 1 se não houver).
  proximoNumeroVersao(workflowId: string): Promise<number>
  criarVersao(input: {
    workflow_id: string
    numero: number
    definicao: DefinicaoWorkflow
    publicado_por?: string | null
  }): Promise<WorkflowVersao>
  buscarVersao(id: string): Promise<WorkflowVersao | null>
  listarVersoes(workflowId: string): Promise<WorkflowVersao[]>

  // --- execuções ---
  criarExecucao(input: {
    workflow_id: string
    versao_id: string
    lead_id?: string | null
    campanha_id?: string | null
    ciclo_chave?: string | null
    servico_id?: string | null
    status?: StatusExecucao
    proxima_verificacao_em?: string | null
  }): Promise<WorkflowExecucao>
  buscarExecucao(id: string): Promise<WorkflowExecucao | null>
  atualizarExecucao(id: string, patch: PatchExecucao): Promise<void>
  // Extensão persistente exclusiva de campanhas de prospecção. Ausente no
  // MemoryStore legado; o executor exige sua presença no store de produção.
  agendarEsperaProspeccao?(id: string, passoEsperado: number, proximoPasso: number, ate: string, claimToken?: string): Promise<WorkflowExecucao | null>
  reivindicarRetomadaProspeccao?(id: string, geracao: number, passo: number, token: string): Promise<WorkflowExecucao | null>
  liberarRetomadaProspeccao?(id: string, token: string): Promise<void>
  reivindicarPublicacaoProspeccao?(id: string, geracao: number, token: string, checkpoint: string): Promise<boolean>
  confirmarPublicacaoProspeccao?(id: string, geracao: number, token: string): Promise<void>
  liberarPublicacaoProspeccao?(id: string, geracao: number, token: string): Promise<void>
  rearmarRetomadaProspeccao?(id: string, geracao: number): Promise<WorkflowExecucao | null>
  listarRetomadasProspeccao?(depois: string | null, limite: number): Promise<WorkflowExecucao[]>
  // Recupera a execução não cancelada que sustenta a idempotência do
  // enrollment. Além de evitar duplicidade, permite reagendar com segurança
  // uma campanha cuja publicação na fila tenha sido interrompida.
  buscarExecucaoParaLead(workflowId: string, leadId: string): Promise<WorkflowExecucao | null>
  // Idempotência de processos recorrentes: considera QUALQUER status, inclusive
  // cancelado por resposta, porque o mesmo ciclo nunca deve ser reinscrito.
  buscarExecucaoParaCiclo(workflowId: string, leadId: string, cicloChave: string): Promise<WorkflowExecucao | null>
  // Já existe alguma execução (qualquer status) deste workflow para o lead?
  // Base da idempotência de enrollment (não inscrever o mesmo lead 2x).
  existeExecucaoParaLead(workflowId: string, leadId: string): Promise<boolean>
  // Execuções que o poll deve tocar AGORA: em_andamento, ou aguardando com
  // proxima_verificacao_em <= agora (espera vencida). Ordenadas por antiguidade.
  execucoesPendentes(agoraISO: string): Promise<WorkflowExecucao[]>
  // 1ª ação (passo_atual=0, agendamento_geracao=0) de uma campanha que ficou
  // 'aguardando' sem avançar além do limiar — indício de falha na ENTREGA da
  // fila de disparo (não de erro de execução, que já vira status='erro').
  // A exclusão de prospecção (que tem reconciliação própria e durável) é feita
  // pelo chamador via ambiente.buscarControleExecucaoCampanha, não aqui.
  execucoesCampanhaTravadas?(limiteEm: string): Promise<WorkflowExecucao[]>
  // Workflows publicados (status='publicado') — candidatos a enrollment.
  workflowsPublicados(): Promise<Workflow[]>
  // Contagem de execuções ATIVAS (em_andamento|aguardando) por workflow_id — a
  // lista usa para "N leads em execução" sem puxar todas as linhas.
  contarExecucoesAtivasPorWorkflow(): Promise<Record<string, number>>

  // --- eventos (log append-only) ---
  registrarEvento(evento: WorkflowExecucaoEvento): Promise<void>
  listarEventos(execucaoId: string): Promise<WorkflowExecucaoEvento[]>
}
