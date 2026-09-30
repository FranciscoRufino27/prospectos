// Recalcula qualidade_email/nota (migration 0054) das linhas que JÁ estão no
// catálogo. A carga nova grava a nota sozinha (destinoSupabase); isto cobre o
// que foi carregado antes da 0054 e reaplica a regra quando ela mudar.
// Tabela global, sem organização (ver 0050). Sem `gravar`, só conta.

import type { SupabaseClient } from '@supabase/supabase-js'
import { notaDoCatalogo } from '../notaCatalogo'

export interface ResumoNotas {
  lidas: number
  alteradas: number
  /** Linhas por nota calculada (ex.: { "51": 120, "40": 300 }). */
  porNota: Record<string, number>
}

interface Linha {
  cnpj: string
  email: string | null
  telefone: string | null
  razao_social: string | null
  nome_fantasia: string | null
  qualidade_email: string | null
  nota: number | null
}

export async function recalcularNotas(
  admin: SupabaseClient,
  opcoes: { gravar: boolean; tamanhoLote?: number; aoProgredir?: (msg: string) => void },
): Promise<ResumoNotas> {
  const tamanho = opcoes.tamanhoLote ?? 1000
  const resumo: ResumoNotas = { lidas: 0, alteradas: 0, porNota: {} }
  let apos = ''
  for (;;) {
    const { data, error } = await admin
      .from('catalogo_estabelecimentos')
      .select('cnpj, email, telefone, razao_social, nome_fantasia, qualidade_email, nota')
      .gt('cnpj', apos)
      .order('cnpj')
      .limit(tamanho)
    if (error) throw new Error(`Falha ao ler o catálogo (a migration 0054 foi aplicada?): ${error.message}`)
    const linhas = (data ?? []) as Linha[]
    if (linhas.length === 0) break

    // Poucas combinações (qualidade, nota) por lote: um update por grupo em
    // vez de um por linha.
    const grupos = new Map<string, { qualidade_email: string; nota: number; cnpjs: string[] }>()
    for (const l of linhas) {
      const calc = notaDoCatalogo(l)
      resumo.porNota[calc.nota] = (resumo.porNota[calc.nota] ?? 0) + 1
      if (l.qualidade_email === calc.qualidade_email && l.nota === calc.nota) continue
      const chave = `${calc.qualidade_email}:${calc.nota}`
      const g = grupos.get(chave) ?? { ...calc, cnpjs: [] }
      g.cnpjs.push(l.cnpj)
      grupos.set(chave, g)
    }
    for (const g of grupos.values()) {
      resumo.alteradas += g.cnpjs.length
      if (!opcoes.gravar) continue
      const { error: erroUpdate } = await admin
        .from('catalogo_estabelecimentos')
        .update({ qualidade_email: g.qualidade_email, nota: g.nota })
        .in('cnpj', g.cnpjs)
      if (erroUpdate) throw new Error(`Falha ao gravar notas: ${erroUpdate.message}`)
    }

    resumo.lidas += linhas.length
    apos = linhas[linhas.length - 1].cnpj
    opcoes.aoProgredir?.(`${resumo.lidas} lidas · ${resumo.alteradas} ${opcoes.gravar ? 'atualizadas' : 'a atualizar'}`)
    if (linhas.length < tamanho) break
  }
  return resumo
}
