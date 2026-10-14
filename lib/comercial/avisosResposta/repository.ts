import type { AvisoResposta, DadosAvisoResposta, DestinoAvisoResposta, TipoAviso } from './types'

// Persistência do outbox de avisos (avisos_resposta_cliente, migrations 0053/0067).
// Toda operação é da organização informada — nunca cruza orgs.
export interface AvisoRespostaRepository {
  // Idempotente por (org, evento, destino): repetir devolve o existente.
  // tipo ausente = 'resposta'.
  registrar(org: string, entrada: { leadId: string; eventoId: string; destinoTipo: DestinoAvisoResposta; dados: DadosAvisoResposta; tipo?: TipoAviso }): Promise<AvisoResposta>
  listarPorEvento(org: string, eventoId: string): Promise<AvisoResposta[]>
  // Houve aviso de RESPOSTA deste lead desde o instante (anti-spam)? Avisos de
  // envio não contam: não podem abafar a resposta que vier logo depois.
  existeDesde(org: string, leadId: string, desdeISO: string): Promise<boolean>
  buscar(org: string, id: string): Promise<AvisoResposta | null>
  // Compare-and-swap: status reclamável + tentativas esperadas → enviando.
  reivindicarEnvio(org: string, id: string, tentativasEsperadas: number): Promise<boolean>
  marcarEnviada(org: string, id: string, info: { destino: string; providerMessageId: string | null }): Promise<void>
  marcarFalha(org: string, id: string, erro: string): Promise<void>
  marcarConfiguracaoAusente(org: string, id: string, motivo: string): Promise<void>
  listarReprocessaveis(org: string, tetoTentativas: number, desdeISO: string, limite: number): Promise<AvisoResposta[]>
}
