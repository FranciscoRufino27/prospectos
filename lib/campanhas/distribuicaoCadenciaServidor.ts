import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { lerEmLotes, lerTodas } from './resumoExecucoesServidor'
import {
  montarDistribuicaoCadencia,
  proximoEnvioDaEtapa,
  type AcaoCadencia,
  type DistribuicaoCadencia,
  type ExecucaoCadencia,
} from './distribuicaoCadencia'

// Leitura (somente) da distribuição da cadência de UMA campanha da organização
// da sessão. Toda consulta filtra organizacao_id (service_role ignora RLS).

interface Base {
  distribuicao: DistribuicaoCadencia
  etapaPorExecucao: Map<string, string>
  execucoes: ExecucaoCadencia[]
}

function acoesDe(definicao: unknown): AcaoCadencia[] | null {
  const acoes = (definicao as { acoes?: unknown } | null)?.acoes
  return Array.isArray(acoes) ? acoes.filter((a): a is AcaoCadencia => !!a && typeof (a as AcaoCadencia).tipo === 'string') : null
}

async function carregarBase(admin: SupabaseClient, org: string, campanhaId: string): Promise<Base | null> {
  const { data: campanha, error } = await admin
    .from('campanhas')
    .select('id, workflow_id')
    .eq('organizacao_id', org)
    .eq('id', campanhaId)
    .maybeSingle()
  if (error) throw error
  if (!campanha) return null

  const execucoes = await lerTodas<ExecucaoCadencia & { iniciado_em: string }>((de, ate) => admin
    .from('workflow_execucoes')
    .select('id, lead_id, status, passo_atual, versao_id, proxima_verificacao_em, iniciado_em')
    .eq('organizacao_id', org)
    .eq('campanha_id', campanhaId)
    .order('id')
    .range(de, ate))

  // Definições: versões usadas pelas execuções + a publicada atual do workflow.
  let versaoAtual: string | null = null
  if (campanha.workflow_id) {
    const { data: wf, error: wfError } = await admin
      .from('workflows')
      .select('versao_atual_id')
      .eq('organizacao_id', org)
      .eq('id', campanha.workflow_id)
      .maybeSingle()
    if (wfError) throw wfError
    versaoAtual = (wf as { versao_atual_id?: string | null } | null)?.versao_atual_id ?? null
  }
  const idsVersao = [...new Set([...execucoes.map((e) => e.versao_id), versaoAtual].filter((v): v is string => !!v))]
  const acoesPorVersao = new Map<string, AcaoCadencia[]>()
  if (idsVersao.length) {
    const versoes = await lerEmLotes<{ id: string; definicao: unknown }>(idsVersao, (lote, de, ate) => admin
      .from('workflow_versoes')
      .select('id, definicao')
      .eq('organizacao_id', org)
      .in('id', lote)
      .order('id')
      .range(de, ate))
    for (const v of versoes) {
      const acoes = acoesDe(v.definicao)
      if (acoes) acoesPorVersao.set(v.id, acoes)
    }
  }

  // Sinais das canceladas: devolução (lead bounced) e resposta (mesma regra do
  // resumo: interação 'resposta' a partir do início da campanha).
  const leadsCanceladas = [...new Set(execucoes.filter((e) => e.status === 'cancelado' && e.lead_id).map((e) => e.lead_id as string))]
  const leadsDevolvidos = new Set<string>()
  const leadsQueResponderam = new Set<string>()
  if (leadsCanceladas.length) {
    const inicio = execucoes.map((e) => e.iniciado_em).filter(Boolean).sort()[0]
    const [devolvidos, respostas] = await Promise.all([
      lerEmLotes<{ id: string }>(leadsCanceladas, (lote, de, ate) => admin
        .from('leads').select('id').eq('organizacao_id', org).in('id', lote).eq('bounced', true).order('id').range(de, ate)),
      inicio
        ? lerEmLotes<{ lead_id: string }>(leadsCanceladas, (lote, de, ate) => admin
          .from('interacoes').select('lead_id').eq('organizacao_id', org).in('lead_id', lote)
          .eq('tipo', 'resposta').gte('created_at', inicio).order('id').range(de, ate))
        : Promise.resolve([]),
    ])
    for (const l of devolvidos) leadsDevolvidos.add(l.id)
    for (const r of respostas) leadsQueResponderam.add(r.lead_id)
  }

  const { etapaPorExecucao, ...distribuicao } = montarDistribuicaoCadencia({
    execucoes,
    acoesPorVersao,
    acoesReferencia: versaoAtual ? acoesPorVersao.get(versaoAtual) ?? null : null,
    leadsDevolvidos,
    leadsQueResponderam,
  })
  return { distribuicao, etapaPorExecucao, execucoes }
}

