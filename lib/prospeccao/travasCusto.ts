import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { parseWorkspaceConfig, type EnriquecimentoPagoConfig, type FontePaga } from '@/lib/config/workspaceConfig'

// Travas de custo do enriquecimento pago da Prospecção (Crustdata, Anymail).
// Antes de CADA chamada paga: liga/desliga da organização e orçamento mensal
// da fonte (soma do que já foi gasto via API no mês, em créditos, + o custo
// máximo desta chamada). Toda consulta — da API ou do cache de inteligência —
// vira uma linha em prospeccao_consumo (migration 0065); só as da API somam no
// orçamento. Sem configuração, o enriquecimento pago fica DESLIGADO.
//
// Falha ao conferir o gasto BLOQUEIA (não gasta sem conseguir contar).
// Chamadas simultâneas podem passar juntas do limite por no máximo o custo
// delas: a busca roda poucas em paralelo e cada uma custa até ~1 crédito.

export type OperacaoPaga = 'pessoas' | 'email' | 'empresas_busca'
export type BloqueioCusto = 'pago_desligado' | 'orcamento_esgotado'

export interface TravasCusto {
  ativo: boolean
  orcamentoMensal: Partial<Record<FontePaga, number>>
}

export const TRAVAS_DESLIGADAS: TravasCusto = { ativo: false, orcamentoMensal: {} }

export function travasDaConfig(cfg: EnriquecimentoPagoConfig | undefined): TravasCusto {
  return { ativo: cfg?.ativo === true, orcamentoMensal: { ...(cfg?.orcamentoMensal ?? {}) } }
}

/** Travas da organização da sessão; erro de leitura = desligado. */
export async function carregarTravas(admin: SupabaseClient, organizacaoId: string): Promise<TravasCusto> {
  const { data, error } = await admin.from('organizacoes').select('configuracoes').eq('id', organizacaoId).maybeSingle()
  if (error) {
    console.error('[prospeccao/travas] não leu a configuração; enriquecimento pago bloqueado:', error.message)
    return TRAVAS_DESLIGADAS
  }
  return travasDaConfig(parseWorkspaceConfig(data?.configuracoes).enriquecimentoPago)
}

/** Início do mês corrente no horário de Brasília (UTC−3, sem horário de verão). */
export function inicioDoMesBrasilia(agora: number): Date {
  const local = new Date(agora - 3 * 3_600_000)
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1, 3, 0, 0))
}

export interface ContextoCusto {
  admin: SupabaseClient
  organizacaoId: string
  travas: TravasCusto
  usuarioId?: string | null
  agora?: () => number
}

const ROTULO_FONTE: Record<FontePaga, string> = { crustdata: 'Crustdata', anymail: 'Anymail' }
const creditos = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })

export type Autorizacao = { ok: true } | { ok: false; motivo: BloqueioCusto; detalhe: string }

/** Pode gastar até `custoMaximo` créditos de `fonte` agora? */
export async function autorizarGasto(ctx: ContextoCusto, fonte: FontePaga, custoMaximo: number): Promise<Autorizacao> {
  if (!ctx.travas.ativo) {
    return { ok: false, motivo: 'pago_desligado', detalhe: 'enriquecimento pago desligado para esta organização' }
  }
  const orcamento = ctx.travas.orcamentoMensal[fonte]
  if (orcamento === undefined || orcamento <= 0) {
    return { ok: false, motivo: 'orcamento_esgotado', detalhe: `sem orçamento mensal definido para ${ROTULO_FONTE[fonte]}` }
  }
  const desde = inicioDoMesBrasilia((ctx.agora ?? Date.now)())
  let gasto: number | null = null
  try {
    const { data, error } = await ctx.admin.rpc('prospeccao_consumo_mes', { p_org: ctx.organizacaoId, p_fonte: fonte, p_desde: desde.toISOString() })
    if (error) console.error('[prospeccao/travas] não conferiu o gasto do mês; bloqueado:', error.message)
    else if (data !== null && data !== undefined && Number.isFinite(Number(data))) gasto = Number(data)
  } catch (e) {
    console.error('[prospeccao/travas] não conferiu o gasto do mês; bloqueado:', e instanceof Error ? e.message : e)
  }
  if (gasto === null) {
    return { ok: false, motivo: 'orcamento_esgotado', detalhe: `não foi possível conferir o gasto do mês de ${ROTULO_FONTE[fonte]}` }
  }
  if (gasto + custoMaximo > orcamento + 1e-9) {
    return {
      ok: false,
      motivo: 'orcamento_esgotado',
      detalhe: `orçamento mensal de ${ROTULO_FONTE[fonte]} esgotado: ${creditos(gasto)} de ${creditos(orcamento)} créditos usados`,
    }
  }
  return { ok: true }
}

export interface LinhaConsumo {
  fonte: FontePaga
  operacao: OperacaoPaga
  origem: 'api' | 'cache'
  resultado: 'ok' | 'nao_encontrado' | 'falha'
  custo: number
  chave?: string | null
  referencia?: string | null
  pessoa?: string | null
}

/** Grava o consumo. Erro só vai para o log: a consulta já aconteceu. */
export async function registrarConsumo(ctx: ContextoCusto, linha: LinhaConsumo): Promise<void> {
  try {
    const { error } = await ctx.admin.from('prospeccao_consumo').insert({
      organizacao_id: ctx.organizacaoId,
      fonte: linha.fonte,
      operacao: linha.operacao,
      origem: linha.origem,
      resultado: linha.resultado,
      custo: Number(linha.custo.toFixed(4)),
      chave: linha.chave?.slice(0, 500) ?? null,
      referencia: linha.referencia?.slice(0, 253) ?? null,
      pessoa: linha.pessoa?.slice(0, 120) ?? null,
      usuario_id: ctx.usuarioId ?? null,
    })
    if (error) console.error('[prospeccao/travas] consumo não registrado:', error.message)
  } catch (e) {
    console.error('[prospeccao/travas] consumo não registrado:', e instanceof Error ? e.message : e)
  }
}
