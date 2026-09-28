import type { AvisoResposta, DadosAvisoResposta, DestinoAvisoResposta } from './types'

// Persistência do outbox de avisos (avisos_resposta_cliente, migration 0053).
// Toda operação é da organização informada — nunca cruza orgs.
export interface AvisoRespostaRepository {
  // Idempotente por (org, evento, destino): repetir devolve o existente.
  registrar(org: string, entrada: { leadId: string; eventoId: string; destinoTipo: DestinoAvisoResposta; dados: DadosAvisoResposta }): Promise<AvisoResposta>
  listarPorEvento(org: string, eventoId: string): Promise<AvisoResposta[]>
  // Houve aviso deste lead desde o instante (anti-spam)?
  existeDesde(org: string, leadId: string, desdeISO: string): Promise<boolean>
  buscar(org: string, id: string): Promise<AvisoResposta | null>
  // Compare-and-swap: status reclamável + tentativas esperadas → enviando.
  reivindicarEnvio(org: string, id: string, tentativasEsperadas: number): Promise<boolean>
  marcarEnviada(org: string, id: string, info: { destino: string; providerMessageId: string | null }): Promise<void>
  marcarFalha(org: string, id: string, erro: string): Promise<void>
  marcarConfiguracaoAusente(org: string, id: string, motivo: string): Promise<void>
  listarReprocessaveis(org: string, tetoTentativas: number, desdeISO: string, limite: number): Promise<AvisoResposta[]>
}
