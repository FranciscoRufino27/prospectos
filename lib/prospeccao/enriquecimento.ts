// Enriquecimento pago do decisor no passo "analisar" (docs/mapa-do-projeto.md
// §15d), sempre sob demanda e empresa por empresa:
//   1. Crustdata People Search acha pessoas com cargo de decisão que trabalham
//      hoje no domínio da empresa (0,13 crédito por pessoa devolvida: 0,03 base
//      + 0,10 do filtro por experiência atual);
//   2. Anymail Finder acha o e-mail do decisor escolhido (1 crédito só quando
//      devolve e-mail válido; não encontrado não cobra).
// Regra de custo: nunca chamar se o dado já existe (o servidor guarda o
// resultado em prospeccao_decisores.enriquecimento, migration 0060).

import type { CargoAlvoProspeccao } from '@/lib/config/workspaceConfig'
import { soLetras } from './emailNominal'

export const CRUSTDATA_PESSOAS_URL = 'https://api.crustdata.com/person/search'
export const ANYMAIL_PESSOA_URL = 'https://api.anymailfinder.com/v5.1/find-email/person'
const CRUSTDATA_VERSAO = '2025-11-01'
/** Pessoas por consulta: 5 × 0,13 = até 0,65 crédito. */
export const LIMITE_CANDIDATOS = 5
const TIMEOUT_CRUSTDATA_MS = 20000
// A Anymail verifica o e-mail no servidor de destino na hora: pode demorar.
const TIMEOUT_ANYMAIL_MS = 50000

export interface CandidatoDecisor {
  nome: string
  cargo: string
  linkedin: string | null
  local: string | null
  /**
   * Domínio do empregador atual, quando a pessoa foi achada pelo NOME da
   * empresa (pode ser outro cadastro dela, ex.: cba.com.br em vez de
   * cbaluminio.com.br). É nele que o e-mail é procurado.
   */
  dominio?: string | null
}

// Sufixo societário (BR e de fora) no fim do nome: "Companhia Brasileira de
// Alumínio S.A." precisa casar com o empregador "CBA | Companhia Brasileira
// de Alumínio" — o `(.)` da Crustdata exige TODAS as palavras.
const SUFIXO_EMPRESA = /(?:[\s,.-]+(?:ltda|me|epp|eireli|s\/a|s\.?a\.?|sa|cia|inc|llc|l\.?l\.?c|ltd|limited|gmbh|ag|s\.?l\.?|sl|sas|s\.?a\.?s\.?|lda|b\.?v\.?|bv|n\.?v\.?|nv|plc|corp|corporation|co|company)\.?)+\.?\s*$/i

/** Nome da empresa para buscar pessoas: sem sufixo societário nem pontuação solta. */
export function nomeParaBuscaDePessoas(nome: string): string {
  const limpo = nome.replace(SUFIXO_EMPRESA, '').replace(/[\s,.-]+$/, '').replace(/\s+/g, ' ').trim()
  return limpo || nome.trim()
}

/** Onde procurar as pessoas: no domínio da empresa ou pelo nome do empregador atual. */
export type AlvoPessoas = string | {
  nomeEmpresa: string
  /** Domínio do cadastro achado: empregador com o mesmo site é a empresa. */
  dominioEmpresa?: string
}

/**
 * O empregador atual (nome/site) é a empresa procurada pelo nome? Mesmo site,
 * mesmo nome, ou nome longo contido ("CBA | Companhia Brasileira de Alumínio"
 * contém "Companhia Brasileira de Alumínio"). Nome curto só por igualdade ou
 * site: "Barkley" não pode pegar funcionário da "Barkley Trading".
 */
export function empregadorConfere(
  empregador: { name?: unknown; company_website?: unknown },
  alvo: { nomeEmpresa: string; dominioEmpresa?: string },
): boolean {
  const site = dominioDoSite(empregador.company_website)
  if (site && alvo.dominioEmpresa && site === alvo.dominioEmpresa) return true
  if (typeof empregador.name !== 'string') return false
  const nome = soLetras(nomeParaBuscaDePessoas(empregador.name))
  const alvoLetras = soLetras(alvo.nomeEmpresa)
  if (!alvoLetras) return false
  return nome === alvoLetras || (alvoLetras.length >= 12 && soLetras(empregador.name).includes(alvoLetras))
}

