import { describe, it, expect, beforeEach } from 'vitest'
import { MemoryStore } from '../store/memoryStore'
import { SimulatedProvider } from '../email/simulatedProvider'
import { Queue } from '../queue'
import { detectarResposta, ehBounce } from '../flows/detectarResposta'
import type { MensagemRecebida } from '../types'
import { makeLead, SEMANA_PASSADA } from './helpers'

function msgBounce(over: Partial<MensagemRecebida> = {}): MensagemRecebida {
  return {
    de: over.de ?? 'mailer-daemon@smtp.empresa.com.br',
    assunto: over.assunto ?? 'Undeliverable: Proposta comercial',
    corpo: over.corpo ?? 'Your message to contato@acme.com.br could not be delivered.',
    automatica: over.automatica ?? true,
    em: over.em ?? new Date(),
    mensagemId: over.mensagemId,
    falhaEntrega: over.falhaEntrega,
  }
}

describe('ehBounce', () => {
  it('detecta mailer-daemon pelo remetente', () => {
    expect(ehBounce(msgBounce({ de: 'mailer-daemon@smtp.example.com' }))).toBe(true)
  })
  it('detecta postmaster pelo remetente', () => {
    expect(ehBounce(msgBounce({ de: 'postmaster@example.com' }))).toBe(true)
  })
  it('detecta "Undeliverable" no assunto', () => {
    expect(ehBounce(msgBounce({ de: 'noreply@example.com', assunto: 'Undeliverable: Re: proposta' }))).toBe(true)
  })
  it('detecta "Delivery Status Notification" no assunto', () => {
    expect(ehBounce(msgBounce({ de: 'noreply@example.com', assunto: 'Delivery Status Notification (Failure)' }))).toBe(true)
  })
  it('NÃO confunde out-of-office com bounce', () => {
    expect(ehBounce({ de: 'ana@empresa.com', assunto: 'Out of office: férias', corpo: '', automatica: true, em: new Date() })).toBe(false)
  })
  it('NÃO confunde auto-reply genérico com bounce', () => {
    expect(ehBounce({ de: 'noreply@sistema.com', assunto: 'Automatic reply: sua mensagem foi recebida', corpo: '', automatica: true, em: new Date() })).toBe(false)
  })
})

