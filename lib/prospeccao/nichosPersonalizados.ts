// Regras dos nichos criados pela organização (configuracoes.prospeccaoNichos).
// Puro: a rota lê/grava a config; aqui só valida e monta a lista nova.
import {
  NICHOS_PERSONALIZADOS_LIMITES,
  parseNichosPersonalizados,
  type NichoPersonalizado,
} from '@/lib/config/workspaceConfig'
import { NICHOS, type Nicho } from './nichos'

export type ResultadoNicho =
  | { ok: true; lista: NichoPersonalizado[]; nicho: NichoPersonalizado }
  | { ok: false; status: number; erro: string }

const chave = (nome: string) => nome.trim().toLocaleLowerCase('pt-BR')

/**
 * Valida e acrescenta um nicho. `existe` diz se o CNAE é uma subclasse real
 * (tabela do IBGE, só no servidor); `descricao` dá o nome para as mensagens.
 * Atividade que já está num nicho (pré-definido ou da org) é recusada com o
 * nome do nicho — a tela agrupa por CNAE e um código não pode cair em dois.
 */
export function adicionarNicho(
  lista: readonly NichoPersonalizado[],
  corpo: { nome?: unknown; cnaes?: unknown },
  id: string,
  agora: string,
  existe: (codigo: string) => boolean,
  descricao: (codigo: string) => string | null = () => null,
): ResultadoNicho {
  const nome = typeof corpo.nome === 'string' ? corpo.nome.trim() : ''
  if (!nome) return { ok: false, status: 400, erro: 'Dê um nome ao nicho.' }
  if (nome.length > NICHOS_PERSONALIZADOS_LIMITES.nome) {
    return { ok: false, status: 400, erro: `O nome aceita até ${NICHOS_PERSONALIZADOS_LIMITES.nome} caracteres.` }
  }
  if (lista.length >= NICHOS_PERSONALIZADOS_LIMITES.total) {
    return { ok: false, status: 409, erro: `A organização já tem ${NICHOS_PERSONALIZADOS_LIMITES.total} nichos. Exclua um para criar outro.` }
  }
  if ([...NICHOS, ...lista].some((n) => chave(n.nome) === chave(nome))) {
    return { ok: false, status: 409, erro: `Já existe um nicho chamado "${nome}".` }
  }

  const brutos = Array.isArray(corpo.cnaes) ? corpo.cnaes : []
  const cnaes = [...new Set(brutos.filter((c): c is string => typeof c === 'string').map((c) => c.replace(/\D/g, '')))]
  if (cnaes.length === 0) return { ok: false, status: 400, erro: 'Escolha pelo menos uma atividade.' }
  if (cnaes.length > NICHOS_PERSONALIZADOS_LIMITES.cnaes) {
    return { ok: false, status: 400, erro: `Um nicho aceita até ${NICHOS_PERSONALIZADOS_LIMITES.cnaes} atividades.` }
  }
  const invalido = cnaes.find((c) => !/^\d{7}$/.test(c) || !existe(c))
  if (invalido) return { ok: false, status: 400, erro: `Atividade desconhecida: ${invalido}.` }

  const donos = donosDasAtividades(lista)
  const repetido = cnaes.find((c) => donos.has(c))
  if (repetido) {
    const rotulo = descricao(repetido) ?? repetido
    return { ok: false, status: 409, erro: `"${rotulo}" já está no nicho ${donos.get(repetido)}.` }
  }

  const nicho: NichoPersonalizado = { id, nome, cnaes, criadoEm: agora }
  const nova = parseNichosPersonalizados([...lista, nicho]) ?? []
  return { ok: true, lista: nova, nicho }
}

/** CNAE → nome do nicho que já o usa (pré-definidos primeiro, depois os da org). */
export function donosDasAtividades(lista: readonly NichoPersonalizado[]): Map<string, string> {
  const donos = new Map<string, string>()
  for (const n of NICHOS) for (const a of n.atividades) donos.set(a.codigo, n.nome)
  for (const n of lista) for (const c of n.cnaes) if (!donos.has(c)) donos.set(c, n.nome)
  return donos
}

export function removerNicho(lista: readonly NichoPersonalizado[], id: string): NichoPersonalizado[] | null {
  if (!lista.some((n) => n.id === id)) return null
  return lista.filter((n) => n.id !== id)
}

/** Formato da tela (o mesmo dos pré-definidos), com o nome de cada atividade. */
export function paraNicho(n: NichoPersonalizado, descricao: (codigo: string) => string | null): Nicho {
  return {
    id: n.id,
    nome: n.nome,
    personalizado: true,
    atividades: n.cnaes.map((codigo) => ({ codigo, nome: descricao(codigo) ?? codigo })),
  }
}
