import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getValidHubSpotAccessToken } from './tokens'
import { PROPRIEDADES_IMPORTACAO, type EmpresaHubspot } from './companies'
import { PROPRIEDADES_CONTATO } from './contacts'
import { PROPRIEDADES_NEGOCIO, listarEstagiosNegocio, type EstagioNegocio } from './deals'
import { listarTodosProprietarios, nomeProprietario } from './owners'
import { listarUsuariosOrganizacao, mapaResponsaveis } from './comerciais'
import { comCache, lerAssociacoes, lerObjetosPorIds, type ObjetoHubspot } from './leituraLote'
import { escolherContatoPrincipal, type ContatoLido } from './contatoPrincipal'
import { ehEmailCorporativo } from './enriquecimento/cadastro'
import { consultarIndice, resumirIndice, type FiltrosIndice, type ResumoIndice } from './indice'
import { ACAO_SUGERIDA, SITUACOES, classificarSituacao, type Situacao } from './situacao'

// Central de Importação HubSpot. A LISTA vem do índice local
// (lib/integracoes/hubspot/indice.ts): só empresas disponíveis para importar
// (aptas + clientes) com comercial mapeado, com filtro/paginação/contagem
// exatos no banco. Os DETALHES da página (contato principal, negócios,
// última interação) são lidos do HubSpot em lote — só das empresas da página.
// Somente leitura: não importa, não cria empresa/lead.

export const TAMANHOS_PAGINA = [25, 50, 100] as const
const LIMITE_ASSOCIADOS = 50 // contatos/negócios lidos por empresa
const TTL_CACHE_MS = 10 * 60 * 1000

export type FiltrosEmpresas = FiltrosIndice

const um = <T extends string>(v: string | null, validos: readonly T[], padrao: T): T =>
  v && (validos as readonly string[]).includes(v) ? (v as T) : padrao

export function parseFiltros(p: URLSearchParams): FiltrosEmpresas {
  const ownerBruto = (p.get('owner') ?? '').trim()
  const tamanhoBruto = Number(p.get('tamanho'))
  const paginaBruta = Number(p.get('pagina'))
  return {
    busca: (p.get('busca') ?? '').trim().slice(0, 100),
    owner: /^\d{1,20}$/.test(ownerBruto) ? ownerBruto : 'todos',
    situacao: um(p.get('situacao'), ['todas', ...SITUACOES] as const, 'todas'),
    importada: um(p.get('importada'), ['todas', 'sim', 'nao'] as const, 'todas'),
    pagina: Number.isInteger(paginaBruta) && paginaBruta >= 1 ? paginaBruta : 1,
    tamanho: (TAMANHOS_PAGINA as readonly number[]).includes(tamanhoBruto) ? tamanhoBruto : 25,
  }
}

// ---------------------------------------------------------------------------
// Linha da tabela
// ---------------------------------------------------------------------------
export type StatusProspectos = 'importada' | 'em_preparo' | 'nao_importada'

export interface NegocioLido {
  id: string
  nome: string
  estagio: string | null
  pipeline: string | null
  ganho: boolean
  fechado: boolean
  data: string | null // closedate
}

export interface DestaqueNegocio {
  tipo: 'ganho' | 'aberto' | 'perdido'
  nome: string
  estagio: string | null
  pipeline: string | null
  data: string | null
}

export interface ResumoEnriquecimento {
  status: string
  confianca: string | null
  cnpj: string | null
  empresa: string | null
  nicho: string | null
  executadoEm: string
}

export interface LinhaEmpresa {
  id: string
  nome: string
  dominio: string | null
  industry: string | null
  owner: { id: string; nome: string } | null
  responsavel: { usuarioId: string; nome: string } | null // null = não mapeado (ou sem owner)
  status: StatusProspectos
  situacao: Situacao
  acao: string
  contatoPrincipal: { id: string; nome: string; cargo: string | null; email: string | null; ultimoContato: string | null } | null
  contatos: { total: number; comEmail: number; corporativos: number; truncado: boolean }
  negocios: { total: number; abertos: number; ganhos: number | null }
  destaque: DestaqueNegocio | null
  ultimaAtividade: string | null
  // recent_deal_close_date e os negócios lidos discordam sobre "cliente".
  divergenciaCliente: boolean
  nichoIdentificado: string | null // nicho sugerido pelo último enriquecimento resolvido
  enriquecimento: ResumoEnriquecimento | null // último preview (hubspot_enriquecimentos)
}

