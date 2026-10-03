import { describe, it, expect } from 'vitest'
import { lerFalhaEntrega } from '../dsn'

const CAIXA = 'comercial@laudo.test'

// Aviso do Gmail: o texto cita a caixa remetente e a mensagem original vai
// anexada (com From/To/Cc) — só a parte delivery-status é confiável.
const AVISO_GMAIL = [
  'From: Mail Delivery Subsystem <mailer-daemon@googlemail.com>',
  `To: ${CAIXA}`,
  'Subject: Delivery Status Notification (Failure)',
  'Content-Type: multipart/report; boundary="b1"; report-type=delivery-status',
  '',
  '--b1',
  'Content-Type: text/plain; charset="UTF-8"',
  '',
  'Address not found',
  "Your message wasn't delivered to fulano@yahoo.com.br because the address couldn't be found.",
  '',
  '--b1',
  'Content-Type: message/delivery-status',
  '',
  'Reporting-MTA: dns; googlemail.com',
  `Received-From-MTA: dns; ${CAIXA}`,
  '',
  'Final-Recipient: rfc822; fulano@yahoo.com.br',
  'Action: failed',
  'Status: 5.1.1',
  'Diagnostic-Code: smtp; 554 30 delivery error: dd This user doesn\'t have a yahoo.com.br account',
  '',
  '--b1',
  'Content-Type: message/rfc822',
  '',
  `From: ${CAIXA}`,
  'To: fulano@yahoo.com.br',
  'Cc: aline@laudo.test',
  'Subject: Laudo dos brinquedos',
  '',
  'Olá!',
  '--b1--',
].join('\n')

describe('lerFalhaEntrega', () => {
  it('lê o destinatário e o status da parte delivery-status (aviso do Gmail)', () => {
    expect(lerFalhaEntrega(AVISO_GMAIL, [CAIXA])).toEqual({
      destinatarios: ['fulano@yahoo.com.br'],
      status: ['5.1.1'],
      somenteAtraso: false,
    })
  })

  it('lê vários destinatários com CRLF, sinais de < > e caixa alta (Office 365)', () => {
    const aviso = [
      'Content-Type: message/delivery-status',
      '',
      'Reporting-MTA: dns;BN8PR.prod.outlook.com',
      '',
      'Final-Recipient: RFC822; <Loja.Centro@Habibs.com.br>',
      'Action: failed',
      'Status: 5.4.14',
      '',
      'Final-Recipient: rfc822;gerencia_mboi@habibs.com.br',
      'Action: failed',
      'Status: 5.4.14',
    ].join('\r\n')
    expect(lerFalhaEntrega(aviso, [CAIXA])).toEqual({
      destinatarios: ['loja.centro@habibs.com.br', 'gerencia_mboi@habibs.com.br'],
      status: ['5.4.14'],
      somenteAtraso: false,
    })
  })

  it('aviso só de atraso (Action: delayed) é marcado como somenteAtraso', () => {
    const aviso = 'Final-Recipient: rfc822; renata@globo.com\nAction: delayed\nStatus: 4.4.1\n'
    expect(lerFalhaEntrega(aviso)?.somenteAtraso).toBe(true)
  })

  it('um destinatário falho e outro atrasado no mesmo aviso NÃO é só atraso', () => {
    const aviso = [
      'Final-Recipient: rfc822; a@x.com.br', 'Action: failed', 'Status: 5.1.1', '',
      'Final-Recipient: rfc822; b@x.com.br', 'Action: delayed', 'Status: 4.4.1',
    ].join('\n')
    const falha = lerFalhaEntrega(aviso)
    expect(falha?.somenteAtraso).toBe(false)
    expect(falha?.destinatarios).toEqual(['a@x.com.br', 'b@x.com.br'])
  })

  it('usa o cabeçalho X-Failed-Recipients (Exim) quando não há delivery-status', () => {
    const aviso = 'X-Failed-Recipients: um@terra.com.br, dois@terra.com.br\nSubject: Mail delivery failed\n\nTexto.'
    expect(lerFalhaEntrega(aviso)?.destinatarios).toEqual(['um@terra.com.br', 'dois@terra.com.br'])
  })

  it('nunca devolve a própria caixa nem endereços do sistema de entrega', () => {
    const aviso = [
      `Original-Recipient: rfc822; ${CAIXA.toUpperCase()}`,
      'Final-Recipient: rfc822; postmaster@servidor.com',
      'Final-Recipient: rfc822; MAILER-DAEMON@servidor.com',
      'Final-Recipient: rfc822; cliente@empresa.com.br',
      'Action: failed',
    ].join('\n')
    expect(lerFalhaEntrega(aviso, [CAIXA])?.destinatarios).toEqual(['cliente@empresa.com.br'])
  })

  it('mensagem sem nenhum campo de DSN devolve null (resposta comum, bounce só em texto)', () => {
    expect(lerFalhaEntrega('Subject: Re: proposta\n\nOi, pode me ligar? fulano@empresa.com.br')).toBeNull()
  })
})
