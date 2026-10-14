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

// 'envio' = e-mail de campanha enviado (publico.operacao.avisoEnvio), mesmo outbox.
export type TipoAviso = 'resposta' | 'envio'

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
  // Responsável definido pela CAMPANHA (id de perfil de login). Quando
  // presente, é ele quem recebe o aviso individual, no lugar do dono do lead.
  // Ausente em avisos gravados antes deste campo = regra antiga.
  responsavelPerfilId?: string | null
  // Grupo definido pela campanha; ausente = grupo da organização.
  grupoId?: string | null
  responsavelNome: string
  link: string | null
  // Só no aviso de envio.
  campanhaNome?: string | null
  etapa?: string | null
  assunto?: string | null
}

export interface AvisoResposta {
  id: string
  organizacaoId: string
  leadId: string
  eventoId: string
  tipo: TipoAviso
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
  // Destinos de WhatsApp escolhidos pela campanha da resposta
  // (publico.operacao.resposta.aviso.whatsapp). Presente = SUBSTITUI a regra
  // da organização para esta resposta ([] = campanha sem WhatsApp).
  destinosCampanha?: DestinoAvisoResposta[]
  // Grupo escolhido na campanha (id Z-API "…-group"); ausente = grupo da conta.
  grupoIdCampanha?: string | null
  // Quem a campanha define como responsável pelo retorno (perfil de login),
  // quando é ele — e não o dono do lead — quem recebe. Mesma pessoa do e-mail
  // de retorno; ausente = responsável do lead.
  responsavelPerfil?: { id: string; nome: string } | null
}

// O que o motor informa sobre um e-mail de campanha que acabou de sair.
export interface EntradaAvisoEnvio {
  organizacaoId: string
  leadId: string
  // "envio:<chave do envio>" — a mesma chave que impede reenviar o e-mail.
  eventoId: string
  destinos: DestinoAvisoResposta[]
  grupoIdCampanha?: string | null
  responsavelPerfil?: { id: string; nome: string } | null
  campanhaNome: string
  etapa: string
  assunto: string
}
