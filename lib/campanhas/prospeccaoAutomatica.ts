// Auto-captura de PROSPECÇÃO (entrega "bloco funcional Prospecção +
// Follow-up"). Espelha DELIBERADAMENTE a forma de lib/renovacao/cadenciaAutomatica.ts
// + lib/renovacao/processar.ts — mesmo padrão já comprovado em produção para
// renovação —, mas é um módulo TOTALMENTE independente: nada aqui é
// importado por, nem importa de, lib/renovacao/**. Isso é intencional: esta
// entrega não pode alterar o comportamento de Renovação/Laudos, então em vez
// de extrair um helper compartilhado (que exigiria tocar no arquivo de
// renovação), a pequena duplicação abaixo fica isolada neste arquivo.
//
// O que faz, a cada tick do cron (chamado por /api/workflows/processar):
//   1) Encontra a ÚNICA campanha REAL (dry_run=false, status='ativa') do tipo
//      'prospeccao' da organização (mesma invariante de segurança da
//      renovação: mais de uma automação real ativa é erro de configuração).
//   2) Reusa buscarPreviaPublicoCampanha (mesma elegibilidade da tela/alerta
//      manual: estagio em ['novo','novos_leads'], sem optout/bounce/perdido,
//      sem execução ativa em OUTRO workflow) para achar leads elegíveis —
//      a origem do lead (owner 'n8n' ou 'engine') NÃO entra no filtro, por
//      pedido explícito desta entrega.
//   3) Inscreve cada lead elegível (idempotente: inscreverLeadManual nunca
//      duplica execução para o mesmo par workflow+lead) e agenda o primeiro
//      disparo pela mesma fila espaçada da ativação manual.
//   4) Encerra (estagio='sem_resposta') leads cuja cadência de prospecção
//      concluiu sem resposta — fecha a janela em que o motor legado
//      (lib/engine) poderia voltar a tratá-los (ver `encerrarProspeccaoSemResposta`).
//
// Trava global: PROSPECCAO_ENVIO_REAL=true (default: desligado). Camada
// adicional às travas por workspace (campanha ativa + dry_run=false) e ao
// MODO_ENSAIO do provider — mesmo desenho da renovação
// (RENOVACAO_ENVIO_REAL), para que ligar isto em produção seja uma decisão
// explícita e não um efeito colateral do deploy desta entrega.
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import {
  SupabaseWorkflowStore,
  inscreverLeadManual,
} from '@/lib/workflows'
import { agendarExecucoesCampanha } from './filaDisparoServidor'
import { agendaPermiteProcessar, janelaDoPublico } from './agenda'
import { buscarPreviaPublicoCampanha } from './publicoServidor'
import { aplicarRegraPublicoPorTipo } from './configuracaoGuiada'
import type { Publico } from '@/components/automacao/tiposCampanha'
import { ESTAGIOS_EM_CADENCIA } from '@/lib/engine/templates'
import { log } from '@/lib/engine/logger'

// Marca TODA execução criada pela auto-captura (CadenciaProspeccaoAutomatica)
// como pertencente ao NOVO fluxo automático — critério que
// encerrarProspeccaoSemResposta usa para nunca tocar em execuções
// históricas/manuais (inscritas por lib/campanhas/ativacaoServidor.ts, que não
// passa cicloChave, deixando a coluna workflow_execucoes.ciclo_chave nula).
// Constante (não por ciclo/competência, ao contrário da renovação): cada lead
// passa pela prospecção UMA vez só, então uma chave fixa já garante
// idempotência via buscarExecucaoParaCiclo (workflow_id + lead_id + esta
// chave é única — migration 0028).
export const CICLO_PROSPECCAO_AUTOMATICA = 'prospeccao_automatica'

interface CampanhaProspeccaoAtiva {
  id: string
  workflow_id: string
  diasSemana: unknown
  limiteDiario: number
  publico: Publico
}

