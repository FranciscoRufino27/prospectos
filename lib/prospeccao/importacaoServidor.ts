// Importação a partir da busca: valida o lote e chama prospeccao_importar
// (migrations 0051/0055), que faz empresa + lead + contato por CNPJ numa transação.
// A prévia é a MESMA função com p_simular=true — não há duas regras.

import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizarPerfilLinkedIn } from './contato'
import { carregarAnalises } from './decisoresServidor'
import { emailDoDecisor } from './enriquecimento'

export const MAX_ITENS_IMPORTACAO = 200

export interface ItemImportacao {
  cnpj: string
  email: string | null
  contato_nome: string | null
  contato_cargo: string | null
  /** Perfil /in/ canônico; gravado em contatos.linkedin (migration 0055). */
  contato_linkedin: string | null
}

export type StatusImportacao =
  | 'importavel'
  | 'importado'
  | 'ja_na_base'
  | 'email_ja_existe'
  | 'sem_email'
  | 'fora_do_catalogo'
  | 'duplicado_no_lote'

export interface ResultadoItem {
  cnpj: string
  status: StatusImportacao
  lead_id: string | null
}

export type ResumoImportacao = Record<StatusImportacao, number>

const TEXTO_MAX = 120

function textoOpcional(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim().slice(0, TEXTO_MAX)
  return t || null
}

export function validarItens(bruto: unknown): { ok: true; itens: ItemImportacao[] } | { ok: false; erro: string } {
  if (!Array.isArray(bruto) || bruto.length === 0) return { ok: false, erro: 'Selecione ao menos uma empresa.' }
  if (bruto.length > MAX_ITENS_IMPORTACAO) {
    return { ok: false, erro: `Importe no máximo ${MAX_ITENS_IMPORTACAO} empresas por vez.` }
  }
  const itens: ItemImportacao[] = []
  for (const b of bruto) {
    const o = (b && typeof b === 'object' ? b : {}) as Record<string, unknown>
    const cnpj = typeof o.cnpj === 'string' ? o.cnpj.replace(/\D/g, '') : ''
    if (!/^\d{14}$/.test(cnpj)) return { ok: false, erro: 'CNPJ inválido na seleção.' }
    const email = textoOpcional(o.email)?.toLowerCase() ?? null
    itens.push({
      cnpj, email,
      contato_nome: textoOpcional(o.contato_nome),
      contato_cargo: textoOpcional(o.contato_cargo),
      // URL que não seja perfil do LinkedIn é descartada, não recusa o lote.
      contato_linkedin: typeof o.contato_linkedin === 'string' ? normalizarPerfilLinkedIn(o.contato_linkedin) : null,
    })
  }
  return { ok: true, itens }
}

export function resumir(resultados: ResultadoItem[]): ResumoImportacao {
  const resumo: ResumoImportacao = {
    importavel: 0, importado: 0, ja_na_base: 0, email_ja_existe: 0,
    sem_email: 0, fora_do_catalogo: 0, duplicado_no_lote: 0,
  }
  for (const r of resultados) resumo[r.status] = (resumo[r.status] ?? 0) + 1
  return resumo
}

/**
 * O e-mail do lead é SEMPRE o do decisor, verificado pela Anymail e salvo pela
 * própria org (0060) — nunca o e-mail cadastral da Receita nem o que o cliente
 * mandou. Sem e-mail do decisor, a empresa nem chega à RPC: lá o e-mail vazio
 * cairia no cadastral do catálogo.
 */
export async function separarPorEmailDoDecisor(
  admin: SupabaseClient,
  org: string,
  itens: ItemImportacao[],
): Promise<{ comEmail: ItemImportacao[]; semEmail: ResultadoItem[] }> {
  const analises = await carregarAnalises(admin, org, itens.map((i) => i.cnpj))
  const comEmail: ItemImportacao[] = []
  const semEmail: ResultadoItem[] = []
  for (const item of itens) {
    const email = emailDoDecisor(analises[item.cnpj]?.enriquecimento, item.contato_nome)
    if (email) comEmail.push({ ...item, email })
    else semEmail.push({ cnpj: item.cnpj, status: 'sem_email', lead_id: null })
  }
  return { comEmail, semEmail }
}

export async function importarProspeccao(
  admin: SupabaseClient,
  params: {
    org: string
    responsavel: { id: string | null; nome: string | null }
    segmento: string | null
    itens: ItemImportacao[]
    simular: boolean
  }
): Promise<{ resultados: ResultadoItem[]; resumo: ResumoImportacao }> {
  const { data, error } = await admin.rpc('prospeccao_importar', {
    p_org: params.org,
    p_responsavel_id: params.responsavel.id,
    p_responsavel_nome: params.responsavel.nome,
    p_segmento: params.segmento,
    p_itens: params.itens,
    p_simular: params.simular,
  })
  if (error) throw new Error(`Falha na importação: ${error.message}`)
  const resultados = (data ?? []) as ResultadoItem[]
  return { resultados, resumo: resumir(resultados) }
}
