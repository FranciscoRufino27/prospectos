// Composição de PRODUÇÃO do aviso de resposta do cliente (server-only): liga o
// repository Supabase, a config da organização e a Z-API ao serviço puro. O
// motor de e-mail e os webhooks do WhatsApp chamam daqui; testes injetam fakes
// direto no serviço.
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { modoAvisoResposta, parseWorkspaceConfig } from '@/lib/config/workspaceConfig'
import { lerConfigZapi, sendText } from '@/lib/whatsapp/zapi'
import { enviadorGrupoZapi, lerGrupoComercialDaOrg } from '../handoff/composicao'
import { SupabaseAvisoRespostaRepository } from './supabaseRepository'
import {
  avisarEnvioCampanha, avisarRespostaCliente, reprocessarAvisosResposta,
  type ContextoLeadAviso, type DepsAvisoResposta, type ResultadoAvisoResposta,
} from './servico'
import type { EntradaAvisoEnvio, EntradaAvisoResposta, EnviadorAviso } from './types'
import { numeroWhatsappAvisos } from './numero'
import { resolverAuthIdDoResponsavel } from '@/lib/leads/responsavelServer'

async function lerContextoLead(admin: SupabaseClient, org: string, leadId: string): Promise<ContextoLeadAviso | null> {
  const { data: lead, error } = await admin
    .from('leads')
    .select('empresa, contato_nome, responsavel_id, responsavel_nome')
    .eq('organizacao_id', org)
    .eq('id', leadId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!lead) return null
  let responsavel: ContextoLeadAviso['responsavel'] = null
  if (lead.responsavel_id) {
    // leads.responsavel_id aponta para `usuarios` (cadastro comercial), não perfis.
    const { data: usuario } = await admin
      .from('usuarios').select('nome').eq('organizacao_id', org).eq('id', lead.responsavel_id).maybeSingle()
    responsavel = { id: lead.responsavel_id as string, nome: (usuario?.nome as string | null) ?? (lead.responsavel_nome as string | null) ?? '' }
  } else if (lead.responsavel_nome) {
    // Legado: só o nome gravado, sem FK — serve para a menção no grupo.
    responsavel = { id: null, nome: lead.responsavel_nome as string }
  }
  return { empresa: (lead.empresa as string | null) ?? '', contato: (lead.contato_nome as string | null) ?? '', responsavel }
}

// Número de avisos de um perfil de login — só se ele ligou os avisos e o
// número é válido; senão null.
export async function lerWhatsappDoPerfil(admin: SupabaseClient, org: string, perfilId: string): Promise<string | null> {
  const { data, error } = await admin
    .from('perfis')
    .select('whatsapp_avisos, avisos_whatsapp_ativo')
    .eq('organizacao_id', org)
    .eq('id', perfilId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data?.avisos_whatsapp_ativo) return null
  return numeroWhatsappAvisos(data.whatsapp_avisos as string | null)
}

// O responsável é um `usuarios`; o número fica no PERFIL de login dele. A
// ponte usuarios → perfil é a mesma da atribuição (e-mail exato, senão nome
// inequívoco); sem correspondência única, não há para quem avisar.
export async function lerWhatsappResponsavel(admin: SupabaseClient, org: string, usuarioId: string): Promise<string | null> {
  const perfilId = await resolverAuthIdDoResponsavel(admin, org, usuarioId)
  if (!perfilId) return null
  return lerWhatsappDoPerfil(admin, org, perfilId)
}

// Z-API → porta do serviço. O individual usa o mesmo send-text do lead.
const enviarIndividualZapi: EnviadorAviso = async (numero, mensagem) => {
  const r = await sendText({ phone: numero, message: mensagem })
  if (r.ok) return { ok: true, providerMessageId: r.messageId ?? r.zaapId ?? r.id ?? null }
  return { ok: false, codigo: r.codigo, mensagem: r.mensagem }
}

function linkLead(leadId: string): string | null {
  const base = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, '')
  return base ? `${base}/leads/${leadId}` : null
}

export function montarDepsAvisoResposta(admin: SupabaseClient): DepsAvisoResposta {
  return {
    repo: new SupabaseAvisoRespostaRepository(admin),
    lerModo: async (org) => {
      const { data, error } = await admin.from('organizacoes').select('configuracoes').eq('id', org).maybeSingle()
      if (error) throw new Error(error.message)
      return modoAvisoResposta(parseWorkspaceConfig(data?.configuracoes))
    },
    lerGrupoId: (org) => lerGrupoComercialDaOrg(admin, org),
    lerContextoLead: (org, leadId) => lerContextoLead(admin, org, leadId),
    lerWhatsappResponsavel: (org, usuarioId) => lerWhatsappResponsavel(admin, org, usuarioId),
    lerWhatsappPerfil: (org, perfilId) => lerWhatsappDoPerfil(admin, org, perfilId),
    enviarIndividual: enviarIndividualZapi,
    enviarGrupo: enviadorGrupoZapi,
    provedorConfigurado: () => lerConfigZapi() !== null,
    linkLead,
  }
}

export type HookAvisoResposta = (entrada: EntradaAvisoResposta) => Promise<ResultadoAvisoResposta>

export function montarHookAvisoResposta(admin: SupabaseClient): HookAvisoResposta {
  const deps = montarDepsAvisoResposta(admin)
  return (entrada) => avisarRespostaCliente(deps, entrada)
}

export type HookAvisoEnvio = (entrada: EntradaAvisoEnvio) => Promise<ResultadoAvisoResposta>

export function montarHookAvisoEnvio(admin: SupabaseClient): HookAvisoEnvio {
  const deps = montarDepsAvisoResposta(admin)
  return (entrada) => avisarEnvioCampanha(deps, entrada)
}

export function reprocessarAvisosRespostaDaOrg(admin: SupabaseClient, organizacaoId: string) {
  return reprocessarAvisosResposta(montarDepsAvisoResposta(admin), organizacaoId)
}

/**
 * Aviso de uma mensagem de WhatsApp recebida de um lead (webhooks Meta/Z-API).
 * Nunca lança: o webhook já gravou a mensagem e não pode falhar por causa do
 * aviso. Sem classificação — só o motor de e-mail classifica respostas.
 */
export async function avisarRespostaWhatsapp(
  admin: SupabaseClient,
  e: { organizacaoId: string; leadId: string; whatsappMessageId: string; texto: string },
): Promise<void> {
  try {
    const r = await avisarRespostaCliente(montarDepsAvisoResposta(admin), {
      organizacaoId: e.organizacaoId,
      leadId: e.leadId,
      eventoId: `whatsapp:${e.whatsappMessageId}`,
      canal: 'whatsapp',
      classificacao: null,
      texto: e.texto,
    })
    console.log(JSON.stringify({
      ts: new Date().toISOString(), nivel: 'info', escopo: 'aviso.resposta',
      msg: 'Aviso de resposta por WhatsApp processado.', leadId: e.leadId, resultado: r.tipo,
      ...(r.tipo === 'processado' ? { destinos: r.resultados.map((x) => x.tipo) } : {}),
    }))
  } catch (erro) {
    console.error(JSON.stringify({
      ts: new Date().toISOString(), nivel: 'erro', escopo: 'aviso.resposta',
      msg: 'Falha ao avisar resposta por WhatsApp.', leadId: e.leadId, erro: erro instanceof Error ? erro.message : String(erro),
    }))
  }
}
