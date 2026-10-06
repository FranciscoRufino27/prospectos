// Ambiente do motor de workflows: os efeitos colaterais REAIS que os blocos
// disparam, atrás de uma interface — para o executor ser testável com um
// ambiente falso (ver __tests__/executor.test.ts).
//
// A implementação real REAPROVEITA o motor de cadência (não reescreve): mesmo
// EmailProvider (GmailProvider gated por MODO_ENSAIO) e mesmo Store de
// interações/leads. Assim "enviar mensagem por template" e "lead respondeu"
// usam exatamente a infra que já roda em produção.
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { criarMotorReal } from '@/lib/engine/scheduler'
import { normalizarNicho, preencher, indiceVariante } from '@/lib/engine/mensagem'
import { GmailProvider } from '@/lib/engine/email/gmailProvider'
import { situacaoRemetenteOrganizacao } from '@/lib/email/remetenteOrganizacao'
import { engineConfig } from '@/lib/engine/config'
import { log } from '@/lib/engine/logger'
import type { Motor } from '@/lib/engine'
import type { Lead } from '@/lib/engine/types'
import { montarEmailCampanhaHtml } from '@/lib/campanhas/emailCampanha'
import { responsavelRecebeCopiaDosEnvios } from '@/lib/campanhas/configuracaoGuiada'
import { enviarEmailCampanhaComCopia, escolherResponsavelCampanha } from '@/lib/campanhas/emailComCopiaServidor'
import { parseWorkspaceConfig } from '@/lib/config/workspaceConfig'
import {
  fraseValidadeRenovacao,
  resolverCcResponsavelRenovacao,
  saudacaoRenovacao,
} from '@/lib/renovacao/emailArtLaudos'
import { agendarMonitorRespostas } from '@/lib/engine/respostasAutomaticas'
import {
  buscarControleExecucaoCampanha,
  type ControleExecucaoCampanha,
} from '@/lib/campanhas/controleExecucaoServidor'
import { concluirDisparoUnicoSeFinalizado } from '@/lib/campanhas/conclusaoDisparoServidor'
import { efeitoEnvioProspeccao, leadBloqueadoParaEnvioProspeccao } from '@/lib/campanhas/prospeccaoEnvio'
import { avaliarOperador, type Operador } from './operadores'

export class ErroEnvioIncerto extends Error {}

// CICLO DE VIDA DA RESERVA DE ENVIO (só prospecção), em mensagens_processadas:
//
//   envio_reservado   → chave tomada, SMTP AINDA NÃO iniciado. Tem lease: uma
//                       reserva abandonada por processo morto volta a ser
//                       retomável depois de LEASE_RESERVA_ENVIO_MS.
//   envio_em_curso    → SMTP iniciado, resultado desconhecido. NUNCA é retomada
//                       automaticamente: pode ter sido entregue.
//   envio_confirmado  → SMTP aceitou e a reserva foi confirmada.
//   envio_incerto     → tentativa terminou ambígua (erro depois de iniciar, ou
//                       processo morto com o SMTP em voo). Exige conferência
//                       humana; jamais vira reenvio automático.
//   envio_confirmado_persistencia_pendente → e-mail saiu, histórico do lead não.
//
// O lease casa com o TTL do claim do workflow (10 min): quem ainda detém o
// passo não pode ter a reserva roubada, e quem morreu não trava o lead.
const LEASE_RESERVA_ENVIO_MS = 10 * 60_000

export interface AmbienteWorkflow {
  readonly organizacaoId: string
  // Em simulação (Fase 5), ações de saída não têm efeito real — só logam.
  readonly simular: boolean
  // Gate da campanha que originou uma execução. A leitura é sempre escopada à
  // organização do ambiente; campanha ausente/cross-tenant devolve null e não
  // pode liberar ações externas.
  buscarControleExecucaoCampanha(campanhaId: string): Promise<ControleExecucaoCampanha | null>
  // Comunicados de disparo único deixam de ficar ativos assim que todas as
  // execuções do público confirmado chegam a um estado terminal.
  sincronizarConclusaoCampanha(campanhaId: string): Promise<void>
  // Alerta operacional idempotente quando uma execução automática entra em
  // erro. Opcional nos ambientes falsos/legados; o ambiente real persiste no app.
  notificarFalhaExecucao?(execucao: { id: string; lead_id: string | null }, mensagem: string): Promise<void>
  // Gatilho 'campo_data_vence': leads cujo `campo` (data) vence em até `dias`.
  selecionarLeadsComCampoVencendo(campo: string, dias: number): Promise<string[]>
  // Gatilho 'campo_igual' (Fase 4.6): leads cujo `campo` satisfaz `operador` vs
  // `valor` (reaproveita avaliarOperador). Serve p/ "mudou de status" e "entrou
  // em etapa" (o enrollment idempotente dispara uma vez por lead/workflow).
  selecionarLeadsPorCampo(campo: string, operador: string, valor: unknown): Promise<string[]>
  // Gatilho 'sem_resposta_ha_dias' (Fase 4.6): leads que NUNCA tiveram interação
  // tipo='resposta' e cujo `campo` (data) é mais antigo que `dias` dias.
  selecionarLeadsSemRespostaHaDias(campo: string, dias: number): Promise<string[]>
  // Condição 'lead_respondeu': o lead já respondeu? (interação tipo='resposta',
  // gravada pelo detectarResposta do motor).
  leadRespondeu(leadId: string): Promise<boolean>
  // Condição genérica 'campo' (Fase 4.5): lê UM campo do lead (whitelist de
  // colunas reais da tabela `leads`). Devolve null se o lead/campo não existir.
  lerCampoLead(leadId: string, campo: string): Promise<unknown>
  // Ação 'enviar_email': monta pelo template e envia (gated por MODO_ENSAIO /
  // simular / campanhas.dry_run). Devolve o assunto para o log da execução.
  // campanhaId: se fornecido, verifica campanhas.dry_run antes do envio real
  // (gate independente do MODO_ENSAIO global — segurança por campanha).
  enviarEmailTemplate(leadId: string, templateTipo: string, campanhaId?: string | null, chaveEnvio?: string | null): Promise<{ enviado: boolean; assunto: string }>
  // Ação 'criar_tarefa'/'criar_tarefa_ligacao': registra a tarefa como interação
  // de sistema no lead, com responsável. Sem responsavelId → cai no responsável
  // do próprio lead (lead.responsavel_id).
  criarTarefa(leadId: string, titulo: string, responsavelId?: string | null, chave?: string | null): Promise<void>
  // Ação 'criar_oportunidade' (Fase 6): abre um deal em `oportunidades` a partir
  // do lead (empresa/responsável herdados). No-op em simulação. Liga o motor de
  // workflows às Oportunidades (Fase 5) sem tocar no fluxo de cadência do motor.
  criarOportunidade(leadId: string, dados: { titulo?: string; valor?: number | null }): Promise<void>
  // Ações 'atualizar_status'/'mover_pipeline'/'atribuir_responsavel' (Fase 4.5):
  // grava UM campo do lead (whitelist de ESCRITA). No-op em simulação.
  atualizarCampoLead(leadId: string, campo: string, valor: unknown): Promise<void>
  // Ação 'adicionar_campanha': inscreve o lead no workflow da campanha-alvo
  // (se a campanha existir, tiver workflow e o lead não estiver já inscrito).
  inscreverEmCampanha(leadId: string, campanhaId: string): Promise<void>
  // Gatilho 'lead_respondeu_gatilho': leads com interação tipo='resposta' nos últimos N dias.
  selecionarLeadsQueResponderamRecente(dentroDeNDias: number): Promise<string[]>
  // Gatilho 'nao_respondeu_em_dias': leads sem resposta inbound há N dias.
  selecionarLeadsSemRespostaInbound(diasSemResposta: number): Promise<string[]>
  // Gatilho 'status_mudou' / 'validade_laudo_venceu'.
  selecionarLeadsPorEstagio(estagio: string): Promise<string[]>
  selecionarLeadsComValidadeVencida(diasApos: number): Promise<string[]>
}

