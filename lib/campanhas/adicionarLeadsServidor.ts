import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buscarCampanha } from './repository'
import { LIMITE_PUBLICO_CAMPANHA, normalizarPublicoCampanha, podeUsarTipoCampanha } from './configuracaoGuiada'
import { chaveEmpresaPublico, classificarPublicoCampanha, type LinhaPublicoCampanha } from './publicoServidor'
import { exigirEnvioRealCampanhaDisponivel } from './opcoesServidor'
import { exigirAvisoRetornoPronto } from './retornoWhatsappServidor'
import { inscreverLeadsNoWorkflow, type ResultadoInscricaoLeads } from './inscricaoLeadsServidor'
import { ESTAGIO_LABELS, estagiosDoStatus } from '@/lib/pipeline-stages'
import { emailValido } from '@/lib/leads/importarCsv'
import { SupabaseWorkflowStore } from '@/lib/workflows'

// "Adicionar leads" a uma campanha já em envio real: o gestor filtra a base,
// escolhe contatos e confirma. Inscreve só os escolhidos, sem alterar o
// público-base (`publico.selecao`) da campanha.

export class ErroAdicaoLeads extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

export interface FiltrosAdicao {
  estagios?: string[]
  segmento?: string
  responsavelId?: string
  cadastradoDe?: string
  cadastradoAte?: string
  busca?: string
}

export type MotivoInelegivel = 'excluido_campanha' | 'sem_email' | 'bloqueado' | 'incompativel' | 'duplicado'

export interface CandidatoAdicao {
  id: string
  empresa: string | null
  contato: string | null
  email: string | null
  segmento: string | null
  estagio: string | null
  elegivel: boolean
  motivo: MotivoInelegivel | null
}

export interface PreviaAdicao {
  encontrados: number
  jaNaCampanha: number
  elegiveis: number
  emailsAusentesOuInvalidos: number
  duplicados: number
  bloqueados: number
  incompativeis: number
  truncado: boolean
  candidatos: CandidatoAdicao[]
}

type Campanha = NonNullable<Awaited<ReturnType<typeof buscarCampanha>>>

const COLUNAS = 'id, empresa_id, empresa, segmento, estagio, contato_nome, contato_email, responsavel_id, owner, optout, bounced, perdido'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DIA_RE = /^\d{4}-\d{2}-\d{2}$/
const LOTE = 200

async function carregarCampanhaParaAdicao(
  admin: SupabaseClient,
  org: string,
  campanhaId: string,
  permiteTiposAvancados: boolean,
): Promise<Campanha & { workflow_id: string }> {
  const campanha = await buscarCampanha(admin, org, campanhaId)
  if (!campanha) throw new ErroAdicaoLeads('Campanha não encontrada.', 404)
  if (!podeUsarTipoCampanha(campanha.tipo, permiteTiposAvancados)) {
    throw new ErroAdicaoLeads('Seu acesso permite apenas campanhas de comunicado.', 403)
  }
  if (campanha.tipo === 'renovacao') {
    throw new ErroAdicaoLeads('Campanhas de renovação recebem os clientes automaticamente pelos vencimentos.', 409)
  }
  if (campanha.status !== 'ativa') throw new ErroAdicaoLeads('Só é possível adicionar leads a uma campanha ativa.', 409)
  if (campanha.dry_run !== false) {
    throw new ErroAdicaoLeads('A campanha está em modo ensaio. Use "Ativar envio real" para inscrever o público.', 409)
  }
  if (!campanha.workflow_id) throw new ErroAdicaoLeads('Campanha sem workflow vinculado.', 409)
  return campanha as Campanha & { workflow_id: string }
}

