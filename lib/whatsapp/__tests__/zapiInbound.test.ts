import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { interpretarReceivedCallback, persistirMensagemZapi, validarSegredoWebhook } from '../zapiInbound'

// Tudo puro ou com Supabase falso. Nenhuma chamada externa.

const INSTANCIA = 'inst-1'

// ReceivedCallback de texto individual no formato real da Z-API.
function callback(over: Record<string, unknown> = {}) {
  return {
    instanceId: INSTANCIA,
    messageId: 'MSG-1',
    phone: '5511999998888',
    fromMe: false,
    momment: 1632228638000,
    status: 'RECEIVED',
    chatName: 'Fulano',
    senderName: 'Fulano da Silva',
    connectedPhone: '5511000000000',
    isGroup: false,
    isNewsletter: false,
    broadcast: false,
    type: 'ReceivedCallback',
    text: { message: 'Olá, tenho interesse' },
    ...over,
  }
}

describe('validarSegredoWebhook', () => {
  it('aceita só o segredo exato', () => {
    expect(validarSegredoWebhook('abc', 'abc')).toBe(true)
    expect(validarSegredoWebhook('abd', 'abc')).toBe(false)
    expect(validarSegredoWebhook('ab', 'abc')).toBe(false)
  })
  it('recusa quando falta um dos lados', () => {
    expect(validarSegredoWebhook(null, 'abc')).toBe(false)
    expect(validarSegredoWebhook('abc', undefined)).toBe(false)
    expect(validarSegredoWebhook('', '')).toBe(false)
  })
})

describe('interpretarReceivedCallback', () => {
  it('texto individual inbound → mensagem com todos os campos', () => {
    const r = interpretarReceivedCallback(callback(), INSTANCIA)
    expect(r.tipo).toBe('mensagem')
    if (r.tipo !== 'mensagem') return
    expect(r.mensagem).toEqual({
      whatsappMessageId: 'MSG-1',
      direcao: 'inbound',
      telefone: '5511999998888',
      nome: 'Fulano da Silva',
      conteudo: 'Olá, tenho interesse',
      mensagemEm: '2021-09-21T12:50:38.000Z',
      connectedPhone: '5511000000000',
      meta: { instanceId: INSTANCIA, status: 'RECEIVED', fromMe: false, momment: 1632228638000 },
    })
  })

  it('fromMe=false → inbound; fromMe=true → outbound', () => {
    const a = interpretarReceivedCallback(callback({ fromMe: false }), INSTANCIA)
    const b = interpretarReceivedCallback(callback({ fromMe: true }), INSTANCIA)
    expect(a.tipo === 'mensagem' && a.mensagem.direcao).toBe('inbound')
    expect(b.tipo === 'mensagem' && b.mensagem.direcao).toBe('outbound')
    expect(b.tipo === 'mensagem' && b.mensagem.meta.fromMe).toBe(true)
  })

  it('momment em ms vira ISO; ausente/inválido cai para agora', () => {
    const ok = interpretarReceivedCallback(callback({ momment: 1700000000000 }), INSTANCIA)
    expect(ok.tipo === 'mensagem' && ok.mensagem.mensagemEm).toBe('2023-11-14T22:13:20.000Z')

    const antes = Date.now()
    const sem = interpretarReceivedCallback(callback({ momment: undefined }), INSTANCIA)
    expect(sem.tipo).toBe('mensagem')
    if (sem.tipo !== 'mensagem') return
    expect(new Date(sem.mensagem.mensagemEm).getTime()).toBeGreaterThanOrEqual(antes)
    expect(sem.mensagem.meta.momment).toBeNull()
  })

  it('normaliza phone (máscara, +, espaços) para só dígitos', () => {
    const r = interpretarReceivedCallback(callback({ phone: '+55 (11) 99999-8888' }), INSTANCIA)
    expect(r.tipo === 'mensagem' && r.mensagem.telefone).toBe('5511999998888')
  })

  it('cai para chatName quando não há senderName', () => {
    const r = interpretarReceivedCallback(callback({ senderName: undefined, chatName: 'Chat X' }), INSTANCIA)
    expect(r.tipo === 'mensagem' && r.mensagem.nome).toBe('Chat X')
  })

  it('grupo, newsletter e broadcast → ignorar', () => {
    expect(interpretarReceivedCallback(callback({ isGroup: true }), INSTANCIA)).toEqual({ tipo: 'ignorar', motivo: 'grupo' })
    expect(interpretarReceivedCallback(callback({ isNewsletter: true }), INSTANCIA)).toEqual({ tipo: 'ignorar', motivo: 'newsletter' })
    expect(interpretarReceivedCallback(callback({ broadcast: true }), INSTANCIA)).toEqual({ tipo: 'ignorar', motivo: 'broadcast' })
  })

  it('sem text.message (mídia, sticker…) → ignorar sem_texto', () => {
    expect(interpretarReceivedCallback(callback({ text: undefined, image: { caption: 'x' } }), INSTANCIA)).toEqual({ tipo: 'ignorar', motivo: 'sem_texto' })
    expect(interpretarReceivedCallback(callback({ text: { message: '   ' } }), INSTANCIA)).toEqual({ tipo: 'ignorar', motivo: 'sem_texto' })
  })

  it('type diferente de ReceivedCallback → ignorar', () => {
    expect(interpretarReceivedCallback(callback({ type: 'DeliveryCallback' }), INSTANCIA)).toEqual({ tipo: 'ignorar', motivo: 'tipo_nao_suportado' })
    expect(interpretarReceivedCallback(callback({ type: 'MessageStatusCallback' }), INSTANCIA)).toEqual({ tipo: 'ignorar', motivo: 'tipo_nao_suportado' })
  })

  it('instanceId diferente do esperado → ignorar (não processa)', () => {
    expect(interpretarReceivedCallback(callback({ instanceId: 'outra' }), INSTANCIA)).toEqual({ tipo: 'ignorar', motivo: 'instancia_desconhecida' })
    expect(interpretarReceivedCallback(callback({ instanceId: undefined }), INSTANCIA)).toEqual({ tipo: 'ignorar', motivo: 'instancia_desconhecida' })
  })

  it('messageId ausente → inválido', () => {
    expect(interpretarReceivedCallback(callback({ messageId: '' }), INSTANCIA)).toEqual({ tipo: 'invalido', motivo: 'messageId ausente' })
  })

  it('phone ausente ou sem dígitos → inválido', () => {
    expect(interpretarReceivedCallback(callback({ phone: undefined }), INSTANCIA).tipo).toBe('invalido')
    expect(interpretarReceivedCallback(callback({ phone: 'abc' }), INSTANCIA).tipo).toBe('invalido')
  })

  it('payload não-objeto → inválido', () => {
    expect(interpretarReceivedCallback(null, INSTANCIA).tipo).toBe('invalido')
    expect(interpretarReceivedCallback('x', INSTANCIA).tipo).toBe('invalido')
  })
})