// Colunas de data que um gatilho pode observar. Whitelist: o `campo` vem da
// definição do workflow (input do usuário) e NÃO pode virar nome de coluna livre.
const CAMPOS_DATA_PERMITIDOS = new Set(['proxima_acao_data', 'ultimo_contato', 'created_at', 'data_validade'])

// Colunas REAIS de `leads` (lib/supabase.ts, tipo Lead) que a condição genérica
// pode ler. Whitelist porque `campo` vem da definição do workflow (input do
// usuário) e NÃO pode virar nome de coluna livre. Nota: são as colunas de
// `leads`, não os campos do tipo `Empresa` (esse é o modelo de mock-data/UI).
const CAMPOS_LEAD_PERMITIDOS = new Set([
  'estagio', 'segmento', 'score', 'responsavel_nome', 'responsavel_id',
  'cidade', 'estado', 'origem', 'faixa_funcionarios', 'canal_preferencial',
  'followups_enviados', 'perdido', 'ultimo_contato', 'proxima_acao_data', 'created_at',
  'data_validade',
])

// Colunas de `leads` que as AÇÕES podem gravar. Subconjunto do que faz sentido
// mutar por automação — nunca id/organizacao_id/timestamps de sistema.
const CAMPOS_LEAD_ESCRITA_PERMITIDOS = new Set([
  'estagio', 'perdido', 'perdido_motivo', 'responsavel_id', 'responsavel_nome',
  'proxima_acao', 'proxima_acao_data',
])

export class AmbienteSupabase implements AmbienteWorkflow {
  private motor: Motor
  private db: SupabaseClient
  constructor(
    public readonly organizacaoId: string,
    opts: { simular?: boolean; client?: SupabaseClient; motor?: Motor } = {},
  ) {
    this.simular = opts.simular ?? false
    this.db = opts.client ?? createSupabaseAdminClient()
    // Motor real da org: Store (interações/leads/templates) + EmailProvider.
    // `motor` injetável serve ao teste do caminho de envio (sem rede).
    this.motor = opts.motor ?? criarMotorReal(organizacaoId)
  }
  readonly simular: boolean

  async buscarControleExecucaoCampanha(campanhaId: string): Promise<ControleExecucaoCampanha | null> {
    return buscarControleExecucaoCampanha(this.db, this.organizacaoId, campanhaId)
  }

  async sincronizarConclusaoCampanha(campanhaId: string): Promise<void> {
    await concluirDisparoUnicoSeFinalizado(this.db, this.organizacaoId, campanhaId)
  }

  async notificarFalhaExecucao(execucao: { id: string; lead_id: string | null }, mensagem: string): Promise<void> {
    if (this.simular) return
    const motivo = `Falha na execução automática ${execucao.id}`
    const { data: existente, error: buscaError } = await this.db
      .from('notificacoes')
      .select('id')
      .eq('organizacao_id', this.organizacaoId)
      .eq('origem', 'workflow')
      .eq('motivo', motivo)
      .eq('lida', false)
      .limit(1)
    if (buscaError) throw buscaError
    if (existente?.length) return
    const { error } = await this.db.from('notificacoes').insert({
      organizacao_id: this.organizacaoId,
      canal: 'app',
      titulo: 'Automação precisa de atenção',
      mensagem: mensagem.slice(0, 500),
      lead_id: execucao.lead_id,
      origem: 'workflow',
      motivo,
      link: execucao.lead_id ? `/leads/${execucao.lead_id}` : '/automacao',
    })
    if (error) throw error
  }

  async selecionarLeadsComCampoVencendo(campo: string, dias: number): Promise<string[]> {
    if (!CAMPOS_DATA_PERMITIDOS.has(campo)) throw new Error(`Campo de data não permitido no gatilho: '${campo}'`)
    const limite = new Date(Date.now() + dias * 86_400_000).toISOString()
    const { data, error } = await this.db
      .from('leads')
      .select('id')
      .eq('organizacao_id', this.organizacaoId)
      .not(campo, 'is', null)
      .lte(campo, limite)
    if (error) throw error
    return (data ?? []).map((l) => l.id as string)
  }

