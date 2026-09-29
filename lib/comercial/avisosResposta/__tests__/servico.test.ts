import { describe, it, expect, beforeEach } from 'vitest'
import { MemoryAvisoRespostaRepository } from './memoryRepository'
import {
  avisarRespostaCliente, reprocessarAvisosResposta, MAX_TENTATIVAS_AVISO,
  type DepsAvisoResposta,
} from '../servico'
import type { EntradaAvisoResposta, ModoAvisoResposta, ResultadoEnvioAviso } from '../types'

const ORG = 'org-a'
const OUTRA = 'org-b'

function montar(modo: ModoAvisoResposta | null = 'ambos') {
  const repo = new MemoryAvisoRespostaRepository()
  const enviados: { tipo: 'individual' | 'grupo'; destino: string; mensagem: string }[] = []
  const estado = {
    modo,
    grupo: '120363019502650977-group' as string | null,
    numero: '5511999998888' as string | null,
    numeroPerfil: '5521988887777' as string | null,
    provedor: true,
    falhar: false,
    agora: new Date('2026-09-28T12:00:00Z'),
  }
  const resultado = (): ResultadoEnvioAviso => (estado.falhar ? { ok: false, codigo: 'erro_provider', mensagem: 'Z-API 500' } : { ok: true, providerMessageId: 'z1' })
  const deps: DepsAvisoResposta = {
    repo,
    lerModo: async (org) => (org === ORG ? estado.modo : null),
    lerGrupoId: async () => estado.grupo,
    lerContextoLead: async (org, leadId) =>
      org === ORG && leadId === 'lead-1' ? { empresa: 'ACME', contato: 'Ana', responsavel: { id: 'bruno', nome: 'Bruno' } } : null,
    lerWhatsappResponsavel: async (org, perfilId) => (org === ORG && perfilId === 'bruno' ? estado.numero : null),
    lerWhatsappPerfil: async (org, perfilId) => (org === ORG && perfilId === 'perfil-aline' ? estado.numeroPerfil : null),
    enviarIndividual: async (destino, mensagem) => { enviados.push({ tipo: 'individual', destino, mensagem }); return resultado() },
    enviarGrupo: async (destino, mensagem) => { enviados.push({ tipo: 'grupo', destino, mensagem }); return resultado() },
    provedorConfigurado: () => estado.provedor,
    linkLead: (id) => `https://app.exemplo/leads/${id}`,
    agora: () => estado.agora,
  }
  repo.agora = () => estado.agora
  return { repo, deps, enviados, estado }
}

const entrada = (over: Partial<EntradaAvisoResposta> = {}): EntradaAvisoResposta => ({
  organizacaoId: ORG, leadId: 'lead-1', eventoId: 'email:<m1@acme>', canal: 'email',
  classificacao: 'neutro', texto: 'Pode me ligar amanhã?\n\nEm 10/09, Vendas escreveu:\n> proposta', ...over,
})

