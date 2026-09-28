import { NextRequest, NextResponse, after } from 'next/server'
import { avisarRespostaWhatsapp } from '@/lib/comercial/avisosResposta/composicao'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { interpretarReceivedCallback, persistirMensagemZapi, validarSegredoWebhook } from '@/lib/whatsapp/zapiInbound'
import { interpretarCallbackGrupo } from '@/lib/comercial/grupo/callbackGrupo'
import { processarComandoGrupoZapi } from '@/lib/comercial/grupo/composicao'

export const runtime = 'nodejs'

// Webhook ReceivedCallback da Z-API. Rota PÚBLICA — a Z-API chama de fora, sem
// sessão. Convive com o webhook da Meta (/api/webhooks/whatsapp); nada aqui
// toca naquele caminho.
//
// Autenticação: a Z-API não assina o callback nem envia headers customizados —
// só permite configurar a URL. Então a URL cadastrada leva `?secret=<valor>`
// e o valor é comparado em tempo constante com ZAPI_WEBHOOK_SECRET. Sem a
// variável configurada a rota se recusa a processar (503): nunca aceita
// callback anônimo. ZAPI_TOKEN e ZAPI_CLIENT_TOKEN não participam.
//
// Respostas:
//   200 — processado (nova/duplicada) ou ignorado de propósito (grupo, mídia,
//         instância desconhecida…): não há por que a Z-API reenviar.
//   400 — payload realmente inválido (JSON quebrado, sem messageId/phone).
//   401 — segredo ausente/incorreto.
//   500 — falha ao gravar. Reenvio da Z-API aqui é BEM-VINDO: a idempotência
//         por whatsapp_message_id garante que não duplica.
export async function POST(req: NextRequest) {
  const esperado = process.env.ZAPI_WEBHOOK_SECRET
  if (!esperado) {
    console.error(JSON.stringify({
      ts: new Date().toISOString(), nivel: 'erro', escopo: 'webhook.zapi',
      msg: 'ZAPI_WEBHOOK_SECRET não configurada — callback recusado.',
    }))
    return NextResponse.json({ erro: 'Webhook não configurado.' }, { status: 503 })
  }
  if (!validarSegredoWebhook(req.nextUrl.searchParams.get('secret'), esperado)) {
    return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })
  }

  const instanceId = process.env.ZAPI_INSTANCE_ID?.trim()
  if (!instanceId) {
    return NextResponse.json({ erro: 'ZAPI_INSTANCE_ID não configurada.' }, { status: 503 })
  }

  let corpo: unknown
  try {
    corpo = await req.json()
  } catch {
    return NextResponse.json({ erro: 'Payload não é JSON.' }, { status: 400 })
  }

  const leitura = interpretarReceivedCallback(corpo, instanceId)
  if (leitura.tipo === 'invalido') {
    return NextResponse.json({ erro: leitura.motivo }, { status: 400 })
  }
  // GRUPO (Fase 4): mensagens do grupo comercial NÃO são conversas de lead
  // (nunca entram em whatsapp_mensagens). Viram, no máximo, um comando de
  // resposta ao check-in, auditado em comercial_grupo_comandos. Qualquer outro
  // grupo ou texto sem "#referência" é ignorado com 200.
  if (leitura.tipo === 'ignorar' && leitura.motivo === 'grupo') {
    return tratarGrupo(corpo, instanceId)
  }
  if (leitura.tipo === 'ignorar') {
    // Instância desconhecida merece aviso: provavelmente configuração errada.
    if (leitura.motivo === 'instancia_desconhecida') {
      console.warn(JSON.stringify({
        ts: new Date().toISOString(), nivel: 'aviso', escopo: 'webhook.zapi',
        msg: 'Callback de instância diferente de ZAPI_INSTANCE_ID — ignorado.',
      }))
    }
    return NextResponse.json({ ok: true, ignorado: leitura.motivo })
  }

  try {
    const r = await persistirMensagemZapi(createSupabaseAdminClient(), leitura.mensagem)
    if (r.status === 'erro') {
      console.error(JSON.stringify({
        ts: new Date().toISOString(), nivel: 'erro', escopo: 'webhook.zapi',
        msg: 'Falha ao gravar mensagem da Z-API.', whatsappMessageId: leitura.mensagem.whatsappMessageId, erro: r.mensagem,
      }))
      return NextResponse.json({ erro: 'Falha ao gravar a mensagem.' }, { status: 500 })
    }
    console.log(JSON.stringify({
      ts: new Date().toISOString(), nivel: 'info', escopo: 'webhook.zapi',
      msg: r.status === 'nova' ? 'Mensagem da Z-API gravada.' : 'Callback repetido — já gravada.',
      whatsappMessageId: leitura.mensagem.whatsappMessageId, direcao: leitura.mensagem.direcao,
      ...(r.status === 'nova' ? { vinculo: r.vinculo } : {}),
    }))
    // Cliente escreveu (não fomos nós): avisa a equipe no WhatsApp, depois de
    // responder à Z-API. Só mensagem NOVA de lead vinculado — callback repetido
    // não avisa de novo. Falha no aviso não afeta o webhook (outbox reprocessa).
    if (r.status === 'nova' && leitura.mensagem.direcao === 'inbound' && r.leadId && r.organizacaoId) {
      const aviso = { organizacaoId: r.organizacaoId, leadId: r.leadId, whatsappMessageId: leitura.mensagem.whatsappMessageId, texto: leitura.mensagem.conteudo }
      after(() => avisarRespostaWhatsapp(createSupabaseAdminClient(), aviso))
    }
    return NextResponse.json({ ok: true, resultado: r.status })
  } catch (e) {
    console.error(JSON.stringify({
      ts: new Date().toISOString(), nivel: 'erro', escopo: 'webhook.zapi',
      msg: 'Exceção ao processar callback.', erro: e instanceof Error ? e.message : String(e),
    }))
    return NextResponse.json({ erro: 'Falha interna.' }, { status: 500 })
  }
}