  async selecionarLeadsPorCampo(campo: string, operador: string, valor: unknown): Promise<string[]> {
    if (!CAMPOS_LEAD_PERMITIDOS.has(campo))
      throw new Error(`Campo de lead não permitido no gatilho: '${campo}'`)
    // Traz id + o campo e filtra em memória com avaliarOperador (mesma lógica da
    // condição — sem duplicar). Org pequena; ok não empurrar todo operador p/ o SQL.
    const { data, error } = await this.db
      .from('leads')
      .select(`id, ${campo}`)
      .eq('organizacao_id', this.organizacaoId)
    if (error) throw error
    // `select('id, ' + campo)` dinâmico não é estaticamente tipado — cast via unknown.
    const linhas = (data ?? []) as unknown as Record<string, unknown>[]
    return linhas
      .filter((l) => avaliarOperador(operador as Operador, l[campo], valor))
      .map((l) => l.id as string)
  }

  async selecionarLeadsSemRespostaHaDias(campo: string, dias: number): Promise<string[]> {
    if (!CAMPOS_DATA_PERMITIDOS.has(campo))
      throw new Error(`Campo de data não permitido no gatilho: '${campo}'`)
    const limite = new Date(Date.now() - dias * 86_400_000).toISOString()
    // Candidatos: campo (data) mais antigo que N dias.
    const { data: candidatos, error: e1 } = await this.db
      .from('leads')
      .select('id')
      .eq('organizacao_id', this.organizacaoId)
      .not(campo, 'is', null)
      .lte(campo, limite)
    if (e1) throw e1
    // Anti-join: quem já teve interação tipo='resposta' fica de fora.
    const { data: respostas, error: e2 } = await this.db
      .from('interacoes')
      .select('lead_id')
      .eq('organizacao_id', this.organizacaoId)
      .eq('tipo', 'resposta')
    if (e2) throw e2
    const responderam = new Set((respostas ?? []).map((r) => (r as { lead_id: string }).lead_id))
    return (candidatos ?? [])
      .map((l) => (l as { id: string }).id)
      .filter((id) => !responderam.has(id))
  }

  async leadRespondeu(leadId: string): Promise<boolean> {
    return (await this.motor.store.contarInteracoes(leadId, 'resposta')) > 0
  }

  async lerCampoLead(leadId: string, campo: string): Promise<unknown> {
    if (!CAMPOS_LEAD_PERMITIDOS.has(campo))
      throw new Error(`Campo de lead não permitido na condição: '${campo}'`)
    // Lê só a coluna pedida, org-scoped (mesmo padrão de selecionarLeads...).
    const { data, error } = await this.db
      .from('leads')
      .select(campo)
      .eq('organizacao_id', this.organizacaoId)
      .eq('id', leadId)
      .maybeSingle()
    if (error) throw error
    // `select(campo)` dinâmico não é estaticamente tipado — cast via unknown.
    return data ? (data as unknown as Record<string, unknown>)[campo] ?? null : null
  }

  // Toma a reserva do passo ANTES de qualquer byte de SMTP e devolve se este
  // worker pode enviar. Qualquer erro de banco aqui sobe como exceção: sem
  // reserva provada, nenhum SMTP é aberto (fail closed).
  private async reservarEnvioProspeccao(chaveEnvio: string, leadId: string): Promise<boolean> {
    const mensagemId = `envio:${chaveEnvio}`
    const agora = new Date().toISOString()
    const leaseVencido = new Date(Date.now() - LEASE_RESERVA_ENVIO_MS).toISOString()
    const { data: inserida, error: erroInsercao } = await this.db.from('mensagens_processadas')
      .upsert({ organizacao_id: this.organizacaoId, mensagem_id: mensagemId,
        resultado: 'envio_reservado', lead_id: leadId, processado_em: agora },
      { onConflict: 'organizacao_id,mensagem_id', ignoreDuplicates: true }).select('id')
    if (erroInsercao) throw new Error(`Reserva de envio indisponível: ${erroInsercao.message}`)

    if (!inserida?.length) {
      // Já existe linha. SÓ é retomável a reserva que nunca chegou ao SMTP e
      // cujo lease venceu. O filtro compõe o CAS: dois processos que tentem
      // retomar a mesma linha serializam no UPDATE e o segundo não casa mais.
      const { data: retomada, error: erroRetomada } = await this.db.from('mensagens_processadas')
        .update({ resultado: 'envio_reservado', processado_em: agora })
        .eq('organizacao_id', this.organizacaoId).eq('mensagem_id', mensagemId)
        .eq('resultado', 'envio_reservado').lt('processado_em', leaseVencido)
        .select('id')
      if (erroRetomada) throw new Error(`Reserva de envio indisponível: ${erroRetomada.message}`)
      if (!retomada?.length) {
        // Tentativa que morreu com o SMTP em voo fica marcada como incerta,
        // para a conferência humana achá-la. Isto NÃO libera reenvio.
        const { error: erroIncerto } = await this.db.from('mensagens_processadas')
          .update({ resultado: 'envio_incerto' })
          .eq('organizacao_id', this.organizacaoId).eq('mensagem_id', mensagemId)
          .eq('resultado', 'envio_em_curso').lt('processado_em', leaseVencido)
        if (erroIncerto) log.erro('Falha ao marcar envio em curso abandonado como incerto.', { chaveEnvio, erro: erroIncerto.message })
        return false
      }
      log.aviso('Reserva de envio abandonada antes do SMTP foi retomada.', { leadId, chaveEnvio })
    }

    // Ponto sem volta: a partir daqui a linha deixa de ser retomável, porque a
    // próxima instrução abre SMTP e o resultado passa a ser desconhecível.
    const { data: emCurso, error: erroEmCurso } = await this.db.from('mensagens_processadas')
      .update({ resultado: 'envio_em_curso', processado_em: agora })
      .eq('organizacao_id', this.organizacaoId).eq('mensagem_id', mensagemId)
      .eq('resultado', 'envio_reservado')
      .select('id')
    if (erroEmCurso) throw new Error(`Reserva de envio indisponível: ${erroEmCurso.message}`)
    return !!emCurso?.length
  }

