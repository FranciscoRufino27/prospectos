import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { telefonesEquivalentes } from './telefone'

// Parsing + persistência das mensagens inbound do WhatsApp Cloud API.
//
// O webhook (/api/webhooks/whatsapp) só chama isto; toda a lógica fica aqui
// para poder ser testada sem subir rota.
//
// Vínculo com lead (etapa desta rodada): ao gravar a mensagem, tenta localizar
// o lead dono do telefone do remetente. Se achar EXATAMENTE um, grava `lead_id`
// e o `organizacao_id` DESSE lead na mensagem. Se não achar nenhum, ou se achar
// mais de um, a mensagem fica sem vínculo (lead_id/organizacao_id NULL) — nunca
// há escolha arbitrária. Ver `resolverVinculoPorTelefone`.

// Formato do webhook da Meta (só os campos que usamos). Ver
// https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples
interface PayloadMeta {
  object?: string
  entry?: Array<{
    id?: string
    changes?: Array<{
      field?: string
      value?: ValorMudanca
    }>
  }>
}

interface ValorMudanca {
  messaging_product?: string
  metadata?: { display_phone_number?: string; phone_number_id?: string }
  contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>
  messages?: MensagemMeta[]
  // Eventos de status (entrega/leitura) vêm aqui — ignorados nesta rodada.
  statuses?: unknown[]
}

interface MensagemMeta {
  id?: string
  from?: string
  timestamp?: string
  type?: string
  text?: { body?: string }
  button?: { text?: string }
  interactive?: {
    button_reply?: { title?: string }
    list_reply?: { title?: string }
  }
  image?: { caption?: string }
  video?: { caption?: string }
  document?: { caption?: string; filename?: string }
  [k: string]: unknown
}

export interface MensagemInbound {
  whatsappMessageId: string
  remetente: string
  remetenteNome: string | null
  tipo: string
  conteudo: string | null
  mensagemEm: string // ISO 8601
  phoneNumberId: string | null
  displayPhoneNumber: string | null
  payloadBruto: Record<string, unknown> // o `value` da mudança
}

// Texto legível da mensagem, quando o tipo tem algum. Para tipos sem texto
// (sticker, location, contacts, reaction…) devolve null — o payload cru guarda
// o resto.
function extrairConteudo(msg: MensagemMeta): string | null {
  const candidatos = [
    msg.text?.body,
    msg.button?.text,
    msg.interactive?.button_reply?.title,
    msg.interactive?.list_reply?.title,
    msg.image?.caption,
    msg.video?.caption,
    msg.document?.caption,
    msg.document?.filename,
  ]
  for (const c of candidatos) {
    if (typeof c === 'string' && c.trim()) return c
  }
  return null
}

// epoch (segundos, string) -> ISO. Cai para "agora" se vier ausente/inválido.
function timestampParaIso(bruto: string | undefined): string {
  const seg = Number(bruto)
  if (Number.isFinite(seg) && seg > 0) return new Date(seg * 1000).toISOString()
  return new Date().toISOString()
}

/**
 * Extrai as mensagens REAIS de um payload do webhook. Eventos que não são
 * mensagem (status de entrega/leitura, notificações de conta) resultam em lista
 * vazia — sem erro. Mensagem sem `id` ou sem `from` é descartada (não dá para
 * deduplicar nem saber de quem é).
 */
export function extrairMensagensInbound(payload: unknown): MensagemInbound[] {
  const p = payload as PayloadMeta
  if (!p || typeof p !== 'object' || !Array.isArray(p.entry)) return []

  const resultado: MensagemInbound[] = []
  for (const entry of p.entry) {
    for (const mudanca of entry.changes ?? []) {
      const valor = mudanca.value
      if (!valor || !Array.isArray(valor.messages) || valor.messages.length === 0) continue

      const nomePorWaId = new Map<string, string>()
      for (const contato of valor.contacts ?? []) {
        const nome = contato.profile?.name?.trim()
        if (contato.wa_id && nome) nomePorWaId.set(contato.wa_id, nome)
      }

      for (const msg of valor.messages) {
        if (!msg.id || !msg.from) continue
        resultado.push({
          whatsappMessageId: msg.id,
          remetente: msg.from,
          remetenteNome: nomePorWaId.get(msg.from) ?? null,
          tipo: typeof msg.type === 'string' && msg.type ? msg.type : 'unknown',
          conteudo: extrairConteudo(msg),
          mensagemEm: timestampParaIso(msg.timestamp),
          phoneNumberId: valor.metadata?.phone_number_id ?? null,
          displayPhoneNumber: valor.metadata?.display_phone_number ?? null,
          payloadBruto: valor as unknown as Record<string, unknown>,
        })
      }
    }
  }
  return resultado
}

