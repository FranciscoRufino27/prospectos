// Filtros da busca de prospecção. O perfil da organização é o ponto de
// partida; a tela pode ajustar. Tudo que vem do cliente é revalidado aqui
// antes de virar parâmetro das RPCs (migration 0051).

import {
  OPCOES_ANOS_MINIMOS,
  OPCOES_CAPITAL_MINIMO,
  PORTES_PROSPECCAO,
  PROSPECCAO_LIMITES,
  UFS_BRASIL,
  type PorteProspeccao,
  type ProspeccaoConfig,
} from '@/lib/config/workspaceConfig'

export interface FiltrosBusca {
  cnaes: string[]
  incluirCnaesSecundarios: boolean
  ufs: string[]
  municipios: string[]
  portes: PorteProspeccao[]
  excluirMei: boolean
  soComEmail: boolean
  texto: string
  /** Aberta há pelo menos N anos (migration 0058); null = qualquer idade. */
  anosMinimos: number | null
  /** Capital social mínimo em reais (0058); null = qualquer. */
  capitalMinimo: number | null
  /** '' = qualquer; 'com' = fixo ou celular; 'celular' = só celular (0058). */
  telefone: FiltroTelefone
}

export type FiltroTelefone = '' | 'com' | 'celular'
export { OPCOES_ANOS_MINIMOS, OPCOES_CAPITAL_MINIMO }

export const LIMITE_PAGINA = 50
const TEXTO_MAX = 80

function lista<T extends string>(v: unknown, valido: (s: string) => boolean, max: number): T[] {
  if (!Array.isArray(v)) return []
  return [...new Set(v.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(valido))].slice(0, max) as T[]
}

export function filtrosDoPerfil(perfil: ProspeccaoConfig | undefined): FiltrosBusca {
  return {
    cnaes: perfil?.cnaes ?? [],
    incluirCnaesSecundarios: perfil?.incluirCnaesSecundarios ?? false,
    ufs: perfil?.ufs ?? [],
    municipios: perfil?.municipios ?? [],
    portes: perfil?.portes ?? [],
    excluirMei: perfil?.excluirMei ?? false,
    // Padrão recomendado: e-mail válido é o único critério mínimo que a fonte
    // atual sustenta de verdade (migration 0051, p_so_com_email filtra no servidor).
    soComEmail: true,
    texto: '',
    anosMinimos: null,
    capitalMinimo: null,
    telefone: '',
  }
}

/** Valida o que veio do cliente; campo ausente/inválido cai no valor do perfil. */
export function normalizarFiltros(bruto: unknown, perfil: ProspeccaoConfig | undefined): FiltrosBusca {
  const base = filtrosDoPerfil(perfil)
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return base
  const b = bruto as Record<string, unknown>
  const texto = typeof b.texto === 'string' ? b.texto.trim().slice(0, TEXTO_MAX) : ''
  return {
    cnaes: Array.isArray(b.cnaes) ? lista(b.cnaes, (s) => /^\d{7}$/.test(s), PROSPECCAO_LIMITES.cnaes) : base.cnaes,
    incluirCnaesSecundarios:
      typeof b.incluirCnaesSecundarios === 'boolean' ? b.incluirCnaesSecundarios : base.incluirCnaesSecundarios,
    ufs: Array.isArray(b.ufs) ? lista(b.ufs, (s) => (UFS_BRASIL as readonly string[]).includes(s), UFS_BRASIL.length) : base.ufs,
    municipios: Array.isArray(b.municipios)
      ? lista(b.municipios, (s) => /^\d{1,7}$/.test(s), PROSPECCAO_LIMITES.municipios)
      : base.municipios,
    portes: Array.isArray(b.portes)
      ? lista<PorteProspeccao>(b.portes, (s) => (PORTES_PROSPECCAO as readonly string[]).includes(s), PORTES_PROSPECCAO.length)
      : base.portes,
    excluirMei: typeof b.excluirMei === 'boolean' ? b.excluirMei : base.excluirMei,
    soComEmail: b.soComEmail === true,
    // `%` e `_` são curingas do ILIKE: escapados para a busca ser literal.
    texto: texto.replace(/[\\%_]/g, (c) => `\\${c}`),
    anosMinimos: (OPCOES_ANOS_MINIMOS as readonly unknown[]).includes(b.anosMinimos) ? (b.anosMinimos as number) : null,
    capitalMinimo: (OPCOES_CAPITAL_MINIMO as readonly unknown[]).includes(b.capitalMinimo) ? (b.capitalMinimo as number) : null,
    telefone: b.telefone === 'com' || b.telefone === 'celular' ? b.telefone : '',
  }
}

/** Tamanho da página pedido pelo cliente, sempre entre 1 e LIMITE_PAGINA. */
export function limitePagina(v: unknown): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 ? Math.min(v, LIMITE_PAGINA) : LIMITE_PAGINA
}

// Cursor da busca por nota (migration 0054): "<nota>-<cnpj>". Opaco para a tela.
export function cursorValido(v: unknown): string | null {
  return typeof v === 'string' && /^\d{1,2}-\d{14}$/.test(v) ? v : null
}

export function lerCursor(cursor: string | null): { nota: number; cnpj: string } | null {
  if (!cursor) return null
  const [nota, cnpj] = cursor.split('-')
  return { nota: Number(nota), cnpj }
}

/** Algum filtro da 0058 ligado? Sem eles a busca usa as RPCs antigas. */
export function temFiltrosExtras(f: FiltrosBusca): boolean {
  return f.anosMinimos !== null || f.capitalMinimo !== null || f.telefone !== ''
}

/** Data limite de abertura para "há mais de N anos" (UTC, AAAA-MM-DD). */
export function aberturaAte(anos: number, hoje: Date = new Date()): string {
  const d = new Date(Date.UTC(hoje.getUTCFullYear() - anos, hoje.getUTCMonth(), hoje.getUTCDate()))
  return d.toISOString().slice(0, 10)
}

/** Parâmetros extras das RPCs _v2 (0058). */
export function paramsExtras(f: FiltrosBusca, hoje?: Date) {
  return {
    p_abertura_ate: f.anosMinimos === null ? null : aberturaAte(f.anosMinimos, hoje),
    p_capital_min: f.capitalMinimo,
    p_telefone: f.telefone,
  }
}

/** Parâmetros comuns de prospeccao_buscar / prospeccao_contar. */
export function paramsRpc(org: string, f: FiltrosBusca) {
  return {
    p_org: org,
    p_cnaes: f.cnaes,
    p_secundarios: f.incluirCnaesSecundarios,
    p_ufs: f.ufs,
    p_municipios: f.municipios,
    p_portes: f.portes,
    p_excluir_mei: f.excluirMei,
    p_so_com_email: f.soComEmail,
    p_texto: f.texto,
  }
}
