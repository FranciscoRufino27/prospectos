// Persistência do decisor da Prospecção (migration 0057). Client admin
// (service_role ignora RLS): TODA operação filtra/grava organizacao_id da
// sessão, recebido da rota — nunca do corpo da requisição.

import type { SupabaseClient } from '@supabase/supabase-js'
import { analiseDaLinha, type AnaliseSalva, type ConsultaSocios } from './decisores'

/** Análises salvas da org para os CNPJs de uma página da busca. */
export async function carregarAnalises(
  admin: SupabaseClient,
  org: string,
  cnpjs: readonly string[],
): Promise<Record<string, AnaliseSalva>> {
  if (cnpjs.length === 0) return {}
  const { data, error } = await admin
    .from('prospeccao_decisores')
    .select('cnpj, nome, cargo, linkedin, consulta')
    .eq('organizacao_id', org)
    .in('cnpj', [...cnpjs])
  if (error) throw new Error(`Falha ao ler decisores salvos: ${error.message}`)
  const saida: Record<string, AnaliseSalva> = {}
  for (const linha of data ?? []) saida[linha.cnpj] = analiseDaLinha(linha)
  return saida
}

/** Escolha do usuário: só nome/cargo/linkedin; a consulta salva fica como está. */
export async function salvarDecisor(
  admin: SupabaseClient,
  org: string,
  usuario: string,
  dados: { cnpj: string; nome: string | null; cargo: string | null; linkedin: string | null },
): Promise<void> {
  const { error } = await admin.from('prospeccao_decisores').upsert(
    {
      organizacao_id: org,
      cnpj: dados.cnpj,
      nome: dados.nome,
      cargo: dados.cargo,
      linkedin: dados.linkedin,
      atualizado_por: usuario,
      atualizado_em: new Date().toISOString(),
    },
    { onConflict: 'organizacao_id,cnpj' },
  )
  if (error) throw new Error(`Falha ao salvar decisor: ${error.message}`)
}

/** Consulta de sócios feita pelo servidor; não mexe na escolha do usuário. */
export async function salvarConsulta(
  admin: SupabaseClient,
  org: string,
  cnpj: string,
  consulta: ConsultaSocios,
): Promise<void> {
  const { error } = await admin.from('prospeccao_decisores').upsert(
    { organizacao_id: org, cnpj, consulta, consultado_em: new Date().toISOString() },
    { onConflict: 'organizacao_id,cnpj' },
  )
  if (error) throw new Error(`Falha ao salvar consulta de sócios: ${error.message}`)
}