describe('detectarResposta — bounce handling', () => {
  let store: MemoryStore
  let email: SimulatedProvider
  let fila: Queue

  beforeEach(() => {
    email = new SimulatedProvider()
    fila = new Queue()
  })

  it('marca lead como bounced e cancela cadência', async () => {
    const lead = makeLead({
      estagio: 'primeiro_contato',
      contato_email: 'contato@acme.com.br',
      ultimo_contato: SEMANA_PASSADA,
    })
    store = new MemoryStore([lead])

    email.injetar(msgBounce({
      de: 'mailer-daemon@smtp.empresa.com.br',
      assunto: 'Undeliverable: proposta',
      corpo: 'Your message to contato@acme.com.br could not be delivered. 550 User not found.',
    }))

    const r = await detectarResposta(store, email, fila)

    const leadAtualizado = await store.buscarLead(lead.id)
    expect(leadAtualizado?.bounced).toBe(true)
    expect(leadAtualizado?.bounced_em).not.toBeNull()
    expect(leadAtualizado?.proxima_acao).toBeNull()
    expect(leadAtualizado?.proxima_acao_data).toBeNull()

    const nota = store.interacoes.find((i) => i.lead_id === lead.id && i.tipo === 'nota')
    expect(nota?.descricao).toContain('Bounce SMTP detectado')

    expect(r.bounces).toBe(1)
    expect(r.respostas).toBe(0)
    expect(r.ignoradas).toBe(1) // bounce conta em ignoradas
    expect(fila.pendentes()).toBe(0)
  })

  // O SimulatedProvider esvazia a caixa a cada leitura, mas o Gmail real varre
  // uma JANELA de dias sem depender de \Seen: o mesmo bounce volta em toda
  // passada do monitor. Injetar duas vezes reproduz esse comportamento — foi
  // essa diferença que escondeu o loop que gerou ~2.400 notas por lead.
  it('bounce repetido não remarca o lead nem duplica a nota', async () => {
    const lead = makeLead({
      estagio: 'primeiro_contato',
      contato_email: 'contato@acme.com.br',
      ultimo_contato: SEMANA_PASSADA,
    })
    store = new MemoryStore([lead])

    const bounce = msgBounce({
      corpo: 'Your message to contato@acme.com.br could not be delivered. 550 User not found.',
    })

    email.injetar(bounce)
    const primeira = await detectarResposta(store, email, fila)
    const marcadoEm = (await store.buscarLead(lead.id))?.bounced_em

    email.injetar(bounce)
    const segunda = await detectarResposta(store, email, fila)

    // Segue contando como bounce (a mensagem É um bounce), mas sem reescrever.
    expect(primeira.bounces).toBe(1)
    expect(segunda.bounces).toBe(1)

    const notas = store.interacoes.filter(
      (i) => i.lead_id === lead.id && i.descricao?.startsWith('Bounce SMTP detectado'),
    )
    expect(notas).toHaveLength(1)

    const depois = await store.buscarLead(lead.id)
    expect(depois?.bounced).toBe(true)
    expect(depois?.bounced_em).toBe(marcadoEm) // carimbo original preservado
  })

  it('o MESMO bounce relido não gera nota nova', async () => {
    const lead = makeLead({ estagio: 'primeiro_contato', contato_email: 'contato@acme.com.br', ultimo_contato: SEMANA_PASSADA })
    store = new MemoryStore([lead])
    const b = msgBounce({
      corpo: 'Your message to contato@acme.com.br could not be delivered.',
      mensagemId: '<bounce-1@mailer-daemon>',
    })

    email.injetar(b)
    await detectarResposta(store, email, fila)
    email.injetar(b)
    const segunda = await detectarResposta(store, email, fila)

    expect(segunda.bounces).toBe(0)
    const notas = store.interacoes.filter((i) => i.descricao?.startsWith('Bounce SMTP detectado'))
    expect(notas).toHaveLength(1)
  })

  it('lead bounced não entra em leadsParaFollowup', async () => {
    const lead = makeLead({
      estagio: 'primeiro_contato',
      bounced: true,
      bounced_em: new Date().toISOString(),
      ultimo_contato: SEMANA_PASSADA,
    })
    store = new MemoryStore([lead])

    const elegiveis = await store.leadsParaFollowup()
    expect(elegiveis).toHaveLength(0)
  })

  it('lead bounced não entra em leadsEsgotadosSemResposta', async () => {
    const lead = makeLead({
      estagio: 'follow_up',
      bounced: true,
      ultimo_contato: SEMANA_PASSADA,
    })
    store = new MemoryStore([lead])
    // Simula que todos os follow-ups foram enviados
    for (let i = 0; i < 10; i++) {
      store.interacoes.push({
        id: `int-${i}`,
        lead_id: lead.id,
        tipo: 'follow_up',
        canal: 'email',
        descricao: `Follow-up ${i}`,
        origem_acao: 'ia',
        created_at: SEMANA_PASSADA,
      })
    }
    const esgotados = await store.leadsEsgotadosSemResposta()
    expect(esgotados).toHaveLength(0)
  })

  it('bounce sem lead casado: contabiliza ignorada, não lança erro', async () => {
    const lead = makeLead({ estagio: 'primeiro_contato', contato_email: 'outro@empresa.com.br' })
    store = new MemoryStore([lead])

    email.injetar(msgBounce({
      de: 'mailer-daemon@servidor.com',
      corpo: 'Message to desconhecido@naoexiste.com could not be delivered.',
    }))

    const r = await detectarResposta(store, email, fila)
    expect(r.bounces).toBe(0)
    expect(r.ignoradas).toBe(1)

    const leadOriginal = await store.buscarLead(lead.id)
    expect(leadOriginal?.bounced).toBe(false)
  })

  it('bounce sem lead casado guarda o endereço na lista de inválidos da org', async () => {
    store = new MemoryStore([makeLead({ contato_email: 'outro@empresa.com.br' })])
    email.injetar(msgBounce({
      corpo: 'Message to desconhecido@naoexiste.com could not be delivered.',
      falhaEntrega: { destinatarios: ['desconhecido@naoexiste.com'], status: ['5.1.1'], somenteAtraso: false },
    }))

    await detectarResposta(store, email, fila)

    expect(store.emailsInvalidos.get('desconhecido@naoexiste.com')).toBe('5.1.1')
  })

  it('usa o destinatário do delivery-status, não o primeiro endereço do texto', async () => {
    const caixa = makeLead({ contato_email: 'comercial@laudo.test', estagio: 'primeiro_contato' })
    const cliente = makeLead({ contato_email: 'fulano@yahoo.com.br', estagio: 'primeiro_contato' })
    store = new MemoryStore([caixa, cliente])
    email.injetar(msgBounce({
      assunto: 'Delivery Status Notification (Failure)',
      corpo: 'Enviado por comercial@laudo.test. Your message to fulano@yahoo.com.br was not delivered.',
      falhaEntrega: { destinatarios: ['fulano@yahoo.com.br'], status: ['5.1.1'], somenteAtraso: false },
    }))

    const r = await detectarResposta(store, email, fila)

    expect(r.bounces).toBe(1)
    expect((await store.buscarLead(cliente.id))?.bounced).toBe(true)
    expect((await store.buscarLead(caixa.id))?.bounced).toBe(false)
    const nota = store.interacoes.find((i) => i.lead_id === cliente.id)
    expect(nota?.descricao).toMatch(/^Bounce SMTP detectado: .*\(status 5\.1\.1\).*removido da cadência automática e das campanhas/)
  })

  it('marca TODOS os leads da org com o endereço, inclusive fora do motor (owner n8n)', async () => {
    const doMotor = makeLead({ contato_email: 'loja@habibs.com.br', owner: 'engine' })
    const importado = makeLead({ contato_email: 'Loja@Habibs.com.br', owner: 'n8n' })
    const outro = makeLead({ contato_email: 'outra@habibs.com.br', owner: 'n8n' })
    store = new MemoryStore([doMotor, importado, outro])
    email.injetar(msgBounce({
      falhaEntrega: { destinatarios: ['loja@habibs.com.br'], status: ['5.4.14'], somenteAtraso: false },
    }))

    await detectarResposta(store, email, fila)

    expect((await store.buscarLead(doMotor.id))?.bounced).toBe(true)
    expect((await store.buscarLead(importado.id))?.bounced).toBe(true)
    expect((await store.buscarLead(outro.id))?.bounced).toBe(false)
  })

  it('um aviso com vários destinatários marca cada um deles', async () => {
    const a = makeLead({ contato_email: 'a@x.com.br' })
    const b = makeLead({ contato_email: 'b@x.com.br' })
    store = new MemoryStore([a, b])
    email.injetar(msgBounce({
      falhaEntrega: { destinatarios: ['a@x.com.br', 'b@x.com.br'], status: ['5.1.1'], somenteAtraso: false },
    }))

    await detectarResposta(store, email, fila)

    expect((await store.buscarLead(a.id))?.bounced).toBe(true)
    expect((await store.buscarLead(b.id))?.bounced).toBe(true)
  })

  it('aviso só de ATRASO não tira o lead da campanha nem entra na lista', async () => {
    const lead = makeLead({ contato_email: 'renata@globo.com', estagio: 'primeiro_contato' })
    store = new MemoryStore([lead])
    email.injetar(msgBounce({
      assunto: 'Delivery Status Notification (Delay)',
      corpo: 'Message delivery to renata@globo.com has been delayed.',
      falhaEntrega: { destinatarios: ['renata@globo.com'], status: ['4.4.1'], somenteAtraso: true },
    }))

    const r = await detectarResposta(store, email, fila)

    expect(r.bounces).toBe(0)
    expect((await store.buscarLead(lead.id))?.bounced).toBe(false)
    expect(store.emailsInvalidos.size).toBe(0)
    expect(store.interacoes).toHaveLength(0)
  })

  it('sem delivery-status, ignora o endereço do mailer-daemon citado no texto', async () => {
    const lead = makeLead({ contato_email: 'contato@acme.com.br' })
    store = new MemoryStore([lead])
    email.injetar(msgBounce({
      corpo: 'From: MAILER-DAEMON@smtp.acme.com.br\nYour message to contato@acme.com.br could not be delivered.',
      falhaEntrega: null,
    }))

    await detectarResposta(store, email, fila)

    expect((await store.buscarLead(lead.id))?.bounced).toBe(true)
  })

  it('auto-reply de férias NÃO é tratado como bounce', async () => {
    const lead = makeLead({ estagio: 'primeiro_contato', contato_email: 'ana@empresa.com.br' })
    store = new MemoryStore([lead])

    email.injetar({
      de: 'ana@empresa.com.br',
      assunto: 'Automatic reply: out of office',
      corpo: 'Estarei ausente até dia 20/08.',
      automatica: true,
      em: new Date(),
    })

    const r = await detectarResposta(store, email, fila)
    expect(r.bounces).toBe(0)

    const leadAtualizado = await store.buscarLead(lead.id)
    expect(leadAtualizado?.bounced).toBe(false)
  })
})
