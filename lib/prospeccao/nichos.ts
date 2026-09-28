// Nichos da prospecção: grupos nomeados de atividades (CNAE subclasse 2.3). O
// catálogo da Receita só traz o código; o nome e o agrupamento vêm daqui.
// Puro — usado no cliente (filtro da tela, perfil de busca) e nos testes.
//
// Um CNAE do perfil fora destes grupos continua buscável: cai em "Outras
// atividades", identificado só pelo código.

export interface AtividadeNicho {
  codigo: string // 7 dígitos, sem máscara
  nome: string
}

export interface Nicho {
  id: string
  nome: string
  atividades: AtividadeNicho[]
}

export const NICHOS: readonly Nicho[] = [
  {
    id: 'hotelaria',
    nome: 'Hotelaria',
    atividades: [
      { codigo: '5510801', nome: 'Hotéis' },
      { codigo: '5510802', nome: 'Apart-hotéis' },
      { codigo: '5510803', nome: 'Motéis' },
      { codigo: '5590601', nome: 'Albergues, exceto assistenciais' },
      { codigo: '5590602', nome: 'Campings' },
      { codigo: '5590603', nome: 'Pensões (alojamento)' },
      { codigo: '5590699', nome: 'Outros alojamentos' },
    ],
  },
  {
    id: 'saude',
    nome: 'Saúde',
    atividades: [
      { codigo: '8610101', nome: 'Atendimento hospitalar' },
      { codigo: '8610102', nome: 'Pronto-socorro e urgências' },
      { codigo: '8711501', nome: 'Clínicas e residências geriátricas' },
      { codigo: '8711502', nome: 'Instituições de longa permanência para idosos' },
    ],
  },
  {
    id: 'lavanderias',
    nome: 'Lavanderias',
    atividades: [
      { codigo: '9601701', nome: 'Lavanderias' },
      { codigo: '9601702', nome: 'Tinturarias' },
      { codigo: '9601703', nome: 'Toalheiros' },
    ],
  },
  {
    id: 'alimentacao',
    nome: 'Alimentação',
    atividades: [
      { codigo: '5620101', nome: 'Alimentação para empresas' },
      { codigo: '5620103', nome: 'Cantinas' },
      { codigo: '5620104', nome: 'Alimentação para consumo domiciliar' },
    ],
  },
  {
    id: 'buffets',
    nome: 'Buffets',
    atividades: [
      { codigo: '5620102', nome: 'Bufê para eventos e recepções' },
    ],
  },
  {
    id: 'restaurantes',
    nome: 'Bares e restaurantes',
    atividades: [
      { codigo: '5611201', nome: 'Restaurantes e similares' },
      { codigo: '5611203', nome: 'Lanchonetes, casas de chá e de sucos' },
      { codigo: '5611204', nome: 'Bares sem entretenimento' },
      { codigo: '5611205', nome: 'Bares com entretenimento' },
    ],
  },
  {
    id: 'eventos',
    nome: 'Eventos',
    atividades: [
      { codigo: '8230001', nome: 'Organização de feiras, congressos e festas' },
      { codigo: '8230002', nome: 'Casas de festas e eventos' },
    ],
  },
]

export const ID_OUTRAS = 'outras'

const POR_CODIGO = new Map<string, { nicho: Nicho; nome: string }>(
  NICHOS.flatMap((n) => n.atividades.map((a) => [a.codigo, { nicho: n, nome: a.nome }] as const)),
)

/** Nome da atividade ('5510801' → 'Hotéis'); null se não está em nenhum nicho. */
export function nomeAtividade(codigo: string): string | null {
  return POR_CODIGO.get(codigo)?.nome ?? null
}

/** Nicho a que o CNAE pertence; null se não está em nenhum. */
export function nichoDaAtividade(codigo: string): Nicho | null {
  return POR_CODIGO.get(codigo)?.nicho ?? null
}

export interface GrupoNicho {
  id: string
  nome: string
  cnaes: string[]
}

/**
 * Agrupa os CNAEs do perfil por nicho, na ordem de NICHOS. CNAEs sem nicho vão
 * para "Outras atividades" (sempre por último). Nicho sem CNAE no perfil não
 * aparece: o filtro só oferece o que o catálogo da organização pode ter.
 */
export function gruposDoPerfil(cnaesPerfil: readonly string[]): GrupoNicho[] {
  const grupos = new Map<string, GrupoNicho>()
  const outras: string[] = []
  for (const c of cnaesPerfil) {
    const nicho = nichoDaAtividade(c)
    if (!nicho) { outras.push(c); continue }
    const g = grupos.get(nicho.id) ?? { id: nicho.id, nome: nicho.nome, cnaes: [] }
    g.cnaes.push(c)
    grupos.set(nicho.id, g)
  }
  const ordenados = NICHOS.flatMap((n) => (grupos.has(n.id) ? [grupos.get(n.id)!] : []))
  return outras.length ? [...ordenados, { id: ID_OUTRAS, nome: 'Outras atividades', cnaes: outras }] : ordenados
}

export type ResultadoAlternarNicho =
  | { ok: true; cnaes: string[] }
  | { ok: false; motivo: 'limite'; faltam: number }

/**
 * Marca/desmarca um nicho inteiro no perfil. Se o nicho já está completo, sai
 * todo; senão, entram as atividades que faltam — desde que caibam no limite do
 * perfil (nunca corta em silêncio: devolve quantas vagas faltam).
 */
export function alternarNicho(cnaes: readonly string[], nichoId: string, limite: number): ResultadoAlternarNicho {
  const nicho = NICHOS.find((n) => n.id === nichoId)
  if (!nicho) return { ok: true, cnaes: [...cnaes] }
  const codigos = nicho.atividades.map((a) => a.codigo)
  if (codigos.every((c) => cnaes.includes(c))) {
    return { ok: true, cnaes: cnaes.filter((c) => !codigos.includes(c)) }
  }
  const novos = codigos.filter((c) => !cnaes.includes(c))
  const excesso = cnaes.length + novos.length - limite
  if (excesso > 0) return { ok: false, motivo: 'limite', faltam: excesso }
  return { ok: true, cnaes: [...cnaes, ...novos] }
}