  async enviarEmailTemplate(leadId: string, templateTipo: string, campanhaId?: string | null, chaveEnvio?: string | null): Promise<{ enviado: boolean; assunto: string }> {
    const lead = await this.motor.store.buscarLead(leadId)
    if (!lead) throw new Error(`lead ${leadId} não encontrado`)
    const nicho = normalizarNicho(lead.segmento)
    // Variantes ativas (A/B, item 6) c/ fallback genérico; escolhe uma por lead.
    const varsNicho = nicho ? await this.motor.store.buscarTemplateEmail(nicho, templateTipo) : []
    const variantes = varsNicho.length ? varsNicho : await this.motor.store.buscarTemplateEmail(null, templateTipo)
    if (variantes.length === 0) throw new Error(`Template ausente (tipo=${templateTipo}, nicho=${nicho ?? 'generico'}).`)
    const tpl = variantes[indiceVariante(lead.id, variantes.length)]
    // O store já filtra pela organização; conferir aqui é a rede de segurança
    // do caminho service_role — template de outro tenant nunca é enviado.
    if (tpl.organizacao_id && tpl.organizacao_id !== this.organizacaoId) {
      throw new Error(`Envio bloqueado: template ${tpl.id} não pertence a esta organização.`)
    }
    // Variáveis e credenciais de nível-org: lidas de uma única consulta.
    //   {nome_servico}  → nomenclaturas.nome_servico || organizacoes.nome
    //   remetente       → conta conectada pela org ou chave legada (lib/email/remetenteOrganizacao)
    const { data: orgRow } = await this.db
      .from('organizacoes')
      .select('nome, configuracoes')
      .eq('id', this.organizacaoId)
      .maybeSingle()
    const orgData = orgRow as { nome?: string; configuracoes?: Record<string, unknown> } | null
    const workspaceConfig = parseWorkspaceConfig(orgData?.configuracoes)
    const orgNomenclaturas = workspaceConfig.nomenclaturas
    const nomeServico = orgNomenclaturas?.['nome_servico'] ?? orgData?.nome ?? ''
    const extras: Record<string, string> = {
      ...(nomeServico ? { nome_servico: nomeServico } : {}),
      frase_validade: fraseValidadeRenovacao(lead.data_validade),
      saudacao_renovacao: saudacaoRenovacao(lead.contato_nome),
    }
    const assunto = preencher(tpl.assunto ?? '{empresa}', lead, extras)
    const corpo = preencher(tpl.corpo, lead, extras)
    // Provider de e-mail: conta da organização (conectada ou legada) ou a padrão.
    // Conta configurada mas inutilizável bloqueia — nunca cai na padrão.
    const situacaoRemetente = await situacaoRemetenteOrganizacao(this.db, this.organizacaoId, { config: workspaceConfig })
    if (situacaoRemetente.estado === 'incompleto' && !this.simular) {
      throw new Error(situacaoRemetente.mensagem)
    }
    const remetenteOrg = situacaoRemetente.estado === 'pronto' ? situacaoRemetente.remetente : null
    const emailProvider = remetenteOrg ? new GmailProvider(remetenteOrg.credenciais) : this.motor.email

    // Simulação (Fase 5): não envia nem grava — quem loga é o executor.
    if (this.simular) return { enviado: false, assunto }
    // Revalida no momento do efeito. Uma mudança de ambiente entre o enrollment
    // e o consumo da fila não pode transformar ensaio em falso positivo.
    if (engineConfig.modoEnsaio) {
      throw new Error('Envio bloqueado: o motor está em MODO_ENSAIO.')
    }

    // Gate por campanha: independente do MODO_ENSAIO global.
    // dry_run=true (padrão) bloqueia o envio mesmo com MODO_ENSAIO=false em prod.
    let campanhaPublico: Record<string, unknown> | null = null
    let campanhaTipo: string | null = null
    if (campanhaId) {
      const { data: camp, error: campanhaError } = await this.db
        .from('campanhas')
        .select('dry_run, publico, tipo, status')
        .eq('id', campanhaId)
        .eq('organizacao_id', this.organizacaoId)
        .maybeSingle()
      if (campanhaError) throw campanhaError
      // Fail-closed: a campanha informada pela execução precisa existir NESTA
      // organização. Sem isto, um vínculo cross-tenant pulava o gate de dry_run
      // e o e-mail saía como se a campanha não existisse.
      if (!camp) {
        throw new Error(`Envio bloqueado: campanha ${campanhaId} não pertence a esta organização.`)
      }
      campanhaPublico = (camp as { publico?: Record<string, unknown> | null } | null)?.publico ?? null
      campanhaTipo = (camp as { tipo?: string | null } | null)?.tipo ?? null
      if (campanhaTipo === 'prospeccao' && (camp as { status?: string }).status
        && !['ativa', 'concluida'].includes(String((camp as { status?: string }).status))) {
        return { enviado: false, assunto }
      }
      if ((camp as { dry_run?: boolean } | null)?.dry_run === true)
        return { enviado: false, assunto }
    }

    // TRAVA DE SEGURANÇA (Prospecção + Follow-up). Escopo estrito:
    // campanhaTipo==='prospeccao' — não altera renovação nem os demais tipos
    // (regra explícita desta entrega; ver lib/campanhas/prospeccaoEnvio.ts).
    // Re-checa o lead no momento do efeito (mesmo princípio de
    // lib/engine/flows/followUp.ts): opt-out/bounce/perdido/descartado podem
    // ter acontecido DEPOIS que esta execução foi agendada, e mesmo assim não
    // podem receber envio.
    let leadProspeccaoAntes: Lead | null = null
    if (campanhaId && campanhaTipo === 'prospeccao') {
      leadProspeccaoAntes = await this.motor.store.buscarLead(leadId)
      if (leadBloqueadoParaEnvioProspeccao(leadProspeccaoAntes)) {
        log.aviso('Envio de prospecção bloqueado (opt-out/bounce/perdido/descartado).', { leadId, campanhaId })
        return { enviado: false, assunto }
      }
      // A resposta cancela a execução pelo monitor Gmail. Esta checagem
      // adicional cobre a janela em que a interação já existe e o cancelamento
      // ainda não foi persistido.
      const { data: resposta, error: respostaErro } = await this.db.from('interacoes')
        .select('id').eq('organizacao_id', this.organizacaoId)
        .eq('lead_id', leadId).eq('tipo', 'resposta').limit(1)
      if (respostaErro) throw respostaErro
      if (resposta?.length) return { enviado: false, assunto }
      if (chaveEnvio) {
        const execucaoId = chaveEnvio.split(':')[0]
        const { data: execucaoAtual, error: execucaoErro } = await this.db
          .from('workflow_execucoes').select('status, campanha_id')
          .eq('organizacao_id', this.organizacaoId).eq('id', execucaoId).maybeSingle()
        if (execucaoErro) throw execucaoErro
        if (!execucaoAtual || execucaoAtual.status === 'cancelado'
          || execucaoAtual.campanha_id !== campanhaId) return { enviado: false, assunto }
      }
    }

    // TRAVA DE REMETENTE (E-mail de prospecção). Escopo estrito a
    // campanhaTipo==='prospeccao': exige remetente explicitamente configurado
    // nesta organização (Configurações > Distribuição > E-mail de envio) —
    // nunca cai no fallback silencioso 'followup'/conta global de outra
    // organização (ver lib/campanhas/opcoesServidor.ts). Renovação e os demais
    // tipos preservam o fallback existente (`emailProvider` acima). Depois do
    // gate de opt-out/bounce: um lead já bloqueado não precisa de remetente
    // configurado para ser corretamente ignorado.
    if (campanhaId && campanhaTipo === 'prospeccao' && !remetenteOrg) {
      throw new Error('Configure um remetente em Configurações antes de iniciar a campanha.')
    }

    const ccRenovacaoAtivo = campanhaTipo === 'renovacao'
      && workspaceConfig.features?.ccResponsavelNaRenovacao === true
    // Campanhas legadas preservam a regra existente. Na renovação com a feature
    // habilitada, a única fonte de CC é lead.responsavel_id — nunca o perfil da
    // campanha — e falha de cadastro/busca não impede o contato principal.
    const contextoCampanha = campanhaId && !ccRenovacaoAtivo
      ? await this.motor.store.buscarContextoCampanhaAtiva?.(leadId)
      : null
    let responsavelLead = null
    if (lead.responsavel_id) {
      try {
        responsavelLead = await this.motor.store.buscarUsuario(lead.responsavel_id)
      } catch (erro) {
        if (!ccRenovacaoAtivo) throw erro
        log.aviso('Não foi possível resolver o responsável para CC da renovação; envio seguirá sem cópia.', {
          organizacaoId: this.organizacaoId,
          leadId,
          campanhaId,
          erro: erro instanceof Error ? erro.message : String(erro),
        })
      }
    }
    // Assinatura do corpo = a MESMA pessoa que vai no CC (ver
    // escolherResponsavelCampanha). No modo carteira é o responsável do lead;
    // fora dele, o responsável geral da campanha, como sempre foi.
    const preferirResponsavelDoLead = contextoCampanha?.retornoParaResponsavelDoLead === true
    const responsavelAssinatura = escolherResponsavelCampanha({
      responsavelCampanha: contextoCampanha?.responsavel,
      responsavelLead,
      preferirResponsavelDoLead,
    })
    const responsavelNome = responsavelAssinatura?.nome?.trim()
      || contextoCampanha?.responsavel?.nome?.trim()
      || responsavelLead?.nome?.trim()
      || null
    const operacao = campanhaPublico?.operacao && typeof campanhaPublico.operacao === 'object'
      ? campanhaPublico.operacao as Record<string, unknown>
      : null
    const inicial = operacao?.mensagemInicial && typeof operacao.mensagemInicial === 'object'
      ? operacao.mensagemInicial as Record<string, unknown>
      : null
    const followups = Array.isArray(operacao?.followups)
      ? operacao.followups.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
      : []
    const mensagemConfigurada = [inicial, ...followups]
      .find((mensagem) => mensagem?.templateTipo === templateTipo)
    // HTML: o da mensagem da campanha quando existe; senão o do próprio template
    // da biblioteca (workflow sem campanha). Mesmo renderer do texto — variáveis
    // e sanitização idênticas —, sem segunda engine de HTML.
    const htmlDaCampanha = typeof mensagemConfigurada?.html === 'string' ? mensagemConfigurada.html : undefined
    const htmlBase = htmlDaCampanha ?? (typeof tpl.html === 'string' && tpl.html.trim() ? tpl.html : undefined)
    const htmlPersonalizado = htmlBase ? preencher(htmlBase, lead, extras) : undefined
    const html = montarEmailCampanhaHtml(
      corpo,
      { responsavelNome: ccRenovacaoAtivo ? null : responsavelNome, nomeServico },
      htmlPersonalizado,
    )

    // TRAVA DE REENVIO. O executor é at-least-once: se cair entre o efeito e a
    // gravação do passo, a ação repete no resume. Aqui isso significaria o mesmo
    // e-mail duas vezes para um cliente real. A chave é execução+bloco, então
    // ciclos diferentes (ex.: renovação semestral) têm execuções distintas e
    // seguem enviando normalmente. Sem chave, o comportamento é o de antes.
    // Fica depois de TODOS os gates para não consumir a chave num envio bloqueado.
    const envioProspeccao = campanhaTipo === 'prospeccao' && !!campanhaId && !!chaveEnvio
    if (envioProspeccao && chaveEnvio) {
      if (!await this.reservarEnvioProspeccao(chaveEnvio, leadId)) {
        log.aviso('Envio de prospecção já reservado ou realizado; sem retry de SMTP.', { leadId, chaveEnvio })
        return { enviado: false, assunto }
      }
    } else if (chaveEnvio) {
      const primeiraVez = await this.motor.store.reivindicarMensagem(`envio:${chaveEnvio}`, 'envio', leadId)
      if (!primeiraVez) {
        log.aviso('Envio já realizado para este passo — não reenvio.', { leadId, templateTipo, chaveEnvio })
        return { enviado: false, assunto }
      }
    }

    // "Somente as respostas" na campanha: o e-mail sai sem o responsável em
    // cópia (vale para os dois caminhos de CC abaixo).
    const copiarResponsavel = responsavelRecebeCopiaDosEnvios(campanhaPublico)
    // Envio real: usa a conta da org (emailProvider) se configurada; senão a padrão.
    try {
    if (campanhaId && ccRenovacaoAtivo) {
      const cc = copiarResponsavel
        ? resolverCcResponsavelRenovacao({
          para: lead.contato_email,
          remetenteEmail: remetenteOrg?.email,
          responsavelLead,
        })
        : undefined
      await emailProvider.enviar(lead.contato_email, assunto, corpo, html, cc)
    } else if (campanhaId) {
      await enviarEmailCampanhaComCopia(emailProvider, {
        para: lead.contato_email,
        assunto,
        corpo,
        html,
        remetenteEmail: remetenteOrg?.email,
        responsavelCampanha: contextoCampanha?.responsavel,
        responsavelLead,
        preferirResponsavelDoLead,
        copiarResponsavel,
      })
    } else {
      await emailProvider.enviar(lead.contato_email, assunto, corpo, html)
    }
    } catch (erro) {
      if (envioProspeccao && chaveEnvio) {
        // Depois de iniciar SMTP não é possível provar que nada foi entregue.
        // A reserva permanece para impedir reenvio cego; requer reconciliação.
        const { error: marcacaoErro } = await this.db.from('mensagens_processadas')
          .update({ resultado: 'envio_incerto' }).eq('organizacao_id', this.organizacaoId)
          .eq('mensagem_id', `envio:${chaveEnvio}`)
        if (marcacaoErro) log.erro('Falha ao registrar envio SMTP incerto.', { chaveEnvio, erro: marcacaoErro.message })
        throw new ErroEnvioIncerto(`Resultado SMTP incerto para ${chaveEnvio}: ${erro instanceof Error ? erro.message : String(erro)}`)
      }
      // Renovação e outros tipos mantêm o comportamento anterior nesta rodada.
      if (chaveEnvio) await this.motor.store.liberarMensagem(`envio:${chaveEnvio}`)
      throw erro
    }
    if (envioProspeccao && chaveEnvio) {
      const { error } = await this.db.from('mensagens_processadas')
        .update({ resultado: 'envio_confirmado' }).eq('organizacao_id', this.organizacaoId)
        .eq('mensagem_id', `envio:${chaveEnvio}`)
      if (error) throw new ErroEnvioIncerto(`SMTP aceitou o envio, mas não foi possível confirmar a reserva: ${error.message}`)
    }
    // Efeito de PROSPECÇÃO sobre o lead (item 2/3 da entrega): tipo de
    // interação correto (abordagem/follow_up, não 'nota') + transição de
    // estágio + cache de followups_enviados — pela MESMA máquina de estados
    // do motor legado (lib/campanhas/prospeccaoEnvio.ts), para os dois
    // motores nunca divergirem sobre o que já foi enviado a este lead.
    // Escopo estrito a campanhaTipo==='prospeccao': renovação e os demais
    // tipos continuam gravando 'nota' e não tocam em estagio/followups_enviados.
    const efeitoProspeccao = leadProspeccaoAntes
      ? efeitoEnvioProspeccao(leadProspeccaoAntes.estagio, leadProspeccaoAntes.followups_enviados ?? 0)
      : null
    try {
    await this.motor.store.registrarInteracao({
      lead_id: leadId,
      tipo: efeitoProspeccao?.tipoInteracao ?? 'nota',
      canal: 'email',
      descricao: `**${assunto}**\n\n${corpo}`,
      origem_acao: 'ia',
      responsavel_id: lead.responsavel_id ?? null,
      template_id: tpl.id, // A/B testing (item 6)
    })
    if (efeitoProspeccao) {
      await this.motor.store.atualizarLead(leadId, {
        estagio: efeitoProspeccao.estagioDestino,
        followups_enviados: efeitoProspeccao.followupsEnviados,
      })
    }
    } catch (erro) {
      if (envioProspeccao && chaveEnvio) {
        const { error: marcacaoErro } = await this.db.from('mensagens_processadas')
          .update({ resultado: 'envio_confirmado_persistencia_pendente' })
          .eq('organizacao_id', this.organizacaoId).eq('mensagem_id', `envio:${chaveEnvio}`)
        if (marcacaoErro) log.erro('Falha ao registrar persistência pós-SMTP pendente.', { chaveEnvio, erro: marcacaoErro.message })
        throw new ErroEnvioIncerto(`SMTP aceitou o envio, mas o histórico do lead ficou pendente: ${erro instanceof Error ? erro.message : String(erro)}`)
      }
      throw erro
    }
    // Cada envio real mantém um único monitor rápido por organização. A chave
    // temporal da fila deduplica campanhas/envios concorrentes. Falha ao
    // agendar não reenvia o e-mail que já saiu; o cron diário segue de fallback.
    if (campanhaId && process.env.VERCEL === '1') {
      try {
        await agendarMonitorRespostas(this.organizacaoId)
      } catch (erro) {
        log.aviso('Não foi possível agendar o monitor rápido de respostas.', {
          organizacaoId: this.organizacaoId,
          campanhaId,
          erro: erro instanceof Error ? erro.message : String(erro),
        })
      }
    }
    return { enviado: true, assunto }
  }

