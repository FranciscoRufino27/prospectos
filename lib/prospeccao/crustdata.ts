// Busca internacional de empresas por nome e país via Crustdata Company Search
// (POST /company/search, API 2025-11-01). Paga: 0,03 crédito por empresa
// devolvida, só com campos básicos — nenhum campo "premium" (headcount,
// taxonomy, funding…) é pedido, porque cada um soma crédito por resultado.
// Nada é gravado: o resultado vai direto para a tela.

export const CRUSTDATA_URL = 'https://api.crustdata.com/company/search'
export const CRUSTDATA_VERSAO = '2025-11-01'
/** Empresas por página: 25 × 0,03 = 0,75 crédito por clique. */
export const LIMITE_INTERNACIONAL = 25
export const CREDITO_POR_EMPRESA = 0.03
const NOME_MAX = 80
const CURSOR_MAX = 4000
const TIMEOUT_MS = 15000

// ISO-3, que a Crustdata aceita no filtro de país. Lista curta e curada para o
// select; ampliar aqui quando um mercado novo entrar.
export const PAISES_INTERNACIONAL = [
  { codigo: 'USA', nome: 'Estados Unidos' },
  { codigo: 'CAN', nome: 'Canadá' },
  { codigo: 'MEX', nome: 'México' },
  { codigo: 'ARG', nome: 'Argentina' },
  { codigo: 'CHL', nome: 'Chile' },
  { codigo: 'COL', nome: 'Colômbia' },
  { codigo: 'PER', nome: 'Peru' },
  { codigo: 'URY', nome: 'Uruguai' },
  { codigo: 'PRY', nome: 'Paraguai' },
  { codigo: 'BRA', nome: 'Brasil' },
  { codigo: 'PRT', nome: 'Portugal' },
  { codigo: 'ESP', nome: 'Espanha' },
  { codigo: 'FRA', nome: 'França' },
  { codigo: 'ITA', nome: 'Itália' },
  { codigo: 'DEU', nome: 'Alemanha' },
  { codigo: 'GBR', nome: 'Reino Unido' },
  { codigo: 'IRL', nome: 'Irlanda' },
  { codigo: 'NLD', nome: 'Países Baixos' },
  { codigo: 'BEL', nome: 'Bélgica' },
  { codigo: 'CHE', nome: 'Suíça' },
  { codigo: 'AUT', nome: 'Áustria' },
  { codigo: 'SWE', nome: 'Suécia' },
  { codigo: 'NOR', nome: 'Noruega' },
  { codigo: 'DNK', nome: 'Dinamarca' },
  { codigo: 'POL', nome: 'Polônia' },
  { codigo: 'ARE', nome: 'Emirados Árabes Unidos' },
  { codigo: 'ISR', nome: 'Israel' },
  { codigo: 'ZAF', nome: 'África do Sul' },
  { codigo: 'IND', nome: 'Índia' },
  { codigo: 'SGP', nome: 'Singapura' },
  { codigo: 'JPN', nome: 'Japão' },
  { codigo: 'AUS', nome: 'Austrália' },
  { codigo: 'NZL', nome: 'Nova Zelândia' },
] as const

export type CodigoPais = (typeof PAISES_INTERNACIONAL)[number]['codigo']

export interface BuscaInternacional {
  nome: string
  pais: CodigoPais | ''
  cursor: string | null
}

export interface EmpresaInternacional {
  id: number
  nome: string
  dominio: string | null
  site: string | null
  linkedin: string | null
  pais: string | null
  cidade: string | null
  sede: string | null
  fundacao: number | null
  funcionarios: string | null
  tipo: string | null
}

export interface RespostaInternacional {
  itens: EmpresaInternacional[]
  proximoCursor: string | null
  total: number | null
}

const CODIGOS = new Set<string>(PAISES_INTERNACIONAL.map((p) => p.codigo))

/** Revalida o pedido da tela. null = nem nome nem país (busca sem critério). */
export function normalizarBuscaInternacional(bruto: unknown): BuscaInternacional | null {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return null
  const b = bruto as Record<string, unknown>
  const nome = typeof b.nome === 'string' ? b.nome.replace(/\s+/g, ' ').trim().slice(0, NOME_MAX) : ''
  const pais = typeof b.pais === 'string' && CODIGOS.has(b.pais) ? (b.pais as CodigoPais) : ''
  // O cursor é opaco (token da Crustdata); só confere tamanho e alfabeto.
  const cursor = typeof b.cursor === 'string' && b.cursor.length <= CURSOR_MAX && /^[A-Za-z0-9_\-+/=:.]+$/.test(b.cursor)
    ? b.cursor
    : null
  if (nome.length < 2 && !pais) return null
  return { nome: nome.length >= 2 ? nome : '', pais, cursor }
}