export type StatusEmailDecisor = 'valido' | 'arriscado' | 'nao_encontrado'

export interface EmailDecisor {
  /** Nome consultado: o e-mail só vale enquanto o decisor for essa pessoa. */
  nome: string
  dominio: string
  status: StatusEmailDecisor
  email: string | null
  consultadoEm: string
}

export interface Enriquecimento {
  crustdata?: { dominio: string; candidatos: CandidatoDecisor[]; consultadoEm: string }
  anymail?: EmailDecisor
}

// Títulos que cada cargo-alvo do perfil procura (português e inglês: o
// LinkedIn mistura os dois). `(.)` da Crustdata casa a palavra em qualquer
// posição do título e tolera erro de digitação.
const TITULOS_DO_CARGO: Record<CargoAlvoProspeccao, string[]> = {
  proprietario: ['Proprietário', 'Owner', 'Dono'],
  socio: ['Sócio', 'Partner'],
  founder: ['Founder', 'Fundador', 'Cofundador'],
  diretor: ['CEO', 'Diretor', 'Director', 'Presidente', 'President', 'COO', 'CFO', 'CMO'],
  gerente: ['Gerente', 'Manager', 'Head'],
}
const TODOS_OS_CARGOS = Object.keys(TITULOS_DO_CARGO) as CargoAlvoProspeccao[]

/** Títulos procurados para os cargos-alvo do perfil (todos, se o perfil não define). */
export function titulosDeDecisao(cargos: readonly CargoAlvoProspeccao[] | undefined): string[] {
  const lista = cargos?.length ? cargos : TODOS_OS_CARGOS
  return [...new Set(lista.flatMap((c) => TITULOS_DO_CARGO[c] ?? []))]
}

const CAMPOS_PESSOA = [
  'experience.employment_details.current.name',
  'experience.employment_details.current.company_website',
  'crustdata_person_id',
  'basic_profile.name',
  'basic_profile.current_title',
  'basic_profile.location.raw',
  'social_handles.professional_network_identifier.profile_url',
]

export function corpoPessoasCrustdata(alvo: AlvoPessoas, titulos: string[], limite = LIMITE_CANDIDATOS): Record<string, unknown> {
  // Pelo nome, `(.)` exige todas as palavras ("Companhia Brasileira de
  // Alumínio" casa "CBA | Companhia Brasileira de Alumínio").
  const empresa = typeof alvo === 'string'
    ? { field: 'experience.employment_details.current.company_website_domain', type: '=', value: alvo }
    : { field: 'experience.employment_details.current.company_name', type: '(.)', value: alvo.nomeEmpresa }
  return {
    filters: {
      op: 'and',
      conditions: [
        empresa,
        // Sigla/palavra curta ("CEO", "Head", "Dono") com `(.)` casava qualquer
        // palavra parecida ("Terapeuta"); `[.]` exige a palavra exata.
        {
          op: 'or',
          conditions: titulos.map((t) => ({ field: 'experience.employment_details.current.title', type: t.length <= 4 ? '[.]' : '(.)', value: t })),
        },
      ],
    },
    fields: CAMPOS_PESSOA,
    limit: Math.min(Math.max(1, limite), LIMITE_CANDIDATOS),
  }
}

const texto = (v: unknown, max = 200): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

