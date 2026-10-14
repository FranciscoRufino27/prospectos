import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getValidHubSpotAccessToken } from './tokens'
import { pesquisarEmpresas } from './companies'
import { comCache, lerAssociacoes, lerObjetosPorIds, type ObjetoHubspot } from './leituraLote'
import { propriedadesCnpj } from './enriquecimento/cascata'
import { cnpjNoNome, ehEmailCorporativo, ehProvedorGenerico, estadoDocumento, normalizarDominio, soDigitos } from './enriquecimento/cadastro'
import { SITUACOES, classificarSituacao, type Situacao } from './situacao'

// Índice local das empresas do HubSpot (tabela hubspot_empresas_indice,
// migration 0057). A Central de Importação lista SÓ o que está disponível
// para importar, com filtro e contagem exatos no banco — a search do HubSpot
// não sabe filtrar por "contato com e-mail corporativo".
//
// Disponível para importar (decisão do usuário, 29/09):
//   apta    = não é cliente + identificável (CNPJ válido ou domínio próprio)
//             + ao menos um contato com e-mail corporativo
//   cliente = tem negócio ganho + ao menos um contato com e-mail (envio de
//             novidades; nunca prospecção fria)
// E, na consulta, o comercial do HubSpot precisa estar mapeado para um
// usuário do ProspectOS (sem responsável não entra).
// Nada aqui importa empresa, contato ou lead.

export type MotivoIndisponivel = 'sem_evidencia' | 'sem_cnpj_ou_dominio' | 'sem_contato' | 'sem_email_corporativo' | 'cliente_sem_email'

export interface LinhaIndice {
  hubspot_company_id: string
  nome: string | null
  dominio: string | null
  cnpj: string | null
  owner_id: string | null
  cliente: boolean
  identificavel: boolean
  contatos_total: number
  contatos_com_email: number
  contatos_corporativos: number
  disponivel: boolean
  motivo_indisponivel: MotivoIndisponivel | null
  situacao: Situacao
  ultima_atividade: string | null
  busca: string
}

export interface ContatoIndice {
  email: string | null
  nome: string | null
}

const instante = (v: string | null | undefined): number | null => {
  if (!v) return null
  const n = /^\d+$/.test(v) ? Number(v) : Date.parse(v)
  return Number.isFinite(n) ? n : null
}

export const normalizarBusca = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function classificarParaIndice(
  e: ObjetoHubspot,
  propsCnpj: readonly string[],
  contatos: readonly ContatoIndice[],
  agora: number,
): LinhaIndice {
  const p = e.properties ?? {}
  const docBruto = propsCnpj.map((k) => p[k]).find((x) => soDigitos(x).length > 0) ?? null
  const cnpj = estadoDocumento(docBruto) === 'valido' ? soDigitos(docBruto) : cnpjNoNome(p.name)
  const dominioBruto = normalizarDominio(p.domain || p.website)
  const dominio = dominioBruto && !ehProvedorGenerico(dominioBruto) ? dominioBruto : null
  const identificavel = !!cnpj || !!dominio

  const contatos_total = Math.max(Number(p.num_associated_contacts) || 0, contatos.length)
  const contatos_com_email = contatos.filter((c) => (c.email ?? '').trim()).length
  const contatos_corporativos = contatos.filter((c) => ehEmailCorporativo(c.email)).length
  const cliente = !!p.recent_deal_close_date

  const apta = !cliente && identificavel && contatos_corporativos > 0
  const clienteDisponivel = cliente && contatos_com_email > 0
  const disponivel = apta || clienteDisponivel
  const motivo: MotivoIndisponivel | null = disponivel ? null
    : cliente ? 'cliente_sem_email'
    : !identificavel && contatos_corporativos === 0 ? 'sem_evidencia'
    : !identificavel ? 'sem_cnpj_ou_dominio'
    : contatos_total === 0 ? 'sem_contato'
    : 'sem_email_corporativo'

  const ultima = instante(p.notes_last_updated)
  const situacao = classificarSituacao(
    {
      ganhou: cliente,
      ultimaAtividade: ultima,
      contatos: contatos_total,
      temNegocio: (Number(p.num_associated_deals) || 0) > 0,
      semEmailUtilizavel: contatos_total > 0 && contatos_com_email === 0,
    },
    agora,
  )

  return {
    hubspot_company_id: e.id,
    nome: p.name?.trim() || null,
    dominio: dominio ?? dominioBruto,
    cnpj,
    owner_id: p.hubspot_owner_id ? String(p.hubspot_owner_id) : null,
    cliente,
    identificavel,
    contatos_total,
    contatos_com_email,
    contatos_corporativos,
    disponivel,
    motivo_indisponivel: motivo,
    situacao,
    ultima_atividade: ultima === null ? null : new Date(ultima).toISOString(),
    busca: normalizarBusca([p.name, dominioBruto, cnpj, ...contatos.flatMap((c) => [c.nome, c.email])].filter(Boolean).join(' ')),
  }
}

