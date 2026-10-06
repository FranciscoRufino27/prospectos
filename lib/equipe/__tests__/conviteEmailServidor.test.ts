import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const mocks = vi.hoisted(() => ({
  modoEnsaio: false,
  buscarRemetenteCampanha: vi.fn(),
  lerCredenciaisGmail: vi.fn(),
  enviar: vi.fn(),
  credUsada: [] as Array<{ user: string }>,
}))

vi.mock('@/lib/engine/config', () => ({
  engineConfig: {
    get modoEnsaio() { return mocks.modoEnsaio },
  },
}))

vi.mock('@/lib/engine/email/gmailProvider', () => ({
  lerCredenciaisGmail: mocks.lerCredenciaisGmail,
  GmailProvider: class {
    constructor(cred: { user: string }) { mocks.credUsada.push(cred) }
    enviar = mocks.enviar
  },
}))

vi.mock('@/lib/campanhas/opcoesServidor', () => ({
  buscarRemetenteCampanha: mocks.buscarRemetenteCampanha,
}))

import { enviarEmailConvite } from '../conviteEmailServidor'

// Contas por workspace, como no ambiente: LAUDO tem chave dedicada; a org sem
// chave usa a conta padrão ('followup').
const CONTAS: Record<string, { conta: string; email: string; nome: string; nomeServico?: string }> = {
  'org-laudo': { conta: 'LAUDO', email: 'laudos@gmail.com', nome: 'LAUDO DE BRINQUEDOS', nomeServico: 'Laudo de Brinquedos' },
  'org-inova': { conta: 'followup', email: 'inovacode@gmail.com', nome: 'Organização Padrão' },
}
const CREDENCIAIS: Record<string, { user: string; appPassword: string }> = {
  LAUDO: { user: 'laudos@gmail.com', appPassword: 'segredo-nao-real' },
  followup: { user: 'inovacode@gmail.com', appPassword: 'segredo-nao-real' },
}

function adminStub(orgsConsultadas: string[] = []) {
  return {
    from: (tabela: string) => {
      expect(tabela).toBe('organizacoes')
      return {
        select: () => ({
          eq: (coluna: string, valor: string) => {
            expect(coluna).toBe('id')
            orgsConsultadas.push(valor)
            const c = CONTAS[valor]
            return {
              maybeSingle: async () => ({
                data: c
                  ? { nome: c.nome, configuracoes: c.nomeServico ? { nomenclaturas: { nome_servico: c.nomeServico } } : {} }
                  : null,
              }),
            }
          },
        }),
      }
    },
  } as unknown as SupabaseClient
}

const LINK = 'https://exemplo.supabase.co/auth/v1/verify?token=abc&type=invite'

beforeEach(() => {
  vi.resetAllMocks()
  mocks.modoEnsaio = false
  mocks.credUsada.length = 0
  // Como o resolvedor real (lib/email/remetenteOrganizacao): a conta já vem com
  // as credenciais; conta configurada sem credencial → null (bloqueia).
  mocks.buscarRemetenteCampanha.mockImplementation(async (_admin: unknown, org: string) => {
    const c = CONTAS[org]
    if (!c) return null
    const credenciais = mocks.lerCredenciaisGmail(c.conta)
    return credenciais
      ? { fonte: c.conta === 'followup' ? 'padrao' : 'legada', conta: c.conta, email: c.email, credenciais }
      : null
  })
  mocks.lerCredenciaisGmail.mockImplementation((conta: string) => CREDENCIAIS[conta] ?? null)
  mocks.enviar.mockResolvedValue(undefined)
})