// Dia `AAAA-MM-DD` → limites do intervalo UTC meio-aberto [início, próximo dia).
function inicioDiaUtc(dia: string): string {
  return `${dia}T00:00:00.000Z`
}
function fimExclusivoUtc(dia: string): string {
  const d = new Date(`${dia}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString()
}

export function normalizarFiltrosAdicao(bruto: unknown): FiltrosAdicao {
  const b = bruto && typeof bruto === 'object' ? bruto as Record<string, unknown> : {}
  const texto = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const estagios = Array.isArray(b.estagios)
    ? [...new Set(b.estagios.filter((e): e is string => typeof e === 'string' && e in ESTAGIO_LABELS).flatMap(estagiosDoStatus))]
    : []
  const dia = (v: unknown) => (DIA_RE.test(texto(v)) && !Number.isNaN(Date.parse(texto(v))) ? texto(v) : undefined)
  return {
    estagios: estagios.length ? estagios : undefined,
    segmento: texto(b.segmento).slice(0, 160) || undefined,
    responsavelId: UUID_RE.test(texto(b.responsavelId)) ? texto(b.responsavelId) : undefined,
    cadastradoDe: dia(b.cadastradoDe),
    cadastradoAte: dia(b.cadastradoAte),
    busca: texto(b.busca).replace(/[%,()"]/g, ' ').trim().slice(0, 120) || undefined,
  }
}

async function buscarLinhasPorFiltros(
  admin: SupabaseClient,
  org: string,
  filtros: FiltrosAdicao,
): Promise<{ linhas: LinhaPublicoCampanha[]; truncado: boolean }> {
  let q = admin.from('leads').select(COLUNAS).eq('organizacao_id', org)
  if (filtros.estagios?.length) q = q.in('estagio', filtros.estagios)
  if (filtros.segmento) q = q.eq('segmento', filtros.segmento)
  if (filtros.responsavelId) {
    // Leads legados só têm `responsavel_nome`: casa por id OU prefixo do nome,
    // como o filtro de responsável da Base de Leads.
    const { data: usuario, error } = await admin.from('usuarios').select('id, nome')
      .eq('organizacao_id', org).eq('id', filtros.responsavelId).maybeSingle()
    if (error) throw error
    if (!usuario) return { linhas: [], truncado: false }
    const nome = typeof usuario.nome === 'string' ? usuario.nome.replace(/[%,()"]/g, ' ').trim() : ''
    q = q.or(nome
      ? `responsavel_id.eq.${usuario.id},responsavel_nome.ilike.${nome}%`
      : `responsavel_id.eq.${usuario.id}`)
  }
  if (filtros.cadastradoDe) q = q.gte('created_at', inicioDiaUtc(filtros.cadastradoDe))
  if (filtros.cadastradoAte) q = q.lt('created_at', fimExclusivoUtc(filtros.cadastradoAte))
  if (filtros.busca) {
    const t = filtros.busca
    q = q.or(`empresa.ilike.%${t}%,contato_nome.ilike.%${t}%,contato_email.ilike.%${t}%`)
  }
  const { data, error } = await q.order('id', { ascending: true }).limit(LIMITE_PUBLICO_CAMPANHA + 1)
  if (error) throw error
  const linhas = (data ?? []) as LinhaPublicoCampanha[]
  return { linhas: linhas.slice(0, LIMITE_PUBLICO_CAMPANHA), truncado: linhas.length > LIMITE_PUBLICO_CAMPANHA }
}

async function buscarLinhasPorIds(admin: SupabaseClient, org: string, ids: string[]): Promise<LinhaPublicoCampanha[]> {
  const linhas: LinhaPublicoCampanha[] = []
  for (let i = 0; i < ids.length; i += LOTE) {
    const { data, error } = await admin.from('leads').select(COLUNAS)
      .eq('organizacao_id', org).in('id', ids.slice(i, i + LOTE)).order('id', { ascending: true })
    if (error) throw error
    linhas.push(...((data ?? []) as LinhaPublicoCampanha[]))
  }
  return linhas
}

// Quem já passou por esta campanha (qualquer status — reinscrever não reenvia)
// e quem está em execução ativa em outro workflow.
async function mapearExecucoes(
  admin: SupabaseClient,
  org: string,
  workflowId: string,
  ids: string[],
): Promise<{ naCampanha: Set<string>; emOutroWorkflow: Set<string> }> {
  const naCampanha = new Set<string>()
  const emOutroWorkflow = new Set<string>()
  for (let i = 0; i < ids.length; i += LOTE) {
    const { data, error } = await admin.from('workflow_execucoes').select('lead_id, workflow_id, status')
      .eq('organizacao_id', org).in('lead_id', ids.slice(i, i + LOTE))
    if (error) throw error
    for (const ex of data ?? []) {
      const leadId = ex.lead_id as string | null
      if (!leadId) continue
      if (ex.workflow_id === workflowId) naCampanha.add(leadId)
      else if (ex.status === 'em_andamento' || ex.status === 'aguardando') emOutroWorkflow.add(leadId)
    }
  }
  return { naCampanha, emOutroWorkflow }
}

function motivoDe(
  linha: LinhaPublicoCampanha,
  excluidosCampanha: (l: LinhaPublicoCampanha) => boolean,
  emOutroWorkflow: Set<string>,
): MotivoInelegivel {
  if (excluidosCampanha(linha)) return 'excluido_campanha'
  if (!emailValido(linha.contato_email?.trim().toLowerCase() ?? '')) return 'sem_email'
  if (linha.optout === true || linha.bounced === true || linha.perdido === true) return 'bloqueado'
  if (!['engine', 'n8n'].includes(linha.owner ?? '') || emOutroWorkflow.has(linha.id)) return 'incompativel'
  return 'duplicado'
}

async function classificarCandidatos(
  admin: SupabaseClient,
  org: string,
  campanha: Campanha & { workflow_id: string },
  linhasBrutas: LinhaPublicoCampanha[],
  truncado: boolean,
): Promise<PreviaAdicao> {
  const { naCampanha, emOutroWorkflow } = await mapearExecucoes(
    admin, org, campanha.workflow_id, linhasBrutas.map((l) => l.id),
  )
  const linhas = linhasBrutas.filter((l) => !naCampanha.has(l.id))
  const selecao = normalizarPublicoCampanha(campanha.publico).selecao ?? {}
  const excluirIds = new Set(selecao.excluirLeadIds ?? [])
  const excluirEmpresas = new Set(selecao.excluirEmpresas ?? [])
  const excluidosCampanha = (l: LinhaPublicoCampanha) =>
    excluirIds.has(l.id) || excluirEmpresas.has(chaveEmpresaPublico(l))

  const previa = classificarPublicoCampanha(linhas, {
    excluirIds: [...excluirIds],
    excluirEmpresas: [...excluirEmpresas],
    execucoesIncompativeis: emOutroWorkflow,
  })
  const elegiveis = new Set(previa.idsElegiveis)
  return {
    encontrados: linhasBrutas.length,
    jaNaCampanha: linhasBrutas.length - linhas.length,
    elegiveis: previa.elegiveis,
    emailsAusentesOuInvalidos: previa.emailsAusentesOuInvalidos,
    duplicados: previa.duplicados,
    bloqueados: previa.bloqueados,
    incompativeis: previa.incompativeis,
    truncado,
    candidatos: linhas.map((l) => ({
      id: l.id,
      empresa: l.empresa,
      contato: l.contato_nome,
      email: l.contato_email,
      segmento: l.segmento,
      estagio: l.estagio,
      elegivel: elegiveis.has(l.id),
      motivo: elegiveis.has(l.id) ? null : motivoDe(l, excluidosCampanha, emOutroWorkflow),
    })),
  }
}

export async function buscarCandidatosAdicao(
  admin: SupabaseClient,
  org: string,
  campanhaId: string,
  filtros: FiltrosAdicao,
  permiteTiposAvancados: boolean,
): Promise<PreviaAdicao> {
  const campanha = await carregarCampanhaParaAdicao(admin, org, campanhaId, permiteTiposAvancados)
  const { linhas, truncado } = await buscarLinhasPorFiltros(admin, org, filtros)
  return classificarCandidatos(admin, org, campanha, linhas, truncado)
}

export async function adicionarLeadsCampanha(
  admin: SupabaseClient,
  org: string,
  campanhaId: string,
  leadIdsBrutos: unknown,
  confirmarQuantidade: unknown,
  permiteTiposAvancados: boolean,
): Promise<ResultadoInscricaoLeads & { publico: number; workflow_id: string }> {
  const leadIds = Array.isArray(leadIdsBrutos)
    ? [...new Set(leadIdsBrutos.filter((id): id is string => typeof id === 'string' && UUID_RE.test(id)))]
    : []
  if (!leadIds.length) throw new ErroAdicaoLeads('Selecione ao menos um contato.', 400)
  if (leadIds.length > LIMITE_PUBLICO_CAMPANHA) {
    throw new ErroAdicaoLeads(`Selecione no máximo ${LIMITE_PUBLICO_CAMPANHA} contatos por vez.`, 400)
  }

  const campanha = await carregarCampanhaParaAdicao(admin, org, campanhaId, permiteTiposAvancados)
  await exigirEnvioRealCampanhaDisponivel(admin, org, campanhaId)

  // Revalida no servidor: ID de outra organização não volta da consulta e quem
  // deixou de ser elegível desde a prévia fica de fora.
  const linhas = await buscarLinhasPorIds(admin, org, leadIds)
  const previa = await classificarCandidatos(admin, org, campanha, linhas, false)
  const idsElegiveis = previa.candidatos.filter((c) => c.elegivel).map((c) => c.id)
  if (!idsElegiveis.length) throw new ErroAdicaoLeads('Nenhum dos contatos selecionados está elegível.', 409)
  if (confirmarQuantidade !== idsElegiveis.length) {
    throw new ErroAdicaoLeads(`Confirme explicitamente a quantidade atual de ${idsElegiveis.length} contatos.`, 409)
  }

  const store = new SupabaseWorkflowStore(org, admin)
  const workflow = await store.buscarWorkflow(campanha.workflow_id)
  if (!workflow || workflow.status !== 'publicado' || !workflow.versao_atual_id) {
    throw new ErroAdicaoLeads('O workflow da campanha precisa estar publicado.', 409)
  }
  await exigirAvisoRetornoPronto(admin, org, normalizarPublicoCampanha(campanha.publico), idsElegiveis)

  const resultado = await inscreverLeadsNoWorkflow(admin, org, store, workflow.id, campanhaId, idsElegiveis)
  return { ...resultado, publico: idsElegiveis.length, workflow_id: workflow.id }
}

export async function buscarOpcoesAdicao(
  admin: SupabaseClient,
  org: string,
): Promise<{ segmentos: string[]; responsaveis: { id: string; nome: string }[] }> {
  const [segmentos, usuarios] = await Promise.all([
    admin.from('leads').select('segmento').eq('organizacao_id', org)
      .not('segmento', 'is', null).neq('segmento', '').order('segmento', { ascending: true }).limit(2000),
    admin.from('usuarios').select('id, nome').eq('organizacao_id', org).order('nome', { ascending: true }),
  ])
  if (segmentos.error) throw segmentos.error
  if (usuarios.error) throw usuarios.error
  const porChave = new Map<string, string>()
  for (const linha of segmentos.data ?? []) {
    const s = typeof linha.segmento === 'string' ? linha.segmento.trim() : ''
    if (s && !porChave.has(s.toLocaleLowerCase('pt-BR'))) porChave.set(s.toLocaleLowerCase('pt-BR'), s)
  }
  return {
    segmentos: [...porChave.values()].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    responsaveis: (usuarios.data ?? [])
      .filter((u) => typeof u.nome === 'string' && u.nome.trim())
      .map((u) => ({ id: u.id as string, nome: (u.nome as string).trim() })),
  }
}