// ---------------------------------------------------------------------------
// Sincronização (lê a base inteira da conta, em lote)
// ---------------------------------------------------------------------------
const PROPRIEDADES_INDICE = ['name', 'domain', 'website', 'hubspot_owner_id', 'num_associated_contacts', 'num_associated_deals', 'recent_deal_close_date', 'notes_last_updated'] as const
const TRAVA_MS = 10 * 60_000
const LOTE_GRAVACAO = 500
const TETO_BUSCA = 10_000 // search do HubSpot não pagina além disso

export type ResultadoSincronizacao =
  | { ok: true; total: number; disponiveis: number; aptas: number; clientes: number; duracaoMs: number }
  | { ok: false; motivo: 'sincronizacao_em_andamento' | 'base_grande_demais' | 'nao_conectado' | 'inativo' | 'app_nao_configurado' | 'erro_refresh' | 'erro_hubspot' | 'erro_banco'; mensagem?: string }

export async function sincronizarIndice(
  org: string,
  deps: { admin?: SupabaseClient; fetch?: typeof fetch; agora?: number } = {},
): Promise<ResultadoSincronizacao> {
  const admin = deps.admin ?? createSupabaseAdminClient()
  const agora = deps.agora ?? Date.now()
  const inicio = Date.now()
  const token = await getValidHubSpotAccessToken(org, { admin, fetch: deps.fetch })
  if (!token.ok) return { ok: false, motivo: token.motivo }

  // Trava: uma sincronização por organização (a travada há > 10 min é abandonada).
  const { data: conexao } = await admin.from('integracoes_hubspot').select('indice_sincronizando_desde').eq('organizacao_id', org).maybeSingle()
  const desde = conexao?.indice_sincronizando_desde ? new Date(String(conexao.indice_sincronizando_desde)).getTime() : null
  if (desde && agora - desde < TRAVA_MS) return { ok: false, motivo: 'sincronizacao_em_andamento' }
  await admin.from('integracoes_hubspot').update({ indice_sincronizando_desde: new Date(agora).toISOString() }).eq('organizacao_id', org)
  const liberar = () => admin.from('integracoes_hubspot').update({ indice_sincronizando_desde: null }).eq('organizacao_id', org)

  try {
    const at = token.accessToken
    const propsCnpj = await comCache(`hubspot:propsCnpj:${org}`, 10 * 60_000, () => propriedadesCnpj(at, deps.fetch))
    if (!propsCnpj) { await liberar(); return { ok: false, motivo: 'erro_hubspot', mensagem: 'propriedades de empresa' } }

    const empresas: ObjetoHubspot[] = []
    let after: string | undefined
    do {
      const r = await pesquisarEmpresas(at, {
        limit: 100,
        after,
        properties: [...PROPRIEDADES_INDICE, ...propsCnpj],
        sorts: [{ propertyName: 'hs_object_id', direction: 'ASCENDING' }],
      }, deps.fetch)
      if (!r.ok) { await liberar(); return { ok: false, motivo: 'erro_hubspot', mensagem: r.mensagem } }
      if ((r.dados.total ?? 0) > TETO_BUSCA) { await liberar(); return { ok: false, motivo: 'base_grande_demais' } }
      empresas.push(...(r.dados.results ?? []))
      after = r.dados.paging?.next?.after
    } while (after)

    const assoc = await lerAssociacoes('companies', 'contacts', at, empresas.map((x) => x.id), 50, deps.fetch)
    if (!assoc.ok) { await liberar(); return { ok: false, motivo: 'erro_hubspot', mensagem: assoc.mensagem } }
    const lidos = await lerObjetosPorIds('contacts', at, [...new Set([...assoc.dados.values()].flatMap((a) => a.ids))], ['email', 'firstname', 'lastname'], deps.fetch)
    if (!lidos.ok) { await liberar(); return { ok: false, motivo: 'erro_hubspot', mensagem: lidos.mensagem } }
    const contato = new Map(lidos.dados.map((c) => [c.id, {
      email: c.properties.email ?? null,
      nome: `${c.properties.firstname ?? ''} ${c.properties.lastname ?? ''}`.trim() || null,
    }]))

    const sincronizadoEm = new Date(agora).toISOString()
    const linhas = empresas.map((x) =>
      classificarParaIndice(x, propsCnpj, (assoc.dados.get(x.id)?.ids ?? []).flatMap((id) => contato.get(id) ?? []), agora))

    for (let i = 0; i < linhas.length; i += LOTE_GRAVACAO) {
      const { error } = await admin.from('hubspot_empresas_indice').upsert(
        linhas.slice(i, i + LOTE_GRAVACAO).map((l) => ({ ...l, organizacao_id: org, sincronizado_em: sincronizadoEm })),
        { onConflict: 'organizacao_id,hubspot_company_id' },
      )
      if (error) { await liberar(); return { ok: false, motivo: 'erro_banco', mensagem: error.message } }
    }
    // Empresas que sumiram do HubSpot saem do índice (só desta organização).
    await admin.from('hubspot_empresas_indice').delete().eq('organizacao_id', org).lt('sincronizado_em', sincronizadoEm)
    await admin.from('integracoes_hubspot').update({
      indice_atualizado_em: sincronizadoEm,
      indice_total: linhas.length,
      indice_sincronizando_desde: null,
    }).eq('organizacao_id', org)

    return {
      ok: true,
      total: linhas.length,
      disponiveis: linhas.filter((l) => l.disponivel).length,
      aptas: linhas.filter((l) => l.disponivel && !l.cliente).length,
      clientes: linhas.filter((l) => l.disponivel && l.cliente).length,
      duracaoMs: Date.now() - inicio,
    }
  } catch (e) {
    await liberar()
    throw e
  }
}