// Supabase fake: `leads` devolve os candidatos ao resolver (id, organizacao_id,
// contato_telefone) e `whatsapp_mensagens.upsert` registra a linha. `modo`
// controla o que o upsert devolve: nova (linha), duplicada (vazio) ou erro.
function adminFake(
  leads: Array<{ id: string; organizacao_id: string; contato_telefone: string | null }>,
  modo: 'nova' | 'duplicada' | 'erro' = 'nova',
) {
  const upserts: Array<{ row: Record<string, unknown>; opts: Record<string, unknown> }> = []
  const client = {
    from(t: string) {
      if (t === 'leads') {
        const b: Record<string, unknown> = { select: () => b, not: () => b, limit: async () => ({ data: leads, error: null }) }
        return b
      }
      if (t === 'whatsapp_mensagens') {
        return {
          upsert(row: Record<string, unknown>, opts: Record<string, unknown>) {
            upserts.push({ row, opts })
            return {
              select: async () => modo === 'erro'
                ? { data: null, error: { message: 'boom' } }
                : { data: modo === 'nova' ? [{ id: 'ROW-1' }] : [], error: null },
            }
          },
        }
      }
      throw new Error('tabela inesperada: ' + t)
    },
  } as unknown as SupabaseClient
  return { client, upserts }
}

function mensagem(over: Partial<ReturnType<typeof base>> = {}) { return { ...base(), ...over } }
function base() {
  const r = interpretarReceivedCallback(callback(), INSTANCIA)
  if (r.tipo !== 'mensagem') throw new Error('fixture inválida')
  return r.mensagem
}

