import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const mocks = vi.hoisted(() => ({
  modoEnsaio: false,
  buscarRemetenteCampanha: vi.fn(),
  buscarRemetenteProspeccao: vi.fn(),
  enviar: vi.fn(),
}))

vi.mock('@/lib/engine/config', () => ({
  engineConfig: {
    get modoEnsaio() { return mocks.modoEnsaio },
  },
}))

vi.mock('@/lib/engine/email/gmailProvider', () => ({
  GmailProvider: class {
    enviar = mocks.enviar
  },
}))

vi.mock('../opcoesServidor', () => ({
  buscarRemetenteCampanha: mocks.buscarRemetenteCampanha,
  buscarRemetenteProspeccao: mocks.buscarRemetenteProspeccao,
}))

import { enviarTesteEmailCampanha } from '../testeEmailServidor'

const admin = {} as SupabaseClient

beforeEach(() => {
  vi.resetAllMocks()
  mocks.modoEnsaio = false
  // O resolvedor (lib/email/remetenteOrganizacao) devolve a conta já com as credenciais.
  mocks.buscarRemetenteCampanha.mockResolvedValue({
    fonte: 'padrao',
    conta: 'followup',
    email: 'remetente@empresa.com.br',
    credenciais: { user: 'remetente@empresa.com.br', appPassword: 'segredo-nao-real' },
  })
  mocks.buscarRemetenteProspeccao.mockResolvedValue({
    fonte: 'conectada',
    conta: 'conectada',
    email: 'prospeccao@empresa.com.br',
    credenciais: { user: 'prospeccao@empresa.com.br', appPassword: 'segredo-nao-real' },
  })
  mocks.enviar.mockResolvedValue(undefined)
})

describe('envio de teste da campanha', () => {
  it('envia somente para o próprio remetente e sanitiza o HTML da prévia', async () => {
    const resultado = await enviarTesteEmailCampanha(admin, 'org-a', {
      assunto: 'Apresentação',
      corpo: 'Olá, {nome}.',
      html: '<div><script>alert(1)</script><p>Olá, <strong>{nome}</strong>.</p></div>',
      responsavelNome: 'Ana Comercial',
      destinatario: 'outra-pessoa@fora.com',
    } as Record<string, unknown>)

    expect(resultado).toEqual({
      destinatario: 'remetente@empresa.com.br',
      assunto: '[TESTE] Apresentação',
    })
    expect(mocks.buscarRemetenteCampanha).toHaveBeenCalledWith(admin, 'org-a')
    expect(mocks.enviar).toHaveBeenCalledTimes(1)
    const [destinatario, assunto, corpo, html] = mocks.enviar.mock.calls[0]
    expect(destinatario).toBe('remetente@empresa.com.br')
    expect(assunto).toBe('[TESTE] Apresentação')
    expect(corpo).toBe('Olá, {nome}.')
    expect(html).toContain('Ana Comercial')
    expect(html).toContain('<strong>{nome}</strong>')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('alert(1)')
  })

  it('não contorna o MODO_ENSAIO', async () => {
    mocks.modoEnsaio = true

    await expect(enviarTesteEmailCampanha(admin, 'org-a', {
      assunto: 'Teste',
      corpo: 'Conteúdo',
    })).rejects.toThrow('O motor está em modo ensaio')

    expect(mocks.buscarRemetenteCampanha).not.toHaveBeenCalled()
    expect(mocks.enviar).not.toHaveBeenCalled()
  })

  it('bloqueia quando a conta da organização está configurada mas inutilizável', async () => {
    // O resolvedor devolve null (ex.: senha salva ilegível) — sem cair na conta padrão.
    mocks.buscarRemetenteCampanha.mockResolvedValue(null)

    await expect(enviarTesteEmailCampanha(admin, 'org-a', {
      assunto: 'Teste',
      corpo: 'Conteúdo',
    })).rejects.toThrow('Configure uma conta remetente no workspace antes de enviar o teste.')

    expect(mocks.enviar).not.toHaveBeenCalled()
  })

  it('exige assunto e conteúdo sem consultar dados do workspace', async () => {
    await expect(enviarTesteEmailCampanha(admin, 'org-a', {
      assunto: ' ',
      corpo: 'Conteúdo',
    })).rejects.toThrow('Informe o assunto da mensagem')

    expect(mocks.buscarRemetenteCampanha).not.toHaveBeenCalled()
    expect(mocks.enviar).not.toHaveBeenCalled()
  })
})

// Campanha tipo='prospeccao': MESMO resolvedor/gate de opcoesServidor.ts usado
// pela ativação e pelo envio real (lib/workflows/ambiente.ts) — nunca o
// fallback global ('followup'/GMAIL_USER) que `buscarRemetenteCampanha` usa
// para os demais tipos.
describe('envio de teste — campanha tipo=prospeccao', () => {
  it('usa o remetente DEDICADO da organização (buscarRemetenteProspeccao), não o fallback', async () => {
    const resultado = await enviarTesteEmailCampanha(admin, 'org-a', {
      assunto: 'Apresentação',
      corpo: 'Olá, {nome}.',
      tipo: 'prospeccao',
    })

    expect(resultado).toEqual({
      destinatario: 'prospeccao@empresa.com.br',
      assunto: '[TESTE] Apresentação',
    })
    expect(mocks.buscarRemetenteProspeccao).toHaveBeenCalledWith(admin, 'org-a')
    expect(mocks.buscarRemetenteCampanha).not.toHaveBeenCalled()
  })

  it('bloqueia sem fallback quando a organização não tem remetente configurado', async () => {
    mocks.buscarRemetenteProspeccao.mockResolvedValue(null)

    await expect(enviarTesteEmailCampanha(admin, 'org-a', {
      assunto: 'Apresentação',
      corpo: 'Olá, {nome}.',
      tipo: 'prospeccao',
    })).rejects.toThrow('Configure um remetente em Configurações antes de iniciar a campanha.')

    expect(mocks.buscarRemetenteCampanha).not.toHaveBeenCalled()
    expect(mocks.enviar).not.toHaveBeenCalled()
  })

  it('outros tipos (ou ausência de tipo) continuam no resolvedor antigo, com fallback', async () => {
    await enviarTesteEmailCampanha(admin, 'org-a', {
      assunto: 'Apresentação',
      corpo: 'Olá, {nome}.',
      tipo: 'renovacao',
    })

    expect(mocks.buscarRemetenteCampanha).toHaveBeenCalledWith(admin, 'org-a')
    expect(mocks.buscarRemetenteProspeccao).not.toHaveBeenCalled()
  })
})