// ---------------------------------------------------------------------------
// Consulta (paginação/filtros/contagem exatos no banco)
// ---------------------------------------------------------------------------
export interface FiltrosIndice {
  busca: string
  owner: 'todos' | string
  situacao: 'todas' | Situacao
  importada: 'todas' | 'sim' | 'nao'
  pagina: number
  tamanho: number
}

// Só letras, números e @ . - _ espaço: o termo vai para um ilike.
export const termoBusca = (v: string) => normalizarBusca(v).replace(/[^a-z0-9@.\-_ ]/g, ' ').replace(/[%_]/g, ' ').trim().slice(0, 100)

// Tipo local da consulta ao índice: só o que é usado. Os genéricos do
// postgrest-js estouram o limite de instanciação do TypeScript aqui.
interface ConsultaIndice extends PromiseLike<{ data: unknown[] | null; count: number | null }> {
  eq(coluna: string, valor: unknown): ConsultaIndice
  in(coluna: string, valores: readonly unknown[]): ConsultaIndice
  not(coluna: string, operador: string, valor: unknown): ConsultaIndice
  ilike(coluna: string, padrao: string): ConsultaIndice
  order(coluna: string, opcoes?: { ascending?: boolean; nullsFirst?: boolean }): ConsultaIndice
  range(de: number, ate: number): ConsultaIndice
}
const consultaIndice = (admin: SupabaseClient, colunas: string, opcoes?: { count: 'exact'; head?: boolean }) =>
  admin.from('hubspot_empresas_indice').select(colunas, opcoes) as unknown as ConsultaIndice

// Aplica o universo (disponível + comercial mapeado) e os filtros. `null` =
// nenhuma linha pode casar (ex.: comercial não mapeado).
function aplicarFiltros(
  q: ConsultaIndice,
  org: string,
  f: Omit<FiltrosIndice, 'pagina' | 'tamanho'>,
  ownersMapeados: readonly string[],
  importadas: readonly string[],
  ignorarSituacao = false,
): ConsultaIndice | null {
  let c = q.eq('organizacao_id', org).eq('disponivel', true)
  if (f.owner !== 'todos') {
    if (!ownersMapeados.includes(f.owner)) return null
    c = c.eq('owner_id', f.owner)
  } else {
    if (!ownersMapeados.length) return null
    c = c.in('owner_id', [...ownersMapeados])
  }
  if (!ignorarSituacao && f.situacao !== 'todas') c = c.eq('situacao', f.situacao)
  if (f.importada === 'sim') {
    if (!importadas.length) return null
    c = c.in('hubspot_company_id', [...importadas])
  } else if (f.importada === 'nao' && importadas.length) {
    c = c.not('hubspot_company_id', 'in', `(${importadas.map((i) => `"${i}"`).join(',')})`)
  }
  // Cada palavra precisa aparecer (em qualquer ordem): "hotel sp" acha "Hotel X — São Paulo".
  for (const palavra of termoBusca(f.busca).split(/\s+/).filter(Boolean).slice(0, 5)) {
    c = c.ilike('busca', `%${palavra}%`)
  }
  return c
}