export interface ResultadoPersistencia {
  recebidas: number
  novas: number
  duplicadas: number
  erros: number
  // Desmembramento do vínculo com lead (só conta as inserções NOVAS; reenvio
  // duplicado não re-resolve nada).
  vinculadas: number // casou exatamente 1 lead -> lead_id + organizacao_id gravados
  semLead: number    // nenhum lead casou o telefone
  ambiguas: number   // 2+ leads casaram -> sem vínculo, ambiguidade logada
}

// Resultado da tentativa de achar o lead dono de um telefone.
export type VinculoLead =
  | { status: 'vinculado'; leadId: string; organizacaoId: string }
  | { status: 'sem_lead' }
  | { status: 'ambiguo'; leadIds: string[]; organizacaoIds: string[] }
  | { status: 'erro' }

// Teto defensivo da leitura de candidatos. A base de leads é da ordem de
// centenas; se algum dia passar disto, o log abaixo avisa que a estratégia
// precisa mudar.
//
// TODO (otimização futura, fora do escopo desta rodada): trocar o scan de
// ~todos os leads + filtro em JS por uma coluna `contato_telefone_normalizado`
// (só dígitos, mantida por trigger/migration) com índice, e consultar por
// `.in()` nas variantes com/sem DDI. Enquanto a base for pequena, o scan de 3
// colunas por mensagem inbound é aceitável.
const LIMITE_LEADS_CANDIDATOS = 20000

/**
 * Localiza o lead cujo `contato_telefone` é equivalente ao telefone do
 * remetente (com/sem DDI 55, ignorando máscara — ver lib/whatsapp/telefone.ts).
 *
 * É uma leitura DELIBERADAMENTE cross-organização: o webhook é público e não
 * tem tenant; descobrir a organização a partir do telefone é justamente o que
 * esta função faz. Mitigações do invariante multi-tenant:
 *   - lê só 3 colunas não sensíveis (id, organizacao_id, contato_telefone);
 *   - o `organizacao_id` gravado na mensagem vem SEMPRE do lead casado, nunca
 *     de payload do cliente;
 *   - qualquer ambiguidade (inclusive entre organizações) resulta em SEM
 *     vínculo — nada é escrito com base em palpite.
 *
 * Retorna:
 *   'vinculado' — exatamente 1 lead distinto casou.
 *   'sem_lead'  — nenhum casou.
 *   'ambiguo'   — 2+ leads distintos casaram (a mensagem fica sem vínculo).
 *   'erro'      — falha ao ler os candidatos (a mensagem fica sem vínculo).
 */
export async function resolverVinculoPorTelefone(
  admin: SupabaseClient,
  remetente: string,
): Promise<VinculoLead> {
  const { data, error } = await admin
    .from('leads')
    .select('id, organizacao_id, contato_telefone')
    .not('contato_telefone', 'is', null)
    .limit(LIMITE_LEADS_CANDIDATOS)

  if (error) {
    console.error(JSON.stringify({
      ts: new Date().toISOString(), nivel: 'erro', escopo: 'webhook.whatsapp',
      msg: 'Falha ao ler leads para vincular mensagem inbound.',
      remetente, erro: error.message,
    }))
    return { status: 'erro' }
  }

  const linhas = (data ?? []) as Array<{
    id: string; organizacao_id: string; contato_telefone: string | null
  }>
  if (linhas.length >= LIMITE_LEADS_CANDIDATOS) {
    console.warn(JSON.stringify({
      ts: new Date().toISOString(), nivel: 'aviso', escopo: 'webhook.whatsapp',
      msg: 'Leitura de candidatos a lead atingiu o teto — trocar por consulta indexada.',
      limite: LIMITE_LEADS_CANDIDATOS,
    }))
  }

  // Dedup por lead: a base tem o mesmo contato repetido em leads diferentes.
  const casados = new Map<string, string>() // leadId -> organizacaoId
  for (const l of linhas) {
    if (telefonesEquivalentes(remetente, l.contato_telefone)) {
      casados.set(l.id, l.organizacao_id)
    }
  }

  if (casados.size === 0) return { status: 'sem_lead' }
  if (casados.size === 1) {
    const [[leadId, organizacaoId]] = casados
    return { status: 'vinculado', leadId, organizacaoId }
  }
  return {
    status: 'ambiguo',
    leadIds: [...casados.keys()],
    organizacaoIds: [...new Set(casados.values())],
  }
}

