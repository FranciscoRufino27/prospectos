import { NextRequest, NextResponse, after } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { avisarRespostaWhatsapp } from '@/lib/comercial/avisosResposta/composicao'
import { extrairMensagensInbound, persistirMensagensInbound } from '@/lib/whatsapp/inbound'

export const runtime = 'nodejs'

// Webhook do WhatsApp Cloud API (Meta). Rota PÚBLICA — a Meta chama de fora,
// sem sessão nem cabeçalho interno. Por isso não usa resolverAcesso()/
// exigirPermissao() (não há usuário logado aqui) nem organizacao_id (ainda não
// existe roteamento de número → organização; é o que a Fase 2 desta feature
// resolve, quando a lógica de negócio for implementada).
//
// Duas responsabilidades, e só isso por enquanto:
//   GET  — handshake de verificação exigido pela Meta ao configurar o webhook.
//   POST — recebimento de evento. Registra em log e responde 200 rápido; a
//          Meta reenvia com backoff se não receber 200 em poucos segundos, e o
//          reenvio duplicaria o evento se a lógica de negócio (ainda não
//          escrita) não for idempotente.
//
// WHATSAPP_VERIFY_TOKEN é uma string secreta que NÓS escolhemos e cadastramos
// no painel da Meta — não é o access token da conta, que autentica chamadas da
// ProspectOS PARA a Meta (envio de mensagem), não o inverso.

// GET — handshake de verificação (Meta > Configuration > Webhooks > Verify).
export async function GET(req: NextRequest) {
  const modo = req.nextUrl.searchParams.get('hub.mode')
  const tokenRecebido = req.nextUrl.searchParams.get('hub.verify_token')
  const challenge = req.nextUrl.searchParams.get('hub.challenge')

  const tokenEsperado = process.env.WHATSAPP_VERIFY_TOKEN
  if (!tokenEsperado) {
    console.error(JSON.stringify({
      ts: new Date().toISOString(), nivel: 'erro', escopo: 'webhook.whatsapp',
      msg: 'WHATSAPP_VERIFY_TOKEN não configurada no ambiente — verificação da Meta recusada.',
    }))
    return new NextResponse('Webhook não configurado.', { status: 403 })
  }

  if (modo === 'subscribe' && tokenRecebido === tokenEsperado && challenge) {
    console.log(JSON.stringify({
      ts: new Date().toISOString(), nivel: 'info', escopo: 'webhook.whatsapp',
      msg: 'Verificação da Meta concluída.',
    }))
    // A Meta exige o challenge como corpo TEXTO puro, sem envelope JSON.
    return new NextResponse(challenge, { status: 200 })
  }

  console.error(JSON.stringify({
    ts: new Date().toISOString(), nivel: 'erro', escopo: 'webhook.whatsapp',
    msg: 'Verificação da Meta recusada — modo ou token não conferem.', modo,
  }))
  return new NextResponse('Forbidden', { status: 403 })
}

// POST — evento recebido. Persiste apenas MENSAGENS reais (status de
// entrega/leitura e outros eventos são ignorados dentro de
// extrairMensagensInbound). Sem vínculo com lead nesta rodada.
//
// Regra de ouro: SEMPRE responder 200 rápido. Um 4xx/5xx faz a Meta reenviar
// com backoff — e a persistência, sendo operação secundária, nunca pode causar
// isso. Erro de banco é registrado e a resposta continua 200 (a idempotência
// por whatsapp_message_id cobre um eventual reenvio).
export async function POST(req: NextRequest) {
  let corpo: unknown = null
  try {
    corpo = await req.json()
  } catch {
    console.error(JSON.stringify({
      ts: new Date().toISOString(), nivel: 'erro', escopo: 'webhook.whatsapp',
      msg: 'Payload do POST não é JSON válido.',
    }))
    return NextResponse.json({ ok: true })
  }

  try {
    const mensagens = extrairMensagensInbound(corpo)
    if (mensagens.length === 0) {
      console.log(JSON.stringify({
        ts: new Date().toISOString(), nivel: 'info', escopo: 'webhook.whatsapp',
        msg: 'Evento sem mensagem (status/notificação) — ignorado.',
      }))
      return NextResponse.json({ ok: true })
    }

    const admin = createSupabaseAdminClient()
    // Cliente escreveu: avisa a equipe no WhatsApp depois de responder à Meta.
    // Falha no aviso não afeta o webhook (o outbox reprocessa).
    const resumo = await persistirMensagensInbound(admin, mensagens, (m) => {
      after(() => avisarRespostaWhatsapp(admin, {
        organizacaoId: m.organizacaoId, leadId: m.leadId, whatsappMessageId: m.whatsappMessageId, texto: m.conteudo,
      }))
    })
    console.log(JSON.stringify({
      ts: new Date().toISOString(), nivel: 'info', escopo: 'webhook.whatsapp',
      msg: 'Mensagens inbound processadas.', ...resumo,
    }))
  } catch (e) {
    // Rede de segurança: nada aqui pode derrubar a resposta 200.
    console.error(JSON.stringify({
      ts: new Date().toISOString(), nivel: 'erro', escopo: 'webhook.whatsapp',
      msg: 'Erro ao processar evento — respondendo 200 mesmo assim.',
      erro: e instanceof Error ? e.message : String(e),
    }))
  }

  return NextResponse.json({ ok: true })
}