function linkedinValido(v: unknown): string | null {
  const t = texto(v, 400)
  if (!t) return null
  try {
    const u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`)
    return u.protocol === 'https:' && /(^|\.)linkedin\.com$/i.test(u.hostname) ? u.toString() : null
  } catch {
    return null
  }
}

/**
 * Perfil da Crustdata → candidato. Descarta o perfil "da própria empresa"
 * (gente que cadastra a marca como pessoa: "Inovacode ." de CEO).
 */
/** "http://www.cba.com.br/" → "cba.com.br"; null se não parecer domínio. */
export function dominioDoSite(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const d = v.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[/?#].*$/, '')
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d) ? d : null
}

export function mapearPessoa(bruto: unknown, alvo: AlvoPessoas): CandidatoDecisor | null {
  if (!bruto || typeof bruto !== 'object') return null
  const p = bruto as {
    basic_profile?: Record<string, unknown>
    social_handles?: { professional_network_identifier?: { profile_url?: unknown } }
    experience?: { employment_details?: { current?: { name?: unknown; company_website?: unknown }[] } }
  }
  const nome = texto(p.basic_profile?.name, 120)
  const cargo = texto(p.basic_profile?.current_title, 120)
  if (!nome || !cargo) return null
  if (typeof alvo === 'string' && soLetras(nome) === soLetras(alvo.split('.')[0])) return null
  // Pelo nome: o e-mail é procurado no site do empregador que casou com o nome.
  let dominio: string | null | undefined
  if (typeof alvo !== 'string') {
    const atuais = Array.isArray(p.experience?.employment_details?.current) ? p.experience!.employment_details!.current! : []
    // Só vale quem trabalha HOJE na empresa procurada (nome/site conferem).
    const casou = atuais.find((e) => empregadorConfere(e, alvo))
    dominio = dominioDoSite(casou?.company_website) ?? alvo.dominioEmpresa ?? null
    if (!casou || !dominio) return null
  }
  const local = p.basic_profile?.location && typeof p.basic_profile.location === 'object'
    ? texto((p.basic_profile.location as Record<string, unknown>).raw, 120)
    : null
  return {
    nome, cargo, linkedin: linkedinValido(p.social_handles?.professional_network_identifier?.profile_url), local,
    ...(dominio ? { dominio } : {}),
  }
}

// Nível do cargo para ordenar os candidatos: quem decide mais vem primeiro.
// Compara palavra inteira, sem acento ("coordenador" não conta como "coo").
const NIVEL_CARGO: Set<string>[] = [
  new Set(['ceo', 'presidente', 'president']),
  new Set(['founder', 'fundador', 'fundadora', 'cofundador', 'cofundadora', 'proprietario', 'proprietaria', 'owner', 'dono', 'dona', 'socio', 'socia', 'partner']),
  new Set(['diretor', 'diretora', 'director', 'coo', 'cfo', 'cmo', 'cto']),
  new Set(['head']),
  new Set(['gerente', 'manager']),
]

export function nivelDoCargo(cargo: string): number {
  const palavras = cargo.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z]+/)
  const i = NIVEL_CARGO.findIndex((nivel) => palavras.some((p) => nivel.has(p)))
  return i === -1 ? NIVEL_CARGO.length : i
}

// pago_desligado / orcamento_esgotado: travas de custo da organização
// (lib/prospeccao/travasCusto.ts) — a fonte nem é chamada.
export type FalhaEnriquecimento = 'sem_chave' | 'sem_credito' | 'limite' | 'indisponivel' | 'pago_desligado' | 'orcamento_esgotado'

export async function buscarDecisoresCrustdata(
  alvo: AlvoPessoas,
  titulos: string[],
  chave: string | undefined,
  fetcher: typeof fetch = fetch,
  /** Pessoas pedidas (cada uma devolvida custa 0,13). */
  limite = LIMITE_CANDIDATOS,
): Promise<{ ok: true; candidatos: CandidatoDecisor[] } | { ok: false; motivo: FalhaEnriquecimento }> {
  if (!chave) return { ok: false, motivo: 'sem_chave' }
  try {
    const res = await fetcher(CRUSTDATA_PESSOAS_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${chave}`, 'content-type': 'application/json', 'x-api-version': CRUSTDATA_VERSAO },
      body: JSON.stringify(corpoPessoasCrustdata(alvo, titulos, limite)),
      signal: AbortSignal.timeout(TIMEOUT_CRUSTDATA_MS),
    })
    if (res.status === 401) return { ok: false, motivo: 'sem_chave' }
    if (res.status === 402 || res.status === 403) return { ok: false, motivo: 'sem_credito' }
    if (res.status === 429) return { ok: false, motivo: 'limite' }
    if (!res.ok) return { ok: false, motivo: 'indisponivel' }
    const dados = (await res.json()) as { profiles?: unknown }
    const candidatos = (Array.isArray(dados.profiles) ? dados.profiles : [])
      .map((p) => mapearPessoa(p, alvo))
      .filter((c): c is CandidatoDecisor => c !== null)
      .sort((a, b) => nivelDoCargo(a.cargo) - nivelDoCargo(b.cargo))
    return { ok: true, candidatos }
  } catch {
    return { ok: false, motivo: 'indisponivel' }
  }
}