describe('e-mail de convite da equipe', () => {
  it('envia pela conta do workspace de quem convida, não pela conta padrão', async () => {
    const orgs: string[] = []
    const r = await enviarEmailConvite(adminStub(orgs), 'org-laudo', { email: 'novo@cliente.com', actionLink: LINK })

    expect(r).toEqual({ emailEnviado: true, simulado: false, remetente: 'laudos@gmail.com' })
    expect(mocks.buscarRemetenteCampanha).toHaveBeenCalledWith(expect.anything(), 'org-laudo')
    expect(mocks.lerCredenciaisGmail).toHaveBeenCalledWith('LAUDO')
    expect(mocks.lerCredenciaisGmail).not.toHaveBeenCalledWith()
    expect(mocks.credUsada).toEqual([CREDENCIAIS.LAUDO])
    expect(orgs).toEqual(['org-laudo'])

    const [para, assunto, corpo, html] = mocks.enviar.mock.calls[0]
    expect(para).toBe('novo@cliente.com')
    expect(assunto).toBe('Convite para acessar Laudo de Brinquedos')
    expect(corpo).toContain(LINK)
    expect(html).toContain('Laudo de Brinquedos')
  })

  it('cada organização usa a própria conta (sem cruzar remetentes)', async () => {
    await enviarEmailConvite(adminStub(), 'org-inova', { email: 'a@inovacode.com.br', actionLink: LINK })
    await enviarEmailConvite(adminStub(), 'org-laudo', { email: 'b@cliente.com', actionLink: LINK })

    expect(mocks.credUsada.map((c) => c.user)).toEqual(['inovacode@gmail.com', 'laudos@gmail.com'])
    expect(mocks.enviar.mock.calls[0][1]).toBe('Convite para acessar Organização Padrão')
    expect(mocks.enviar.mock.calls[1][1]).toBe('Convite para acessar Laudo de Brinquedos')
  })

  it('chave dedicada sem credencial bloqueia o envio em vez de usar a conta de outra org', async () => {
    mocks.lerCredenciaisGmail.mockImplementation((conta: string) => (conta === 'LAUDO' ? null : CREDENCIAIS[conta]))

    const r = await enviarEmailConvite(adminStub(), 'org-laudo', { email: 'novo@cliente.com', actionLink: LINK })

    expect(r).toEqual({ emailEnviado: false, simulado: false, motivo: 'credencial_ausente', remetente: null })
    expect(mocks.enviar).not.toHaveBeenCalled()
  })

  it('workspace sem remetente configurado não envia', async () => {
    mocks.buscarRemetenteCampanha.mockResolvedValue(null)

    const r = await enviarEmailConvite(adminStub(), 'org-inova', { email: 'a@inovacode.com.br', actionLink: LINK })

    expect(r).toMatchObject({ emailEnviado: false, motivo: 'credencial_ausente' })
    expect(mocks.enviar).not.toHaveBeenCalled()
  })

  it('não contorna o MODO_ENSAIO', async () => {
    mocks.modoEnsaio = true

    const r = await enviarEmailConvite(adminStub(), 'org-laudo', { email: 'novo@cliente.com', actionLink: LINK })

    expect(r).toEqual({ emailEnviado: false, simulado: true, remetente: 'laudos@gmail.com' })
    expect(mocks.enviar).not.toHaveBeenCalled()
  })

  it('falha de SMTP devolve falha sem lançar (o convite já foi criado)', async () => {
    mocks.enviar.mockRejectedValue(new Error('535 auth failed'))
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {})

    const r = await enviarEmailConvite(adminStub(), 'org-inova', { email: 'a@inovacode.com.br', actionLink: LINK })

    expect(r).toEqual({ emailEnviado: false, simulado: false, motivo: 'falha_envio', remetente: 'inovacode@gmail.com' })
    erro.mockRestore()
  })

  it('sem link de convite não consulta o workspace nem envia', async () => {
    const orgs: string[] = []
    const r = await enviarEmailConvite(adminStub(orgs), 'org-laudo', { email: 'novo@cliente.com', actionLink: null })

    expect(r).toMatchObject({ emailEnviado: false, motivo: 'sem_link' })
    expect(mocks.buscarRemetenteCampanha).not.toHaveBeenCalled()
    expect(orgs).toEqual([])
    expect(mocks.enviar).not.toHaveBeenCalled()
  })
})