const inteiro = (v: string | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const instante = (v: string | null | undefined): number | null => {
  if (!v) return null
  const n = /^\d+$/.test(v) ? Number(v) : Date.parse(v)
  return Number.isFinite(n) ? n : null
}
const iso = (v: string | null | undefined): string | null => {
  const t = instante(v)
  return t === null ? null : new Date(t).toISOString()
}

export function paraContato(o: ObjetoHubspot): ContatoLido {
  const p = o.properties ?? {}
  const nome = `${p.firstname ?? ''} ${p.lastname ?? ''}`.trim()
  return {
    id: o.id,
    nome: nome || (p.email ?? `Contato ${o.id}`),
    email: (p.email ?? '').trim() || null,
    cargo: (p.jobtitle ?? '').trim() || null,
    ultimoContato: iso(p.notes_last_contacted),
    ownerId: p.hubspot_owner_id ? String(p.hubspot_owner_id) : null,
  }
}

export function paraNegocio(o: ObjetoHubspot, estagios: Map<string, EstagioNegocio>): NegocioLido {
  const p = o.properties ?? {}
  const rotulo = estagios.get(`${p.pipeline ?? ''}/${p.dealstage ?? ''}`)
  return {
    id: o.id,
    nome: p.dealname || `Negócio ${o.id}`,
    estagio: rotulo?.estagio ?? p.dealstage ?? null,
    pipeline: rotulo?.pipeline ?? p.pipeline ?? null,
    ganho: p.hs_is_closed_won === 'true',
    fechado: p.hs_is_closed === 'true',
    data: iso(p.closedate),
  }
}

// Negócio a destacar: último ganho; senão o aberto mais recente; senão o
// último perdido. "Recente" = closedate; empate → maior ID.
export function negocioEmDestaque(negocios: readonly NegocioLido[]): DestaqueNegocio | null {
  const ordenar = (l: NegocioLido[]) =>
    [...l].sort((a, b) => (instante(b.data) ?? -Infinity) - (instante(a.data) ?? -Infinity) || Number(b.id) - Number(a.id))
  const escolher = (tipo: DestaqueNegocio['tipo'], l: NegocioLido[]): DestaqueNegocio | null => {
    const n = ordenar(l)[0]
    return n ? { tipo, nome: n.nome, estagio: n.estagio, pipeline: n.pipeline, data: n.data } : null
  }
  return escolher('ganho', negocios.filter((n) => n.ganho))
    ?? escolher('aberto', negocios.filter((n) => !n.fechado))
    ?? escolher('perdido', negocios.filter((n) => n.fechado && !n.ganho))
}

export interface ContextoLinha {
  agora: number
  nomesOwners: Map<string, string>
  responsaveis: Map<string, string>
  nomesUsuarios: Map<string, string>
  importadas: Set<string>
  emPreparo: Set<string>
  contatos: Map<string, { lista: ContatoLido[]; truncado: boolean }>
  negocios: Map<string, { lista: NegocioLido[]; truncado: boolean }>
  // Situação calculada no índice (a mesma dos contadores); sem ela, calcula aqui.
  situacoes?: Map<string, Situacao>
  enriquecimentos?: Map<string, ResumoEnriquecimento>
}

export function montarLinha(e: EmpresaHubspot, ctx: ContextoLinha): LinhaEmpresa {
  const p = e.properties ?? {}
  const ownerId = p.hubspot_owner_id ? String(p.hubspot_owner_id) : null
  const usuarioId = ownerId ? ctx.responsaveis.get(ownerId) ?? null : null
  const contatos = ctx.contatos.get(e.id) ?? { lista: [], truncado: false }
  const negocios = ctx.negocios.get(e.id) ?? { lista: [], truncado: false }
  const totalContatos = inteiro(p.num_associated_contacts) ?? contatos.lista.length
  const comEmail = contatos.lista.filter((c) => c.email).length
  const ganhou = !!p.recent_deal_close_date

  const situacao = ctx.situacoes?.get(e.id) ?? classificarSituacao(
    {
      ganhou,
      ultimaAtividade: instante(p.notes_last_updated),
      contatos: totalContatos,
      temNegocio: (inteiro(p.num_associated_deals) ?? 0) > 0,
      semEmailUtilizavel: totalContatos > 0 && !contatos.truncado && comEmail === 0,
    },
    ctx.agora,
  )
  const principal = escolherContatoPrincipal(contatos.lista)
  const ganhos = negocios.truncado ? null : negocios.lista.filter((n) => n.ganho).length
  const enr = ctx.enriquecimentos?.get(e.id) ?? null

  return {
    id: e.id,
    nome: p.name || `(sem nome) #${e.id}`,
    dominio: p.domain || null,
    industry: p.industry || null,
    owner: ownerId ? { id: ownerId, nome: ctx.nomesOwners.get(ownerId) ?? `Owner ${ownerId}` } : null,
    responsavel: usuarioId ? { usuarioId, nome: ctx.nomesUsuarios.get(usuarioId) ?? '—' } : null,
    status: ctx.importadas.has(e.id) ? 'importada' : ctx.emPreparo.has(e.id) ? 'em_preparo' : 'nao_importada',
    situacao,
    acao: ACAO_SUGERIDA[situacao],
    contatoPrincipal: principal
      ? { id: principal.id, nome: principal.nome, cargo: principal.cargo, email: principal.email, ultimoContato: principal.ultimoContato }
      : null,
    contatos: {
      total: totalContatos,
      comEmail,
      corporativos: contatos.lista.filter((c) => ehEmailCorporativo(c.email)).length,
      truncado: contatos.truncado,
    },
    negocios: {
      total: inteiro(p.num_associated_deals) ?? 0,
      abertos: inteiro(p.hs_num_open_deals) ?? 0,
      ganhos,
    },
    destaque: negocioEmDestaque(negocios.lista),
    ultimaAtividade: iso(p.notes_last_updated),
    divergenciaCliente: ganhos !== null && (ganhos > 0) !== ganhou,
    nichoIdentificado: enr?.status === 'resolvida' ? enr.nicho : null,
    enriquecimento: enr,
  }
}

// ---------------------------------------------------------------------------
// Orquestração
// ---------------------------------------------------------------------------
export async function idsImportados(admin: SupabaseClient, org: string): Promise<string[]> {
  const { data } = await admin
    .from('empresas')
    .select('hubspot_company_id')
    .eq('organizacao_id', org)
    .not('hubspot_company_id', 'is', null)
  return (data ?? []).map((r) => String(r.hubspot_company_id))
}

export type ResultadoListagem =
  | { ok: true; total: number; pagina: number; tamanho: number; itens: LinhaEmpresa[]; foraDoHubspot: number }
  | { ok: false; motivo: string; status: number }

type Deps = { admin?: SupabaseClient; fetch?: typeof fetch; agora?: number }

export async function resumirSituacoes(
  org: string,
  filtros: FiltrosEmpresas,
  deps: Deps = {},
): Promise<{ ok: true; resumo: ResumoIndice }> {
  const admin = deps.admin ?? createSupabaseAdminClient()
  const [responsaveis, importadas] = await Promise.all([mapaResponsaveis(admin, org), idsImportados(admin, org)])
  return { ok: true, resumo: await resumirIndice(admin, org, filtros, [...responsaveis.keys()], importadas) }
}

export async function listarEmpresasParaImportacao(
  org: string,
  filtros: FiltrosEmpresas,
  deps: Deps = {},
): Promise<ResultadoListagem> {
  const admin = deps.admin ?? createSupabaseAdminClient()
  const agora = deps.agora ?? Date.now()
  const base = { pagina: filtros.pagina, tamanho: filtros.tamanho }

  const [responsaveis, importadas] = await Promise.all([mapaResponsaveis(admin, org), idsImportados(admin, org)])
  const consulta = await consultarIndice(admin, org, filtros, [...responsaveis.keys()], importadas)
  if (!consulta.linhas.length) return { ok: true, total: consulta.total, itens: [], foraDoHubspot: 0, ...base }

  const token = await getValidHubSpotAccessToken(org, { admin, fetch: deps.fetch })
  if (!token.ok) return { ok: false, motivo: token.motivo, status: token.motivo === 'nao_conectado' ? 404 : 409 }
  const at = token.accessToken
  const idsPagina = consulta.linhas.map((l) => l.hubspot_company_id)

  const [lidas, assocContatos, assocNegocios, estagios, owners, usuarios, statusDb] = await Promise.all([
    lerObjetosPorIds('companies', at, idsPagina, PROPRIEDADES_IMPORTACAO, deps.fetch),
    lerAssociacoes('companies', 'contacts', at, idsPagina, LIMITE_ASSOCIADOS, deps.fetch),
    lerAssociacoes('companies', 'deals', at, idsPagina, LIMITE_ASSOCIADOS, deps.fetch),
    comCache(`hubspot:estagios:${org}`, TTL_CACHE_MS, async () => {
      const r = await listarEstagiosNegocio(at, deps.fetch)
      return r.ok ? r.dados : null
    }),
    comCache(`hubspot:owners:${org}`, TTL_CACHE_MS, async () => {
      const r = await listarTodosProprietarios(at, deps.fetch)
      return r.ok ? r.dados : null
    }),
    listarUsuariosOrganizacao(admin, org),
    statusNoProspectos(admin, org, idsPagina),
  ])
  if (!lidas.ok) return { ok: false, motivo: lidas.codigo, status: lidas.codigo === 'nao_autorizado' ? 409 : 502 }
  if (!assocContatos.ok || !assocNegocios.ok) return { ok: false, motivo: 'erro_associacoes', status: 502 }

  const [contatosLidos, negociosLidos] = await Promise.all([
    lerObjetosPorIds('contacts', at, [...assocContatos.dados.values()].flatMap((a) => a.ids), PROPRIEDADES_CONTATO, deps.fetch),
    lerObjetosPorIds('deals', at, [...assocNegocios.dados.values()].flatMap((a) => a.ids), PROPRIEDADES_NEGOCIO, deps.fetch),
  ])
  if (!contatosLidos.ok || !negociosLidos.ok) return { ok: false, motivo: 'erro_leitura_associados', status: 502 }

  const contatoPorId = new Map(contatosLidos.dados.map((c) => [c.id, paraContato(c)]))
  const mapaEstagios = estagios ?? new Map<string, EstagioNegocio>()
  const negocioPorId = new Map(negociosLidos.dados.map((n) => [n.id, paraNegocio(n, mapaEstagios)]))
  const empresaPorId = new Map(lidas.dados.map((x) => [x.id, x]))

  const ctx: ContextoLinha = {
    agora,
    nomesOwners: new Map((owners ?? []).map((o) => [String(o.id), nomeProprietario(o)])),
    responsaveis,
    nomesUsuarios: new Map(usuarios.map((u) => [u.id, u.nome])),
    importadas: statusDb.importadas,
    emPreparo: statusDb.emPreparo,
    enriquecimentos: statusDb.enriquecimentos,
    situacoes: new Map(consulta.linhas.map((l) => [l.hubspot_company_id, l.situacao])),
    contatos: new Map(idsPagina.map((id) => {
      const a = assocContatos.dados.get(id) ?? { ids: [], truncado: false }
      return [id, { lista: a.ids.flatMap((c) => contatoPorId.get(c) ?? []), truncado: a.truncado }]
    })),
    negocios: new Map(idsPagina.map((id) => {
      const a = assocNegocios.dados.get(id) ?? { ids: [], truncado: false }
      return [id, { lista: a.ids.flatMap((n) => negocioPorId.get(n) ?? []), truncado: a.truncado }]
    })),
  }

  // Mantém a ordem do índice; empresa apagada no HubSpot desde a última
  // sincronização some da página (e é contada para a tela avisar).
  const itens = idsPagina.flatMap((id) => {
    const empresa = empresaPorId.get(id)
    return empresa ? [montarLinha(empresa, ctx)] : []
  })
  return { ok: true, total: consulta.total, itens, foraDoHubspot: idsPagina.length - itens.length, ...base }
}

// Status só dos IDs desta página.
async function statusNoProspectos(admin: SupabaseClient, org: string, ids: string[]) {
  const importadas = new Set<string>()
  const emPreparo = new Set<string>()
  const enriquecimentos = new Map<string, ResumoEnriquecimento>()
  if (ids.length) {
    const [imp, prep, enr] = await Promise.all([
      admin.from('empresas').select('hubspot_company_id').eq('organizacao_id', org).in('hubspot_company_id', ids),
      admin.from('hubspot_importacao_itens').select('hubspot_company_id').eq('organizacao_id', org).in('hubspot_company_id', ids),
      admin.from('hubspot_enriquecimentos')
        .select('hubspot_company_id, status_enriquecimento, confianca, cnpj, razao_social, nome_fantasia, nicho_sugerido, executado_em')
        .eq('organizacao_id', org).in('hubspot_company_id', ids),
    ])
    for (const r of imp.data ?? []) importadas.add(String(r.hubspot_company_id))
    for (const r of prep.data ?? []) emPreparo.add(String(r.hubspot_company_id))
    for (const r of enr.data ?? []) {
      enriquecimentos.set(String(r.hubspot_company_id), {
        status: String(r.status_enriquecimento),
        confianca: (r.confianca as string | null) ?? null,
        cnpj: (r.cnpj as string | null) ?? null,
        empresa: ((r.nome_fantasia || r.razao_social) as string | null) ?? null,
        nicho: (r.nicho_sugerido as string | null) ?? null,
        executadoEm: String(r.executado_em),
      })
    }
  }
  return { importadas, emPreparo, enriquecimentos }
}