async function buscarCampanhaAtivaProspeccao(
  admin: SupabaseClient,
  org: string,
): Promise<CampanhaProspeccaoAtiva | null> {
  const { data, error } = await admin
    .from('campanhas')
    .select('id, workflow_id, publico')
    .eq('organizacao_id', org)
    .eq('tipo', 'prospeccao')
    .eq('status', 'ativa')
    .eq('dry_run', false)
    .not('workflow_id', 'is', null)
    .order('iniciada_em', { ascending: false })
    .limit(2)
  if (error) throw error
  if (!data?.length) return null
  if (data.length > 1) {
    throw new Error('Há mais de uma automação real de prospecção ativa. Pause uma delas para evitar contatos duplicados.')
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

export class CadenciaProspeccaoAutomatica {
  private readonly store: SupabaseWorkflowStore

  private constructor(
    admin: SupabaseClient,
    private readonly org: string,
    private readonly campanha: CampanhaProspeccaoAtiva,
    private readonly leadsElegiveisSet: Set<string>,
  ) {
    this.store = new SupabaseWorkflowStore(org, admin)
  }

  get campanhaId(): string {
    return this.campanha.id
  }

  leadsElegiveis(): string[] {
    return [...this.leadsElegiveisSet]
  }

  static async preparar(admin: SupabaseClient, org: string): Promise<CadenciaProspeccaoAutomatica | null> {
    // Trava global de emergência, além das travas por workspace (campanha
    // ativa + dry_run=false) e do MODO_ENSAIO no provedor de e-mail.
    if (process.env.PROSPECCAO_ENVIO_REAL !== 'true') {
      throw new Error('A auto-captura de prospecção está bloqueada pela trava global de segurança (PROSPECCAO_ENVIO_REAL).')
    }
    const campanha = await buscarCampanhaAtivaProspeccao(admin, org)
    if (!campanha) return null
    const store = new SupabaseWorkflowStore(org, admin)
    const workflow = await store.buscarWorkflow(campanha.workflow_id)
    if (!workflow || workflow.status !== 'publicado' || !workflow.versao_atual_id) {
      throw new Error('A campanha de prospecção ativa não possui um workflow publicado.')
    }
    const previa = await buscarPreviaPublicoCampanha(
      admin,
      org,
      aplicarRegraPublicoPorTipo(campanha.publico, 'prospeccao'),
      campanha.workflow_id,
    )
    return new CadenciaProspeccaoAutomatica(admin, org, campanha, new Set(previa.idsElegiveis))
  }

  async inscrever(leadId: string): Promise<{ jaInscrito: boolean; execucaoId: string; precisaAgendar: boolean }> {
    // ciclo_chave é o que MARCA esta execução como pertencente ao NOVO fluxo
    // automático — ver CICLO_PROSPECCAO_AUTOMATICA logo abaixo. Sem isto, uma
    // execução criada aqui seria indistinguível de uma inscrita pelo wizard
    // manual (lib/campanhas/ativacaoServidor.ts::inscreverCampanhaReal, que
    // chama inscreverLeadManual SEM cicloChave, deixando a coluna nula).
    const inscricao = await inscreverLeadManual(
      this.store,
      this.campanha.workflow_id,
      leadId,
      this.campanha.id,
      { cicloChave: CICLO_PROSPECCAO_AUTOMATICA },
    )
    if (!inscricao.execucaoId) throw new Error('A execução de prospecção não pôde ser localizada.')
    const execucao = await this.store.buscarExecucao(inscricao.execucaoId)
    return {
      jaInscrito: inscricao.jaInscrito,
      execucaoId: inscricao.execucaoId,
      // Mesmo critério da renovação: agenda quando é inscrição nova, ou
      // quando uma execução anterior ficou parada em erro/em_andamento sem
      // nunca ter sido agendada.
      precisaAgendar: !inscricao.jaInscrito || execucao?.status === 'erro' || execucao?.status === 'em_andamento',
    }
  }

  async agendar(execucaoIds: string[], agoraISO: string = new Date().toISOString()) {
    if (!agendaPermiteProcessar(this.campanha.diasSemana, agoraISO)) {
      return { agendadas: 0, ignoradas: 0, primeiraExecucaoEm: null, ultimaExecucaoEm: null }
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

// Encerra (estagio='sem_resposta') leads cuja cadência de prospecção JÁ
// CONCLUIU (todas as ações do workflow rodaram) sem que o lead tenha
// respondido. Sem isto, o lead ficaria parado em 'follow_up'/'primeiro_contato'
// indefinidamente e, quando a execução deixa de estar ativa, o motor LEGADO
// (lib/engine, leadsParaFollowup) voltaria a enxergá-lo como elegível e
// mandaria uma sequência paralela de follow-ups com templates diferentes —
// exatamente a duplicidade que esta entrega precisa fechar.
//
// ATUA SOMENTE sobre execuções do NOVO fluxo automático — marcadas com
// ciclo_chave=CICLO_PROSPECCAO_AUTOMATICA por CadenciaProspeccaoAutomatica.inscrever.
// Execuções históricas/manuais (inscritas pelo wizard, lib/campanhas/ativacaoServidor.ts)
// têm ciclo_chave NULO e NUNCA são tocadas aqui, mesmo que pertençam a uma
// campanha tipo='prospeccao' já concluída — não é limpeza de histórico, é
// housekeeping estrito do que esta entrega passou a criar. Não depende de
// PROSPECCAO_ENVIO_REAL e não envia nada: só transiciona estado e registra uma
// nota, mesma semântica do lib/engine/flows/followUp.ts::leadsEsgotadosSemResposta.
export async function encerrarProspeccaoSemResposta(
  admin: SupabaseClient,
  org: string,
): Promise<{ encerrados: number }> {
  const { data: campanhas, error: campanhasErro } = await admin
    .from('campanhas')
    .select('id')
    .eq('organizacao_id', org)
    .eq('tipo', 'prospeccao')
  if (campanhasErro) throw campanhasErro
  const campanhaIds = (campanhas ?? []).map((c) => c.id as string)
  if (!campanhaIds.length) return { encerrados: 0 }

  const { data: execucoes, error: execucoesErro } = await admin
    .from('workflow_execucoes')
    .select('lead_id')
    .eq('organizacao_id', org)
    .eq('status', 'concluido')
    .eq('ciclo_chave', CICLO_PROSPECCAO_AUTOMATICA) // critério que exclui histórico/manual
    .in('campanha_id', campanhaIds)
  if (execucoesErro) throw execucoesErro
  const leadIds = [...new Set((execucoes ?? []).map((e) => e.lead_id as string).filter(Boolean))]
  if (!leadIds.length) return { encerrados: 0 }

  const { data: leads, error: leadsErro } = await admin
    .from('leads')
    .select('id')
    .eq('organizacao_id', org)
    .in('id', leadIds)
    .in('estagio', ESTAGIOS_EM_CADENCIA)
  if (leadsErro) throw leadsErro
  const alvos = (leads ?? []).map((l) => l.id as string)
  if (!alvos.length) return { encerrados: 0 }

  const { error: updateErro } = await admin
    .from('leads')
    .update({ estagio: 'sem_resposta', proxima_acao: null, proxima_acao_data: null })
    .eq('organizacao_id', org)
    .in('id', alvos)
  if (updateErro) throw updateErro

  const { error: notaErro } = await admin.from('interacoes').insert(alvos.map((leadId) => ({
    organizacao_id: org,
    lead_id: leadId,
    tipo: 'nota',
    canal: 'sistema',
    descricao: "Cadência de prospecção concluída sem resposta. Movido para 'sem_resposta'.",
    origem_acao: 'ia',
  })))
  if (notaErro) throw notaErro

  return { encerrados: alvos.length }
}

export interface ResultadoProspeccaoAutomatica {
  automacaoConfigurada: boolean
  inscritos: number
  jaInscritos: number
  falhas: number
  encerradosSemResposta: number
}

export async function processarProspeccaoAutomatica(
  org: string,
  opts: { client?: SupabaseClient } = {},
): Promise<ResultadoProspeccaoAutomatica> {
  const admin = opts.client ?? createSupabaseAdminClient()

  let cadencia: CadenciaProspeccaoAutomatica | null = null
  try {
    cadencia = await CadenciaProspeccaoAutomatica.preparar(admin, org)
  } catch (error) {
    // Trava desligada ou configuração inválida (0 ou >1 campanha real ativa,
    // workflow não publicado): estado seguro é NÃO capturar — não interrompe
    // o encerramento dos leads já concluídos, abaixo.
    log.info('Auto-captura de prospecção inativa nesta organização.', {
      organizacaoId: org,
      motivo: error instanceof Error ? error.message : String(error),
    })
  }

  let inscritos = 0
  let jaInscritos = 0
  let falhas = 0
  if (cadencia) {
    const execucoesParaAgendar: string[] = []
    for (const leadId of cadencia.leadsElegiveis()) {
      try {
        // Leads importados (owner='n8n') ficam fora do motor até serem
        // capturados por uma campanha real — mesma transição da ativação
        // manual (lib/campanhas/carteiraServidor.ts). A origem do lead não
        // afeta a elegibilidade (já resolvida por buscarPreviaPublicoCampanha);
        // isto só formaliza a entrada no motor.
        const { error: ownerErro } = await admin
          .from('leads')
          .update({ owner: 'engine' })
          .eq('organizacao_id', org)
          .eq('id', leadId)
          .eq('owner', 'n8n')
        if (ownerErro) throw ownerErro

        const resultado = await cadencia.inscrever(leadId)
        if (resultado.jaInscrito) jaInscritos++
        else inscritos++
        if (resultado.precisaAgendar) execucoesParaAgendar.push(resultado.execucaoId)
      } catch (error) {
        falhas++
        log.aviso('Falha ao inscrever lead na auto-captura de prospecção.', {
          organizacaoId: org,
          leadId,
          erro: error instanceof Error ? error.message : String(error),
        })
      }
    }
    if (execucoesParaAgendar.length) {
      try {
        await cadencia.agendar(execucoesParaAgendar)
      } catch (error) {
        falhas += execucoesParaAgendar.length
        log.aviso('Falha ao agendar o disparo da auto-captura de prospecção.', {
          organizacaoId: org,
          erro: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  const { encerrados } = await encerrarProspeccaoSemResposta(admin, org)

  return {
    automacaoConfigurada: !!cadencia,
    inscritos,
    jaInscritos,
    falhas,
    encerradosSemResposta: encerrados,
  }
}
