import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

// Cache persistente de fontes PÚBLICAS (tabela global enriquecimento_cache,
// migration 0056 — exceção documentada ao isolamento por organização, só
// service_role). Evita consultar o mesmo CNPJ/domínio de novo dentro da
// validade. Resultado "falha" expira rápido para não travar uma nova tentativa.

export type TipoCache = 'opencnpj' | 'site_dominio'
export type StatusCache = 'ok' | 'nao_encontrado' | 'falha'

const HORA = 3_600_000
const DIA = 24 * HORA
export const VALIDADE_MS: Record<StatusCache, number> = {
  ok: 30 * DIA,
  nao_encontrado: 7 * DIA,
  falha: HORA / 6, // 10 min: falha passageira não trava nova tentativa por muito tempo
}

export interface EntradaCache<T> {
  status: StatusCache
  resultado: T
}

export async function lerCache<T>(admin: SupabaseClient, tipo: TipoCache, chave: string, agora: number): Promise<EntradaCache<T> | null> {
  const { data } = await admin
    .from('enriquecimento_cache')
    .select('status, resultado, expira_em')
    .eq('tipo', tipo)
    .eq('chave', chave)
    .maybeSingle()
  if (!data || new Date(String(data.expira_em)).getTime() <= agora) return null
  return { status: data.status as StatusCache, resultado: data.resultado as T }
}

export async function gravarCache<T>(admin: SupabaseClient, tipo: TipoCache, chave: string, entrada: EntradaCache<T>, agora: number): Promise<void> {
  await admin.from('enriquecimento_cache').upsert(
    {
      tipo,
      chave,
      status: entrada.status,
      resultado: entrada.resultado,
      consultado_em: new Date(agora).toISOString(),
      expira_em: new Date(agora + VALIDADE_MS[entrada.status]).toISOString(),
    },
    { onConflict: 'tipo,chave' },
  )
}

// Lê do cache; se ausente/expirado, consulta e grava. `consultar` devolve a
// entrada já classificada. Deduplica chamadas simultâneas da mesma chave
// dentro do mesmo lote (memo em memória por execução).
export function criarConsultaComCache(admin: SupabaseClient, agora: number) {
  const emAndamento = new Map<string, Promise<{ entrada: EntradaCache<unknown>; doCache: boolean }>>()
  return async function comCache<T>(tipo: TipoCache, chave: string, consultar: () => Promise<EntradaCache<T>>) {
    const k = `${tipo}:${chave}`
    let p = emAndamento.get(k)
    if (!p) {
      p = (async () => {
        const hit = await lerCache<T>(admin, tipo, chave, agora)
        if (hit) return { entrada: hit as EntradaCache<unknown>, doCache: true }
        const entrada = await consultar()
        await gravarCache(admin, tipo, chave, entrada, agora)
        return { entrada: entrada as EntradaCache<unknown>, doCache: false }
      })()
      emAndamento.set(k, p)
    }
    const r = await p
    return { entrada: r.entrada as EntradaCache<T>, doCache: r.doCache }
  }
}