/**
 * Grava cada mensagem, ignorando as que já existem (idempotência por
 * `whatsapp_message_id`). Nunca lança: um erro de banco é contado e registrado,
 * mas não pode virar resposta não-200 para a Meta (evita reenvio em loop).
 *
 * Antes de gravar, tenta vincular a mensagem a um lead pelo telefone do
 * remetente (ver `resolverVinculoPorTelefone`). O vínculo entra na PRÓPRIA
 * inserção — então um reenvio da Meta (mesmo `whatsapp_message_id`) não
 * re-resolve nem sobrescreve nada: `ignoreDuplicates` mantém a primeira linha.
 * Os contadores `vinculadas`/`semLead`/`ambiguas` classificam apenas as
 * inserções NOVAS.
 */
export async function persistirMensagensInbound(
  admin: SupabaseClient,
  mensagens: MensagemInbound[],
  // Chamado para cada mensagem NOVA vinculada a um lead (quem chama avisa a
  // equipe). Reenvio duplicado não chama.
  aoGravarVinculada?: (m: { leadId: string; organizacaoId: string; whatsappMessageId: string; conteudo: string }) => void,
): Promise<ResultadoPersistencia> {
  const resultado: ResultadoPersistencia = {
    recebidas: mensagens.length, novas: 0, duplicadas: 0, erros: 0,
    vinculadas: 0, semLead: 0, ambiguas: 0,
  }

  for (const m of mensagens) {
    try {
      const vinculo = await resolverVinculoPorTelefone(admin, m.remetente)
      // Só grava organizacao_id/lead_id quando há UM lead. Ambiguidade, ausência
      // ou erro de leitura -> mensagem fica sem vínculo (campos NULL).
      const campoVinculo =
        vinculo.status === 'vinculado'
          ? { lead_id: vinculo.leadId, organizacao_id: vinculo.organizacaoId }
          : {}

      const { data, error } = await admin
        .from('whatsapp_mensagens')
        .upsert(
          {
            whatsapp_message_id: m.whatsappMessageId,
            direcao: 'inbound',
            remetente: m.remetente,
            remetente_nome: m.remetenteNome,
            tipo: m.tipo,
            conteudo: m.conteudo,
            mensagem_em: m.mensagemEm,
            phone_number_id: m.phoneNumberId,
            display_phone_number: m.displayPhoneNumber,
            payload: m.payloadBruto,
            ...campoVinculo,
          },
          { onConflict: 'whatsapp_message_id', ignoreDuplicates: true },
        )
        .select('id')

      if (error) {
        resultado.erros += 1
        console.error(JSON.stringify({
          ts: new Date().toISOString(), nivel: 'erro', escopo: 'webhook.whatsapp',
          msg: 'Falha ao gravar mensagem inbound.',
          whatsappMessageId: m.whatsappMessageId, erro: error.message,
        }))
        continue
      }

      // upsert com ignoreDuplicates: linha retornada = inserção nova; vazio = já existia.
      if ((data?.length ?? 0) === 0) {
        resultado.duplicadas += 1
        continue
      }
      resultado.novas += 1

      if (vinculo.status === 'vinculado') {
        resultado.vinculadas += 1
        aoGravarVinculada?.({
          leadId: vinculo.leadId, organizacaoId: vinculo.organizacaoId,
          whatsappMessageId: m.whatsappMessageId, conteudo: m.conteudo ?? '',
        })
        console.log(JSON.stringify({
          ts: new Date().toISOString(), nivel: 'info', escopo: 'webhook.whatsapp',
          msg: 'Mensagem inbound vinculada a lead.',
          whatsappMessageId: m.whatsappMessageId,
          leadId: vinculo.leadId, organizacaoId: vinculo.organizacaoId,
        }))
      } else if (vinculo.status === 'ambiguo') {
        resultado.ambiguas += 1
        console.warn(JSON.stringify({
          ts: new Date().toISOString(), nivel: 'aviso', escopo: 'webhook.whatsapp',
          msg: 'Telefone do remetente casa com mais de um lead — mensagem gravada SEM vínculo.',
          whatsappMessageId: m.whatsappMessageId, remetente: m.remetente,
          leadIds: vinculo.leadIds, organizacaoIds: vinculo.organizacaoIds,
        }))
      } else if (vinculo.status === 'sem_lead') {
        resultado.semLead += 1
      }
      // status 'erro' já foi logado dentro do resolver; mensagem fica sem vínculo.
    } catch (e) {
      resultado.erros += 1
      console.error(JSON.stringify({
        ts: new Date().toISOString(), nivel: 'erro', escopo: 'webhook.whatsapp',
        msg: 'Exceção ao gravar mensagem inbound.',
        whatsappMessageId: m.whatsappMessageId,
        erro: e instanceof Error ? e.message : String(e),
      }))
    }
  }
  return resultado
}
