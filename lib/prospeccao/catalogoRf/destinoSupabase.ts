// Destino real do catálogo: tabelas globais da migration 0050, escritas com
// service_role. O catálogo não tem organizacao_id por desenho (dado público
// compartilhado, invisível ao cliente) — ver cabeçalho da 0050.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { DestinoCatalogo, RegistroCatalogo, ResumoCarga } from './carga'
import { notaDoCatalogo } from '../notaCatalogo'

export function criarDestinoSupabase(admin: SupabaseClient): DestinoCatalogo {
  return {
    async gravar(lote: RegistroCatalogo[]) {
      const agora = new Date().toISOString()
      const { error } = await admin
        .from('catalogo_estabelecimentos')
        // qualidade_email/nota (0054) ordenam a busca da Prospecção.
        .upsert(lote.map((r) => ({ ...r, ...notaDoCatalogo(r), atualizado_em: agora })), { onConflict: 'cnpj' })
      if (error) throw new Error(`Falha ao gravar lote do catálogo: ${error.message}`)
    },

    async removerNaoVistos(mesRf: string, cnaes: string[], cnaesSecundarios: string[]) {
      // CNAEs já validados como 7 dígitos: seguros para interpolar no filtro.
      const filtros = [`cnae_principal.in.(${cnaes.join(',')})`]
      if (cnaesSecundarios.length) filtros.push(`cnaes_secundarios.ov.{${cnaesSecundarios.join(',')}}`)
      const { error, count } = await admin
        .from('catalogo_estabelecimentos')
        .delete({ count: 'exact' })
        .neq('mes_rf', mesRf)
        .or(filtros.join(','))
      if (error) throw new Error(`Falha ao limpar catálogo antigo: ${error.message}`)
      return count ?? 0
    },
  }
}

export async function registrarInicioCarga(
  admin: SupabaseClient,
  dados: { mesRf: string; cnaes: string[]; shards: number[]; completa: boolean }
): Promise<string> {
  const { data, error } = await admin
    .from('catalogo_rf_cargas')
    .insert({ mes_rf: dados.mesRf, cnaes: dados.cnaes, shards: dados.shards, completa: dados.completa })
    .select('id')
    .single()
  if (error || !data) throw new Error(`Falha ao registrar carga: ${error?.message ?? 'sem id'}`)
  return data.id as string
}

export async function registrarFimCarga(
  admin: SupabaseClient,
  id: string,
  resultado: { resumo: ResumoCarga } | { erro: string }
): Promise<void> {
  const campos =
    'resumo' in resultado
      ? {
          status: 'concluida',
          linhas_lidas: resultado.resumo.linhasLidas,
          estabelecimentos_gravados: resultado.resumo.gravados,
          estabelecimentos_removidos: resultado.resumo.removidos,
        }
      : { status: 'erro', erro: resultado.erro.slice(0, 2000) }
  const { error } = await admin
    .from('catalogo_rf_cargas')
    .update({ ...campos, concluida_em: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(`Falha ao fechar registro da carga: ${error.message}`)
}