export async function consultarIndice(
  admin: SupabaseClient,
  org: string,
  f: FiltrosIndice,
  ownersMapeados: readonly string[],
  importadas: readonly string[],
): Promise<{ total: number; linhas: Array<{ hubspot_company_id: string; situacao: Situacao }> }> {
  const q = aplicarFiltros(consultaIndice(admin, 'hubspot_company_id, situacao', { count: 'exact' }), org, f, ownersMapeados, importadas)
  if (!q) return { total: 0, linhas: [] }
  const de = (f.pagina - 1) * f.tamanho
  const { data, count } = await q
    .order('nome', { ascending: true, nullsFirst: false })
    .order('hubspot_company_id', { ascending: true }) // desempate único
    .range(de, de + f.tamanho - 1)
  const linhas = (data ?? []) as Array<{ hubspot_company_id: unknown; situacao: unknown }>
  return {
    total: count ?? 0,
    linhas: linhas.map((r) => ({ hubspot_company_id: String(r.hubspot_company_id), situacao: r.situacao as Situacao })),
  }
}

// Todas as empresas do filtro (id e nome), na mesma ordem da lista. Lê em
// páginas de 1.000 — o máximo de linhas por resposta do Supabase.
const PAGINA_LEITURA = 1000

export async function linhasDoFiltro(
  admin: SupabaseClient,
  org: string,
  f: Omit<FiltrosIndice, 'pagina' | 'tamanho'>,
  ownersMapeados: readonly string[],
  importadas: readonly string[],
): Promise<Array<{ id: string; nome: string }>> {
  const linhas: Array<{ id: string; nome: string }> = []
  for (let de = 0; ; de += PAGINA_LEITURA) {
    const q = aplicarFiltros(consultaIndice(admin, 'hubspot_company_id, nome'), org, f, ownersMapeados, importadas)
    if (!q) return []
    const { data } = await q
      .order('nome', { ascending: true, nullsFirst: false })
      .order('hubspot_company_id', { ascending: true })
      .range(de, de + PAGINA_LEITURA - 1)
    const lote = (data ?? []) as Array<{ hubspot_company_id: unknown; nome: unknown }>
    for (const r of lote) {
      const id = String(r.hubspot_company_id)
      linhas.push({ id, nome: typeof r.nome === 'string' && r.nome ? r.nome : `(sem nome) #${id}` })
    }
    if (lote.length < PAGINA_LEITURA) return linhas
  }
}

const contar = async (q: PromiseLike<{ count: number | null }> | null) => {
  if (!q) return 0
  const { count } = await q
  return count ?? 0
}

export interface ResumoIndice {
  atualizadoEm: string | null
  sincronizando: boolean
  total: number // empresas no índice (base inteira)
  disponiveis: number // disponíveis com comercial mapeado
  semResponsavel: number // disponíveis cujo comercial não está mapeado
  porSituacao: Record<Situacao, number>
}

export async function resumirIndice(
  admin: SupabaseClient,
  org: string,
  f: Omit<FiltrosIndice, 'pagina' | 'tamanho'>,
  ownersMapeados: readonly string[],
  importadas: readonly string[],
): Promise<ResumoIndice> {
  const tabela = () => consultaIndice(admin, 'hubspot_company_id', { count: 'exact', head: true })
  const { data: conexao } = await admin.from('integracoes_hubspot').select('indice_atualizado_em, indice_sincronizando_desde').eq('organizacao_id', org).maybeSingle()
  const [total, disponiveisTodos, disponiveis] = await Promise.all([
    contar(tabela().eq('organizacao_id', org)),
    contar(tabela().eq('organizacao_id', org).eq('disponivel', true)),
    contar(aplicarFiltros(tabela(), org, { ...f, owner: 'todos', situacao: 'todas', importada: 'todas', busca: '' }, ownersMapeados, importadas)),
  ])
  const porSituacao = {} as Record<Situacao, number>
  await Promise.all(SITUACOES.map(async (s) => {
    porSituacao[s] = await contar(aplicarFiltros(tabela(), org, { ...f, situacao: s }, ownersMapeados, importadas))
  }))
  const desde = conexao?.indice_sincronizando_desde ? new Date(String(conexao.indice_sincronizando_desde)).getTime() : null
  return {
    atualizadoEm: (conexao?.indice_atualizado_em as string | null) ?? null,
    sincronizando: !!desde && Date.now() - desde < TRAVA_MS,
    total,
    disponiveis,
    semResponsavel: disponiveisTodos - disponiveis,
    porSituacao,
  }
}

// Empresas do índice disponíveis (e com comercial mapeado) entre os IDs dados.
export async function disponiveisEntre(
  admin: SupabaseClient,
  org: string,
  ids: readonly string[],
  ownersMapeados: readonly string[],
): Promise<Map<string, { cliente: boolean }>> {
  if (!ids.length || !ownersMapeados.length) return new Map()
  const { data } = await admin
    .from('hubspot_empresas_indice')
    .select('hubspot_company_id, cliente')
    .eq('organizacao_id', org)
    .eq('disponivel', true)
    .in('owner_id', [...ownersMapeados])
    .in('hubspot_company_id', [...ids])
  return new Map((data ?? []).map((r) => [String(r.hubspot_company_id), { cliente: r.cliente === true }]))
}