// Ramo de GRUPO: interpreta o callback como evento de grupo e entrega ao
// domínio comercial. 200 para ignorados/duplicados/rejeitados (não há por que
// a Z-API reenviar); 500 só em falha de infraestrutura — o reenvio é bem-vindo
// porque o comando é idempotente por messageId.
async function tratarGrupo(corpo: unknown, instanceId: string) {
  const leitura = interpretarCallbackGrupo(corpo, instanceId)
  if (leitura.tipo === 'invalido') return NextResponse.json({ erro: leitura.motivo }, { status: 400 })
  if (leitura.tipo === 'ignorar') return NextResponse.json({ ok: true, ignorado: `grupo:${leitura.motivo}` })
  try {
    const r = await processarComandoGrupoZapi(createSupabaseAdminClient(), leitura.evento)
    console.log(JSON.stringify({
      ts: new Date().toISOString(), nivel: r.tipo === 'falhou' ? 'erro' : 'info', escopo: 'webhook.zapi.grupo',
      msg: 'Callback de grupo processado.', providerMessageId: leitura.evento.providerMessageId,
      resultado: r.tipo, ...('motivo' in r ? { motivo: r.motivo } : {}), ...('resultado' in r ? { comando: r.resultado } : {}),
    }))
    return NextResponse.json({ ok: true, resultado: r.tipo, ...('motivo' in r ? { motivo: r.motivo } : {}) })
  } catch (e) {
    console.error(JSON.stringify({
      ts: new Date().toISOString(), nivel: 'erro', escopo: 'webhook.zapi.grupo',
      msg: 'Exceção ao processar comando de grupo.', erro: e instanceof Error ? e.message : String(e),
    }))
    return NextResponse.json({ erro: 'Falha interna.' }, { status: 500 })
  }
}
