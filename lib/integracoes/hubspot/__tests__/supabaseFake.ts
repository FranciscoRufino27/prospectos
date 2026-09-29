// Client Supabase falso para os testes da integração HubSpot: registra filtros
// (.eq/.in/.not) e payloads por tabela; o resultado vem de `dados(tabela, chain)`.
import type { SupabaseClient } from '@supabase/supabase-js'

export class Chain {
  eqCalls: [string, unknown][] = []
  inCalls: [string, unknown[]][] = []
  payload: unknown = null
  mode: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select'
  upsertOpts: unknown = null
  constructor(public table: string, private dados: (t: string, c: Chain) => { data?: unknown; error?: { message: string } | null }) {}
  select() { return this }
  insert(p: unknown) { this.mode = 'insert'; this.payload = p; return this }
  upsert(p: unknown, o?: unknown) { this.mode = 'upsert'; this.payload = p; this.upsertOpts = o; return this }
  update(p: unknown) { this.mode = 'update'; this.payload = p; return this }
  delete() { this.mode = 'delete'; return this }
  eq(c: string, v: unknown) { this.eqCalls.push([c, v]); return this }
  in(c: string, v: unknown[]) { this.inCalls.push([c, v]); return this }
  not() { return this }
  order() { return this }
  limit() { return this }
  maybeSingle() { return this }
  single() { return this }
  temEq(col: string, val: unknown) { return this.eqCalls.some(([c, v]) => c === col && v === val) }
  then(resolve: (v: unknown) => void) {
    const r = this.dados(this.table, this)
    resolve({ data: r.data ?? null, error: r.error ?? null })
  }
}

export function supabaseFake(dados: (t: string, c: Chain) => { data?: unknown; error?: { message: string } | null } = () => ({})) {
  const chains: Chain[] = []
  const client = {
    from(table: string) { const c = new Chain(table, dados); chains.push(c); return c },
  } as unknown as SupabaseClient
  return { client, chains }
}

// Toda chamada que filtra organizacao_id usa só `org`; todo payload com
// organizacao_id carrega só `org`.
export function tocouSoOrg(chains: Chain[], org: string): boolean {
  for (const c of chains) {
    for (const [col, val] of c.eqCalls) if (col === 'organizacao_id' && val !== org) return false
    const linhas = Array.isArray(c.payload) ? c.payload : c.payload ? [c.payload] : []
    for (const l of linhas as Record<string, unknown>[]) {
      if ('organizacao_id' in l && l.organizacao_id !== org) return false
    }
  }
  return true
}
