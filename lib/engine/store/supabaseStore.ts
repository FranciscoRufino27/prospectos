// Implementação real do Store sobre o Supabase, usando o client de service role
// (lib/supabase-admin.ts). Mapeia para as tabelas reais `leads`, `interacoes`,
// `usuarios`, `templates`. A trava owner='engine' é aplicada em TODA leitura de
// lote.
//
// MULTI-TENANT (migration 0006): este Store é PRESO a uma organização, passada
// no construtor. TODA leitura filtra e TODA escrita grava `organizacao_id`.
// Como o client é service_role (bypassa RLS), esse filtro explícito é o que
// garante o isolamento neste caminho — não é redundância, é obrigatório.
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getEngineConfig, OWNER_ENGINE } from '../config'
import { log } from '../logger'
import { ESTAGIOS_EM_CADENCIA, dominioDoLead } from '../templates'
import { canaisRetornoCampanha } from '@/lib/campanhas/configuracaoGuiada'
import type { ContextoCampanhaResposta, Lead, NovaInteracao, TipoInteracaoEngine, UsuarioBasico } from '../types'
import type { Store, TemplateEmail } from './store'

export class SupabaseStore implements Store {
  readonly organizacaoId: string
  private db: SupabaseClient

  constructor(organizacaoId: string, client?: SupabaseClient) {
    this.organizacaoId = organizacaoId
    this.db = client ?? createSupabaseAdminClient()
  }

  async buscarLead(id: string): Promise<Lead | null> {
    const { data, error } = await this.db
      .from('leads')
      .select('*')
      .eq('id', id)
      .eq('organizacao_id', this.organizacaoId)
      .maybeSingle()
    if (error) throw error
    return (data as Lead) ?? null
  }

  async buscarLeadPorEmail(email: string): Promise<Lead | null> {
    const { data, error } = await this.db
      .from('leads')
      .select('*')
      .eq('organizacao_id', this.organizacaoId)
      .eq('owner', OWNER_ENGINE)
      .ilike('contato_email', email.trim())
      .limit(1)
    if (error) throw error
    return (data?.[0] as Lead) ?? null
  }

  async buscarLeadPorDominio(dominio: string): Promise<Lead | null> {
    const d = dominio.trim().toLowerCase()
    if (!d) return null
    // 1) coluna dominio explícita
    const porColuna = await this.db
      .from('leads')
      .select('*')
      .eq('organizacao_id', this.organizacaoId)
      .eq('owner', OWNER_ENGINE)
      .ilike('dominio', d)
      .limit(1)
    if (porColuna.error) throw porColuna.error
    if (porColuna.data?.[0]) return porColuna.data[0] as Lead
    // 2) fallback: domínio derivado do contato_email
    const porEmail = await this.db
      .from('leads')
      .select('*')
      .eq('organizacao_id', this.organizacaoId)
      .eq('owner', OWNER_ENGINE)
      .ilike('contato_email', `%@${d}`)
      .limit(1)
    if (porEmail.error) throw porEmail.error
    const lead = (porEmail.data?.[0] as Lead) ?? null
    // Garante que o domínio derivado é realmente de empresa (não gmail etc).
    if (lead && dominioDoLead(lead) === d) return lead
    return null
  }

  async atualizarLead(id: string, patch: Partial<Lead>): Promise<void> {
    const { error } = await this.db
      .from('leads')
      .update(patch)
      .eq('id', id)
      .eq('organizacao_id', this.organizacaoId)
    if (error) throw error
  }

  async registrarInteracao(i: NovaInteracao): Promise<void> {
    const registradaEm = new Date().toISOString()
    const { error } = await this.db.from('interacoes').insert({
      lead_id: i.lead_id,
      tipo: i.tipo,
      canal: i.canal,
      descricao: i.descricao,
      origem_acao: i.origem_acao,
      responsavel_id: i.responsavel_id ?? null,
      template_id: i.template_id ?? null,
      organizacao_id: this.organizacaoId,
    })
    if (error) throw error
    if (i.canal === 'email') {
      const { error: leadError } = await this.db
        .from('leads')
        .update({ ultimo_contato: registradaEm })
        .eq('id', i.lead_id)
        .eq('organizacao_id', this.organizacaoId)
      // O e-mail e a interação já foram persistidos. Não propague esta falha:
      // o executor poderia repetir uma mensagem externa que já foi enviada.
      // A interface ainda consegue derivar o horário pelo histórico auditável.
      if (leadError) {
        log.aviso('Interação registrada, mas não foi possível sincronizar o último contato.', {
          organizacaoId: this.organizacaoId,
          leadId: i.lead_id,
        })
      }
    }
  }

