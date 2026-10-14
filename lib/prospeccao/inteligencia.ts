import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { gravarCache, lerCache, type EntradaCache, type EntradaCacheLida, type OrigemConsulta, type TipoCache } from '@/lib/integracoes/hubspot/enriquecimento/cache'
import { consultarOpenCnpj, type ResultadoOpenCnpj } from '@/lib/integracoes/hubspot/enriquecimento/opencnpj'
import { soLetras } from './emailNominal'
import type { AlvoPessoas, CandidatoDecisor, EmailDecisor, FalhaEnriquecimento } from './enriquecimento'
import type { Socio } from './socios'
import { autorizarGasto, registrarConsumo, type ContextoCusto, type TravasCusto } from './travasCusto'

// Inteligência da Prospecção: tudo que a plataforma já consultou sobre uma
// empresa ou pessoa fica no cache GLOBAL (enriquecimento_cache, 0056/0064) e
// é consultado ANTES de qualquer API — inclusive o "não achou" (cache
// negativo), que só volta a ser tentado depois da validade. O mesmo fato pago
// por uma organização vale para as outras: as chaves das APIs são da
// plataforma. O que é de cada organização (decisor escolhido, descarte,
// importação) continua em prospeccao_decisores / _internacionais.
//
// Nunca viram cache (não são fatos sobre a empresa): chave ausente, conta sem
// crédito e limite de requisições. Instabilidade ("indisponivel") vira falha
// de 10 min. Cache fora do ar não bloqueia: a consulta segue como antes.
//
// Fontes PAGAS: cache válido responde primeiro e NÃO passa pelas travas nem
// gera custo (consumo registrado com origem 'cache' e custo 0). Só na falta do
// cache entram as travas da organização (liga/desliga + orçamento, ver
// travasCusto.ts) e, autorizada, a chamada — registrada com o custo real.

/** Créditos estimados: Crustdata cobra por pessoa devolvida; Anymail, por e-mail achado. */
export const CUSTO_PESSOA_CRUSTDATA = 0.13
export const CUSTO_EMAIL_VALIDO_ANYMAIL = 1

export interface ContextoInteligencia {
  admin: SupabaseClient
  /** Organização da sessão que disparou a consulta (auditoria de quem pagou). */
  organizacaoId: string
  agora?: () => number
}

/** Contexto das fontes pagas: travas da organização e quem disparou. */
export interface ContextoPago extends ContextoInteligencia {
  travas: TravasCusto
  usuarioId?: string | null
}

const custoDe = (ctx: ContextoPago): ContextoCusto => ({ admin: ctx.admin, organizacaoId: ctx.organizacaoId, travas: ctx.travas, usuarioId: ctx.usuarioId, agora: ctx.agora })

const agoraDe = (ctx: ContextoInteligencia) => (ctx.agora ?? Date.now)()

async function ler<T>(ctx: ContextoInteligencia, tipo: TipoCache, chave: string): Promise<EntradaCacheLida<T> | null> {
  try {
    return await lerCache<T>(ctx.admin, tipo, chave, agoraDe(ctx))
  } catch (e) {
    console.error('[prospeccao/inteligencia] cache indisponível na leitura:', tipo, e instanceof Error ? e.message : e)
    return null
  }
}

async function gravar<T>(ctx: ContextoInteligencia, tipo: TipoCache, chave: string, entrada: EntradaCache<T>, custo: number | null): Promise<void> {
  const origem: OrigemConsulta = { custo, organizacaoId: ctx.organizacaoId }
  try {
    const erro = await gravarCache(ctx.admin, tipo, chave, entrada, agoraDe(ctx), origem)
    if (erro) console.error('[prospeccao/inteligencia] cache não gravou:', tipo, erro)
  } catch (e) {
    console.error('[prospeccao/inteligencia] cache indisponível na gravação:', tipo, e instanceof Error ? e.message : e)
  }
}

// ---------------------------------------------------------------------------
// Chaves (estáveis: a mesma pergunta cai na mesma linha)
// ---------------------------------------------------------------------------

/** E-mail de uma pessoa num domínio: domínio + nome sem acento/espaço/pontuação. */
export function chaveEmail(nome: string, dominio: string): string {
  return `${dominio.trim().toLowerCase()}#${soLetras(nome)}`
}

