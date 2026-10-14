import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { engineConfig } from '@/lib/engine/config'
import {
  remetenteComPadrao,
  remetenteDedicado,
  type RemetenteOrganizacao,
} from '@/lib/email/remetenteOrganizacao'

// Remetente das campanhas. A regra (conta conectada pela organização →
// chave legada → conta padrão) vive em lib/email/remetenteOrganizacao.ts.
// O objeto devolvido carrega as credenciais: só o servidor o usa — para o
// navegador ou para o banco vão apenas `conta` e `email`.

export interface RemetenteCampanha {
  conta: string
  email: string
}

export type { RemetenteOrganizacao }

/** Demais tipos de campanha: conta da org ou, sem nenhuma, a padrão da plataforma. */
export async function buscarRemetenteCampanha(
  admin: SupabaseClient,
  org: string,
): Promise<RemetenteOrganizacao | null> {
  return remetenteComPadrao(admin, org)
}

/**
 * Prospecção: só a conta DEDICADA desta organização — nunca o fallback
 * 'followup'/conta global. É o que decide o bloqueio de ativação/envio real.
 */
export async function buscarRemetenteProspeccao(
  admin: SupabaseClient,
  org: string,
): Promise<RemetenteOrganizacao | null> {
  return remetenteDedicado(admin, org)
}

/** Remetente que a campanha deste tipo usaria (null = não configurado). */
export async function buscarRemetenteDoTipo(
  admin: SupabaseClient,
  org: string,
  tipoCampanha: string | null | undefined,
): Promise<RemetenteOrganizacao | null> {
  return tipoCampanha === 'prospeccao' ? buscarRemetenteProspeccao(admin, org) : buscarRemetenteCampanha(admin, org)
}

/** Só o que pode sair do servidor (UI, publico da campanha). */
export function remetentePublico(r: RemetenteOrganizacao | null): RemetenteCampanha | null {
  return r ? { conta: r.conta, email: r.email } : null
}

export async function exigirEnvioRealCampanhaDisponivel(
  admin: SupabaseClient,
  org: string,
  campanhaId: string,
): Promise<RemetenteOrganizacao> {
  if (engineConfig.modoEnsaio) {
    throw new Error('Envio real indisponível: desative o MODO_ENSAIO no ambiente do Vercel.')
  }
  // Prospecção exige remetente EXPLICITAMENTE configurado nesta organização —
  // nunca o fallback silencioso 'followup'/conta global de outra organização.
  // Renovação e demais tipos preservam o comportamento anterior (fallback
  // permitido). Busca só a coluna `tipo` para não acoplar este gate ao
  // formato completo da campanha.
  const { data, error } = await admin
    .from('campanhas')
    .select('tipo')
    .eq('id', campanhaId)
    .eq('organizacao_id', org)
    .maybeSingle()
  if (error) throw error
  const tipoCampanha = (data as { tipo?: string | null } | null)?.tipo ?? null
  if (tipoCampanha === 'prospeccao') {
    const dedicado = await buscarRemetenteProspeccao(admin, org)
    if (!dedicado) {
      throw new Error('Configure um remetente em Configurações antes de iniciar a campanha.')
    }
    return dedicado
  }
  const remetente = await buscarRemetenteCampanha(admin, org)
  if (!remetente) {
    throw new Error('Envio real indisponível: configure a conta Gmail deste workspace.')
  }
  return remetente
}