export const CAMPOS_CRUSTDATA = [
  'crustdata_company_id',
  'basic_info.name',
  'basic_info.primary_domain',
  'basic_info.website',
  'basic_info.professional_network_url',
  'basic_info.year_founded',
  'basic_info.employee_count_range',
  'basic_info.company_type',
  'locations.country',
  'locations.city',
  'locations.headquarters',
]

/**
 * Corpo do POST. Com nome, usa a busca ranqueada (`lexical`): a empresa com o
 * nome mais parecido vem primeiro. O filtro `(.)` em basic_info.name devolvia
 * as parecidas sem ordem ("Inovacode" sumia entre 340 resultados). Só país é
 * filtro puro.
 */
export function corpoCrustdata(b: BuscaInternacional): Record<string, unknown> {
  const filtroPais = b.pais ? { filters: { field: 'locations.country', type: '=', value: b.pais } } : {}
  return {
    ...(b.nome ? { search: { query: b.nome, mode: 'lexical' } } : {}),
    ...filtroPais,
    fields: CAMPOS_CRUSTDATA,
    limit: LIMITE_INTERNACIONAL,
    ...(b.cursor ? { cursor: b.cursor } : {}),
  }
}

const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** Só aceita link http(s): o valor vai para um href na tela. */
const link = (v: unknown): string | null => {
  const t = texto(v)
  if (!t) return null
  const comEsquema = /^https?:\/\//i.test(t) ? t : `https://${t}`
  try {
    const u = new URL(comEsquema)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null
  } catch {
    return null
  }
}

export function mapearEmpresa(bruto: unknown): EmpresaInternacional | null {
  if (!bruto || typeof bruto !== 'object') return null
  const r = bruto as { crustdata_company_id?: unknown; basic_info?: Record<string, unknown>; locations?: Record<string, unknown> }
  const info = r.basic_info ?? {}
  const loc = r.locations ?? {}
  const nome = texto(info.name)
  if (typeof r.crustdata_company_id !== 'number' || !nome) return null
  return {
    id: r.crustdata_company_id,
    nome,
    dominio: texto(info.primary_domain),
    site: link(info.website),
    linkedin: link(info.professional_network_url),
    pais: texto(loc.country),
    cidade: texto(loc.city),
    sede: texto(loc.headquarters),
    fundacao: typeof info.year_founded === 'number' ? info.year_founded : null,
    funcionarios: texto(info.employee_count_range),
    tipo: texto(info.company_type),
  }
}

export type FalhaCrustdata = 'sem_chave' | 'sem_credito' | 'limite' | 'indisponivel'

export async function buscarEmpresasCrustdata(
  busca: BuscaInternacional,
  chave: string | undefined,
  fetcher: typeof fetch = fetch
): Promise<{ ok: true; resposta: RespostaInternacional } | { ok: false; motivo: FalhaCrustdata }> {
  if (!chave) return { ok: false, motivo: 'sem_chave' }
  try {
    const res = await fetcher(CRUSTDATA_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${chave}`,
        'content-type': 'application/json',
        'x-api-version': CRUSTDATA_VERSAO,
      },
      body: JSON.stringify(corpoCrustdata(busca)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (res.status === 401) return { ok: false, motivo: 'sem_chave' }
    if (res.status === 402 || res.status === 403) return { ok: false, motivo: 'sem_credito' }
    if (res.status === 429) return { ok: false, motivo: 'limite' }
    if (!res.ok) return { ok: false, motivo: 'indisponivel' }
    const dados = (await res.json()) as { companies?: unknown; next_cursor?: unknown; total_count?: unknown }
    const itens = (Array.isArray(dados.companies) ? dados.companies : [])
      .map(mapearEmpresa)
      .filter((e): e is EmpresaInternacional => e !== null)
    return {
      ok: true,
      resposta: {
        itens,
        proximoCursor: typeof dados.next_cursor === 'string' && dados.next_cursor ? dados.next_cursor : null,
        total: typeof dados.total_count === 'number' ? dados.total_count : null,
      },
    }
  } catch {
    return { ok: false, motivo: 'indisponivel' }
  }
}

export const MENSAGEM_FALHA: Record<FalhaCrustdata, { texto: string; status: number }> = {
  sem_chave: { texto: 'Busca internacional não configurada (chave da Crustdata ausente ou inválida).', status: 503 },
  sem_credito: { texto: 'A conta da Crustdata está sem crédito ou sem permissão para esta busca.', status: 402 },
  limite: { texto: 'Muitas buscas seguidas. Aguarde um minuto e tente de novo.', status: 429 },
  indisponivel: { texto: 'Crustdata indisponível no momento.', status: 502 },
}
