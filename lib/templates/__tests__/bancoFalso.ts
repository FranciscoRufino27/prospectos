// Banco Supabase FALSO, em memória, para testes de isolamento multi-tenant.
// Diferente de um mock que só registra `.eq()`, este APLICA os filtros: um
// teste consegue provar que a linha de outra organização não foi lida nem
// alterada. Emula também as travas do banco que importam aqui:
//   - insert sem organizacao_id falha (NOT NULL da 0006);
//   - update que troca organizacao_id falha (trigger da 0046);
//   - update/delete sem filtro falha (escrita global nunca é aceitável).
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

export type Linha = Record<string, unknown>

type OperadorFiltro = 'eq' | 'neq' | 'is' | 'not_is' | 'in' | 'ilike'
export interface Filtro {
  op: OperadorFiltro
  coluna: string
  valor: unknown
}

export interface OperacaoRegistrada {
  tabela: string
  tipo: 'select' | 'insert' | 'update' | 'delete' | 'upsert'
  filtros: Filtro[]
  payload?: unknown
}

interface ErroFalso {
  message: string
  code?: string
}

interface Resultado {
  data: unknown
  error: ErroFalso | null
  count?: number | null
}

// Tabelas globais por desenho (sem organizacao_id): o cache de inteligência
// (enriquecimento_cache, 0056/0064) guarda fatos, não dados de uma org.
const TABELAS_SEM_ORGANIZACAO = new Set(['organizacoes', 'enriquecimento_cache'])

export class BancoFalso {
  private readonly tabelas = new Map<string, Linha[]>()
  readonly operacoes: OperacaoRegistrada[] = []

  constructor(inicial: Record<string, Linha[]> = {}) {
    for (const [tabela, linhas] of Object.entries(inicial)) {
      this.tabelas.set(tabela, linhas.map((linha) => ({ ...linha })))
    }
  }

  linhas(tabela: string): Linha[] {
    if (!this.tabelas.has(tabela)) this.tabelas.set(tabela, [])
    return this.tabelas.get(tabela)!
  }

  copia(tabela: string): Linha[] {
    return JSON.parse(JSON.stringify(this.linhas(tabela))) as Linha[]
  }

  escritas(tabela?: string): OperacaoRegistrada[] {
    return this.operacoes.filter((op) => op.tipo !== 'select' && (!tabela || op.tabela === tabela))
  }

  /** Funções do banco simuladas; outras devolvem erro (como função inexistente). */
  falharRpc = false

  cliente(): SupabaseClient {
    return {
      from: (tabela: string) => new ConsultaFalsa(this, tabela),
      rpc: async (nome: string, args: Record<string, unknown>) => {
        if (!this.falharRpc && nome === 'prospeccao_consumo_mes') {
          // Mesma regra da migration 0065: soma do custo via API da org/fonte desde a data.
          const desde = new Date(String(args.p_desde)).getTime()
          const soma = this.linhas('prospeccao_consumo')
            .filter((l) => l.organizacao_id === args.p_org && l.fonte === args.p_fonte && l.origem === 'api'
              && new Date(String(l.criado_em ?? l.created_at)).getTime() >= desde)
            .reduce((t, l) => t + Number(l.custo ?? 0), 0)
          return { data: soma, error: null }
        }
        return { data: null, error: { message: `function ${nome} does not exist`, code: '42883' } }
      },
    } as unknown as SupabaseClient
  }
}

function casaIlike(valor: unknown, padrao: unknown): boolean {
  if (typeof valor !== 'string' || typeof padrao !== 'string') return false
  const regex = padrao
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/%/g, '.*')
    .replace(/_/g, '.')
  return new RegExp(`^${regex}$`, 'is').test(valor)
}

class ConsultaFalsa implements PromiseLike<Resultado> {
  private tipo: OperacaoRegistrada['tipo'] = 'select'
  private colunas: string | null = null
  private retornarLinhas = false
  private contar = false
  private somenteContagem = false
  private readonly filtros: Filtro[] = []
  private payload: unknown
  private modo: 'lista' | 'single' | 'maybe' = 'lista'
  private limite: number | null = null
  private readonly ordens: { coluna: string; asc: boolean }[] = []
  private conflito: string[] = []

  constructor(private readonly banco: BancoFalso, private readonly tabela: string) {}

  select(colunas = '*', opcoes?: { count?: string; head?: boolean }) {
    this.colunas = colunas
    if (this.tipo !== 'select') this.retornarLinhas = true
    this.contar = opcoes?.count === 'exact'
    this.somenteContagem = opcoes?.head === true
    return this
  }
  insert(payload: unknown) { this.tipo = 'insert'; this.payload = payload; return this }
  update(payload: unknown) { this.tipo = 'update'; this.payload = payload; return this }
  delete() { this.tipo = 'delete'; return this }
  /** ON CONFLICT (onConflict) DO UPDATE SET <só as colunas enviadas>, como o PostgREST. */
  upsert(payload: unknown, opcoes?: { onConflict?: string }) {
    this.tipo = 'upsert'
    this.payload = payload
    this.conflito = (opcoes?.onConflict ?? 'id').split(',').map((c) => c.trim()).filter(Boolean)
    return this
  }
  eq(coluna: string, valor: unknown) { this.filtros.push({ op: 'eq', coluna, valor }); return this }
  neq(coluna: string, valor: unknown) { this.filtros.push({ op: 'neq', coluna, valor }); return this }
  is(coluna: string, valor: unknown) { this.filtros.push({ op: 'is', coluna, valor }); return this }
  in(coluna: string, valor: unknown[]) { this.filtros.push({ op: 'in', coluna, valor }); return this }
  ilike(coluna: string, valor: string) { this.filtros.push({ op: 'ilike', coluna, valor }); return this }
  not(coluna: string, operador: string, valor: unknown) {
    if (operador !== 'is') throw new Error(`BancoFalso: not(${operador}) não suportado`)
    this.filtros.push({ op: 'not_is', coluna, valor })
    return this
  }
  order(coluna: string, opcoes?: { ascending?: boolean }) {
    this.ordens.push({ coluna, asc: opcoes?.ascending !== false })
    return this
  }
  limit(n: number) { this.limite = n; return this }
  single() { this.modo = 'single'; return this }
  maybeSingle() { this.modo = 'maybe'; return this }