const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function buscarEmailAnymail(
  nome: string,
  dominio: string,
  chave: string | undefined,
  fetcher: typeof fetch = fetch,
  agora: Date = new Date(),
): Promise<{ ok: true; resultado: EmailDecisor } | { ok: false; motivo: FalhaEnriquecimento }> {
  if (!chave) return { ok: false, motivo: 'sem_chave' }
  try {
    const res = await fetcher(ANYMAIL_PESSOA_URL, {
      method: 'POST',
      headers: { Authorization: chave, 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: dominio, full_name: nome }),
      signal: AbortSignal.timeout(TIMEOUT_ANYMAIL_MS),
    })
    if (res.status === 401) return { ok: false, motivo: 'sem_chave' }
    if (res.status === 402) return { ok: false, motivo: 'sem_credito' }
    if (res.status === 429) return { ok: false, motivo: 'limite' }
    if (!res.ok) return { ok: false, motivo: 'indisponivel' }
    const dados = (await res.json()) as { email?: unknown; email_status?: unknown }
    const email = texto(dados.email, 254)?.toLowerCase() ?? null
    const status: StatusEmailDecisor =
      email && EMAIL_VALIDO.test(email) && dados.email_status === 'valid' ? 'valido'
      : email && EMAIL_VALIDO.test(email) && dados.email_status === 'risky' ? 'arriscado'
      : 'nao_encontrado'
    return {
      ok: true,
      resultado: { nome, dominio, status, email: status === 'nao_encontrado' ? null : email, consultadoEm: agora.toISOString() },
    }
  } catch {
    return { ok: false, motivo: 'indisponivel' }
  }
}

/** jsonb salvo → formato da tela; ignora o que não tiver a forma esperada. */
export function lerEnriquecimento(bruto: unknown): Enriquecimento | null {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return null
  const b = bruto as Record<string, unknown>
  const saida: Enriquecimento = {}
  const c = b.crustdata as Record<string, unknown> | undefined
  if (c && typeof c.dominio === 'string' && Array.isArray(c.candidatos) && typeof c.consultadoEm === 'string') {
    saida.crustdata = {
      dominio: c.dominio,
      consultadoEm: c.consultadoEm,
      candidatos: c.candidatos.filter((x): x is CandidatoDecisor => !!x && typeof x === 'object' && typeof (x as CandidatoDecisor).nome === 'string'),
    }
  }
  const a = b.anymail as Record<string, unknown> | undefined
  if (a && typeof a.nome === 'string' && typeof a.dominio === 'string' && typeof a.consultadoEm === 'string'
    && (a.status === 'valido' || a.status === 'arriscado' || a.status === 'nao_encontrado')) {
    saida.anymail = {
      nome: a.nome, dominio: a.dominio, status: a.status, consultadoEm: a.consultadoEm,
      email: typeof a.email === 'string' ? a.email : null,
    }
  }
  return saida.crustdata || saida.anymail ? saida : null
}

/** E-mail do decisor que vale para a importação: só válido e da mesma pessoa. */
export function emailDoDecisor(enr: Enriquecimento | null | undefined, nomeDecisor: string | null | undefined): string | null {
  const a = enr?.anymail
  if (!a || a.status !== 'valido' || !a.email || !nomeDecisor) return null
  return soLetras(a.nome) === soLetras(nomeDecisor) ? a.email : null
}

export const MENSAGEM_FALHA_ENRIQUECIMENTO: Record<FalhaEnriquecimento, { texto: string; status: number }> = {
  sem_chave: { texto: 'Integração não configurada (chave ausente ou inválida).', status: 503 },
  sem_credito: { texto: 'A conta está sem crédito para esta consulta.', status: 402 },
  limite: { texto: 'Muitas consultas seguidas. Aguarde um minuto e tente de novo.', status: 429 },
  indisponivel: { texto: 'Serviço indisponível no momento. Tente de novo.', status: 502 },
  // 503 e 402 fazem a busca automática parar (a tela trata como falha fatal).
  pago_desligado: { texto: 'Enriquecimento pago desligado para esta organização.', status: 503 },
  orcamento_esgotado: { texto: 'Orçamento do enriquecimento pago esgotado.', status: 402 },
}
