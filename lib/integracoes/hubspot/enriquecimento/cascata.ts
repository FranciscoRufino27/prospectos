import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { nichoDaAtividade } from '@/lib/prospeccao/nichos'
import { buscarHubspot } from '../client'
import { getValidHubSpotAccessToken } from '../tokens'
import { comCache as comCacheMemoria, lerAssociacoes, lerObjetosPorIds } from '../leituraLote'
import {
  cnpjNoNome,
  diagnosticarCadastro,
  dominioCombinaComNome,
  dominioDeEmail,
  dominiosCorporativos,
  ehProvedorGenerico,
  estadoDocumento,
  formatarCnpj,
  normalizarDominio,
  semelhancaNome,
  soDigitos,
  type CadastroAtual,
} from './cadastro'
import { consultarOpenCnpj, type DadosCnpj } from './opencnpj'
import { cnpjsNoSite, type DepsSite } from './siteCnpj'
import { criarConsultaComCache, type EntradaCache } from './cache'

// Enriquecimento em PREVIEW (microentrega 1). Cascata, sem inferir empresa
// pelo nome da pessoa:
//   A. CNPJ válido no HubSpot (propriedade de CNPJ ou dentro do nome) → OpenCNPJ
//   B. domínio da empresa → CNPJ publicado no site → OpenCNPJ
//   C. domínio do e-mail corporativo de um contato → idem B
//   D. sem evidência → nao_resolvida
// Confiança: alta = CNPJ confirmado + evidência independente (e-mail da
// Receita no mesmo domínio, nome parecido, ou site confirma o CNPJ do HubSpot);
// media = uma única evidência; baixa = ambíguo. NADA é gravado no HubSpot:
// o resultado vai só para hubspot_enriquecimentos (preview da organização).

export const LIMITE_EMPRESAS_ENRIQUECIMENTO = 20
const PAUSA_OPENCNPJ_MS = 150
const CONCORRENCIA = 4
const PRAZO_TOTAL_MS = 45_000
const MAX_DOMINIOS_POR_EMPRESA = 3
const MAX_CNPJS_POR_SITE = 3
const SEMELHANCA_FORTE = 0.5

export type Fonte = 'hubspot_cnpj' | 'hubspot_nome' | 'site_dominio_empresa' | 'site_email_contato'
export type StatusEnriquecimento = 'resolvida' | 'ambigua' | 'nao_resolvida' | 'erro_fonte'
export type Confianca = 'alta' | 'media' | 'baixa'

export interface ResultadoEnriquecimento {
  hubspot_company_id: string
  nome_hubspot: string | null
  cadastro_atual: CadastroAtual
  empresa_identificada: string | null
  razao_social: string | null
  nome_fantasia: string | null
  cnpj: string | null
  situacao_cadastral: string | null
  dominio: string | null
  cnae_principal: string | null
  atividade_principal: string | null
  nicho_sugerido: string | null
  fonte: Fonte | null
  confianca: Confianca | null
  status_enriquecimento: StatusEnriquecimento
  evidencias: string[]
}

export type ResultadoLote =
  | { ok: true; itens: ResultadoEnriquecimento[]; naoEncontradas: string[]; propriedadesCnpj: string[] }
  | { ok: false; motivo: 'selecao_vazia' | 'selecao_excede_limite' | 'id_invalido' | 'nao_conectado' | 'inativo' | 'app_nao_configurado' | 'erro_refresh' | 'erro_hubspot' | 'erro_banco'; mensagem?: string }

export function validarIds(ids: unknown): { ok: true; ids: string[] } | { ok: false; motivo: 'selecao_vazia' | 'selecao_excede_limite' | 'id_invalido' } {
  if (!Array.isArray(ids) || ids.length === 0) return { ok: false, motivo: 'selecao_vazia' }
  if (ids.some((id) => typeof id !== 'string' || !/^\d{1,20}$/.test(id))) return { ok: false, motivo: 'id_invalido' }
  const unicos = [...new Set(ids as string[])]
  if (unicos.length > LIMITE_EMPRESAS_ENRIQUECIMENTO) return { ok: false, motivo: 'selecao_excede_limite' }
  return { ok: true, ids: unicos }
}