/** Pessoas de uma empresa: onde procurar + cargos pedidos (sem ordem) + quantas. */
export function chavePessoas(alvo: AlvoPessoas, titulos: readonly string[], limite: number): string {
  const onde = typeof alvo === 'string'
    ? `dominio:${alvo.trim().toLowerCase()}`
    : `empresa:${soLetras(alvo.nomeEmpresa)}|${(alvo.dominioEmpresa ?? '').trim().toLowerCase()}`
  const cargos = [...new Set(titulos.map((t) => t.trim().toLowerCase()).filter(Boolean))].sort().join(',')
  return `${onde}#${cargos}#${limite}`
}

// ---------------------------------------------------------------------------
// OpenCNPJ (grátis): cadastro + sócios numa só consulta, compartilhada com a
// Central HubSpot (mesmo tipo 'opencnpj').
// ---------------------------------------------------------------------------

export async function consultarOpenCnpjComCache(
  ctx: ContextoInteligencia,
  cnpj: string,
  opcoes: { precisaSocios?: boolean; fetch?: typeof fetch } = {},
): Promise<ResultadoOpenCnpj> {
  if (!/^\d{14}$/.test(cnpj)) return { status: 'nao_encontrado' }
  const hit = await ler<Extract<ResultadoOpenCnpj, { status: 'ok' }>['dados'] | null>(ctx, 'opencnpj', cnpj)
  if (hit?.status === 'nao_encontrado') return { status: 'nao_encontrado' }
  if (hit?.status === 'falha') return { status: 'falha', motivo: 'falha recente (cache)' }
  // Entrada antiga (sem sócios) não serve a quem precisa dos sócios: consulta de novo.
  if (hit?.status === 'ok' && hit.resultado && (!opcoes.precisaSocios || Array.isArray(hit.resultado.socios))) {
    return { status: 'ok', dados: hit.resultado }
  }
  const r = await consultarOpenCnpj(cnpj, opcoes.fetch)
  await gravar(ctx, 'opencnpj', cnpj, r.status === 'ok' ? { status: 'ok', resultado: r.dados } : { status: r.status, resultado: null }, 0)
  return r
}

export async function consultarSociosComCache(
  ctx: ContextoInteligencia,
  cnpj: string,
  fetcher?: typeof fetch,
): Promise<{ ok: true; socios: Socio[] } | { ok: false; motivo: 'nao_encontrado' | 'indisponivel' }> {
  const r = await consultarOpenCnpjComCache(ctx, cnpj, { precisaSocios: true, fetch: fetcher })
  if (r.status === 'ok') return { ok: true, socios: r.dados.socios ?? [] }
  return { ok: false, motivo: r.status === 'nao_encontrado' ? 'nao_encontrado' : 'indisponivel' }
}

// ---------------------------------------------------------------------------
// Crustdata People Search (pago por pessoa devolvida)
// ---------------------------------------------------------------------------

type FalhaPaga = { ok: false; motivo: FalhaEnriquecimento; detalhe?: string }
type ResultadoPessoas = { ok: true; candidatos: CandidatoDecisor[] } | FalhaPaga

