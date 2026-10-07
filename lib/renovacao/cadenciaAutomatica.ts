import type { SupabaseClient } from '@supabase/supabase-js'
import {
  SupabaseWorkflowStore,
  inscreverLeadManual,
} from '@/lib/workflows'
import { agendarExecucoesCampanha } from '@/lib/campanhas/filaDisparoServidor'
import { agendaPermiteProcessar, janelaDoPublico } from '@/lib/campanhas/agenda'
import { buscarPreviaPublicoCampanha } from '@/lib/campanhas/publicoServidor'
import { aplicarRegraPublicoPorTipo } from '@/lib/campanhas/configuracaoGuiada'
import type { Publico } from '@/components/automacao/tiposCampanha'

interface CampanhaRenovacaoAtiva {
  id: string
  workflow_id: string
  diasSemana: unknown
  limiteDiario: number
  publico: Publico
}

export interface EntradaCadenciaRenovacao {
  leadId: string
  empresaId: string | null
  servicoId: string | null
  vencimento: string
}

export interface ResultadoEntradaCadencia {
  jaInscrito: boolean
  execucaoId: string
  precisaAgendar: boolean
}

export function chaveCicloRenovacao(entrada: Pick<EntradaCadenciaRenovacao, 'empresaId' | 'leadId' | 'vencimento'>): string {
  const entidade = entrada.empresaId ? `empresa:${entrada.empresaId}` : `lead:${entrada.leadId}`
  // Uma única conversa por empresa em cada competência evita que dois laudos
  // vencendo no mesmo mês gerem e-mails paralelos para o mesmo contato.
  return `${entidade}:${entrada.vencimento.slice(0, 7)}`
}

async function buscarCampanhaAtiva(
  admin: SupabaseClient,
  org: string,
): Promise<CampanhaRenovacaoAtiva | null> {
  const { data, error } = await admin
    .from('campanhas')
    .select('id, workflow_id, publico')
    .eq('organizacao_id', org)
    .eq('tipo', 'renovacao')
    .eq('status', 'ativa')
    .eq('dry_run', false)
    .not('workflow_id', 'is', null)
    .order('iniciada_em', { ascending: false })
    .limit(2)
  if (error) throw error
  if (!data?.length) return null
  if (data.length > 1) {
    throw new Error('Há mais de uma automação real de renovação ativa. Pause uma delas para evitar contatos duplicados.')
  }
  const publico = data[0].publico && typeof data[0].publico === 'object' && !Array.isArray(data[0].publico)
    ? data[0].publico as Record<string, unknown>
    : null
  const agenda = publico?.agenda && typeof publico.agenda === 'object' && !Array.isArray(publico.agenda)
    ? publico.agenda as Record<string, unknown>
    : null
  return {
    id: data[0].id as string,
    workflow_id: data[0].workflow_id as string,
    diasSemana: agenda?.diasSemana,
    limiteDiario: typeof agenda?.limiteDiario === 'number' && Number.isFinite(agenda.limiteDiario) && agenda.limiteDiario > 0
      ? Math.floor(agenda.limiteDiario)
      : 40,
    publico: (publico ?? {}) as Publico,
  }
}

export class CadenciaRenovacaoAutomatica {
  private readonly store: SupabaseWorkflowStore

  private constructor(
    admin: SupabaseClient,
    private readonly org: string,
    private readonly campanha: CampanhaRenovacaoAtiva,
    private readonly leadsElegiveis: Set<string>,
  ) {
    this.store = new SupabaseWorkflowStore(org, admin)
  }

  get limitePorLote(): number {
    return this.campanha.limiteDiario
  }

  static async preparar(admin: SupabaseClient, org: string): Promise<CadenciaRenovacaoAutomatica | null> {
    // Trava global de emergência preservada além das travas por workspace
    // (campanha ativa + dry_run=false) e do MODO_ENSAIO no provedor.
    if (process.env.RENOVACAO_ENVIO_REAL !== 'true') {
      throw new Error('O envio automático de renovação está bloqueado pela trava global de segurança.')
    }
    const campanha = await buscarCampanhaAtiva(admin, org)
    if (!campanha) return null
    const store = new SupabaseWorkflowStore(org, admin)
    const workflow = await store.buscarWorkflow(campanha.workflow_id)
    if (!workflow || workflow.status !== 'publicado' || !workflow.versao_atual_id) {
      throw new Error('A automação de renovação ativa não possui um workflow publicado.')
    }
    const previa = await buscarPreviaPublicoCampanha(
      admin,
      org,
      aplicarRegraPublicoPorTipo(campanha.publico, 'renovacao'),
      campanha.workflow_id,
    )
    return new CadenciaRenovacaoAutomatica(admin, org, campanha, new Set(previa.idsElegiveis))
  }

  aceitaLead(leadId: string): boolean {
    return this.leadsElegiveis.has(leadId)
  }

  async inscrever(entrada: EntradaCadenciaRenovacao): Promise<ResultadoEntradaCadencia> {
    const cicloChave = chaveCicloRenovacao(entrada)
    const inscricao = await inscreverLeadManual(
      this.store,
      this.campanha.workflow_id,
      entrada.leadId,
      this.campanha.id,
      { cicloChave, servicoId: entrada.servicoId },
    )
    if (!inscricao.execucaoId) throw new Error('A execução da renovação não pôde ser localizada.')

    const execucao = await this.store.buscarExecucao(inscricao.execucaoId)
    return {
      jaInscrito: inscricao.jaInscrito,
      execucaoId: inscricao.execucaoId,
      precisaAgendar: !inscricao.jaInscrito || execucao?.status === 'erro' || execucao?.status === 'em_andamento',
    }
  }

  async agendar(execucaoIds: string[], agoraISO = new Date().toISOString()) {
    if (!agendaPermiteProcessar(this.campanha.diasSemana, agoraISO)) {
      return {
        agendadas: 0,
        ignoradas: 0,
        primeiraExecucaoEm: null,
        ultimaExecucaoEm: null,
      }
    }
    return agendarExecucoesCampanha(
      this.store,
      this.org,
      this.campanha.id,
      execucaoIds.slice(0, this.campanha.limiteDiario),
      { janela: janelaDoPublico(this.campanha.publico) },
    )
  }
}

export async function alertarConfiguracaoRenovacao(
  admin: SupabaseClient,
  org: string,
  mensagem: string,
): Promise<void> {
  const motivo = 'Configuração da renovação automática'
  const { data, error: buscaError } = await admin
    .from('notificacoes')
    .select('id')
    .eq('organizacao_id', org)
    .eq('origem', 'renovacao')
    .eq('motivo', motivo)
    .eq('lida', false)
    .limit(1)
  if (buscaError) throw buscaError
  if (data?.length) return
  const { error } = await admin.from('notificacoes').insert({
    organizacao_id: org,
    canal: 'app',
    titulo: 'Configure a renovação automática',
    mensagem: mensagem.slice(0, 500),
    origem: 'renovacao',
    motivo,
    link: '/campanhas',
  })
  if (error) throw error
}