  async contarInteracoes(leadId: string, tipo: TipoInteracaoEngine): Promise<number> {
    const { count, error } = await this.db
      .from('interacoes')
      .select('id', { count: 'exact', head: true })
      .eq('organizacao_id', this.organizacaoId)
      .eq('lead_id', leadId)
      .eq('tipo', tipo)
      .eq('origem_acao', 'ia')
    if (error) throw error
    return count ?? 0
  }

  async contarInteracoesDesde(leadId: string, tipo: TipoInteracaoEngine, desdeISO: string): Promise<number> {
    const { count, error } = await this.db
      .from('interacoes')
      .select('id', { count: 'exact', head: true })
      .eq('organizacao_id', this.organizacaoId)
      .eq('lead_id', leadId)
      .eq('tipo', tipo)
      .eq('origem_acao', 'ia')
      .gte('created_at', desdeISO)
    if (error) throw error
    return count ?? 0
  }

  async enviosHoje(): Promise<number> {
    const inicioDia = new Date()
    inicioDia.setHours(0, 0, 0, 0)
    const { count, error } = await this.db
      .from('interacoes')
      .select('id', { count: 'exact', head: true })
      .eq('organizacao_id', this.organizacaoId)
      .in('tipo', ['abordagem', 'follow_up'])
      .eq('origem_acao', 'ia')
      .gte('created_at', inicioDia.toISOString())
    if (error) throw error
    return count ?? 0
  }

  // Um lead está em UMA cadência: quem tem execução de workflow ativa
  // (campanha, renovação, follow-up de retorno do handoff — Fase 4) fica fora da
  // esteira legada, senão os dois motores enviariam. Também impede o legado de
  // "esgotar" (sem_resposta) um lead que o workflow ainda está trabalhando.
  private async semExecucaoAtiva(leads: Lead[]): Promise<Lead[]> {
    if (leads.length === 0) return leads
    const { data, error } = await this.db
      .from('workflow_execucoes')
      .select('lead_id')
      .eq('organizacao_id', this.organizacaoId)
      .in('status', ['em_andamento', 'aguardando'])
      .in('lead_id', leads.map((l) => l.id))
    if (error) throw error
    const ocupados = new Set((data ?? []).map((e) => e.lead_id as string))
    return ocupados.size === 0 ? leads : leads.filter((l) => !ocupados.has(l.id))
  }

  async leadsParaFollowup(): Promise<Lead[]> {
    const cfg = await getEngineConfig(this.organizacaoId)
    const agora = Date.now()
    const intervaloMs = cfg.horasEntreFollowups * 3600_000
    const { data, error } = await this.db
      .from('leads')
      .select('*')
      .eq('organizacao_id', this.organizacaoId)
      .eq('owner', OWNER_ENGINE)
      .eq('perdido', false)
      // Opt-out (item 2.4): quem pediu p/ sair nunca mais é contatado pelo motor.
      .eq('optout', false)
      // Bounce (migration 0027): email inválido/devolvido — nunca mais contatado.
      .eq('bounced', false)
      .in('estagio', ESTAGIOS_EM_CADENCIA)
    if (error) throw error

    const candidatos = await this.semExecucaoAtiva((data as Lead[]) ?? [])
    const elegiveis: Lead[] = []
    for (const lead of candidatos) {
      // Trava de máximo de follow-ups.
      const enviados = await this.contarInteracoes(lead.id, 'follow_up')
      if (enviados >= cfg.maxFollowups) continue
      // Gate de tempo: proxima_acao_data se houver, senão ultimo_contato+intervalo.
      if (lead.proxima_acao_data) {
        if (new Date(lead.proxima_acao_data).getTime() > agora) continue
      } else if (lead.ultimo_contato) {
        if (new Date(lead.ultimo_contato).getTime() + intervaloMs > agora) continue
      }
      elegiveis.push(lead)
    }
    return elegiveis
  }