  async criarTarefa(leadId: string, titulo: string, responsavelId?: string | null, chave?: string | null): Promise<void> {
    if (this.simular) return
    // Mesma trava do envio: o resume pode repetir a ação, e sem isto o
    // responsável vê tarefa, notificação e nota duplicadas no painel.
    if (chave) {
      const primeiraVez = await this.motor.store.reivindicarMensagem(`tarefa:${chave}`, 'tarefa', leadId)
      if (!primeiraVez) {
        log.aviso('Tarefa já criada para este passo — não duplico.', { leadId, chave })
        return
      }
    }
    // Buscamos o lead também para o fallback de responsável E para o corpo da
    // notificação (empresa/contato).
    const lead = await this.motor.store.buscarLead(leadId)
    // Responsável explícito da ação; senão, o responsável do próprio lead.
    const responsavel = responsavelId ?? lead?.responsavel_id ?? null

    // Substitui variáveis de template no título ({empresa}, {nome}, etc.) se o
    // lead foi buscado com sucesso — torna tarefas como "[WA] contato com {empresa}"
    // legíveis no painel do responsável.
    const tituloFinal = lead ? preencher(titulo, lead) : titulo

    // 1ª classe (Fase 4): a tarefa vira linha em `tarefas` (não mais só nota).
    const { data: tarefa } = await this.db.from('tarefas').insert({
      organizacao_id: this.organizacaoId,
      lead_id: leadId,
      tipo: 'workflow',
      titulo: tituloFinal,
      responsavel_id: responsavel,
      origem: 'workflow',
      motivo: 'Ação de workflow: criar tarefa',
    }).select('id').single()

    // Histórico do lead (seção 9: tarefa aparece na conversa). Mantido além da
    // tabela `tarefas` — é o registro cronológico que o LeadPanel exibe.
    await this.motor.store.registrarInteracao({
      lead_id: leadId,
      tipo: 'nota',
      canal: 'sistema',
      descricao: `Tarefa: ${tituloFinal}`,
      origem_acao: 'ia',
      responsavel_id: responsavel,
    })

    // Notificação (in-app + e-mail, best-effort): registra em `notificacoes` e
    // dispara o e-mail HTML. Falha aqui nunca propaga (a tarefa já está gravada).
    await this.notificarResponsavelTarefa(tarefa?.id ?? null, leadId, responsavel, tituloFinal, lead)
  }

