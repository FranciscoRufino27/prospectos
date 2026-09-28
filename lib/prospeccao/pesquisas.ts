// Pesquisas salvas da Prospecção: operações puras sobre a lista guardada em
// organizacoes.configuracoes.prospeccaoPesquisas. As rotas só leem a lista,
// aplicam a operação e gravam pelo ponto único de escrita da config.

import {
  PESQUISAS_LIMITES,
  parseFiltrosPesquisa,
  quantidadeValida,
  type FiltrosPesquisaSalva,
  type PesquisaSalva,
} from '@/lib/config/workspaceConfig'
import { NOME_UF } from './estados'
import { gruposDoPerfil } from './nichos'
import { ROTULO_PORTE } from './rotulos'

export type ResultadoPesquisas = { ok: true; lista: PesquisaSalva[] } | { ok: false; erro: string; status: number }

function nomeValido(bruto: unknown): string | null {
  const nome = typeof bruto === 'string' ? bruto.trim().replace(/\s+/g, ' ') : ''
  return nome && nome.length <= PESQUISAS_LIMITES.nome ? nome : null
}

function nomeEmUso(lista: PesquisaSalva[], nome: string, ignorarId?: string): boolean {
  const alvo = nome.toLocaleLowerCase('pt-BR')
  return lista.some((p) => p.id !== ignorarId && p.nome.toLocaleLowerCase('pt-BR') === alvo)
}

export function adicionarPesquisa(
  lista: PesquisaSalva[],
  entrada: { nome?: unknown; filtros?: unknown; quantidade?: unknown },
  id: string,
  agora: string,
): ResultadoPesquisas {
  const nome = nomeValido(entrada.nome)
  if (!nome) return { ok: false, erro: `Dê um nome de até ${PESQUISAS_LIMITES.nome} caracteres.`, status: 400 }
  const filtros = parseFiltrosPesquisa(entrada.filtros)
  if (!filtros) return { ok: false, erro: 'A pesquisa precisa de ao menos uma atividade.', status: 400 }
  if (entrada.quantidade != null && quantidadeValida(entrada.quantidade) === null) {
    return { ok: false, erro: `Quantidade entre 1 e ${PESQUISAS_LIMITES.quantidadeMax}.`, status: 400 }
  }
  if (lista.length >= PESQUISAS_LIMITES.total) {
    return { ok: false, erro: `Limite de ${PESQUISAS_LIMITES.total} pesquisas salvas. Exclua uma para salvar outra.`, status: 409 }
  }
  if (nomeEmUso(lista, nome)) return { ok: false, erro: 'Já existe uma pesquisa com esse nome.', status: 409 }
  return {
    ok: true,
    lista: [...lista, { id, nome, filtros, quantidade: quantidadeValida(entrada.quantidade), criadaEm: agora }],
  }
}

export function renomearPesquisa(lista: PesquisaSalva[], id: string, nomeBruto: unknown): ResultadoPesquisas {
  const alvo = lista.find((p) => p.id === id)
  if (!alvo) return { ok: false, erro: 'Pesquisa não encontrada.', status: 404 }
  const nome = nomeValido(nomeBruto)
  if (!nome) return { ok: false, erro: `Dê um nome de até ${PESQUISAS_LIMITES.nome} caracteres.`, status: 400 }
  if (nomeEmUso(lista, nome, id)) return { ok: false, erro: 'Já existe uma pesquisa com esse nome.', status: 409 }
  return { ok: true, lista: lista.map((p) => (p.id === id ? { ...p, nome } : p)) }
}

export function removerPesquisa(lista: PesquisaSalva[], id: string): ResultadoPesquisas {
  if (!lista.some((p) => p.id === id)) return { ok: false, erro: 'Pesquisa não encontrada.', status: 404 }
  return { ok: true, lista: lista.filter((p) => p.id !== id) }
}

/** "Hotelaria SP, RJ | Microempresa | 40 empresas" — ponto de partida do nome. */
export function nomeSugerido(filtros: FiltrosPesquisaSalva, quantidade: number | null): string {
  const grupos = gruposDoPerfil(filtros.cnaes ?? [])
  const nicho = grupos.length === 1 ? grupos[0].nome : grupos.length > 1 ? `${grupos.length} nichos` : 'Atividades'
  const ufs = filtros.ufs ?? []
  const regiao = ufs.length === 0 ? 'Brasil' : ufs.length === 1 ? ufs[0] : ufs.length <= 3 ? ufs.join(', ') : `${ufs.length} estados`
  const municipios = filtros.municipios?.length ?? 0
  const partes = [`${nicho} ${regiao}${municipios ? ` (${municipios} ${municipios === 1 ? 'cidade' : 'cidades'})` : ''}`]
  const portes = filtros.portes ?? []
  if (portes.length === 1) partes.push(ROTULO_PORTE[portes[0]])
  else if (portes.length > 1) partes.push(`${portes.length} portes`)
  if (quantidade) partes.push(`${quantidade} empresas`)
  return partes.join(' | ').slice(0, PESQUISAS_LIMITES.nome)
}

/** Descrição curta para o atalho: nome do estado quando é um só. */
export function resumoPesquisa(p: PesquisaSalva): string {
  const ufs = p.filtros.ufs ?? []
  const regiao = ufs.length === 0 ? 'Brasil inteiro' : ufs.length === 1 ? NOME_UF[ufs[0] as keyof typeof NOME_UF] ?? ufs[0] : `${ufs.length} estados`
  const atividades = p.filtros.cnaes?.length ?? 0
  return [
    `${atividades} atividade${atividades === 1 ? '' : 's'}`,
    regiao,
    ...(p.filtros.municipios?.length
      ? [`${p.filtros.municipios.length} município${p.filtros.municipios.length === 1 ? '' : 's'}`]
      : []),
    p.quantidade ? `até ${p.quantidade} empresas` : 'sem limite',
  ].join(' · ')
}
