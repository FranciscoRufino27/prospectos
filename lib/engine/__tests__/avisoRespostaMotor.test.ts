// Aviso de resposta do cliente NO MOTOR: detectarResposta chama o hook
// `avisarResposta` para TODA resposta humana registrada, com a classificação
// só quando ela foi feita, e uma falha no aviso nunca derruba a detecção.
import { describe, it, expect, beforeEach } from 'vitest'
import { MemoryStore } from '../store/memoryStore'
import { SimulatedProvider } from '../email/simulatedProvider'
import { Queue } from '../queue'
import { detectarResposta } from '../flows/detectarResposta'
import { direcionarCloser, type PayloadDirecionarCloser } from '../flows/direcionarCloser'
import type { ContextoCampanhaResposta, MensagemRecebida } from '../types'
import { makeLead, SEMANA_PASSADA } from './helpers'
import type { ClassificacaoResposta } from '@/lib/comercial/respostas/classificarResposta'
import type { EntradaGatilhoProspeccao, ResultadoGatilhoProspeccao } from '@/lib/comercial/handoff/gatilhoProspeccao'
import type { EntradaAvisoResposta } from '@/lib/comercial/avisosResposta/types'

function msg(over: Partial<MensagemRecebida> = {}): MensagemRecebida {
  return {
    de: 'ana@acme.com.br', assunto: 'Re: proposta', corpo: over.corpo ?? 'Tenho interesse.',
    em: new Date(), mensagemId: over.mensagemId ?? '<m1@acme>',
  }
}

const classificar = (c: ClassificacaoResposta) => async () => ({ classificacao: c, via: 'ia' as const })

class StoreTeste extends MemoryStore {
  readonly organizacaoId = 'org-a'
  contexto: ContextoCampanhaResposta | null = null
  async cancelarExecucoesWorkflow() {}
  async buscarContextoCampanhaAtiva() { return this.contexto }
}

function avisoFake(falhar = false) {
  const chamadas: EntradaAvisoResposta[] = []
  const hook = async (e: EntradaAvisoResposta) => {
    chamadas.push(e)
    if (falhar) throw new Error('Z-API fora')
    return { tipo: 'processado' }
  }
  return { hook, chamadas }
}

// Gatilho de handoff mínimo: registra a ordem das chamadas.
function handoffFake(ordem: string[]) {
  return async (e: EntradaGatilhoProspeccao): Promise<ResultadoGatilhoProspeccao> => {
    ordem.push('handoff')
    return { handoff: { tipo: 'ja_processado', handoff: { id: 'h1', organizacaoId: e.organizacaoId, leadId: e.leadId } } as never, responsavel: null, notificacao: null }
  }
}