  then<A = Resultado, B = never>(
    sucesso?: ((valor: Resultado) => A | PromiseLike<A>) | null,
    falha?: ((motivo: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve().then(() => this.executar()).then(sucesso, falha)
  }

  private casa(linha: Linha): boolean {
    return this.filtros.every(({ op, coluna, valor }) => {
      const atual = linha[coluna]
      switch (op) {
        case 'eq': return atual === valor
        case 'neq': return atual !== valor
        case 'is': return valor === null ? atual === null || atual === undefined : atual === valor
        case 'not_is': return valor === null ? atual !== null && atual !== undefined : atual !== valor
        case 'in': return Array.isArray(valor) && valor.includes(atual)
        case 'ilike': return casaIlike(atual, valor)
      }
    })
  }

  private projetar(linha: Linha): Linha {
    if (!this.colunas || this.colunas.trim() === '*') return { ...linha }
    const colunas = this.colunas.split(',').map((c) => c.trim()).filter(Boolean)
    return Object.fromEntries(colunas.map((c) => [c, linha[c] ?? null]))
  }

  private resposta(linhas: Linha[]): Resultado {
    const projetadas = linhas.map((linha) => this.projetar(linha))
    if (this.modo === 'lista') return { data: projetadas, error: null }
    if (projetadas.length > 1 || (this.modo === 'single' && projetadas.length === 0)) {
      return { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' } }
    }
    return { data: projetadas[0] ?? null, error: null }
  }

  private executar(): Resultado {
    this.banco.operacoes.push({
      tabela: this.tabela,
      tipo: this.tipo,
      filtros: [...this.filtros],
      payload: this.payload,
    })
    const tabela = this.banco.linhas(this.tabela)

    if (this.tipo === 'select') {
      let linhas = tabela.filter((linha) => this.casa(linha))
      for (const { coluna, asc } of [...this.ordens].reverse()) {
        linhas = [...linhas].sort((a, b) => {
          const x = String(a[coluna] ?? '')
          const y = String(b[coluna] ?? '')
          return asc ? x.localeCompare(y) : y.localeCompare(x)
        })
      }
      const total = linhas.length
      if (this.limite !== null) linhas = linhas.slice(0, this.limite)
      if (this.contar) {
        return { data: this.somenteContagem ? null : linhas.map((l) => this.projetar(l)), count: total, error: null }
      }
      return this.resposta(linhas)
    }

    if (this.tipo === 'insert') {
      const novas = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Linha[]
      if (!TABELAS_SEM_ORGANIZACAO.has(this.tabela) && novas.some((linha) => !linha.organizacao_id)) {
        return { data: null, error: { message: 'null value in column "organizacao_id"', code: '23502' } }
      }
      const agora = new Date().toISOString()
      const inseridas = novas.map((linha) => ({ id: randomUUID(), created_at: agora, ...linha }))
      tabela.push(...inseridas)
      return this.retornarLinhas ? this.resposta(inseridas) : { data: null, error: null }
    }

    if (this.tipo === 'upsert') {
      const novas = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Linha[]
      if (!TABELAS_SEM_ORGANIZACAO.has(this.tabela) && novas.some((linha) => !linha.organizacao_id)) {
        return { data: null, error: { message: 'null value in column "organizacao_id"', code: '23502' } }
      }
      const afetadas: Linha[] = []
      for (const nova of novas) {
        const existente = tabela.find((linha) => this.conflito.every((c) => linha[c] === nova[c]))
        if (existente) {
          Object.assign(existente, nova)
          afetadas.push(existente)
        } else {
          const inserida = { ...nova }
          tabela.push(inserida)
          afetadas.push(inserida)
        }
      }
      return this.retornarLinhas ? this.resposta(afetadas) : { data: null, error: null }
    }

    if (this.filtros.length === 0) {
      return { data: null, error: { message: `${this.tipo} sem filtro recusado pelo BancoFalso`, code: '21000' } }
    }

    if (this.tipo === 'update') {
      const patch = this.payload as Linha
      const alvo = tabela.filter((linha) => this.casa(linha))
      if ('organizacao_id' in patch && alvo.some((linha) => linha.organizacao_id !== patch.organizacao_id)) {
        return { data: null, error: { message: 'organizacao_id não pode ser alterado (templates).', code: '42501' } }
      }
      for (const linha of alvo) Object.assign(linha, patch)
      return this.retornarLinhas ? this.resposta(alvo) : { data: null, error: null }
    }

    const removidas = tabela.filter((linha) => this.casa(linha))
    this.banco.linhas(this.tabela).splice(0, tabela.length, ...tabela.filter((linha) => !this.casa(linha)))
    return this.retornarLinhas ? this.resposta(removidas) : { data: null, error: null }
  }
}
