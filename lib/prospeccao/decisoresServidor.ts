// Persistência do decisor da Prospecção (migration 0057). Client admin
// (service_role ignora RLS): TODA operação filtra/grava organizacao_id da
// sessão, recebido da rota — nunca do corpo da requisição.

import type { SupabaseClient } from '@supabase/supabase-js'
import { analiseDaLinha, type AnaliseSalva, type ConsultaSocios } from './decisores'
import { lerEnriquecimento, type Enriquecimento } from './enriquecimento'

/** Análises salvas da org para os CNPJs de uma página da busca. */
export async function carregarAnalises(
  admin: SupabaseClient,
  org: string,
  cnpjs: readonly string[],
): Promise<Record<string, AnaliseSalva>> {
  if (cnpjs.length === 0) return {}
  const ler = (colunas: string) => admin
    .from('prospeccao_decisores')
    .select(colunas)
    .eq('organizacao_id', org)
    .in('cnpj', [...cnpjs])
  let { data, error } = await ler('cnpj, nome, cargo, linkedin, consulta, enriquecimento')
  // Banco ainda sem a 0060: segue com o que já existia (decisor e sócios).
  if (error && /enriquecimento/.test(error.message)) ({ data, error } = await ler('cnpj, nome, cargo, linkedin, consulta'))
  if (error) throw new Error(`Falha ao ler decisores salvos: ${error.message}`)
  const saida: Record<string, AnaliseSalva> = {}
  // select() com colunas dinâmicas perde a tipagem da linha.
  type Linha = Parameters<typeof analiseDaLinha>[0] & { cnpj: string }
  for (const linha of (data ?? []) as unknown as Linha[]) saida[linha.cnpj] = analiseDaLinha(linha)
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

/** Enriquecimento já salvo de um CNPJ da org (null = nada pago ainda). */
export async function lerEnriquecimentoSalvo(admin: SupabaseClient, org: string, cnpj: string): Promise<Enriquecimento | null> {
  const { data, error } = await admin
    .from('prospeccao_decisores')
    .select('enriquecimento')
    .eq('organizacao_id', org)
    .eq('cnpj', cnpj)
    .maybeSingle()
  if (error) throw new Error(`Falha ao ler enriquecimento: ${error.message}`)
  return lerEnriquecimento(data?.enriquecimento)
}

/**
 * Grava uma consulta paga sem apagar a outra (Crustdata e Anymail convivem no
 * mesmo jsonb) nem mexer em decisor/sócios. Só o servidor chama.
 */
export async function salvarEnriquecimento(
  admin: SupabaseClient,
  org: string,
  cnpj: string,
  parte: Enriquecimento,
): Promise<Enriquecimento> {
  const atual = (await lerEnriquecimentoSalvo(admin, org, cnpj)) ?? {}
  const novo: Enriquecimento = { ...atual, ...parte }
  const { error } = await admin.from('prospeccao_decisores').upsert(
    { organizacao_id: org, cnpj, enriquecimento: novo },
    { onConflict: 'organizacao_id,cnpj' },
  )
  if (error) throw new Error(`Falha ao salvar enriquecimento: ${error.message}`)
  return novo
}