describe('avisarRespostaCliente', () => {
  let t: ReturnType<typeof montar>
  beforeEach(() => { t = montar() })

  it('org sem modo configurado = desligado: nada registrado nem enviado', async () => {
    t.estado.modo = null
    expect(await avisarRespostaCliente(t.deps, entrada())).toEqual({ tipo: 'desligado' })
    expect(t.repo.linhas).toHaveLength(0)
    expect(t.enviados).toHaveLength(0)
  })

  it('modo "ambos": avisa o responsável no número dele e o grupo com menção', async () => {
    const r = await avisarRespostaCliente(t.deps, entrada())
    expect(r.tipo).toBe('processado')
    expect(t.enviados.map((e) => [e.tipo, e.destino])).toEqual([
      ['individual', '5511999998888'],
      ['grupo', '120363019502650977-group'],
    ])
    const grupo = t.enviados[1].mensagem
    expect(grupo).toContain('@Bruno, ACME respondeu por e-mail.')
    expect(grupo).toContain('Leitura automática: sem sinal claro de interesse')
    expect(grupo).toContain('"Pode me ligar amanhã?"')
    expect(grupo).not.toContain('proposta') // histórico citado fica de fora
    expect(grupo).toContain('Abrir: https://app.exemplo/leads/lead-1')
    expect(t.enviados[0].mensagem).not.toContain('@Bruno')
    expect(t.repo.linhas.every((a) => a.status === 'enviada')).toBe(true)
  })

  it('modo "responsavel" só manda no privado; "grupo" só no grupo', async () => {
    t.estado.modo = 'responsavel'
    await avisarRespostaCliente(t.deps, entrada())
    expect(t.enviados.map((e) => e.tipo)).toEqual(['individual'])

    const g = montar('grupo')
    await avisarRespostaCliente(g.deps, entrada())
    expect(g.enviados.map((e) => e.tipo)).toEqual(['grupo'])
  })

  it('grupo já avisado pelo handoff: não duplica no grupo', async () => {
    await avisarRespostaCliente(t.deps, entrada({ classificacao: 'positivo', grupoJaAvisado: true }))
    expect(t.enviados.map((e) => e.tipo)).toEqual(['individual'])

    const g = montar('grupo')
    expect(await avisarRespostaCliente(g.deps, entrada({ grupoJaAvisado: true }))).toEqual({ tipo: 'sem_destino' })
    expect(g.enviados).toHaveLength(0)
  })

  it('a mesma resposta processada de novo não avisa duas vezes', async () => {
    await avisarRespostaCliente(t.deps, entrada())
    await avisarRespostaCliente(t.deps, entrada())
    expect(t.enviados).toHaveLength(2) // um por destino, uma vez só
    expect(t.repo.linhas).toHaveLength(2)
  })

  it('anti-spam: outra mensagem do mesmo lead em menos de 1 min é agrupada; depois disso avisa', async () => {
    await avisarRespostaCliente(t.deps, entrada({ eventoId: 'whatsapp:1', canal: 'whatsapp', classificacao: null }))
    t.estado.agora = new Date('2026-09-28T12:00:40Z')
    expect(await avisarRespostaCliente(t.deps, entrada({ eventoId: 'whatsapp:2', canal: 'whatsapp', classificacao: null }))).toEqual({ tipo: 'agrupado' })
    t.estado.agora = new Date('2026-09-28T12:01:10Z')
    expect((await avisarRespostaCliente(t.deps, entrada({ eventoId: 'whatsapp:3', canal: 'whatsapp', classificacao: null }))).tipo).toBe('processado')
    expect(t.enviados).toHaveLength(4)
    expect(t.enviados[0].mensagem).toContain('respondeu por WhatsApp')
    expect(t.enviados[0].mensagem).not.toContain('Leitura automática') // WhatsApp não é classificado
  })

  it('responsável sem número: fica em configuracao_ausente sem gastar tentativa e sai quando ele cadastrar', async () => {
    t.estado.modo = 'responsavel'
    t.estado.numero = null
    const r = await avisarRespostaCliente(t.deps, entrada())
    expect(r.tipo === 'processado' && r.resultados[0].tipo).toBe('configuracao_ausente')
    expect(t.repo.linhas[0]).toMatchObject({ status: 'configuracao_ausente', tentativas: 0 })
    expect(t.enviados).toHaveLength(0)

    t.estado.numero = '5511999998888'
    expect(await reprocessarAvisosResposta(t.deps, ORG)).toEqual({ tentados: 1, enviados: 1 })
    expect(t.repo.linhas[0].status).toBe('enviada')
  })

  it('Z-API não configurada: não chama o provedor nem gasta tentativa', async () => {
    t.estado.provedor = false
    await avisarRespostaCliente(t.deps, entrada())
    expect(t.enviados).toHaveLength(0)
    expect(t.repo.linhas.every((a) => a.status === 'configuracao_ausente' && a.tentativas === 0)).toBe(true)
  })

  it('falha do provedor: falhou, reprocessa e para no teto de tentativas', async () => {
    t.estado.modo = 'responsavel'
    t.estado.falhar = true
    await avisarRespostaCliente(t.deps, entrada())
    expect(t.repo.linhas[0]).toMatchObject({ status: 'falhou', tentativas: 1 })
    for (let i = 0; i < 10; i++) await reprocessarAvisosResposta(t.deps, ORG)
    expect(t.repo.linhas[0].tentativas).toBe(MAX_TENTATIVAS_AVISO)
    expect(t.enviados).toHaveLength(MAX_TENTATIVAS_AVISO)
  })

  it('pendência com mais de 24h não é mais reprocessada', async () => {
    t.estado.numero = null
    t.estado.modo = 'responsavel'
    await avisarRespostaCliente(t.deps, entrada())
    t.estado.numero = '5511999998888'
    t.estado.agora = new Date('2026-09-29T13:00:00Z')
    expect(await reprocessarAvisosResposta(t.deps, ORG)).toEqual({ tentados: 0, enviados: 0 })
  })

  it('lead de outra organização não é encontrado nem avisado', async () => {
    t.deps.lerModo = async () => 'ambos'
    expect(await avisarRespostaCliente(t.deps, entrada({ organizacaoId: OUTRA }))).toEqual({ tipo: 'lead_nao_encontrado' })
    expect(t.enviados).toHaveLength(0)
    expect(await reprocessarAvisosResposta(t.deps, OUTRA)).toEqual({ tentados: 0, enviados: 0 })
  })

  it('aviso "enviando" preso não é reenviado', async () => {
    t.estado.modo = 'responsavel'
    await avisarRespostaCliente(t.deps, entrada())
    t.repo.linhas[0].status = 'enviando'
    const r = await avisarRespostaCliente(t.deps, entrada())
    expect(r.tipo === 'processado' && r.resultados[0].tipo).toBe('incerta')
    expect(t.enviados).toHaveLength(1)
  })
})

