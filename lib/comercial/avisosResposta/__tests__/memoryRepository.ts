// Fake em memória do outbox de avisos (mesmas regras do Supabase: unique
// org+evento+destino, compare-and-swap em tentativas, escopo por org).
import type { AvisoRespostaRepository } from '../repository'
import type { AvisoResposta, DadosAvisoResposta, DestinoAvisoResposta, StatusAvisoResposta } from '../types'

const RECLAMAVEIS = new Set<StatusAvisoResposta>(['pendente', 'falhou', 'configuracao_ausente'])

export class MemoryAvisoRespostaRepository implements AvisoRespostaRepository {
  linhas: AvisoResposta[] = []
  private seq = 0
  // Relógio das linhas criadas (o serviço compara com a janela anti-spam).
  agora = () => new Date('2026-09-28T12:00:00Z')

  async registrar(org: string, e: { leadId: string; eventoId: string; destinoTipo: DestinoAvisoResposta; dados: DadosAvisoResposta }): Promise<AvisoResposta> {
    const existente = this.linhas.find((a) => a.organizacaoId === org && a.eventoId === e.eventoId && a.destinoTipo === e.destinoTipo)
    if (existente) return { ...existente }
    const novo: AvisoResposta = {
      id: `a${++this.seq}`, organizacaoId: org, leadId: e.leadId, eventoId: e.eventoId, destinoTipo: e.destinoTipo,
      status: 'pendente', tentativas: 0, ultimoErro: null, dados: { ...e.dados }, destino: null,
      providerMessageId: null, enviadoEm: null, criadoEm: this.agora().toISOString(),
    }
    this.linhas.push(novo)
    return { ...novo }
  }

  async listarPorEvento(org: string, eventoId: string) {
    return this.linhas.filter((a) => a.organizacaoId === org && a.eventoId === eventoId).map((a) => ({ ...a }))
  }

  async existeDesde(org: string, leadId: string, desdeISO: string) {
    return this.linhas.some((a) => a.organizacaoId === org && a.leadId === leadId && a.criadoEm >= desdeISO)
  }

  async buscar(org: string, id: string) {
    const a = this.linhas.find((x) => x.organizacaoId === org && x.id === id)
    return a ? { ...a } : null
  }

  private linha(org: string, id: string) {
    return this.linhas.find((x) => x.organizacaoId === org && x.id === id)
  }

  async reivindicarEnvio(org: string, id: string, tentativasEsperadas: number) {
    const a = this.linha(org, id)
    if (!a || !RECLAMAVEIS.has(a.status) || a.tentativas !== tentativasEsperadas) return false
    a.status = 'enviando'; a.tentativas = tentativasEsperadas + 1; a.ultimoErro = null
    return true
  }

  async marcarEnviada(org: string, id: string, info: { destino: string; providerMessageId: string | null }) {
    const a = this.linha(org, id)
    if (a) Object.assign(a, { status: 'enviada', destino: info.destino, providerMessageId: info.providerMessageId, enviadoEm: this.agora().toISOString(), ultimoErro: null })
  }

  async marcarFalha(org: string, id: string, erro: string) {
    const a = this.linha(org, id)
    if (a) Object.assign(a, { status: 'falhou', ultimoErro: erro })
  }

  async marcarConfiguracaoAusente(org: string, id: string, motivo: string) {
    const a = this.linha(org, id)
    if (a && RECLAMAVEIS.has(a.status)) Object.assign(a, { status: 'configuracao_ausente', ultimoErro: motivo })
  }

  async listarReprocessaveis(org: string, teto: number, desdeISO: string, limite: number) {
    return this.linhas
      .filter((a) => a.organizacaoId === org && RECLAMAVEIS.has(a.status) && a.tentativas < teto && a.criadoEm >= desdeISO)
      .slice(0, limite)
      .map((a) => ({ ...a }))
  }
}