  async leadsEsgotadosSemResposta(): Promise<Lead[]> {
    const cfg = await getEngineConfig(this.organizacaoId)
    const agora = Date.now()
    const intervaloMs = cfg.horasEntreFollowups * 3600_000
    const { data, error } = await this.db
      .from('leads')
      .select('*')
      .eq('organizacao_id', this.organizacaoId)
      .eq('owner', OWNER_ENGINE)
      .eq('perdido', false)
      .eq('bounced', false)
      .in('estagio', ESTAGIOS_EM_CADENCIA)
    if (error) throw error

    const candidatos = await this.semExecucaoAtiva((data as Lead[]) ?? [])
    const esgotados: Lead[] = []
    for (const lead of candidatos) {
      // Só os que ESGOTARAM os follow-ups.
      const enviados = await this.contarInteracoes(lead.id, 'follow_up')
      if (enviados < cfg.maxFollowups) continue
      // E cujo tempo de espera do último follow-up já passou.
      let venceu = false
      if (lead.proxima_acao_data) venceu = new Date(lead.proxima_acao_data).getTime() <= agora
      else if (lead.ultimo_contato) venceu = new Date(lead.ultimo_contato).getTime() + intervaloMs <= agora
      if (!venceu) continue
      esgotados.push(lead)
    }
    return esgotados
  }

  async buscarUsuario(id: string): Promise<UsuarioBasico | null> {
    const { data, error } = await this.db
      .from('usuarios')
      .select('id, nome, email')
      .eq('id', id)
      .eq('organizacao_id', this.organizacaoId)
      .maybeSingle()
    if (error) throw error
    return (data as UsuarioBasico) ?? null
  }

  async buscarResponsavelCampanhaAtiva(leadId: string): Promise<UsuarioBasico | null> {
    return (await this.buscarContextoCampanhaAtiva(leadId))?.responsavel ?? null
  }

