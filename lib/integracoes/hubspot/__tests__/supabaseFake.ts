// Client Supabase falso para os testes da integração HubSpot: registra filtros
// (.eq/.in/.not/.lt/.ilike), ordenação, paginação e payloads por tabela; o
// resultado vem de `dados(tabela, chain)`.
import type { SupabaseClient } from '@supabase/supabase-js'

type Resultado = { data?: unknown; error?: { message: string } | null; count?: number | null }

export class Chain {
  eqCalls: [string, unknown][] = []
  inCalls: [string, unknown[]][] = []
  notCalls: [string, string, unknown][] = []
  ltCalls: [string, unknown][] = []
  ilikeCalls: [string, string][] = []
  orderCalls: [string, unknown][] = []
  rangeCall: [number, number] | null = null
  selectOpts: unknown = null
  payload: unknown = null
  mode: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select'
  upsertOpts: unknown = null
  constructor(public table: string, private dados: (t: string, c: Chain) => Resultado) {}
  select(_cols?: unknown, opts?: unknown) { if (opts) this.selectOpts = opts; return this }
  insert(p: unknown) { this.mode = 'insert'; this.payload = p; return this }
  upsert(p: unknown, o?: unknown) { this.mode = 'upsert'; this.payload = p; this.upsertOpts = o; return this }
  update(p: unknown) { this.mode = 'update'; this.payload = p; return this }
  delete() { this.mode = 'delete'; return this }
  eq(c: string, v: unknown) { this.eqCalls.push([c, v]); return this }
  in(c: string, v: unknown[]) { this.inCalls.push([c, v]); return this }
  not(c: string, op: string, v: unknown) { this.notCalls.push([c, op, v]); return this }
  lt(c: string, v: unknown) { this.ltCalls.push([c, v]); return this }
  ilike(c: string, v: string) { this.ilikeCalls.push([c, v]); return this }
  order(c: string, o?: unknown) { this.orderCalls.push([c, o]); return this }
  range(a: number, b: number) { this.rangeCall = [a, b]; return this }
  limit() { return this }
  maybeSingle() { return this }
  single() { return this }
  temEq(col: string, val: unknown) { return this.eqCalls.some(([c, v]) => c === col && v === val) }
  then(resolve: (v: unknown) => void) {
    const r = this.dados(this.table, this)
    resolve({ data: r.data ?? null, error: r.error ?? null, count: r.count ?? null })
  }
}

export function supabaseFake(dados: (t: string, c: Chain) => Resultado = () => ({})) {
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
