// Interface do "banco de dados" do motor. O resto do sistema só conhece esta
// interface, nunca o Supabase diretamente — por isso dá para testar contra um
// MemoryStore sem tocar na rede.
import type { ContextoCampanhaResposta, Lead, NovaInteracao, TipoInteracaoEngine, UsuarioBasico } from '../types'

// Template de e-mail selecionável pelo motor (subconjunto da tabela `templates`).
// `id` identifica a VARIANTE (A/B testing, item 6) — gravado na interação do envio.
export interface TemplateEmail {
  id: string
  assunto: string | null
  corpo: string
  // HTML opcional do template (coluna `html`, migration 0046). Quando existe, é
  // o corpo HTML do e-mail e `corpo` vira o texto alternativo.
  html?: string | null
  // Organização dona da linha — o envio confere antes de usar o template.
  organizacao_id?: string
}

export interface Store {
  // Organização à qual este Store está preso (multi-tenant, migration 0006).
  // O SupabaseStore filtra/grava sempre esta org; o MemoryStore (testes) não
  // usa org e deixa undefined. Os fluxos leem daqui p/ pedir a config da org
  // certa (getEngineConfig(store.organizacaoId)).
  readonly organizacaoId?: string
  buscarLead(id: string): Promise<Lead | null>
  // Casa pelo e-mail EXATO do contato (case-insensitive).
  buscarLeadPorEmail(email: string): Promise<Lead | null>
  // Bounce é do ENDEREÇO, não de um lead: TODOS os leads da org com este e-mail
  // exato, qualquer owner (lead importado fora do motor também recebe campanha).
  buscarLeadsPorEmail?(email: string): Promise<Lead[]>
  // Guarda o endereço na lista de e-mails inválidos da org (migration 0062).
  // Sobrevive à exclusão/reimportação do lead: o trigger da 0062 marca como
  // bounced quem entrar depois com o mesmo e-mail. Best-effort — não lança.
  registrarEmailInvalido?(email: string, motivo: string | null): Promise<void>
  // Casa pelo domínio da empresa (resposta encaminhada). Usa coluna `dominio`
  // e, como fallback, o domínio do contato_email.
  buscarLeadPorDominio(dominio: string): Promise<Lead | null>
  atualizarLead(id: string, patch: Partial<Lead>): Promise<void>
  registrarInteracao(i: NovaInteracao): Promise<void>
  // Quantas interações de um tipo o lead já tem (base da idempotência).
  contarInteracoes(leadId: string, tipo: TipoInteracaoEngine): Promise<number>
  // Igual à contagem acima, limitada ao ciclo atual. Evita que uma resposta de
  // uma renovação antiga bloqueie o reconhecimento da renovação deste ano.
  contarInteracoesDesde(leadId: string, tipo: TipoInteracaoEngine, desdeISO: string): Promise<number>
  // Quantos e-mails o motor enviou hoje (respeita o limite diário).
  enviosHoje(): Promise<number>
  // Leads owner='engine' elegíveis para follow-up agora.
  leadsParaFollowup(): Promise<Lead[]>
  // Leads owner='engine' que ESGOTARAM os follow-ups (>= MAX) sem responder e
  // cujo tempo de espera já passou — candidatos a sair para 'sem_resposta'.
  leadsEsgotadosSemResposta(): Promise<Lead[]>
  // Dados do responsável/closer do lead (para notificação do Fluxo 3).
  buscarUsuario(id: string): Promise<UsuarioBasico | null>
  // Responsável configurado na campanha mais recente que originou o contato.
  buscarResponsavelCampanhaAtiva?(leadId: string): Promise<UsuarioBasico | null>
  // Contexto e modelo de notificação persistidos nessa campanha. Execuções já
  // concluídas/canceladas continuam válidas porque a resposta chega depois.
  buscarContextoCampanhaAtiva?(leadId: string): Promise<ContextoCampanhaResposta | null>
  // TODAS as variantes de e-mail ATIVAS por (nicho, tipo). nicho=null busca o
  // GENÉRICO. A seleção da variante (A/B) e o fallback ficam em mensagem.ts.
  buscarTemplateEmail(nicho: string | null, tipo: string): Promise<TemplateEmail[]>
  // Cancela todas as workflow_execucoes ativas (em_andamento/aguardando) do lead
  // quando há bounce OU resposta real, impedindo novos passos persistentes.
  cancelarExecucoesWorkflow(leadId: string): Promise<void>
  // Idempotência por mensagem (migration 0030). Reivindica a mensagem para
  // processamento: devolve true só na PRIMEIRA vez. É um insert com unique, então
  // duas passadas concorrentes não processam a mesma mensagem duas vezes.
  reivindicarMensagem(mensagemId: string, resultado?: string, leadId?: string | null): Promise<boolean>
  // Devolve a mensagem à fila quando o processamento falhou no meio — sem isso
  // uma falha transitória faria a mensagem ser descartada para sempre.
  liberarMensagem(mensagemId: string): Promise<void>
}