// Propriedades de company que guardam CNPJ nesta conta HubSpot (por rótulo
// ou nome contendo "cnpj", mais a nativa hs_tax_id). Descoberta por
// organização — o nome interno varia de conta para conta.
export async function propriedadesCnpj(accessToken: string, doFetch?: typeof fetch): Promise<string[] | null> {
  const r = await buscarHubspot<{ results?: Array<{ name: string; label?: string }> }>('/crm/v3/properties/companies', accessToken, {}, doFetch)
  if (!r.ok) return null
  const achadas = (r.dados.results ?? []).filter((p) => /\bcnpj\b/i.test(`${p.name} ${p.label ?? ''}`)).map((p) => p.name)
  return [...new Set([...achadas, 'hs_tax_id'])]
}

// Sinal independente de que o CNPJ é desta empresa.
export function sinalForte(d: DadosCnpj, nomeHubspot: string | null, dominios: readonly string[]): string | null {
  const dominioReceita = dominioDeEmail(d.email)
  if (dominioReceita && !ehProvedorGenerico(dominioReceita) && dominios.includes(dominioReceita)) return `e-mail na Receita é do domínio ${dominioReceita}`
  const sim = Math.max(semelhancaNome(nomeHubspot, d.razao_social), semelhancaNome(nomeHubspot, d.nome_fantasia))
  if (sim >= SEMELHANCA_FORTE) return 'nome no HubSpot corresponde à razão social/fantasia'
  const dom = dominios.find((x) => dominioCombinaComNome(x, d.razao_social, d.nome_fantasia))
  if (dom) return `domínio ${dom} corresponde ao nome na Receita`
  return null
}

interface Candidato { dados: DadosCnpj; dominio: string; fonte: Fonte; sinal: string | null }
type PorDominio =
  | { tipo: 'unico'; c: Candidato }
  | { tipo: 'ambiguo'; candidatos: Candidato[]; dominio: string }
  | { tipo: 'nada'; falhou: boolean }

export interface DepsEnriquecimento {
  admin?: SupabaseClient
  fetch?: typeof fetch
  site?: DepsSite
  agora?: number
  pausaOpenCnpjMs?: number
  prazoMs?: number
}

