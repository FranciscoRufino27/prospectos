import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

// Cache GLOBAL de inteligência (tabela enriquecimento_cache, migrations 0056 e
// 0064 — exceção documentada ao isolamento por organização, só service_role):
// fatos sobre empresas e pessoas, não decisões comerciais. Evita consultar o
// mesmo CNPJ/domínio/pessoa de novo dentro da validade, inclusive quando a
// fonte NÃO achou (cache negativo). Resultado "falha" expira rápido para não
// travar uma nova tentativa.

export type TipoCache = 'opencnpj' | 'site_dominio' | 'crustdata_pessoas' | 'anymail_email'
export type StatusCache = 'ok' | 'nao_encontrado' | 'falha'

const HORA = 3_600_000
const DIA = 24 * HORA
const FALHA = HORA / 6 // 10 min: falha passageira não trava nova tentativa por muito tempo

// Validade por fonte: positivo = quanto o dado vale; negativo = quando vale
// tentar de novo (retry). Pago dura mais: refazer custa crédito.
export const VALIDADE_MS: Record<TipoCache, Record<StatusCache, number>> = {
  opencnpj: { ok: 30 * DIA, nao_encontrado: 7 * DIA, falha: FALHA },
  site_dominio: { ok: 30 * DIA, nao_encontrado: 7 * DIA, falha: FALHA },
  crustdata_pessoas: { ok: 90 * DIA, nao_encontrado: 30 * DIA, falha: FALHA },
  anymail_email: { ok: 180 * DIA, nao_encontrado: 60 * DIA, falha: FALHA },
}

export interface EntradaCache<T> {
  status: StatusCache
  resultado: T
}

/** Entrada lida, com a data em que a fonte foi consultada. */
export interface EntradaCacheLida<T> extends EntradaCache<T> {
  consultadoEm: string
}

/** Auditoria de uma consulta (não decide nada): créditos e quem disparou. */
export interface OrigemConsulta {
  custo?: number | null
  organizacaoId?: string | null
}

export async function lerCache<T>(admin: SupabaseClient, tipo: TipoCache, chave: string, agora: number): Promise<EntradaCacheLida<T> | null> {
  const { data } = await admin
    .from('enriquecimento_cache')
    .select('status, resultado, consultado_em, expira_em')
    .eq('tipo', tipo)
    .eq('chave', chave)
    .maybeSingle()
  if (!data || new Date(String(data.expira_em)).getTime() <= agora) return null
  return { status: data.status as StatusCache, resultado: data.resultado as T, consultadoEm: String(data.consultado_em) }
}

export async function gravarCache<T>(
  admin: SupabaseClient,
  tipo: TipoCache,
  chave: string,
  entrada: EntradaCache<T>,
  agora: number,
  origem: OrigemConsulta = {},
): Promise<string | null> {
  // Devolve a mensagem de erro (null = gravou). A Central HubSpot ignora, como
  // sempre fez; o cache de inteligência registra no log.
  const { error } = await admin.from('enriquecimento_cache').upsert(
    {
      tipo,
      chave,
      status: entrada.status,
      resultado: entrada.resultado,
      consultado_em: new Date(agora).toISOString(),
      expira_em: new Date(agora + VALIDADE_MS[tipo][entrada.status]).toISOString(),
      // Só vai no upsert quando informado: a Central HubSpot (fonte pública,
      // sem custo) continua gravando exatamente as colunas de antes.
      ...(origem.custo !== undefined ? { custo: origem.custo } : {}),
      ...(origem.organizacaoId !== undefined ? { pago_por_organizacao: origem.organizacaoId } : {}),
    },
    { onConflict: 'tipo,chave' },
  )
  return error ? error.message : null
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
        if (hit) return { entrada: { status: hit.status, resultado: hit.resultado } as EntradaCache<unknown>, doCache: true }
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
