// Pré-condições do aviso de resposta escolhido na campanha, conferidas antes
// de sair do ensaio: grupo marcado precisa existir e, sem e-mail, a resposta
// tem de chegar a alguém pelo WhatsApp.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BancoFalso } from '@/lib/templates/__tests__/bancoFalso'
import { normalizarPublicoCampanha } from '../configuracaoGuiada'

// Números de avisos por perfil/usuário — a leitura real (ponte usuarios →
// perfil + perfis.whatsapp_avisos) é do módulo de avisos.
const numeros = vi.hoisted(() => ({
  perfil: new Map<string, string>(),
  usuario: new Map<string, string>(),
}))
vi.mock('@/lib/comercial/avisosResposta/composicao', () => ({
  lerWhatsappDoPerfil: async (_admin: unknown, _org: string, id: string) => numeros.perfil.get(id) ?? null,
  lerWhatsappResponsavel: async (_admin: unknown, _org: string, id: string) => numeros.usuario.get(id) ?? null,
}))

import { exigirAvisoRetornoPronto, perfisComWhatsappAvisos } from '../retornoWhatsappServidor'

const ORG = 'org-a'
const OUTRA = 'org-b'
const GRUPO_CONTA = '120363019502650977-group'
const ENV_ZAPI = { ZAPI_INSTANCE_ID: 'i', ZAPI_TOKEN: 't', ZAPI_CLIENT_TOKEN: 'c' } as const

function banco(opcoes: { grupoConta?: string | null } = {}) {
  const grupo = opcoes.grupoConta === undefined ? GRUPO_CONTA : opcoes.grupoConta
  return new BancoFalso({
    organizacoes: [
      { id: ORG, configuracoes: grupo ? { comercial: { grupoWhatsappId: grupo } } : {} },
      { id: OUTRA, configuracoes: { comercial: { grupoWhatsappId: '120363999999999999-group' } } },
    ],
    leads: [
      { id: 'l1', organizacao_id: ORG, responsavel_id: 'u-bruno' },
      { id: 'l2', organizacao_id: ORG, responsavel_id: 'u-sofie' },
      { id: 'l3', organizacao_id: ORG, responsavel_id: null },
      { id: 'l9', organizacao_id: OUTRA, responsavel_id: 'u-intruso' },
    ],
    usuarios: [
      { id: 'u-bruno', organizacao_id: ORG, nome: 'Bruno' },
      { id: 'u-sofie', organizacao_id: ORG, nome: 'Sofie' },
      { id: 'u-intruso', organizacao_id: OUTRA, nome: 'Intruso' },
    ],
    perfis: [
      { id: 'p-aline', organizacao_id: ORG, nome: 'Aline', avisos_whatsapp_ativo: true, whatsapp_avisos: '(21) 98888-7777' },
      { id: 'p-desligado', organizacao_id: ORG, nome: 'Carla', avisos_whatsapp_ativo: false, whatsapp_avisos: '(21) 97777-6666' },
      { id: 'p-invalido', organizacao_id: ORG, nome: 'Dani', avisos_whatsapp_ativo: true, whatsapp_avisos: '123' },
      { id: 'p-outra', organizacao_id: OUTRA, nome: 'Outra', avisos_whatsapp_ativo: true, whatsapp_avisos: '(11) 96666-5555' },
    ],
  })
}

const publico = (aviso: Record<string, unknown>, over: Record<string, unknown> = {}) => normalizarPublicoCampanha({
  responsavel_id: 'p-aline',
  operacao: { resposta: { aviso } },
  ...over,
})
const soWhatsappResponsavel = { email: false, whatsapp: ['responsavel'] }

