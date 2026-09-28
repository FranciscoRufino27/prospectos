// Aviso de resposta do cliente (migration 0053): quando um cliente responde,
// o responsável do lead e/ou o grupo comercial recebem um aviso no WhatsApp.
// A resposta em si já foi registrada por quem chama (motor de e-mail, webhook
// do WhatsApp); o aviso é um EFEITO recuperável num outbox próprio.

// Escolha da organização (comercial.avisoResposta). Ausente = desligado.
export type { ModoAvisoResposta } from '@/lib/config/workspaceConfig'

export type DestinoAvisoResposta = 'responsavel' | 'grupo'
export type CanalResposta = 'email' | 'whatsapp'
// null = não classificada (WhatsApp, ou resposta fora da prospecção).
export type ClassificacaoAviso = 'positivo' | 'negativo' | 'neutro' | 'indeterminado' | null

// pendente → enviando → enviada | falhou (até o teto)
// configuracao_ausente: sem Z-API, sem grupo ou responsável sem número —
// não consome tentativa e volta a tentar ao reprocessar.
export type StatusAvisoResposta = 'pendente' | 'enviando' | 'enviada' | 'falhou' | 'configuracao_ausente'

// Congelado na resposta: reprocessar monta o MESMO texto. O número do
// responsável NÃO fica aqui — é lido na hora de enviar (ele pode cadastrar
// o número depois e o aviso pendente sai).
export interface DadosAvisoResposta {
  empresa: string
  contato: string
  canal: CanalResposta
  classificacao: ClassificacaoAviso
  trecho: string
  // id de `usuarios` (leads.responsavel_id), não de perfis.
  responsavelId: string | null
  responsavelNome: string
  link: string | null
}

export interface AvisoResposta {
  id: string
  organizacaoId: string
  leadId: string
  eventoId: string
  destinoTipo: DestinoAvisoResposta
  status: StatusAvisoResposta
  tentativas: number
  ultimoErro: string | null
  dados: DadosAvisoResposta
  destino: string | null
  providerMessageId: string | null
  enviadoEm: string | null
  criadoEm: string
}

// Porta de envio (Z-API em produção, fake nos testes).
export type ResultadoEnvioAviso =
  | { ok: true; providerMessageId: string | null }
  | { ok: false; codigo: string; mensagem: string }

export type EnviadorAviso = (destino: string, mensagem: string) => Promise<ResultadoEnvioAviso>

// O que o chamador (motor / webhook) informa sobre a resposta.
export interface EntradaAvisoResposta {
  organizacaoId: string
  leadId: string
  eventoId: string
  canal: CanalResposta
  classificacao: ClassificacaoAviso
  // Texto da resposta (será limpo e cortado).
  texto: string
  // A resposta positiva com rodízio já avisou o grupo pelo handoff: não
  // manda um segundo aviso ao mesmo grupo.
  grupoJaAvisado?: boolean
}