describe('aviso de resposta no motor', () => {
  let email: SimulatedProvider
  let fila: Queue
  beforeEach(() => { email = new SimulatedProvider(); fila = new Queue() })

  const leadEmCadencia = () => makeLead({ estagio: 'primeiro_contato', contato_email: 'ana@acme.com.br', ultimo_contato: SEMANA_PASSADA })

  it('resposta NEGATIVA: avisa com a classificação, sem grupo já avisado', async () => {
    const store = new StoreTeste([leadEmCadencia()])
    const a = avisoFake()
    email.injetar(msg({ corpo: 'Não temos interesse.' }))
    await detectarResposta(store, email, fila, { classificarResposta: classificar('negativo'), avisarResposta: a.hook })
    expect(a.chamadas).toHaveLength(1)
    expect(a.chamadas[0]).toMatchObject({
      organizacaoId: 'org-a', eventoId: 'email:<m1@acme>', canal: 'email', classificacao: 'negativo',
      texto: 'Não temos interesse.', grupoJaAvisado: false,
    })
  })

  it('resposta POSITIVA com handoff: avisa DEPOIS do handoff e marca o grupo como já avisado', async () => {
    const store = new StoreTeste([leadEmCadencia()])
    const ordem: string[] = []
    const a = avisoFake()
    const aviso = async (e: EntradaAvisoResposta) => { ordem.push('aviso'); return a.hook(e) }
    email.injetar(msg())
    await detectarResposta(store, email, fila, { classificarResposta: classificar('positivo'), handoffProspeccao: handoffFake(ordem), avisarResposta: aviso })
    expect(ordem).toEqual(['handoff', 'aviso'])
    expect(a.chamadas[0]).toMatchObject({ classificacao: 'positivo', grupoJaAvisado: true })
  })

  it('positiva SEM rodízio (sem hook de handoff): grupo não foi avisado', async () => {
    const store = new StoreTeste([leadEmCadencia()])
    const a = avisoFake()
    email.injetar(msg())
    await detectarResposta(store, email, fila, { classificarResposta: classificar('positivo'), avisarResposta: a.hook })
    expect(a.chamadas[0]).toMatchObject({ classificacao: 'positivo', grupoJaAvisado: false })
  })

  it('resposta fora da prospecção (campanha de renovação): avisa sem classificação', async () => {
    const lead = makeLead({ estagio: 'interessado', contato_email: 'ana@acme.com.br', ultimo_contato: SEMANA_PASSADA })
    const store = new StoreTeste([lead])
    store.contexto = {
      id: 'c1', execucaoId: 'e1', iniciadoEm: SEMANA_PASSADA, execucaoStatus: 'aguardando', cicloChave: null, nome: 'Renovação',
      tipo: 'renovacao', responsavel: null, notificarResponsavel: true, emailAssunto: null, emailCorpo: null, emailHtml: null,
    }
    const a = avisoFake()
    email.injetar(msg())
    await detectarResposta(store, email, fila, { classificarResposta: classificar('negativo'), avisarResposta: a.hook })
    expect(a.chamadas).toHaveLength(1)
    expect(a.chamadas[0].classificacao).toBeNull()
  })

  it('falha no aviso não derruba a detecção: resposta registrada e closer enfileirado', async () => {
    const lead = leadEmCadencia()
    const store = new StoreTeste([lead])
    const a = avisoFake(true)
    email.injetar(msg())
    const r = await detectarResposta(store, email, fila, { classificarResposta: classificar('positivo'), avisarResposta: a.hook })
    expect(r.respostas).toBe(1)
    expect(a.chamadas).toHaveLength(1)
    expect((await store.buscarLead(lead.id))?.estagio).toBe('interessado')
    const closer: unknown[] = []
    fila.registrar('direcionar_closer', async (p) => { closer.push(p) })
    await fila.processar()
    expect(closer).toHaveLength(1)
  })

  it('sem hook (scripts/testes antigos): comportamento de sempre', async () => {
    const store = new StoreTeste([leadEmCadencia()])
    email.injetar(msg())
    const r = await detectarResposta(store, email, fila, { classificarResposta: classificar('positivo') })
    expect(r.respostas).toBe(1)
  })
})

