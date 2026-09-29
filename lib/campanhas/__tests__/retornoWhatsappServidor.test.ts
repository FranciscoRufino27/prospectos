// Pré-condição do "Somente WhatsApp": a campanha não sai do ensaio se alguém
// que receberia o retorno não tem o WhatsApp de avisos ligado (ou sem Z-API).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BancoFalso } from '@/lib/templates/__tests__/bancoFalso'
import { normalizarPublicoCampanha } from '../configuracaoGuiada'

// Números de avisos por perfil/usuário — a leitura real (ponte usuarios →
// perfil + perfis.whatsapp_avisos) tem teste próprio no módulo de avisos.
const numeros = vi.hoisted(() => ({
  perfil: new Map<string, string>(),
  usuario: new Map<string, string>(),
}))
vi.mock('@/lib/comercial/avisosResposta/composicao', () => ({
  lerWhatsappDoPerfil: async (_admin: unknown, _org: string, id: string) => numeros.perfil.get(id) ?? null,
  lerWhatsappResponsavel: async (_admin: unknown, _org: string, id: string) => numeros.usuario.get(id) ?? null,
}))

import { exigirWhatsappRetornoPronto, perfisComWhatsappAvisos } from '../retornoWhatsappServidor'

const ORG = 'org-a'
const OUTRA = 'org-b'
const ENV_ZAPI = { ZAPI_INSTANCE_ID: 'i', ZAPI_TOKEN: 't', ZAPI_CLIENT_TOKEN: 'c' } as const

function banco() {
  return new BancoFalso({
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

const publico = (over: Record<string, unknown> = {}, canais: string = 'whatsapp') => normalizarPublicoCampanha({
  responsavel_id: 'p-aline',
  operacao: { resposta: { canais } },
  ...over,
})

describe('exigirWhatsappRetornoPronto', () => {
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

  it('"E-mail e WhatsApp" nunca bloqueia (o e-mail continua chegando)', async () => {
    delete process.env.ZAPI_TOKEN
    await expect(exigirWhatsappRetornoPronto(banco().cliente(), ORG, publico({}, 'email_whatsapp'), ['l1'])).resolves.toBeUndefined()
  })

  it('campanha antiga (sem canais) nunca bloqueia', async () => {
    await expect(exigirWhatsappRetornoPronto(banco().cliente(), ORG, normalizarPublicoCampanha({}), ['l1'])).resolves.toBeUndefined()
  })

  it('sem Z-API no servidor: bloqueia', async () => {
    delete process.env.ZAPI_TOKEN
    numeros.perfil.set('p-aline', '5521988887777')
    await expect(exigirWhatsappRetornoPronto(banco().cliente(), ORG, publico(), ['l1'])).rejects.toThrow('Z-API')
  })

  it('responsável geral com número: libera', async () => {
    numeros.perfil.set('p-aline', '5521988887777')
    await expect(exigirWhatsappRetornoPronto(banco().cliente(), ORG, publico(), ['l1', 'l2'])).resolves.toBeUndefined()
  })

  it('responsável geral sem número: bloqueia com o nome dele', async () => {
    await expect(exigirWhatsappRetornoPronto(banco().cliente(), ORG, publico(), ['l1'])).rejects.toThrow('Aline ainda não ligou')
  })

  it('carteira: lista os donos sem número (e o responsável da campanha, se houver lead sem dono)', async () => {
    numeros.usuario.set('u-bruno', '5511999998888')
    const p = publico({ retornoPara: 'lead' })
    await expect(exigirWhatsappRetornoPronto(banco().cliente(), ORG, p, ['l1', 'l2', 'l3']))
      .rejects.toThrow('Sofie, Aline ainda não ligaram')
    numeros.usuario.set('u-sofie', '5511977776666')
    numeros.perfil.set('p-aline', '5521988887777')
    await expect(exigirWhatsappRetornoPronto(banco().cliente(), ORG, p, ['l1', 'l2', 'l3'])).resolves.toBeUndefined()
  })

  it('carteira sem lead órfão não exige o número do responsável da campanha', async () => {
    numeros.usuario.set('u-bruno', '5511999998888')
    numeros.usuario.set('u-sofie', '5511977776666')
    await expect(exigirWhatsappRetornoPronto(banco().cliente(), ORG, publico({ retornoPara: 'lead' }), ['l1', 'l2']))
      .resolves.toBeUndefined()
  })

  it('lead de outra organização não entra na conta', async () => {
    numeros.usuario.set('u-bruno', '5511999998888')
    // l9 é da OUTRA org: o dono dela (sem número) não pode bloquear nem vazar o nome.
    await expect(exigirWhatsappRetornoPronto(banco().cliente(), ORG, publico({ retornoPara: 'lead' }), ['l1', 'l9']))
      .resolves.toBeUndefined()
  })
})

describe('perfisComWhatsappAvisos', () => {
  it('só perfis da organização, com aviso ligado e número válido', async () => {
    expect(await perfisComWhatsappAvisos(banco().cliente(), ORG)).toEqual(['p-aline'])
  })
})