export async function enriquecerEmpresas(
  org: string,
  perfilId: string,
  entrada: { companyIds: unknown },
  deps: DepsEnriquecimento = {},
): Promise<ResultadoLote> {
  const v = validarIds(entrada.companyIds)
  if (!v.ok) return v
  const admin = deps.admin ?? createSupabaseAdminClient()
  const agora = deps.agora ?? Date.now()
  const inicio = Date.now()
  const prazo = deps.prazoMs ?? PRAZO_TOTAL_MS
  const tempoEsgotado = () => Date.now() - inicio > prazo

  const token = await getValidHubSpotAccessToken(org, { admin, fetch: deps.fetch })
  if (!token.ok) return { ok: false, motivo: token.motivo }
  const at = token.accessToken

  const propsCnpj = await comCacheMemoria(`hubspot:propsCnpj:${org}`, 10 * 60_000, () => propriedadesCnpj(at, deps.fetch))
  if (!propsCnpj) return { ok: false, motivo: 'erro_hubspot', mensagem: 'não foi possível ler as propriedades de empresa' }

  const empresas = await lerObjetosPorIds('companies', at, v.ids, ['name', 'domain', 'website', 'num_associated_contacts', ...propsCnpj], deps.fetch)
  if (!empresas.ok) return { ok: false, motivo: 'erro_hubspot', mensagem: empresas.mensagem }
  const idsLidos = empresas.dados.map((e) => e.id)
  const assoc = await lerAssociacoes('companies', 'contacts', at, idsLidos, 50, deps.fetch)
  if (!assoc.ok) return { ok: false, motivo: 'erro_hubspot', mensagem: assoc.mensagem }
  const contatos = await lerObjetosPorIds('contacts', at, [...assoc.dados.values()].flatMap((a) => a.ids), ['email'], deps.fetch)
  if (!contatos.ok) return { ok: false, motivo: 'erro_hubspot', mensagem: contatos.mensagem }
  const emailPorContato = new Map(contatos.dados.map((c) => [c.id, c.properties.email ?? null]))
  const contatosPorEmpresa = assoc.dados
  const propsDocumento: string[] = propsCnpj

  // Fontes externas com cache persistente + dedup no lote + ritmo da OpenCNPJ.
  const comCache = criarConsultaComCache(admin, agora)
  let filaOpenCnpj: Promise<unknown> = Promise.resolve()
  const pausa = deps.pausaOpenCnpjMs ?? PAUSA_OPENCNPJ_MS
  const openCnpj = (cnpj: string) =>
    comCache<DadosCnpj | null>('opencnpj', cnpj, () => {
      const vez = filaOpenCnpj.then(async () => {
        const r = await consultarOpenCnpj(cnpj, deps.fetch)
        if (pausa) await new Promise((res) => setTimeout(res, pausa))
        return r
      })
      filaOpenCnpj = vez.catch(() => {})
      return vez.then((r): EntradaCache<DadosCnpj | null> =>
        r.status === 'ok' ? { status: 'ok', resultado: r.dados } : { status: r.status, resultado: null })
    })
  // Prazo esgotado não vira "falha" em cache: a próxima tentativa consulta de novo.
  const site = async (dominio: string): Promise<{ entrada: EntradaCache<string[]> }> => {
    if (tempoEsgotado()) return { entrada: { status: 'falha', resultado: [] } }
    return comCache<string[]>('site_dominio', dominio, async () => {
      const r = await cnpjsNoSite(dominio, { fetch: deps.fetch, ...deps.site })
      return r.status === 'ok' ? { status: 'ok', resultado: r.cnpjs } : { status: r.status, resultado: [] }
    })
  }

  async function resolverPorDominios(dominios: string[], dominioEmpresa: string | null, nome: string | null, refs: string[]): Promise<PorDominio> {
    let falhou = false
    for (const dominio of dominios) {
      const s = await site(dominio)
      if (s.entrada.status === 'falha') { falhou = true; continue }
      const cnpjs = s.entrada.resultado.slice(0, MAX_CNPJS_POR_SITE)
      const candidatos: Candidato[] = []
      for (const c of cnpjs) {
        const o = await openCnpj(c)
        if (o.entrada.status === 'falha') falhou = true
        if (o.entrada.status === 'ok' && o.entrada.resultado) {
          const dados = o.entrada.resultado
          candidatos.push({ dados, dominio, fonte: dominio === dominioEmpresa ? 'site_dominio_empresa' : 'site_email_contato', sinal: sinalForte(dados, nome, [dominio, ...refs]) })
        }
      }
      if (!candidatos.length) continue
      if (candidatos.length === 1) return { tipo: 'unico', c: candidatos[0] }
      const fortes = candidatos.filter((c) => c.sinal)
      if (fortes.length === 1) return { tipo: 'unico', c: fortes[0] }
      return { tipo: 'ambiguo', candidatos, dominio }
    }
    return { tipo: 'nada', falhou }
  }

  async function processar(e: { id: string; properties: Record<string, string | null> }): Promise<ResultadoEnriquecimento> {
    const p = e.properties ?? {}
    const nome = p.name ?? null
    const emails = (contatosPorEmpresa.get(e.id)?.ids ?? []).map((id) => emailPorContato.get(id) ?? null)
    const documentoBruto = propsDocumento.map((k) => p[k]).find((x) => soDigitos(x).length > 0) ?? null
    const cadastro = diagnosticarCadastro({
      nome,
      documento: documentoBruto,
      dominio: p.domain || p.website || null,
      emailsContatos: emails,
      temContato: (Number(p.num_associated_contacts) || 0) > 0 || emails.length > 0,
    })
    const dominioEmpresaBruto = normalizarDominio(p.domain || p.website)
    const dominioEmpresa = dominioEmpresaBruto && !ehProvedorGenerico(dominioEmpresaBruto) ? dominioEmpresaBruto : null
    const dominiosEmail = dominiosCorporativos(emails).filter((d) => d !== dominioEmpresa)
    const dominios = [dominioEmpresa, ...dominiosEmail].filter((d): d is string => !!d).slice(0, MAX_DOMINIOS_POR_EMPRESA)
    const evid: string[] = []

    const base = (extra: Partial<ResultadoEnriquecimento>): ResultadoEnriquecimento => ({
      hubspot_company_id: e.id, nome_hubspot: nome, cadastro_atual: cadastro, empresa_identificada: null, razao_social: null,
      nome_fantasia: null, cnpj: null, situacao_cadastral: null, dominio: dominioEmpresa ?? dominios[0] ?? null, cnae_principal: null,
      atividade_principal: null, nicho_sugerido: null, fonte: null, confianca: null, status_enriquecimento: 'nao_resolvida', evidencias: evid,
      ...extra,
    })
    const resolvido = (d: DadosCnpj, fonte: Fonte, confianca: Confianca, dominio: string | null): ResultadoEnriquecimento => {
      if (d.situacao_cadastral && !/^ativa$/i.test(d.situacao_cadastral)) evid.push(`Situação cadastral na Receita: ${d.situacao_cadastral}`)
      return base({
        empresa_identificada: d.nome_fantasia || d.razao_social,
        razao_social: d.razao_social, nome_fantasia: d.nome_fantasia, cnpj: d.cnpj, situacao_cadastral: d.situacao_cadastral,
        dominio: dominio ?? dominioEmpresa ?? dominioDeEmail(d.email),
        cnae_principal: d.cnae_principal, atividade_principal: d.atividade_principal,
        nicho_sugerido: d.cnae_principal ? nichoDaAtividade(d.cnae_principal)?.nome ?? null : null,
        fonte, confianca, status_enriquecimento: 'resolvida',
      })
    }

    // A — CNPJ já no HubSpot (campo de CNPJ ou dentro do nome).
    const estadoDoc = estadoDocumento(documentoBruto)
    if (estadoDoc === 'cpf') evid.push('Campo de CNPJ tem 11 dígitos (provável CPF) — não consultado')
    if (estadoDoc === 'digito_invalido') evid.push('CNPJ do HubSpot com dígito verificador inválido — ignorado')
    const cnpjA = estadoDoc === 'valido' ? soDigitos(documentoBruto) : cnpjNoNome(nome)
    const fonteA: Fonte = estadoDoc === 'valido' ? 'hubspot_cnpj' : 'hubspot_nome'
    let falhouFonte = false
    if (cnpjA) {
      const o = await openCnpj(cnpjA)
      if (o.entrada.status === 'ok' && o.entrada.resultado) {
        const d = o.entrada.resultado
        evid.push(`CNPJ ${formatarCnpj(cnpjA)} do HubSpot confirmado na Receita (OpenCNPJ)`)
        const sinal = sinalForte(d, nome, dominios)
        if (sinal) { evid.push(sinal); return resolvido(d, fonteA, 'alta', null) }
        // Sem sinal no próprio cadastro: o site confirma ou contradiz?
        const viaSite = await resolverPorDominios(dominios, dominioEmpresa, nome, dominios)
        if (viaSite.tipo === 'unico' && viaSite.c.dados.cnpj === cnpjA) {
          evid.push(`site ${viaSite.c.dominio} publica o mesmo CNPJ`)
          return resolvido(d, fonteA, 'alta', viaSite.c.dominio)
        }
        if (viaSite.tipo === 'unico') {
          evid.push(`site ${viaSite.c.dominio} publica outro CNPJ: ${formatarCnpj(viaSite.c.dados.cnpj)} (${viaSite.c.dados.razao_social ?? '—'})`)
          return { ...resolvido(d, fonteA, 'baixa', null), status_enriquecimento: 'ambigua' }
        }
        evid.push('sem evidência independente (nome/domínio) — conferir')
        return resolvido(d, fonteA, 'media', null)
      }
      if (o.entrada.status === 'nao_encontrado') evid.push(`CNPJ ${formatarCnpj(cnpjA)} do HubSpot não existe na Receita`)
      else { falhouFonte = true; evid.push(`OpenCNPJ indisponível para ${formatarCnpj(cnpjA)}`) }
    }

    // B/C — domínio da empresa, depois domínio do e-mail corporativo.
    if (!dominios.length) {
      evid.push(cadastro.email_contato === 'apenas_generico' ? 'Contatos só com e-mail genérico (gmail, hotmail…)' : 'Sem domínio da empresa nem e-mail corporativo')
      return base({ status_enriquecimento: falhouFonte ? 'erro_fonte' : 'nao_resolvida' })
    }
    const viaDominio = await resolverPorDominios(dominios, dominioEmpresa, nome, dominios)
    if (viaDominio.tipo === 'unico') {
      const c = viaDominio.c
      evid.push(`CNPJ ${formatarCnpj(c.dados.cnpj)} publicado no site ${c.dominio}, confirmado na Receita`)
      if (c.sinal) evid.push(c.sinal)
      return resolvido(c.dados, c.fonte, c.sinal ? 'alta' : 'media', c.dominio)
    }
    if (viaDominio.tipo === 'ambiguo') {
      evid.push(`site ${viaDominio.dominio} publica vários CNPJs: ${viaDominio.candidatos.map((c) => `${formatarCnpj(c.dados.cnpj)} (${c.dados.razao_social ?? '—'})`).join('; ')}`)
      return base({ status_enriquecimento: 'ambigua', confianca: 'baixa', fonte: viaDominio.candidatos[0].fonte, dominio: viaDominio.dominio })
    }
    evid.push(`Nenhum CNPJ confirmado nos sites: ${dominios.join(', ')}`)
    return base({ status_enriquecimento: viaDominio.falhou || falhouFonte ? 'erro_fonte' : 'nao_resolvida' })
  }

  // Processa com concorrência limitada (a OpenCNPJ é serializada à parte).
  const resultados: ResultadoEnriquecimento[] = new Array(empresas.dados.length)
  let proxima = 0
  await Promise.all(Array.from({ length: Math.min(CONCORRENCIA, empresas.dados.length) }, async () => {
    while (proxima < empresas.dados.length) {
      const i = proxima++
      resultados[i] = await processar(empresas.dados[i])
    }
  }))

  if (resultados.length) {
    const { error } = await admin.from('hubspot_enriquecimentos').upsert(
      resultados.map((r) => ({
        organizacao_id: org,
        hubspot_company_id: r.hubspot_company_id,
        cadastro_atual: r.cadastro_atual,
        status_enriquecimento: r.status_enriquecimento,
        confianca: r.confianca,
        fonte: r.fonte,
        cnpj: r.cnpj,
        razao_social: r.razao_social,
        nome_fantasia: r.nome_fantasia,
        situacao_cadastral: r.situacao_cadastral,
        dominio: r.dominio,
        cnae_principal: r.cnae_principal,
        atividade_principal: r.atividade_principal,
        nicho_sugerido: r.nicho_sugerido,
        evidencias: r.evidencias,
        executado_por: perfilId,
        executado_em: new Date(agora).toISOString(),
      })),
      { onConflict: 'organizacao_id,hubspot_company_id' },
    )
    if (error) return { ok: false, motivo: 'erro_banco', mensagem: error.message }
  }

  const lidos = new Set(idsLidos)
  return { ok: true, itens: resultados, naoEncontradas: v.ids.filter((id) => !lidos.has(id)), propriedadesCnpj: propsCnpj }
}