export async function buscarPessoasComCache(
  ctx: ContextoPago,
  alvo: AlvoPessoas,
  titulos: readonly string[],
  limite: number,
  buscar: () => Promise<ResultadoPessoas>,
): Promise<ResultadoPessoas> {
  const chave = chavePessoas(alvo, titulos, limite)
  const referencia = typeof alvo === 'string' ? alvo : alvo.dominioEmpresa ?? alvo.nomeEmpresa
  const consumo = { fonte: 'crustdata' as const, operacao: 'pessoas' as const, chave, referencia }

  const hit = await ler<CandidatoDecisor[]>(ctx, 'crustdata_pessoas', chave)
  if (hit) {
    await registrarConsumo(custoDe(ctx), { ...consumo, origem: 'cache', resultado: hit.status, custo: 0 })
    if (hit.status === 'ok') return { ok: true, candidatos: Array.isArray(hit.resultado) ? hit.resultado : [] }
    if (hit.status === 'nao_encontrado') return { ok: true, candidatos: [] }
    return { ok: false, motivo: 'indisponivel' }
  }

  const autorizacao = await autorizarGasto(custoDe(ctx), 'crustdata', limite * CUSTO_PESSOA_CRUSTDATA)
  if (!autorizacao.ok) return { ok: false, motivo: autorizacao.motivo, detalhe: autorizacao.detalhe }

  const r = await buscar()
  if (r.ok) {
    const custo = Number((r.candidatos.length * CUSTO_PESSOA_CRUSTDATA).toFixed(4))
    const status = r.candidatos.length ? 'ok' as const : 'nao_encontrado' as const
    await gravar(ctx, 'crustdata_pessoas', chave, { status, resultado: r.candidatos }, custo)
    await registrarConsumo(custoDe(ctx), { ...consumo, origem: 'api', resultado: status, custo })
  } else if (r.motivo === 'indisponivel') {
    await gravar(ctx, 'crustdata_pessoas', chave, { status: 'falha', resultado: [] }, 0)
    await registrarConsumo(custoDe(ctx), { ...consumo, origem: 'api', resultado: 'falha', custo: 0 })
  } else if (r.motivo !== 'sem_chave') {
    // Sem crédito / limite: a fonte foi chamada e recusou (sem custo, sem cache).
    await registrarConsumo(custoDe(ctx), { ...consumo, origem: 'api', resultado: 'falha', custo: 0 })
  }
  return r
}

// ---------------------------------------------------------------------------
// Anymail Finder (pago por e-mail achado; "não encontrado" não cobra)
// ---------------------------------------------------------------------------

type ResultadoEmail = { ok: true; resultado: EmailDecisor } | FalhaPaga

/** E-mail válido = 1 crédito; "arriscado" conta 1 por segurança (estimativa); não achou = 0. */
export const custoEmail = (status: EmailDecisor['status']) => (status === 'nao_encontrado' ? 0 : CUSTO_EMAIL_VALIDO_ANYMAIL)

export async function buscarEmailComCache(
  ctx: ContextoPago,
  nome: string,
  dominio: string,
  buscar: () => Promise<ResultadoEmail>,
): Promise<ResultadoEmail> {
  const chave = chaveEmail(nome, dominio)
  const consumo = { fonte: 'anymail' as const, operacao: 'email' as const, chave, referencia: dominio, pessoa: nome }

  const hit = await ler<EmailDecisor>(ctx, 'anymail_email', chave)
  if (hit && !(hit.status === 'ok' && !hit.resultado?.email)) {
    await registrarConsumo(custoDe(ctx), { ...consumo, origem: 'cache', resultado: hit.status, custo: 0 })
    if (hit.status === 'ok') return { ok: true, resultado: hit.resultado }
    if (hit.status === 'nao_encontrado') {
      return { ok: true, resultado: { nome, dominio, status: 'nao_encontrado', email: null, consultadoEm: hit.consultadoEm } }
    }
    return { ok: false, motivo: 'indisponivel' }
  }

  const autorizacao = await autorizarGasto(custoDe(ctx), 'anymail', CUSTO_EMAIL_VALIDO_ANYMAIL)
  if (!autorizacao.ok) return { ok: false, motivo: autorizacao.motivo, detalhe: autorizacao.detalhe }

  const r = await buscar()
  if (r.ok) {
    const achou = r.resultado.status !== 'nao_encontrado'
    const custo = custoEmail(r.resultado.status)
    await gravar(ctx, 'anymail_email', chave, { status: achou ? 'ok' : 'nao_encontrado', resultado: r.resultado }, custo)
    await registrarConsumo(custoDe(ctx), { ...consumo, origem: 'api', resultado: achou ? 'ok' : 'nao_encontrado', custo })
  } else if (r.motivo === 'indisponivel') {
    await gravar(ctx, 'anymail_email', chave, { status: 'falha', resultado: null }, 0)
    await registrarConsumo(custoDe(ctx), { ...consumo, origem: 'api', resultado: 'falha', custo: 0 })
  } else if (r.motivo !== 'sem_chave') {
    await registrarConsumo(custoDe(ctx), { ...consumo, origem: 'api', resultado: 'falha', custo: 0 })
  }
  return r
}
