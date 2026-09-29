import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getValidHubSpotAccessToken } from './tokens'
import { pesquisarEmpresas, PROPRIEDADES_IMPORTACAO, type EmpresaHubspot } from './companies'
import { listarTodosProprietarios, nomeProprietario } from './owners'
import { listarUsuariosOrganizacao, mapaResponsaveis } from './comerciais'

// Listagem server-side das empresas do HubSpot para o preparo da importação.
// Filtros e paginação são aplicados NO HUBSPOT (search API) — o navegador só
// recebe a página pedida, nunca a base inteira.
//
// "Já importada" = existe em `empresas` com (organizacao_id, hubspot_company_id).
// Esse conjunto vai para o HubSpot como filtro IN/NOT_IN em hs_object_id, que
// aceita no máximo 100 valores (verificado: 101 → HTTP 400). Acima disso o
// filtro responde "indisponível" em vez de devolver resultado errado.

export const TAMANHOS_PAGINA = [25, 50, 100] as const
export const LIMITE_IDS_FILTRO = 100
const LIMITE_RESULTADOS_BUSCA = 10000 // teto da search API do HubSpot (after + limit)

export interface FiltrosEmpresas {
  busca: string
  owner: 'todos' | 'sem' | string // string = hubspot_owner_id
  importada: 'todas' | 'sim' | 'nao'
  contato: 'todos' | 'com' | 'sem'
  negocio: 'todos' | 'com' | 'sem'
  pagina: number
  tamanho: number
}

const um = <T extends string>(v: string | null, validos: readonly T[], padrao: T): T =>
  v && (validos as readonly string[]).includes(v) ? (v as T) : padrao

export function parseFiltros(p: URLSearchParams): FiltrosEmpresas {
  const ownerBruto = (p.get('owner') ?? '').trim()
  const owner = ownerBruto === 'sem' || /^\d{1,20}$/.test(ownerBruto) ? ownerBruto : 'todos'
  const tamanhoBruto = Number(p.get('tamanho'))
  const tamanho = (TAMANHOS_PAGINA as readonly number[]).includes(tamanhoBruto) ? tamanhoBruto : 25
  const paginaBruta = Number(p.get('pagina'))
  const pagina = Number.isInteger(paginaBruta) && paginaBruta >= 1 ? paginaBruta : 1
  return {
    busca: (p.get('busca') ?? '').trim().slice(0, 100),
    owner,
    importada: um(p.get('importada'), ['todas', 'sim', 'nao'] as const, 'todas'),
    contato: um(p.get('contato'), ['todos', 'com', 'sem'] as const, 'todos'),
    negocio: um(p.get('negocio'), ['todos', 'com', 'sem'] as const, 'todos'),
    pagina,
    tamanho,
  }
}

type FiltroHubspot = { propertyName: string; operator: string; value?: string; values?: string[] }

// "Sem X" precisa cobrir 0 e propriedade ausente → duas alternativas (OR).
function alternativasContagem(prop: string, modo: 'todos' | 'com' | 'sem'): FiltroHubspot[][] {
  if (modo === 'com') return [[{ propertyName: prop, operator: 'GT', value: '0' }]]
  if (modo === 'sem') {
    return [
      [{ propertyName: prop, operator: 'EQ', value: '0' }],
      [{ propertyName: prop, operator: 'NOT_HAS_PROPERTY' }],
    ]
  }
  return [[]]
}

export type ResultadoCorpo =
  | { ok: true; corpo: Record<string, unknown> }
  | { ok: true; vazio: true } // "já importada" sem nenhuma importada: nem consulta o HubSpot
  | { ok: false; motivo: 'filtro_importadas_indisponivel' | 'pagina_fora_do_limite' }

export function montarCorpoBusca(f: FiltrosEmpresas, idsImportados: readonly string[]): ResultadoCorpo {
  const after = (f.pagina - 1) * f.tamanho
  if (after + f.tamanho > LIMITE_RESULTADOS_BUSCA) return { ok: false, motivo: 'pagina_fora_do_limite' }

  const base: FiltroHubspot[] = []
  if (f.owner === 'sem') base.push({ propertyName: 'hubspot_owner_id', operator: 'NOT_HAS_PROPERTY' })
  else if (f.owner !== 'todos') base.push({ propertyName: 'hubspot_owner_id', operator: 'EQ', value: f.owner })

  if (f.importada !== 'todas') {
    if (idsImportados.length > LIMITE_IDS_FILTRO) return { ok: false, motivo: 'filtro_importadas_indisponivel' }
    if (f.importada === 'sim') {
      if (idsImportados.length === 0) return { ok: true, vazio: true }
      base.push({ propertyName: 'hs_object_id', operator: 'IN', values: [...idsImportados] })
    } else if (idsImportados.length > 0) {
      base.push({ propertyName: 'hs_object_id', operator: 'NOT_IN', values: [...idsImportados] })
    }
  }

  const grupos: FiltroHubspot[][] = []
  for (const c of alternativasContagem('num_associated_contacts', f.contato)) {
    for (const n of alternativasContagem('num_associated_deals', f.negocio)) {
      grupos.push([...base, ...c, ...n])
    }
  }
  const filterGroups = grupos.filter((g) => g.length > 0).map((filters) => ({ filters }))

  const corpo: Record<string, unknown> = {
    limit: f.tamanho,
    properties: [...PROPRIEDADES_IMPORTACAO],
    sorts: [{ propertyName: 'name', direction: 'ASCENDING' }],
  }
  if (after > 0) corpo.after = String(after)
  if (f.busca) corpo.query = f.busca
  if (filterGroups.length) corpo.filterGroups = filterGroups
  return { ok: true, corpo }
}