  async buscarContextoCampanhaAtiva(leadId: string): Promise<ContextoCampanhaResposta | null> {
    const { data: execucao, error: execError } = await this.db
      .from('workflow_execucoes')
      .select('id, campanha_id, iniciado_em, status, ciclo_chave')
      .eq('organizacao_id', this.organizacaoId)
      .eq('lead_id', leadId)
      // Inclui concluídas/canceladas: a execução termina ou é pausada antes que
      // o contato responda, mas o contexto/responsável continua sendo o da
      // campanha que originou a conversa.
      .in('status', ['em_andamento', 'aguardando', 'concluido', 'cancelado'])
      .not('campanha_id', 'is', null)
      .order('iniciado_em', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (execError) throw execError
    const campanhaId = (execucao as { campanha_id?: string | null } | null)?.campanha_id
    if (!campanhaId) return null

    const { data: campanha, error: campanhaError } = await this.db
      .from('campanhas')
      .select('id, nome, tipo, publico')
      .eq('organizacao_id', this.organizacaoId)
      .eq('id', campanhaId)
      .in('status', ['ativa', 'pausada', 'concluida'])
      .maybeSingle()
    if (campanhaError) throw campanhaError
    if (!campanha) return null
    const campanhaRow = campanha as { id: string; nome: string; tipo: string | null; publico?: Record<string, unknown> }
    const publico = campanhaRow.publico
    const responsavelId = typeof publico?.responsavel_id === 'string' ? publico.responsavel_id : null
    let responsavel: UsuarioBasico | null = null
    if (responsavelId) {
      const { data: perfil, error: perfilError } = await this.db
        .from('perfis')
        .select('id, nome')
        .eq('organizacao_id', this.organizacaoId)
        .eq('id', responsavelId)
        .maybeSingle()
      if (perfilError) throw perfilError
      if (perfil) {
        const { data: auth, error: authError } = await this.db.auth.admin.getUserById(responsavelId)
        if (authError) throw authError
        if (auth.user?.email) {
          responsavel = {
            id: responsavelId,
            nome: (perfil as { nome?: string | null }).nome?.trim() || auth.user.email,
            email: auth.user.email,
          }
        }
      }
    }
    const operacao = publico?.operacao && typeof publico.operacao === 'object'
      ? publico.operacao as Record<string, unknown>
      : {}
    const resposta = operacao.resposta && typeof operacao.resposta === 'object'
      ? operacao.resposta as Record<string, unknown>
      : {}
    const canaisRetorno = canaisRetornoCampanha(publico)
    return {
      id: campanhaRow.id,
      execucaoId: (execucao as { id?: string | null }).id ?? null,
      iniciadoEm: (execucao as { iniciado_em?: string | null }).iniciado_em ?? null,
      execucaoStatus: (execucao as { status?: string | null }).status ?? null,
      cicloChave: (execucao as { ciclo_chave?: string | null }).ciclo_chave ?? null,
      nome: campanhaRow.nome,
      tipo: campanhaRow.tipo,
      responsavel,
      // Só o valor explícito 'lead' inverte a precedência; campanha antiga (sem
      // o campo) continua encaminhando para o responsável fixo.
      retornoParaResponsavelDoLead: publico?.retornoPara === 'lead',
      canaisRetorno,
      // "Somente WhatsApp" desliga o e-mail de retorno mesmo que o flag antigo
      // tenha ficado gravado como true.
      notificarResponsavel: resposta.notificarResponsavel !== false && canaisRetorno !== 'whatsapp',
      emailAssunto: typeof resposta.emailAssunto === 'string' ? resposta.emailAssunto : null,
      emailCorpo: typeof resposta.emailCorpo === 'string' ? resposta.emailCorpo : null,
      emailHtml: typeof resposta.emailHtml === 'string' ? resposta.emailHtml : null,
    }
  }

  // Insert com unique (organizacao_id, mensagem_id): quem conseguir inserir
  // processa; os demais recebem conflito e pulam. Em caso de erro do banco
  // devolvemos true — perder uma resposta real é pior que reprocessar.
  async reivindicarMensagem(mensagemId: string, resultado?: string, leadId?: string | null): Promise<boolean> {
    if (!mensagemId) return true
    const { data, error } = await this.db
      .from('mensagens_processadas')
      .upsert(
        {
          organizacao_id: this.organizacaoId,
          mensagem_id: mensagemId,
          resultado: resultado ?? null,
          lead_id: leadId ?? null,
        },
        { onConflict: 'organizacao_id,mensagem_id', ignoreDuplicates: true },
      )
      .select('id')
    if (error) {
      log.aviso('Não consegui registrar a mensagem processada; seguindo sem dedup.', {
        mensagemId,
        erro: error.message,
      })
      return true
    }
    return (data?.length ?? 0) > 0
  }

  async liberarMensagem(mensagemId: string): Promise<void> {
    if (!mensagemId) return
    const { error } = await this.db
      .from('mensagens_processadas')
      .delete()
      .eq('organizacao_id', this.organizacaoId)
      .eq('mensagem_id', mensagemId)
    if (error) log.aviso('Falha ao liberar a mensagem para reprocessamento.', { mensagemId, erro: error.message })
  }

  async cancelarExecucoesWorkflow(leadId: string): Promise<void> {
    // Cancela todas as execuções ativas (em_andamento/aguardando) do lead.
    // Chamado quando um bounce SMTP ou uma resposta real é detectada.
    const { error } = await this.db
      .from('workflow_execucoes')
      .update({ status: 'cancelado' })
      .eq('organizacao_id', this.organizacaoId)
      .eq('lead_id', leadId)
      .in('status', ['em_andamento', 'aguardando'])
    if (error) throw error
  }

  async buscarTemplateEmail(nicho: string | null, tipo: string): Promise<TemplateEmail[]> {
    // TODAS as variantes ativas (A/B, item 6). Ordena por created_at p/ a seleção
    // por índice (mensagem.ts escolhe uma por lead) ser estável.
    let q = this.db
      .from('templates')
      .select('id, assunto, corpo, html, organizacao_id')
      .eq('organizacao_id', this.organizacaoId)
      .eq('canal', 'email')
      .eq('tipo', tipo)
      .eq('ativo', true)
      .order('created_at', { ascending: true })
    q = nicho === null ? q.is('nicho', null) : q.eq('nicho', nicho)
    const { data, error } = await q
    if (error) throw error
    return (data ?? []) as TemplateEmail[]
  }
}