describe('avisarRespostaCliente — aviso escolhido na campanha', () => {
  let t: ReturnType<typeof montar>
  beforeEach(() => { t = montar(null) })

  it('org desligada + campanha pede o responsável: avisa só o responsável no privado', async () => {
    const r = await avisarRespostaCliente(t.deps, entrada({ destinosCampanha: ['responsavel'] }))
    expect(r.tipo).toBe('processado')
    expect(t.enviados.map((e) => [e.tipo, e.destino])).toEqual([['individual', '5511999998888']])
  })

  it('a escolha da campanha SUBSTITUI a da organização: org "ambos", campanha só grupo', async () => {
    t.estado.modo = 'ambos'
    await avisarRespostaCliente(t.deps, entrada({ destinosCampanha: ['grupo'] }))
    expect(t.enviados.map((e) => e.tipo)).toEqual(['grupo'])
  })

  it('campanha sem WhatsApp ([]): ninguém é avisado, mesmo com a org em "ambos"', async () => {
    t.estado.modo = 'ambos'
    expect(await avisarRespostaCliente(t.deps, entrada({ destinosCampanha: [] }))).toEqual({ tipo: 'desligado' })
    expect(t.repo.linhas).toHaveLength(0)
  })

  it('responsável e grupo, sem destino repetido', async () => {
    await avisarRespostaCliente(t.deps, entrada({ destinosCampanha: ['grupo', 'responsavel', 'grupo'] }))
    expect(t.repo.linhas.map((a) => a.destinoTipo)).toEqual(['responsavel', 'grupo'])
  })

  it('grupo próprio da campanha vai no lugar do grupo da conta, também no reprocesso', async () => {
    t.estado.provedor = false
    const r = await avisarRespostaCliente(t.deps, entrada({ destinosCampanha: ['grupo'], grupoIdCampanha: '120363000000000001-group' }))
    expect(r.tipo === 'processado' && r.resultados[0].tipo).toBe('configuracao_ausente')
    t.estado.provedor = true
    expect(await reprocessarAvisosResposta(t.deps, ORG)).toEqual({ tentados: 1, enviados: 1 })
    expect(t.enviados[0].destino).toBe('120363000000000001-group')
  })

  it('sem grupo próprio, usa o grupo da conta', async () => {
    await avisarRespostaCliente(t.deps, entrada({ destinosCampanha: ['grupo'], grupoIdCampanha: null }))
    expect(t.enviados[0].destino).toBe('120363019502650977-group')
  })

  it('responsável definido pela campanha: vai para o número do PERFIL dele e é ele na menção do grupo', async () => {
    await avisarRespostaCliente(t.deps, entrada({
      destinosCampanha: ['responsavel', 'grupo'],
      responsavelPerfil: { id: 'perfil-aline', nome: 'Aline' },
    }))
    expect(t.enviados.map((e) => [e.tipo, e.destino])).toEqual([
      ['individual', '5521988887777'],
      ['grupo', '120363019502650977-group'],
    ])
    expect(t.enviados[1].mensagem).toContain('@Aline, ACME respondeu por e-mail.')
    expect(t.repo.linhas[0].dados).toMatchObject({ responsavelPerfilId: 'perfil-aline', responsavelId: 'bruno', responsavelNome: 'Aline' })
  })

  it('responsável da campanha sem WhatsApp de avisos: fica em configuracao_ausente e sai quando ele cadastrar', async () => {
    t.estado.numeroPerfil = null
    const r = await avisarRespostaCliente(t.deps, entrada({ destinosCampanha: ['responsavel'], responsavelPerfil: { id: 'perfil-aline', nome: 'Aline' } }))
    expect(r.tipo === 'processado' && r.resultados[0].tipo).toBe('configuracao_ausente')
    t.estado.numeroPerfil = '5521988887777'
    expect(await reprocessarAvisosResposta(t.deps, ORG)).toEqual({ tentados: 1, enviados: 1 })
    expect(t.enviados[0].destino).toBe('5521988887777')
  })

  it('resposta sem escolha da campanha segue a organização (desligada = desligado)', async () => {
    expect(await avisarRespostaCliente(t.deps, entrada())).toEqual({ tipo: 'desligado' })
  })
})