export type StatusProspectos = 'importada' | 'em_preparo' | 'nao_importada'

export interface LinhaEmpresa {
  id: string
  nome: string
  dominio: string | null
  industry: string | null
  contatos: number | null
  negocios: number | null
  owner: { id: string; nome: string } | null
  responsavel: { usuarioId: string; nome: string } | null // null = não mapeado (ou sem owner)
  status: StatusProspectos
}

const inteiro = (v: string | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function montarLinha(
  e: EmpresaHubspot,
  ctx: {
    nomesOwners: Map<string, string>
    responsaveis: Map<string, string>
    nomesUsuarios: Map<string, string>
    importadas: Set<string>
    emPreparo: Set<string>
  },
): LinhaEmpresa {
  const p = e.properties ?? {}
  const ownerId = p.hubspot_owner_id ? String(p.hubspot_owner_id) : null
  const usuarioId = ownerId ? ctx.responsaveis.get(ownerId) ?? null : null
  return {
    id: e.id,
    nome: p.name || `(sem nome) #${e.id}`,
    dominio: p.domain || null,
    industry: p.industry || null,
    contatos: inteiro(p.num_associated_contacts),
    negocios: inteiro(p.num_associated_deals),
    owner: ownerId ? { id: ownerId, nome: ctx.nomesOwners.get(ownerId) ?? `Owner ${ownerId}` } : null,
    responsavel: usuarioId ? { usuarioId, nome: ctx.nomesUsuarios.get(usuarioId) ?? '—' } : null,
    status: ctx.importadas.has(e.id) ? 'importada' : ctx.emPreparo.has(e.id) ? 'em_preparo' : 'nao_importada',
  }
}

export async function idsImportados(admin: SupabaseClient, org: string): Promise<string[]> {
  const { data } = await admin
    .from('empresas')
    .select('hubspot_company_id')
    .eq('organizacao_id', org)
    .not('hubspot_company_id', 'is', null)
    .limit(LIMITE_IDS_FILTRO + 1) // só precisamos saber se passou do limite do filtro
  return (data ?? []).map((r) => String(r.hubspot_company_id))
}

export type ResultadoListagem =
  | { ok: true; total: number; pagina: number; tamanho: number; itens: LinhaEmpresa[] }
  | { ok: false; motivo: string; status: number }

export async function listarEmpresasParaImportacao(
  org: string,
  filtros: FiltrosEmpresas,
  deps: { admin?: SupabaseClient; fetch?: typeof fetch } = {},
): Promise<ResultadoListagem> {
  const admin = deps.admin ?? createSupabaseAdminClient()
  const token = await getValidHubSpotAccessToken(org, { admin, fetch: deps.fetch })
  if (!token.ok) return { ok: false, motivo: token.motivo, status: token.motivo === 'nao_conectado' ? 404 : 409 }

  const importados = await idsImportados(admin, org)
  const corpo = montarCorpoBusca(filtros, importados)
  if (!corpo.ok) return { ok: false, motivo: corpo.motivo, status: 422 }
  if ('vazio' in corpo) return { ok: true, total: 0, pagina: filtros.pagina, tamanho: filtros.tamanho, itens: [] }

  const [busca, owners, usuarios, responsaveis] = await Promise.all([
    pesquisarEmpresas(token.accessToken, corpo.corpo, deps.fetch),
    listarTodosProprietarios(token.accessToken, deps.fetch),
    listarUsuariosOrganizacao(admin, org),
    mapaResponsaveis(admin, org),
  ])
  if (!busca.ok) return { ok: false, motivo: busca.codigo, status: busca.codigo === 'nao_autorizado' ? 409 : 502 }

  // Status só dos IDs desta página (a lista `importados` é truncada no limite do filtro).
  const idsPagina = busca.dados.results.map((e) => e.id)
  const importadas = new Set<string>()
  const emPreparo = new Set<string>()
  if (idsPagina.length) {
    const [imp, prep] = await Promise.all([
      admin.from('empresas').select('hubspot_company_id').eq('organizacao_id', org).in('hubspot_company_id', idsPagina),
      admin.from('hubspot_importacao_itens').select('hubspot_company_id').eq('organizacao_id', org).in('hubspot_company_id', idsPagina),
    ])
    for (const r of imp.data ?? []) importadas.add(String(r.hubspot_company_id))
    for (const r of prep.data ?? []) emPreparo.add(String(r.hubspot_company_id))
  }

  const ctx = {
    nomesOwners: new Map((owners.ok ? owners.dados : []).map((o) => [String(o.id), nomeProprietario(o)])),
    responsaveis,
    nomesUsuarios: new Map(usuarios.map((u) => [u.id, u.nome])),
    importadas,
    emPreparo,
  }
  return {
    ok: true,
    total: busca.dados.total ?? 0,
    pagina: filtros.pagina,
    tamanho: filtros.tamanho,
    itens: busca.dados.results.map((e) => montarLinha(e, ctx)),
  }
}