describe('aviso de resposta — escolha da campanha', () => {
  let email: SimulatedProvider
  let fila: Queue
  beforeEach(() => { email = new SimulatedProvider(); fila = new Queue() })

  const aline = { id: 'perfil-aline', nome: 'Aline', email: 'aline@org.com.br' }
  const contexto = (over: Partial<ContextoCampanhaResposta> = {}): ContextoCampanhaResposta => ({
    id: 'c1', execucaoId: 'e1', iniciadoEm: SEMANA_PASSADA, execucaoStatus: 'aguardando', cicloChave: null, nome: 'Renovação',
    tipo: 'renovacao', responsavel: aline, notificarResponsavel: true, emailAssunto: null, emailCorpo: null, emailHtml: null,
    ...over,
  })
  const leadRenovacao = (over: Parameters<typeof makeLead>[0] = {}) =>
    makeLead({ estagio: 'renovacao', contato_email: 'ana@acme.com.br', ultimo_contato: SEMANA_PASSADA, ...over })

  it('responsável geral + grupo próprio: destinos, pessoa e grupo da campanha vão para o aviso', async () => {
    const store = new StoreTeste([leadRenovacao({ responsavel_id: 'usuario-bruno' })])
    store.contexto = contexto({ avisoRetorno: { email: false, whatsapp: ['responsavel', 'grupo'], grupoWhatsappId: '120363000000000001-group' } })
    const a = avisoFake()
    email.injetar(msg())
    await detectarResposta(store, email, fila, { avisarResposta: a.hook })
    expect(a.chamadas[0]).toMatchObject({
      destinosCampanha: ['responsavel', 'grupo'],
      responsavelPerfil: { id: 'perfil-aline', nome: 'Aline' },
      grupoIdCampanha: '120363000000000001-group',
    })
  })

  it('carteira com dono no lead: o WhatsApp individual vai para o dono (sem responsável da campanha)', async () => {
    const store = new StoreTeste([leadRenovacao({ responsavel_id: 'usuario-bruno' })])
    store.contexto = contexto({ avisoRetorno: { email: true, whatsapp: ['responsavel'] }, retornoParaResponsavelDoLead: true })
    const a = avisoFake()
    email.injetar(msg())
    await detectarResposta(store, email, fila, { avisarResposta: a.hook })
    expect(a.chamadas[0]).toMatchObject({ destinosCampanha: ['responsavel'], responsavelPerfil: null, grupoIdCampanha: null })
  })

  it('carteira com lead sem dono: cai no responsável da campanha, como o e-mail', async () => {
    const store = new StoreTeste([leadRenovacao({ responsavel_id: undefined })])
    store.contexto = contexto({ avisoRetorno: { email: true, whatsapp: ['responsavel'] }, retornoParaResponsavelDoLead: true })
    const a = avisoFake()
    email.injetar(msg())
    await detectarResposta(store, email, fila, { avisarResposta: a.hook })
    expect(a.chamadas[0].responsavelPerfil).toEqual({ id: 'perfil-aline', nome: 'Aline' })
  })

  it('só e-mail: a campanha manda destinos vazios (nenhum WhatsApp)', async () => {
    const store = new StoreTeste([leadRenovacao()])
    store.contexto = contexto({ avisoRetorno: { email: true, whatsapp: [] } })
    const a = avisoFake()
    email.injetar(msg())
    await detectarResposta(store, email, fila, { avisarResposta: a.hook })
    expect(a.chamadas[0].destinosCampanha).toEqual([])
  })

  it('campanha anterior à escolha: nada muda — só a regra da organização', async () => {
    const store = new StoreTeste([leadRenovacao()])
    store.contexto = contexto()
    const a = avisoFake()
    email.injetar(msg())
    await detectarResposta(store, email, fila, { avisarResposta: a.hook })
    expect(a.chamadas[0].destinosCampanha).toBeUndefined()
    expect(a.chamadas[0].responsavelPerfil).toBeUndefined()
  })

  it('sem e-mail marcado: o Fluxo 3 não manda e-mail de retorno ao responsável', async () => {
    const lead = leadRenovacao()
    const store = new StoreTeste([lead])
    store.contexto = contexto({ avisoRetorno: { email: false, whatsapp: ['grupo'] }, notificarResponsavel: false })
    const a = avisoFake()
    email.injetar(msg())
    await detectarResposta(store, email, fila, { avisarResposta: a.hook })
    fila.registrar('direcionar_closer', (p) => direcionarCloser(store, email, p as PayloadDirecionarCloser))
    await fila.processar()
    expect(email.enviados).toHaveLength(0)
    expect(a.chamadas).toHaveLength(1)
    expect((await store.buscarLead(lead.id))?.estagio).toBe('interessado')
  })
})