  // Ação 'criar_oportunidade' (Fase 6): abre um deal em `oportunidades` a partir
  // do lead. Tudo via this.db, org-scoped (organizacao_id = this.organizacaoId),
  // mesmo padrão de criarTarefa — não passa pelo fluxo de cadência do motor.
  async criarOportunidade(leadId: string, dados: { titulo?: string; valor?: number | null }): Promise<void> {
    if (this.simular) return
    const { data: lead } = await this.db
      .from('leads')
      .select('empresa_id, responsavel_id, empresa')
      .eq('id', leadId)
      .eq('organizacao_id', this.organizacaoId)
      .maybeSingle()
    const l = (lead ?? null) as { empresa_id?: string | null; responsavel_id?: string | null; empresa?: string | null } | null
    const titulo = dados.titulo?.trim() || `Oportunidade — ${l?.empresa ?? '(lead)'}`
    const valor = typeof dados.valor === 'number' && Number.isFinite(dados.valor) ? dados.valor : null
    await this.db.from('oportunidades').insert({
      organizacao_id: this.organizacaoId,
      lead_id: leadId,
      empresa_id: l?.empresa_id ?? null,
      responsavel_id: l?.responsavel_id ?? null,
      titulo,
      valor,
      origem: 'workflow',
      status: 'aberta',
    })
    // Histórico do lead (aparece na conversa do LeadPanel), org-scoped.
    await this.db.from('interacoes').insert({
      organizacao_id: this.organizacaoId,
      lead_id: leadId,
      tipo: 'nota',
      canal: 'sistema',
      descricao: `Oportunidade criada: ${titulo}`,
      origem_acao: 'ia',
      motivo: 'workflow',
    })
  }

