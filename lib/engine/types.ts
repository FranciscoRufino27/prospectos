// Tipos do motor. Reaproveitam o shape real do Supabase (lib/supabase.ts) e
// adicionam os campos da migration 0001 (owner, tese_comercial, dominio).
import type { Lead as LeadBase, Interacao as InteracaoBase } from '@/lib/supabase'

export type Owner = 'n8n' | 'engine'

// Estágios do funil (vocabulário DESTE projeto — mesmos da UI do pipeline).
export type Estagio =
  | 'novos_leads'
  | 'primeiro_contato'
  | 'aguardando_resposta'
  | 'follow_up'
  | 'interessado'
  | 'reuniao_agendada'
  | 'perdido'

export type Lead = Omit<LeadBase, 'proxima_acao' | 'proxima_acao_data'> & {
  owner?: Owner
  tese_comercial?: string | null
  dominio?: string | null
  // O motor limpa estes campos (null) ao pausar a cadência — alarga p/ aceitar null.
  proxima_acao?: string | null
  proxima_acao_data?: string | null
}

export type Interacao = InteracaoBase

// Tipos de interação usados pelo motor (subconjunto do enum da tabela interacoes).
export type TipoInteracaoEngine = 'abordagem' | 'resposta' | 'follow_up' | 'nota'

export interface NovaInteracao {
  lead_id: string
  tipo: TipoInteracaoEngine
  canal: 'email' | 'sistema' | 'plataforma'
  descricao: string
  origem_acao: 'ia' | 'humano'
  responsavel_id?: string | null
  // Variante de template usada no envio (A/B testing, item 6). null = sem A/B.
  template_id?: string | null
}

// Uma mensagem lida da caixa de entrada (Fluxo 2 — Detectar resposta).
export interface MensagemRecebida {
  // Identificador opaco do provedor. Permite confirmar a leitura somente depois
  // que a resposta foi persistida, sem acoplar o fluxo a mailbox/UID do IMAP.
  idRecebimento?: string
  // Identidade ESTÁVEL da mensagem (Message-ID, RFC 5322). É a chave de
  // idempotência da migration 0030: a caixa é varrida por janela de dias, então
  // a mesma mensagem reaparece em toda passada e só o id evita reprocessá-la.
  // Cai para mailbox+UID quando o cabeçalho não vem.
  mensagemId?: string
  de: string // e-mail do remetente
  assunto: string
  corpo: string
  automatica?: boolean // dica do provedor: é auto-resposta?
  em: Date
}

// Usuário (closer/responsável) — subconjunto necessário ao motor.
export interface UsuarioBasico {
  id: string
  nome: string
  email: string
}

export interface ContextoCampanhaResposta {
  id: string
  execucaoId?: string | null
  iniciadoEm?: string | null
  execucaoStatus?: string | null
  // Identidade do ciclo da execução (workflow_execucoes.ciclo_chave). Fase 4:
  // 'handoff_retorno:<id>' marca o follow-up de RETORNO do handoff — a
  // resposta positiva a ele reativa o mesmo comercial.
  cicloChave?: string | null
  nome: string
  tipo: string | null
  responsavel: UsuarioBasico | null
  // true = campanha configurada para devolver o retorno ao responsável do
  // PRÓPRIO lead (carteira), usando `responsavel` acima só como fallback.
  // Opcional: contexto montado por store antigo/teste vale como false (legado).
  retornoParaResponsavelDoLead?: boolean
  // Canais do aviso de resposta escolhidos na campanha ('email_whatsapp' |
  // 'whatsapp'). Com valor, o responsável é avisado no WhatsApp mesmo que a
  // organização não tenha ligado o aviso; null/ausente = campanha antiga.
  canaisRetorno?: 'email_whatsapp' | 'whatsapp' | null
  notificarResponsavel: boolean
  emailAssunto: string | null
  emailCorpo: string | null
  emailHtml: string | null
}
