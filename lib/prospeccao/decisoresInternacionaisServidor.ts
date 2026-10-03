// Cache do decisor internacional por (organizacao_id, dominio), migration 0063.
// Client admin (service_role ignora RLS): TODA operação filtra/grava
// organizacao_id da sessão, recebido da rota — nunca do corpo da requisição.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Decisor } from './decisores'
import type { CandidatoDecisor, EmailDecisor } from './enriquecimento'
import type { SalvoInternacional } from './decisorAutomatico'

const TABELA = 'prospeccao_decisores_internacionais'

/** Domínio aceito (o mesmo check da 0063): minúsculo, com TLD. */
export function dominioValido(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const d = v.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')
  return d.length <= 253 && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d) ? d : null
}

export async function lerDecisorInternacional(admin: SupabaseClient, org: string, dominio: string): Promise<SalvoInternacional | null> {
  const { data, error } = await admin.from(TABELA).select('candidatos, anymail').eq('organizacao_id', org).eq('dominio', dominio).maybeSingle()
  if (error) throw new Error(`Falha ao ler decisor internacional: ${error.message}`)
  if (!data) return null
  return {
    candidatos: Array.isArray(data.candidatos) ? (data.candidatos as CandidatoDecisor[]) : null,
    anymail: Array.isArray(data.anymail) ? (data.anymail as EmailDecisor[]) : [],
  }
}

export async function salvarDecisorInternacional(
  admin: SupabaseClient,
  org: string,
  dominio: string,
  parte: { candidatos?: CandidatoDecisor[]; anymail?: EmailDecisor[]; decisor?: Decisor },
): Promise<void> {
  const agora = new Date().toISOString()
  const { error } = await admin.from(TABELA).upsert(
    {
      organizacao_id: org,
      dominio,
      ...(parte.candidatos ? { candidatos: parte.candidatos, candidatos_em: agora } : {}),
      ...(parte.anymail ? { anymail: parte.anymail } : {}),
      ...(parte.decisor ? { decisor: parte.decisor } : {}),
      atualizado_em: agora,
    },
    { onConflict: 'organizacao_id,dominio' },
  )
  if (error) throw new Error(`Falha ao salvar decisor internacional: ${error.message}`)
}