  // Avisa por e-mail o responsável de uma tarefa recém-criada — mesma infra da
  // notificação de closer (this.motor.email.enviar, gated por MODO_ENSAIO dentro
  // do GmailProvider). Best-effort: sem responsável/e-mail, ou falha na busca/envio,
  // não quebra a criação da tarefa — só loga.
  private async notificarResponsavelTarefa(
    tarefaId: string | null,
    leadId: string,
    responsavelId: string | null,
    titulo: string,
    lead: Lead | null,
  ): Promise<void> {
    if (!responsavelId) return
    try {
      const usuario = await this.motor.store.buscarUsuario(responsavelId)
      if (!usuario?.email) {
        log.aviso('Responsável da tarefa sem e-mail cadastrado — sem notificação.', {
          leadId,
          responsavelId,
        })
        return
      }
      const empresa = lead?.empresa ?? '(lead)'
      const contato = lead?.contato_nome ?? lead?.contato_email ?? '-'
      // Registro estruturado da notificação (Fase 4) — canal e-mail.
      await this.db.from('notificacoes').insert({
        organizacao_id: this.organizacaoId,
        email: usuario.email,
        canal: 'email',
        titulo: `Nova tarefa: ${titulo}`,
        mensagem: `Você é responsável pela tarefa "${titulo}" (${empresa}).`,
        lead_id: leadId,
        tarefa_id: tarefaId,
        origem: 'workflow',
        motivo: 'Tarefa criada por workflow',
        link: `/leads/${leadId}`,
      })
      // Texto puro = fallback (clientes sem HTML). Mantém o formato de antes.
      const corpo = [
        'Você foi definido como responsável por uma nova tarefa gerada por um workflow.',
        '',
        `Tarefa  : ${titulo}`,
        `Empresa : ${empresa}`,
        `Contato : ${contato}`,
      ].join('\n')
      const html = montarEmailTarefaHtml({ nome: usuario.nome, titulo, empresa, contato, leadId })
      await this.motor.email.enviar(usuario.email, `Nova tarefa: ${titulo}`, corpo, html)
    } catch (e) {
      log.erro('Falha ao notificar responsável da tarefa (tarefa criada mesmo assim).', {
        leadId,
        responsavelId,
        erro: e instanceof Error ? e.message : String(e),
      })
    }
  }

  async atualizarCampoLead(leadId: string, campo: string, valor: unknown): Promise<void> {
    if (!CAMPOS_LEAD_ESCRITA_PERMITIDOS.has(campo))
      throw new Error(`Campo de lead não permitido para escrita: '${campo}'`)
    if (this.simular) return
    const { error } = await this.db
      .from('leads')
      .update({ [campo]: valor })
      .eq('organizacao_id', this.organizacaoId)
      .eq('id', leadId)
    if (error) throw error
  }

