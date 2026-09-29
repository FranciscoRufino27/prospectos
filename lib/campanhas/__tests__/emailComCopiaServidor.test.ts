import { describe, expect, it, vi } from 'vitest'
import type { EmailProvider } from '@/lib/engine/email/provider'
import { enviarEmailCampanhaComCopia, escolherResponsavelCampanha } from '../emailComCopiaServidor'

function provider() {
  return {
    enviar: vi.fn().mockResolvedValue(undefined),
    lerCaixaEntrada: vi.fn().mockResolvedValue([]),
  } satisfies EmailProvider
}

describe('e-mail de campanha com cópia comercial', () => {
  it('coloca em cópia o responsável escolhido na campanha', async () => {
    const email = provider()
    await enviarEmailCampanhaComCopia(email, {
      para: 'lead@empresa.com',
      assunto: 'Assunto',
      corpo: 'Mensagem',
      html: '<p>Mensagem</p>',
      responsavelCampanha: { id: 'perfil-1', nome: 'Aline', email: 'aline@empresa.com' },
      responsavelLead: { id: 'usuario-1', nome: 'Francisco', email: 'francisco@empresa.com' },
    })

    expect(email.enviar).toHaveBeenCalledWith(
      'lead@empresa.com',
      'Assunto',
      'Mensagem',
      '<p>Mensagem</p>',
      'aline@empresa.com',
    )
  })

  it('usa o responsável real do lead como fallback', async () => {
    const email = provider()
    await enviarEmailCampanhaComCopia(email, {
      para: 'lead@empresa.com',
      assunto: 'Assunto',
      corpo: 'Mensagem',
      responsavelLead: { id: 'usuario-1', nome: 'Francisco', email: 'francisco@empresa.com' },
    })

    expect(email.enviar).toHaveBeenCalledWith(
      'lead@empresa.com',
      'Assunto',
      'Mensagem',
      undefined,
      'francisco@empresa.com',
    )
  })

  it('não copia o responsável quando ele é a própria conta remetente', async () => {
    const email = provider()
    await enviarEmailCampanhaComCopia(email, {
      para: 'lead@empresa.com',
      assunto: 'Assunto',
      corpo: 'Mensagem',
      remetenteEmail: 'comercial@laudos.com',
      responsavelCampanha: { id: 'perfil-1', nome: 'Francisco', email: 'COMERCIAL@LAUDOS.COM' },
    })

    expect(email.enviar).toHaveBeenCalledWith(
      'lead@empresa.com',
      'Assunto',
      'Mensagem',
      undefined,
      undefined,
    )
  })

  it('bloqueia o envio se nenhum responsável tiver e-mail real', async () => {
    const email = provider()
    await expect(enviarEmailCampanhaComCopia(email, {
      para: 'lead@empresa.com',
      assunto: 'Assunto',
      corpo: 'Mensagem',
    })).rejects.toThrow('responsável comercial não possui e-mail')
    expect(email.enviar).not.toHaveBeenCalled()
  })
})

// Modo carteira: o cliente não pode receber e-mail assinado por uma pessoa e
// ter a resposta caindo na caixa de outra — CC e assinatura seguem a mesma
// precedência do aviso de retorno.
describe('e-mail de campanha no modo carteira', () => {
  const daCampanha = { id: 'perfil-1', nome: 'Aline', email: 'aline@empresa.com' }
  const doLead = { id: 'usuario-1', nome: 'Francisco', email: 'francisco@empresa.com' }

  it('copia o responsável do lead, não o geral da campanha', async () => {
    const email = provider()
    await enviarEmailCampanhaComCopia(email, {
      para: 'lead@empresa.com',
      assunto: 'Assunto',
      corpo: 'Mensagem',
      responsavelCampanha: daCampanha,
      responsavelLead: doLead,
      preferirResponsavelDoLead: true,
    })

    expect(email.enviar).toHaveBeenCalledWith(
      'lead@empresa.com', 'Assunto', 'Mensagem', undefined, 'francisco@empresa.com',
    )
  })

  it('lead sem responsável cai no geral da campanha', async () => {
    const email = provider()
    const escolhido = await enviarEmailCampanhaComCopia(email, {
      para: 'lead@empresa.com',
      assunto: 'Assunto',
      corpo: 'Mensagem',
      responsavelCampanha: daCampanha,
      responsavelLead: null,
      preferirResponsavelDoLead: true,
    })

    expect(escolhido.email).toBe('aline@empresa.com')
  })

  it('escolherResponsavelCampanha decide igual nos dois modos (é a mesma fonte da assinatura)', () => {
    expect(escolherResponsavelCampanha({ responsavelCampanha: daCampanha, responsavelLead: doLead })?.nome).toBe('Aline')
    expect(escolherResponsavelCampanha({
      responsavelCampanha: daCampanha, responsavelLead: doLead, preferirResponsavelDoLead: true,
    })?.nome).toBe('Francisco')
    // Responsável sem e-mail não conta como candidato em nenhum dos modos.
    expect(escolherResponsavelCampanha({
      responsavelCampanha: daCampanha,
      responsavelLead: { id: 'u2', nome: 'Sem e-mail', email: '' },
      preferirResponsavelDoLead: true,
    })?.nome).toBe('Aline')
    expect(escolherResponsavelCampanha({ preferirResponsavelDoLead: true })).toBeNull()
  })
})

describe('e-mail de campanha em "somente as respostas"', () => {
  it('sai sem cópia, mas devolve quem assina', async () => {
    const email = provider()
    const quem = await enviarEmailCampanhaComCopia(email, {
      para: 'lead@empresa.com',
      assunto: 'Assunto',
      corpo: 'Mensagem',
      responsavelCampanha: { id: 'perfil-1', nome: 'Aline', email: 'aline@empresa.com' },
      copiarResponsavel: false,
    })
    expect(email.enviar).toHaveBeenCalledWith('lead@empresa.com', 'Assunto', 'Mensagem', undefined, undefined)
    expect(quem.nome).toBe('Aline')
  })

  it('continua exigindo um responsável com e-mail (é quem recebe o retorno)', async () => {
    const email = provider()
    await expect(enviarEmailCampanhaComCopia(email, {
      para: 'lead@empresa.com', assunto: 'A', corpo: 'M', copiarResponsavel: false,
    })).rejects.toThrow('Envio bloqueado')
    expect(email.enviar).not.toHaveBeenCalled()
  })
})
