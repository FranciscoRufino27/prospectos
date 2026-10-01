// Busca de prospecção no servidor: RPCs da migration 0051 sobre o catálogo RF.
// `org` vem SEMPRE da sessão (resolverAcesso), nunca do payload.

import type { SupabaseClient } from '@supabase/supabase-js'
import { lerCursor, limitePagina, paramsExtras, paramsRpc, temFiltrosExtras, type FiltrosBusca } from './filtros'
import { classificarEmail, type QualidadeEmail } from './qualidadeEmail'
import { dominioDaEmpresa, type DominioEmpresa } from './dominioEmpresa'
import { descricoesCnae, nomeMunicipioIbge } from './referenciaIbge'
import { carregarAnalises } from './decisoresServidor'
import type { AnaliseSalva } from './decisores'

export interface ResultadoCatalogo {
  cnpj: string
  razao_social: string | null
  nome_fantasia: string | null
  cnae_principal: string
  cnaes_secundarios: string[]
  porte: string | null
  mei: boolean | null
  capital_social: number | null
  data_inicio_atividade: string | null
  logradouro: string | null
  numero: string | null
  bairro: string | null
  cep: string | null
  uf: string | null
  municipio: string | null
  telefone: string | null
  email: string | null
  ja_na_base: boolean
  lead_id: string | null
  qualidade_email: QualidadeEmail
  dominio: DominioEmpresa | null
  /** Nome oficial do IBGE (com acento); null quando não casou com a RF. */
  municipio_nome: string | null
  /** Descrição IBGE dos CNAEs principal e secundários, por código. */
  atividades: Record<string, string>
  /** Decisor e consulta de sócios que a org já salvou (0057); null = nada salvo. */
  analise: AnaliseSalva | null
}

export interface StatusCatalogo {
  mesRf: string
  concluidaEm: string | null
  cnaes: string[]
}

export interface RespostaBusca {
  itens: ResultadoCatalogo[]
  proximoCursor: string | null
  // Total geral (ignora soComEmail) e total com e-mail: os dois juntos dão os
  // cards "Empresas avaliadas" / "Com e-mail válido" / "Descartadas", sempre,
  // independente do critério de e-mail estar ligado nesta busca.
  total: number | null
  totalComEmail: number | null
  catalogo: StatusCatalogo | null
}

export async function statusCatalogo(admin: SupabaseClient): Promise<StatusCatalogo | null> {
  const { data, error } = await admin
    .from('catalogo_rf_cargas')
    .select('mes_rf, concluida_em, cnaes')
    .eq('status', 'concluida')
    .order('concluida_em', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`Falha ao ler status do catálogo: ${error.message}`)
  return data ? { mesRf: data.mes_rf, concluidaEm: data.concluida_em, cnaes: data.cnaes ?? [] } : null
}

export async function buscarProspeccao(
  admin: SupabaseClient,
  org: string,
  filtros: FiltrosBusca,
  cursor: string | null,
  opcoes: { contar: boolean; limite?: number }
): Promise<RespostaBusca> {
  // Sem CNAE a busca varreria o catálogo inteiro: a tela pede para configurar.
  if (filtros.cnaes.length === 0) {
    return { itens: [], proximoCursor: null, total: 0, totalComEmail: 0, catalogo: await statusCatalogo(admin) }
  }
  // Tempo de empresa/capital/telefone (0058) só existem nas RPCs _v2; sem eles,
  // as RPCs antigas atendem (e a busca padrão não depende da 0058).
  const extras = temFiltrosExtras(filtros)
  const params = extras ? { ...paramsRpc(org, filtros), ...paramsExtras(filtros) } : paramsRpc(org, filtros)
  const rpcBuscar = extras ? 'prospeccao_buscar_por_nota_v2' : 'prospeccao_buscar_por_nota'
  const rpcContar = extras ? 'prospeccao_contar_v2' : 'prospeccao_contar'
  // Quantidade desejada: a página traz só o que falta (nunca mais que LIMITE_PAGINA).
  const limite = limitePagina(opcoes.limite)
  const apos = lerCursor(cursor)
  const [pagina, contagemGeral, contagemComEmail, catalogo] = await Promise.all([
    // Ordenada por nota (0054): as empresas de dado melhor vêm primeiro.
    admin.rpc(rpcBuscar, {
      ...params,
      p_apos_nota: apos?.nota ?? null,
      p_apos_cnpj: apos?.cnpj ?? null,
      p_limite: limite,
    }),
    // Contagem só na primeira página: paginar não muda o total. Sempre as duas
    // (geral e com e-mail), independente do toggle atual — os cards precisam
    // dos dois números ao mesmo tempo.
    opcoes.contar ? admin.rpc(rpcContar, { ...params, p_so_com_email: false }) : Promise.resolve({ data: null, error: null }),
    opcoes.contar ? admin.rpc(rpcContar, { ...params, p_so_com_email: true }) : Promise.resolve({ data: null, error: null }),
    statusCatalogo(admin),
  ])
  if (pagina.error) throw new Error(`Falha na busca: ${pagina.error.message}`)
  if (contagemGeral.error) throw new Error(`Falha na contagem: ${contagemGeral.error.message}`)
  if (contagemComEmail.error) throw new Error(`Falha na contagem com e-mail: ${contagemComEmail.error.message}`)

  const linhas = (pagina.data ?? []) as (Omit<ResultadoCatalogo, 'qualidade_email' | 'dominio' | 'municipio_nome' | 'atividades' | 'analise'> & { nota: number })[]
  // Sem a tabela da 0057 (ou falha de leitura) a busca segue, só sem o salvo.
  const analises = await carregarAnalises(admin, org, linhas.map((l) => l.cnpj)).catch((e) => {
    console.error('[prospeccao/busca] sem decisores salvos:', e)
    return {} as Record<string, AnaliseSalva>
  })
  const itens: ResultadoCatalogo[] = linhas.map(({ nota: _nota, ...l }) => ({
    ...l,
    capital_social: l.capital_social === null ? null : Number(l.capital_social),
    qualidade_email: classificarEmail(l.email),
    dominio: dominioDaEmpresa(l.email, [l.nome_fantasia, l.razao_social]),
    municipio_nome: nomeMunicipioIbge(l.municipio, l.uf),
    atividades: descricoesCnae([l.cnae_principal, ...(l.cnaes_secundarios ?? [])]),
    analise: analises[l.cnpj] ?? null,
  }))
  return {
    itens,
    proximoCursor: linhas.length === limite ? `${linhas[linhas.length - 1].nota}-${linhas[linhas.length - 1].cnpj}` : null,
    total: contagemGeral.data === null ? null : Number(contagemGeral.data),
    totalComEmail: contagemComEmail.data === null ? null : Number(contagemComEmail.data),
    catalogo,
  }
}