  async inscreverEmCampanha(leadId: string, campanhaId: string): Promise<void> {
    if (this.simular) return
    // Lead bounced não entra em nenhuma nova campanha.
    const { data: leadCheck } = await this.db
      .from('leads')
      .select('bounced')
      .eq('id', leadId)
      .eq('organizacao_id', this.organizacaoId)
      .maybeSingle()
    if ((leadCheck as { bounced?: boolean | null } | null)?.bounced === true) return

    const { data: camp } = await this.db
      .from('campanhas')
      .select('workflow_id')
      .eq('id', campanhaId)
      .eq('organizacao_id', this.organizacaoId)
      .eq('status', 'ativa')
      .maybeSingle()
    if (!camp?.workflow_id) return // campanha não encontrada ou sem workflow
    const { inscreverLeadManual } = await import('./index')
    const { SupabaseWorkflowStore } = await import('./store/supabaseStore')
    const store = new SupabaseWorkflowStore(this.organizacaoId, this.db)
    await inscreverLeadManual(store, camp.workflow_id, leadId, campanhaId)
  }

  async selecionarLeadsQueResponderamRecente(dentroDeNDias: number): Promise<string[]> {
    const desde = dentroDeNDias > 0
      ? new Date(Date.now() - dentroDeNDias * 86_400_000).toISOString()
      : new Date(0).toISOString()
    const { data } = await this.db
      .from('interacoes')
      .select('lead_id')
      .eq('organizacao_id', this.organizacaoId)
      .eq('tipo', 'resposta')
      .gte('created_at', desde)
    const ids = [...new Set((data ?? []).map((r) => (r as { lead_id: string }).lead_id).filter(Boolean))]
    return ids
  }

  async selecionarLeadsSemRespostaInbound(diasSemResposta: number): Promise<string[]> {
    const limite = new Date(Date.now() - diasSemResposta * 86_400_000).toISOString()
    const { data: responderam } = await this.db
      .from('interacoes')
      .select('lead_id')
      .eq('organizacao_id', this.organizacaoId)
      .eq('tipo', 'resposta')
    const idsResponderam = new Set((responderam ?? []).map((r) => (r as { lead_id: string }).lead_id))
    const { data: leads } = await this.db
      .from('leads')
      .select('id')
      .eq('organizacao_id', this.organizacaoId)
      .lt('ultimo_contato', limite)
      .or('perdido.is.null,perdido.eq.false')
    return (leads ?? [])
      .map((l) => (l as { id: string }).id)
      .filter((id) => !idsResponderam.has(id))
  }

  async selecionarLeadsPorEstagio(estagio: string): Promise<string[]> {
    const { data } = await this.db
      .from('leads')
      .select('id')
      .eq('organizacao_id', this.organizacaoId)
      .eq('estagio', estagio)
      .or('perdido.is.null,perdido.eq.false')
    return (data ?? []).map((l) => (l as { id: string }).id)
  }

  async selecionarLeadsComValidadeVencida(diasApos: number): Promise<string[]> {
    const alvo = new Date(Date.now() - diasApos * 86_400_000).toISOString().slice(0, 10)
    const { data } = await this.db
      .from('leads')
      .select('id')
      .eq('organizacao_id', this.organizacaoId)
      .not('data_validade', 'is', null)
      .lte('data_validade', alvo)
      .or('perdido.is.null,perdido.eq.false')
    return (data ?? []).map((l) => (l as { id: string }).id)
  }
}

// Escapa texto do usuário para interpolar com segurança no HTML do e-mail.
function escaparHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// E-mail transacional (HTML) da notificação de tarefa. Regras de e-mail: layout
// por TABELAS + estilos INLINE (nada de flexbox/CSS externo), compatível com os
// clientes de e-mail. Acento verde (#22c55e, o mesmo do ícone da sidebar), fundo
// branco. O botão leva a /leads/{id}, que redireciona para o LeadPanel real.
function montarEmailTarefaHtml(dados: {
  nome: string
  titulo: string
  empresa: string
  contato: string
  leadId: string
}): string {
  const nome = escaparHtml(dados.nome)
  const titulo = escaparHtml(dados.titulo)
  const empresa = escaparHtml(dados.empresa)
  const contato = escaparHtml(dados.contato)
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? ''
  const leadUrl = escaparHtml(`${base}/leads/${dados.leadId}`)
  const VERDE = '#22c55e'
  const linha = (rotulo: string, valor: string) =>
    `<tr>
      <td style="padding:5px 0;color:#64748b;font-size:14px;width:96px;vertical-align:top;">${rotulo}</td>
      <td style="padding:5px 0;color:#0f172a;font-size:14px;font-weight:bold;">${valor}</td>
    </tr>`
  return `<!doctype html>
<html lang="pt-BR">
<body style="margin:0;padding:0;background-color:#f4f5f7;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background-color:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">
        <tr>
          <td style="padding:20px 28px;border-bottom:1px solid #eef0f2;">
            <table role="presentation" cellpadding="0" cellspacing="0"><tr>
              <td width="32" style="width:32px;height:32px;background-color:${VERDE};border-radius:8px;text-align:center;vertical-align:middle;color:#ffffff;font-size:16px;font-weight:bold;line-height:32px;">&#9889;</td>
              <td style="padding-left:10px;vertical-align:middle;">
                <div style="font-size:15px;font-weight:bold;color:#0f172a;line-height:1.15;">ProspectOS</div>
                <div style="font-size:12px;color:#6366f1;line-height:1.15;">InovaCode</div>
              </td>
            </tr></table>
          </td>
        </tr>
        <tr>
          <td style="padding:28px;">
            <p style="margin:0 0 14px;font-size:16px;color:#0f172a;">Olá, ${nome},</p>
            <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#334155;">Você foi definido como responsável por uma nova tarefa gerada por um workflow.</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;">
              <tr><td style="padding:14px 18px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  ${linha('Tarefa', titulo)}
                  ${linha('Empresa', empresa)}
                  ${linha('Contato', contato)}
                </table>
              </td></tr>
            </table>
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 4px;"><tr>
              <td style="background-color:${VERDE};border-radius:8px;">
                <a href="${leadUrl}" target="_blank" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:bold;color:#ffffff;text-decoration:none;">Ver lead no ProspectOS</a>
              </td>
            </tr></table>
          </td>
        </tr>
        <tr>
          <td style="padding:18px 28px;border-top:1px solid #eef0f2;background-color:#fafafa;">
            <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.5;">Esta é uma mensagem automática do ProspectOS. Não responda a este e-mail.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}
