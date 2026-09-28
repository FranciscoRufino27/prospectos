import 'server-only'
import crypto from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizarTelefone } from './telefone'
import { resolverVinculoPorTelefone, type VinculoLead } from './inbound'

// Inbound da Z-API — interpretação e persistência do ReceivedCallback.
//
// Coexiste com o inbound da Meta (lib/whatsapp/inbound.ts) e REUSA dele o
// resolver de lead por telefone (`resolverVinculoPorTelefone`) — a regra de
// vínculo/ambiguidade é uma só para os dois provedores. O que é próprio daqui:
// o formato do callback, a direção por `fromMe` e o payload de diagnóstico.
//
// Primeira versão: SÓ texto individual. Grupo, newsletter, broadcast, mídia e
// outros tipos são IGNORADOS com sucesso (o webhook responde 200) — não há por
// que a Z-API reenviar um evento que não vamos processar.

// --- Segredo do webhook ------------------------------------------------------
// A Z-API não assina o callback; o que ela permite é configurar a URL. Então o
// segredo vai na query string (`?secret=...`) e é comparado em tempo constante,
// no mesmo padrão de lib/engine/optout.ts. Nunca é logado.
export function validarSegredoWebhook(recebido: string | null | undefined, esperado: string | null | undefined): boolean {
  if (!esperado || !recebido) return false
  const a = Buffer.from(recebido)
  const b = Buffer.from(esperado)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

// --- Interpretação -----------------------------------------------------------

// Só os campos do ReceivedCallback que usamos. Ver docs da Z-API.
interface ReceivedCallbackZapi {
  type?: unknown
  instanceId?: unknown
  messageId?: unknown
  phone?: unknown
  fromMe?: unknown
  momment?: unknown
  status?: unknown
  chatName?: unknown
  senderName?: unknown
  connectedPhone?: unknown
  isGroup?: unknown
  isNewsletter?: unknown
  broadcast?: unknown
  text?: { message?: unknown } | null
}

export interface MensagemZapi {
  whatsappMessageId: string
  direcao: 'inbound' | 'outbound' // fromMe=false → inbound; fromMe=true → outbound
  telefone: string                 // contraparte, só dígitos
  nome: string | null              // senderName (inbound) / chatName
  conteudo: string
  mensagemEm: string               // ISO
  connectedPhone: string | null    // nosso número, se veio
  // Metadata suficiente para diagnóstico — nunca o callback inteiro.
  meta: { instanceId: string; status: string | null; fromMe: boolean; momment: number | null }
}

export type Interpretacao =
  | { tipo: 'mensagem'; mensagem: MensagemZapi }
  | { tipo: 'ignorar'; motivo: MotivoIgnorar }
  | { tipo: 'invalido'; motivo: string }

export type MotivoIgnorar =
  | 'tipo_nao_suportado'   // não é ReceivedCallback
  | 'instancia_desconhecida'
  | 'grupo'
  | 'newsletter'
  | 'broadcast'
  | 'sem_texto'            // mídia, sticker, etc. — fora da 1ª versão

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

// `momment` vem em MILISSEGUNDOS. Ausente/inválido → agora (mesma escolha do
// inbound Meta, que cai para "agora" quando o timestamp não presta).
function mommentParaIso(v: unknown): { iso: string; momment: number | null } {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  if (Number.isFinite(n) && n > 0) return { iso: new Date(n).toISOString(), momment: n }
  return { iso: new Date().toISOString(), momment: null }
}

/**
 * Lê um callback bruto e decide: mensagem processável, ignorar (200) ou
 * inválido. Puro e determinístico — sem I/O.
 */
export function interpretarReceivedCallback(payload: unknown, instanceIdEsperado: string): Interpretacao {
  if (!payload || typeof payload !== 'object') return { tipo: 'invalido', motivo: 'payload não é objeto' }
  const p = payload as ReceivedCallbackZapi

  if (p.type !== 'ReceivedCallback') return { tipo: 'ignorar', motivo: 'tipo_nao_suportado' }

  const instanceId = str(p.instanceId)
  if (!instanceId || instanceId !== instanceIdEsperado) return { tipo: 'ignorar', motivo: 'instancia_desconhecida' }

  if (p.isGroup === true) return { tipo: 'ignorar', motivo: 'grupo' }
  if (p.isNewsletter === true) return { tipo: 'ignorar', motivo: 'newsletter' }
  if (p.broadcast === true) return { tipo: 'ignorar', motivo: 'broadcast' }

  const messageId = str(p.messageId)
  if (!messageId) return { tipo: 'invalido', motivo: 'messageId ausente' }

  const telefone = normalizarTelefone(str(p.phone))
  if (!telefone) return { tipo: 'invalido', motivo: 'phone ausente ou sem dígitos' }

  const conteudo = str(p.text?.message)
  if (!conteudo) return { tipo: 'ignorar', motivo: 'sem_texto' }

  const fromMe = p.fromMe === true
  const { iso, momment } = mommentParaIso(p.momment)

  return {
    tipo: 'mensagem',
    mensagem: {
      whatsappMessageId: messageId,
      direcao: fromMe ? 'outbound' : 'inbound',
      telefone,
      // No inbound o remetente é o contato (senderName); no fromMe, o nome do
      // chat ainda identifica a contraparte.
      nome: str(p.senderName) ?? str(p.chatName),
      conteudo,
      mensagemEm: iso,
      connectedPhone: str(p.connectedPhone) ? normalizarTelefone(str(p.connectedPhone)) : null,
      meta: { instanceId, status: str(p.status), fromMe, momment },
    },
  }
}

// --- Persistência ------------------------------------------------------------

export type ResultadoPersistenciaZapi =
  // leadId/organizacaoId só quando o vínculo é único (quem chama avisa a equipe).
  | { status: 'nova'; id: string; vinculo: VinculoLead['status']; leadId?: string; organizacaoId?: string }
  | { status: 'duplicada' } // whatsapp_message_id já existia — linha original preservada
  | { status: 'erro'; mensagem: string }

/**
 * Grava a mensagem em `whatsapp_mensagens` com as mesmas convenções do inbound
 * Meta e do outbound Z-API:
 *   - `remetente` = telefone da CONTRAPARTE nos dois sentidos;
 *   - vínculo lead/organização SÓ via `resolverVinculoPorTelefone` — o callback
 *     não é fonte de organizacao_id/lead_id, e ambiguidade = sem vínculo;
 *   - `upsert` + `ignoreDuplicates` em `whatsapp_message_id`: callback repetido
 *     ou fromMe de mensagem que /api/whatsapp/send já gravou NÃO duplica nem
 *     sobrescreve — a primeira linha (a mais completa) fica.
 */
export async function persistirMensagemZapi(
  admin: SupabaseClient,
  m: MensagemZapi,
): Promise<ResultadoPersistenciaZapi> {
  const vinculo = await resolverVinculoPorTelefone(admin, m.telefone)
  const campoVinculo = vinculo.status === 'vinculado'
    ? { lead_id: vinculo.leadId, organizacao_id: vinculo.organizacaoId }
    : {}

  const { data, error } = await admin
    .from('whatsapp_mensagens')
    .upsert(
      {
        whatsapp_message_id: m.whatsappMessageId,
        direcao: m.direcao,
        remetente: m.telefone,
        remetente_nome: m.nome,
        tipo: 'text',
        conteudo: m.conteudo,
        mensagem_em: m.mensagemEm,
        phone_number_id: null,
        display_phone_number: m.connectedPhone,
        payload: { origem: 'zapi.received', provider: 'zapi', ...m.meta },
        ...campoVinculo,
      },
      { onConflict: 'whatsapp_message_id', ignoreDuplicates: true },
    )
    .select('id')

  if (error) return { status: 'erro', mensagem: error.message }
  // ignoreDuplicates: linha retornada = inserção nova; vazio = já existia.
  const linha = data?.[0] as { id?: string } | undefined
  if (!linha?.id) return { status: 'duplicada' }

  if (vinculo.status === 'ambiguo') {
    console.warn(JSON.stringify({
      ts: new Date().toISOString(), nivel: 'aviso', escopo: 'webhook.zapi',
      msg: 'Telefone casa com mais de um lead — mensagem gravada SEM vínculo.',
      whatsappMessageId: m.whatsappMessageId, leadIds: vinculo.leadIds, organizacaoIds: vinculo.organizacaoIds,
    }))
  }
  return {
    status: 'nova', id: linha.id, vinculo: vinculo.status,
    ...(vinculo.status === 'vinculado' ? { leadId: vinculo.leadId, organizacaoId: vinculo.organizacaoId } : {}),
  }
}
