import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { gravarCache, lerCache, type EntradaCache, type EntradaCacheLida, type OrigemConsulta, type TipoCache } from '@/lib/integracoes/hubspot/enriquecimento/cache'
import { consultarOpenCnpj, type ResultadoOpenCnpj } from '@/lib/integracoes/hubspot/enriquecimento/opencnpj'
import { soLetras } from './emailNominal'
import type { AlvoPessoas, CandidatoDecisor, EmailDecisor, FalhaEnriquecimento } from './enriquecimento'
import type { Socio } from './socios'

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

/** Créditos estimados (auditoria): Crustdata cobra por pessoa devolvida; Anymail, por e-mail válido. */
export const CUSTO_PESSOA_CRUSTDATA = 0.13
export const CUSTO_EMAIL_VALIDO_ANYMAIL = 1

export interface ContextoInteligencia {
  admin: SupabaseClient
  /** Organização da sessão que disparou a consulta (auditoria de quem pagou). */
  organizacaoId: string
  agora?: () => number
}

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

type ResultadoPessoas = { ok: true; candidatos: CandidatoDecisor[] } | { ok: false; motivo: FalhaEnriquecimento }

export async function buscarPessoasComCache(
  ctx: ContextoInteligencia,
  alvo: AlvoPessoas,
  titulos: readonly string[],
  limite: number,
  buscar: () => Promise<ResultadoPessoas>,
): Promise<ResultadoPessoas> {
  const chave = chavePessoas(alvo, titulos, limite)
  const hit = await ler<CandidatoDecisor[]>(ctx, 'crustdata_pessoas', chave)
  if (hit?.status === 'ok') return { ok: true, candidatos: Array.isArray(hit.resultado) ? hit.resultado : [] }
  if (hit?.status === 'nao_encontrado') return { ok: true, candidatos: [] }
  if (hit?.status === 'falha') return { ok: false, motivo: 'indisponivel' }

  const r = await buscar()
  if (r.ok) {
    await gravar(ctx, 'crustdata_pessoas', chave,
      { status: r.candidatos.length ? 'ok' : 'nao_encontrado', resultado: r.candidatos },
      Number((r.candidatos.length * CUSTO_PESSOA_CRUSTDATA).toFixed(4)))
  } else if (r.motivo === 'indisponivel') {
    await gravar(ctx, 'crustdata_pessoas', chave, { status: 'falha', resultado: [] }, 0)
  }
  return r
}

// ---------------------------------------------------------------------------
// Anymail Finder (pago por e-mail válido; "não encontrado" não cobra)
// ---------------------------------------------------------------------------

type ResultadoEmail = { ok: true; resultado: EmailDecisor } | { ok: false; motivo: FalhaEnriquecimento }

export async function buscarEmailComCache(
  ctx: ContextoInteligencia,
  nome: string,
  dominio: string,
  buscar: () => Promise<ResultadoEmail>,
): Promise<ResultadoEmail> {
  const chave = chaveEmail(nome, dominio)
  const hit = await ler<EmailDecisor>(ctx, 'anymail_email', chave)
  if (hit?.status === 'ok' && hit.resultado?.email) return { ok: true, resultado: hit.resultado }
  if (hit?.status === 'nao_encontrado') {
    return { ok: true, resultado: { nome, dominio, status: 'nao_encontrado', email: null, consultadoEm: hit.consultadoEm } }
  }
  if (hit?.status === 'falha') return { ok: false, motivo: 'indisponivel' }

  const r = await buscar()
  if (r.ok) {
    const achou = r.resultado.status !== 'nao_encontrado'
    // Estimativa: e-mail válido = 1 crédito; "arriscado" não tem custo conhecido.
    const custo = r.resultado.status === 'valido' ? CUSTO_EMAIL_VALIDO_ANYMAIL : achou ? null : 0
    await gravar(ctx, 'anymail_email', chave, { status: achou ? 'ok' : 'nao_encontrado', resultado: r.resultado }, custo)
  } else if (r.motivo === 'indisponivel') {
    await gravar(ctx, 'anymail_email', chave, { status: 'falha', resultado: null }, 0)
  }
  return r
}