export async function buscarDistribuicaoCadencia(
  admin: SupabaseClient,
  org: string,
  campanhaId: string,
): Promise<DistribuicaoCadencia | null> {
  return (await carregarBase(admin, org, campanhaId))?.distribuicao ?? null
}

export interface ContatoDaEtapa {
  leadId: string | null
  empresa: string | null
  contato: string | null
  email: string | null
  estagioLead: string | null
  /** Último e-mail que saiu de fato para o contato nesta campanha. */
  ultimoEnvioEm: string | null
  /** Próximo envio da sequência (só para quem segue ativo). */
  proximoEnvio: string | null
  dataPrevista: string | null
  statusExecucao: string
}

export const LIMITE_CONTATOS_ETAPA = 500

export async function buscarContatosDaEtapa(
  admin: SupabaseClient,
  org: string,
  campanhaId: string,
  etapaId: string,
): Promise<{ contatos: ContatoDaEtapa[]; total: number } | null> {
  const base = await carregarBase(admin, org, campanhaId)
  if (!base) return null
  const daEtapa = base.execucoes.filter((e) => base.etapaPorExecucao.get(e.id) === etapaId)
  const recorte = daEtapa.slice(0, LIMITE_CONTATOS_ETAPA)
  const leadIds = [...new Set(recorte.map((e) => e.lead_id).filter((v): v is string => !!v))]
  const execIds = recorte.map((e) => e.id)

  const [leads, envios] = await Promise.all([
    leadIds.length
      ? lerEmLotes<{ id: string; empresa: string | null; contato_nome: string | null; contato_email: string | null; estagio: string | null }>(
        leadIds, (lote, de, ate) => admin.from('leads')
          .select('id, empresa, contato_nome, contato_email, estagio')
          .eq('organizacao_id', org).in('id', lote).order('id').range(de, ate))
      : Promise.resolve([]),
    execIds.length
      ? lerEmLotes<{ execucao_id: string; criado_em: string; detalhe?: Record<string, unknown> | null }>(
        execIds, (lote, de, ate) => admin.from('workflow_execucao_eventos')
          .select('execucao_id, criado_em, detalhe')
          .eq('organizacao_id', org).in('execucao_id', lote).eq('tipo', 'email_enviado')
          .order('id').range(de, ate))
      : Promise.resolve([]),
  ])
  const leadPorId = new Map(leads.map((l) => [l.id, l]))
  const ultimoEnvio = new Map<string, string>()
  for (const ev of envios) {
    if (ev.detalhe?.enviado !== true) continue
    const atual = ultimoEnvio.get(ev.execucao_id)
    if (!atual || ev.criado_em > atual) ultimoEnvio.set(ev.execucao_id, ev.criado_em)
  }
  const ativo = (s: string) => s === 'aguardando' || s === 'em_andamento'

  const contatos = recorte.map((e): ContatoDaEtapa => {
    const lead = e.lead_id ? leadPorId.get(e.lead_id) : undefined
    return {
      leadId: e.lead_id,
      empresa: lead?.empresa ?? null,
      contato: lead?.contato_nome ?? null,
      email: lead?.contato_email ?? null,
      estagioLead: lead?.estagio ?? null,
      ultimoEnvioEm: ultimoEnvio.get(e.id) ?? null,
      proximoEnvio: ativo(e.status) ? proximoEnvioDaEtapa(etapaId) : null,
      dataPrevista: ativo(e.status) ? e.proxima_verificacao_em ?? null : null,
      statusExecucao: e.status,
    }
  })
  contatos.sort((a, b) => (a.dataPrevista ?? '9').localeCompare(b.dataPrevista ?? '9') || (a.empresa ?? '').localeCompare(b.empresa ?? '', 'pt-BR'))
  return { contatos, total: daEtapa.length }
}