describe('persistirMensagemZapi', () => {
  it('lead único → grava com lead_id + organizacao_id do LEAD (nunca do callback)', async () => {
    const { client, upserts } = adminFake([{ id: 'L1', organizacao_id: 'org-A', contato_telefone: '11999998888' }])
    const r = await persistirMensagemZapi(client, mensagem())
    // lead/org devolvidos para o webhook avisar a equipe — os do LEAD, não do callback.
    expect(r).toEqual({ status: 'nova', id: 'ROW-1', vinculo: 'vinculado', leadId: 'L1', organizacaoId: 'org-A' })

    expect(upserts).toHaveLength(1)
    const { row, opts } = upserts[0]
    expect(row).toMatchObject({
      whatsapp_message_id: 'MSG-1',
      direcao: 'inbound',
      remetente: '5511999998888',
      remetente_nome: 'Fulano da Silva',
      tipo: 'text',
      conteudo: 'Olá, tenho interesse',
      mensagem_em: '2021-09-21T12:50:38.000Z',
      phone_number_id: null,
      display_phone_number: '5511000000000',
      lead_id: 'L1',
      organizacao_id: 'org-A',
      payload: { origem: 'zapi.received', provider: 'zapi', instanceId: INSTANCIA, status: 'RECEIVED', fromMe: false, momment: 1632228638000 },
    })
    expect(opts).toEqual({ onConflict: 'whatsapp_message_id', ignoreDuplicates: true })
  })

  it('fromMe=true grava como outbound', async () => {
    const { client, upserts } = adminFake([{ id: 'L1', organizacao_id: 'org-A', contato_telefone: '11999998888' }])
    await persistirMensagemZapi(client, mensagem({ direcao: 'outbound', meta: { ...base().meta, fromMe: true } }))
    expect(upserts[0].row.direcao).toBe('outbound')
    expect((upserts[0].row.payload as { fromMe: boolean }).fromMe).toBe(true)
  })

  it('lead inexistente → grava SEM lead_id/organizacao_id (nada inventado)', async () => {
    const { client, upserts } = adminFake([])
    const r = await persistirMensagemZapi(client, mensagem())
    expect(r).toEqual({ status: 'nova', id: 'ROW-1', vinculo: 'sem_lead' })
    expect(upserts[0].row).not.toHaveProperty('lead_id')
    expect(upserts[0].row).not.toHaveProperty('organizacao_id')
  })

  it('telefone em DUAS organizações → ambíguo → sem vínculo (não cruza tenant)', async () => {
    const { client, upserts } = adminFake([
      { id: 'L-A', organizacao_id: 'org-A', contato_telefone: '11999998888' },
      { id: 'L-B', organizacao_id: 'org-B', contato_telefone: '5511999998888' },
    ])
    const r = await persistirMensagemZapi(client, mensagem())
    expect(r).toEqual({ status: 'nova', id: 'ROW-1', vinculo: 'ambiguo' })
    expect(upserts[0].row).not.toHaveProperty('lead_id')
    expect(upserts[0].row).not.toHaveProperty('organizacao_id')
  })

  it('vínculo reusa o resolver do inbound Meta: casa com/sem DDI', async () => {
    // Lead salvo sem DDI; callback chega com DDI. Mesma regra de equivalência.
    const { client, upserts } = adminFake([{ id: 'L1', organizacao_id: 'org-A', contato_telefone: '(11) 99999-8888' }])
    const r = await persistirMensagemZapi(client, mensagem({ telefone: '5511999998888' }))
    expect(r).toMatchObject({ status: 'nova', vinculo: 'vinculado' })
    expect(upserts[0].row.lead_id).toBe('L1')
  })

  it('callback DUPLICADO → duplicada, sem segunda linha e sem erro', async () => {
    const { client, upserts } = adminFake([{ id: 'L1', organizacao_id: 'org-A', contato_telefone: '11999998888' }], 'duplicada')
    const r = await persistirMensagemZapi(client, mensagem())
    expect(r).toEqual({ status: 'duplicada' })
    // O upsert foi tentado uma vez e o banco ignorou — é exatamente o esperado.
    expect(upserts).toHaveLength(1)
    expect(upserts[0].opts).toEqual({ onConflict: 'whatsapp_message_id', ignoreDuplicates: true })
  })

  it('fromMe de mensagem que /api/whatsapp/send JÁ gravou → duplicada; linha original preservada', async () => {
    // O outbound gravou whatsapp_message_id='MSG-OUT' com lead/org da sessão.
    // Depois chega o ReceivedCallback (fromMe=true) com o MESMO messageId.
    const { client, upserts } = adminFake([{ id: 'L1', organizacao_id: 'org-A', contato_telefone: '11999998888' }], 'duplicada')
    const r = await persistirMensagemZapi(client, mensagem({ whatsappMessageId: 'MSG-OUT', direcao: 'outbound' }))
    expect(r).toEqual({ status: 'duplicada' })
    // ignoreDuplicates = INSERT ... ON CONFLICT DO NOTHING: nada é sobrescrito.
    expect(upserts[0].opts.ignoreDuplicates).toBe(true)
  })

  it('erro do banco → status erro com a mensagem', async () => {
    const { client } = adminFake([], 'erro')
    const r = await persistirMensagemZapi(client, mensagem())
    expect(r).toEqual({ status: 'erro', mensagem: 'boom' })
  })
})