describe('exigirAvisoRetornoPronto', () => {
  const envAnterior: Record<string, string | undefined> = {}
  beforeEach(() => {
    numeros.perfil.clear()
    numeros.usuario.clear()
    for (const [k, v] of Object.entries(ENV_ZAPI)) { envAnterior[k] = process.env[k]; process.env[k] = v }
  })
  afterEach(() => {
    for (const k of Object.keys(ENV_ZAPI)) {
      if (envAnterior[k] === undefined) delete process.env[k]
      else process.env[k] = envAnterior[k]
    }
  })

  it('campanha antiga (sem escolha) nunca bloqueia', async () => {
    await expect(exigirAvisoRetornoPronto(banco().cliente(), ORG, normalizarPublicoCampanha({}), ['l1'])).resolves.toBeUndefined()
  })

  it('com e-mail marcado, falta de Z-API ou de número não bloqueia (o e-mail chega)', async () => {
    delete process.env.ZAPI_TOKEN
    await expect(exigirAvisoRetornoPronto(banco().cliente(), ORG, publico({ email: true, whatsapp: ['responsavel'] }), ['l1']))
      .resolves.toBeUndefined()
  })

  it('nenhum canal marcado bloqueia', async () => {
    await expect(exigirAvisoRetornoPronto(banco().cliente(), ORG, publico({ email: false, whatsapp: [] }), ['l1']))
      .rejects.toThrow('ao menos um canal')
  })

  it('grupo marcado sem grupo na campanha nem na conta bloqueia, mesmo com e-mail', async () => {
    await expect(exigirAvisoRetornoPronto(banco({ grupoConta: null }).cliente(), ORG, publico({ email: true, whatsapp: ['grupo'] }), ['l1']))
      .rejects.toThrow('não há grupo')
  })

  it('grupo da campanha supre a falta de grupo na conta', async () => {
    await expect(exigirAvisoRetornoPronto(
      banco({ grupoConta: null }).cliente(), ORG,
      publico({ email: false, whatsapp: ['grupo'], grupoWhatsappId: '120363000000000001-group' }), ['l1'],
    )).resolves.toBeUndefined()
  })

  it('só WhatsApp sem Z-API bloqueia', async () => {
    delete process.env.ZAPI_TOKEN
    numeros.perfil.set('p-aline', '5521988887777')
    await expect(exigirAvisoRetornoPronto(banco().cliente(), ORG, publico(soWhatsappResponsavel), ['l1'])).rejects.toThrow('Z-API')
  })

  it('só WhatsApp: responsável geral com número libera; sem número bloqueia com o nome', async () => {
    await expect(exigirAvisoRetornoPronto(banco().cliente(), ORG, publico(soWhatsappResponsavel), ['l1'])).rejects.toThrow('Aline ainda não ligou')
    numeros.perfil.set('p-aline', '5521988887777')
    await expect(exigirAvisoRetornoPronto(banco().cliente(), ORG, publico(soWhatsappResponsavel), ['l1'])).resolves.toBeUndefined()
  })

  it('só WhatsApp com o grupo marcado: responsável sem número não bloqueia (o grupo recebe)', async () => {
    await expect(exigirAvisoRetornoPronto(banco().cliente(), ORG, publico({ email: false, whatsapp: ['responsavel', 'grupo'] }), ['l1']))
      .resolves.toBeUndefined()
  })

  it('carteira: lista os donos sem número (e o responsável da campanha, se houver lead sem dono)', async () => {
    numeros.usuario.set('u-bruno', '5511999998888')
    const p = publico(soWhatsappResponsavel, { retornoPara: 'lead' })
    await expect(exigirAvisoRetornoPronto(banco().cliente(), ORG, p, ['l1', 'l2', 'l3']))
      .rejects.toThrow('Sofie, Aline ainda não ligaram')
    numeros.usuario.set('u-sofie', '5511977776666')
    numeros.perfil.set('p-aline', '5521988887777')
    await expect(exigirAvisoRetornoPronto(banco().cliente(), ORG, p, ['l1', 'l2', 'l3'])).resolves.toBeUndefined()
  })

  it('carteira sem lead órfão não exige o número do responsável da campanha', async () => {
    numeros.usuario.set('u-bruno', '5511999998888')
    numeros.usuario.set('u-sofie', '5511977776666')
    await expect(exigirAvisoRetornoPronto(banco().cliente(), ORG, publico(soWhatsappResponsavel, { retornoPara: 'lead' }), ['l1', 'l2']))
      .resolves.toBeUndefined()
  })

  it('lead e grupo de outra organização não entram na conta', async () => {
    numeros.usuario.set('u-bruno', '5511999998888')
    // l9 é da OUTRA org: o dono dela (sem número) não pode bloquear nem vazar o nome.
    await expect(exigirAvisoRetornoPronto(banco().cliente(), ORG, publico(soWhatsappResponsavel, { retornoPara: 'lead' }), ['l1', 'l9']))
      .resolves.toBeUndefined()
    // O grupo da OUTRA org não serve para esta.
    await expect(exigirAvisoRetornoPronto(banco({ grupoConta: null }).cliente(), ORG, publico({ email: true, whatsapp: ['grupo'] }), ['l1']))
      .rejects.toThrow('não há grupo')
  })
})

describe('perfisComWhatsappAvisos', () => {
  it('só perfis da organização, com aviso ligado e número válido', async () => {
    expect(await perfisComWhatsappAvisos(banco().cliente(), ORG)).toEqual(['p-aline'])
  })
})
