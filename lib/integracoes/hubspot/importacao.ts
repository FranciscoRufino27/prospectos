import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { UFS_BRASIL } from '@/lib/config/workspaceConfig'
import { getValidHubSpotAccessToken } from './tokens'
import { mapaResponsaveis } from './comerciais'
import { lerAssociacoes, lerObjetosPorIds, type ObjetoHubspot } from './leituraLote'
import { propriedadesCnpj } from './enriquecimento/cascata'
import { cnpjValido, ehEmailCorporativo, normalizarDominio, soDigitos } from './enriquecimento/cadastro'

// Importação de um lote preparado: cria empresa + um lead por contato com
// e-mail da empresa (com o contato correspondente), responsável = usuário
// mapeado do comercial dono da empresa no HubSpot (nunca por nome), sem
// segmento. As travas atômicas ficam na função hubspot_importar (0061);
// aqui só se lê o HubSpot e se monta o pedido. `simular` não grava nada.
// Lead nasce com owner='n8n': não entra no motor de cadência sozinho.

export const LIMITE_CONTATOS_POR_EMPRESA = 50

const PROPRIEDADES_EMPRESA = ['name', 'domain', 'city', 'state', 'phone', 'hubspot_owner_id']
const PROPRIEDADES_CONTATO = ['firstname', 'lastname', 'email', 'jobtitle', 'phone', 'mobilephone']

export type StatusImportacao =
  | 'importado'
  | 'importavel'
  | 'ja_e_lead'
  | 'sem_email'
  | 'sem_contato_novo'
  | 'empresa_ja_importada'
  | 'cnpj_ja_na_base'
  | 'sem_responsavel'
  | 'fora_do_lote'
  | 'duplicado_no_lote'
  | 'item_invalido'
  | 'cliente_nao_suportado'
  | 'nao_encontrada_no_hubspot'

export interface ResumoImportacao {
  simulado: boolean
  empresasTotal: number
  empresasComLead: number // criadas (ou que seriam criadas, na simulação)
  leads: number // criados (ou que seriam criados)
  jaEramLead: number // contatos pulados: e-mail/contato já é lead
  semContatoNovo: number // empresas sem nenhum contato novo com e-mail da empresa
  jaImportadas: number
  cnpjJaNaBase: number
  semResponsavel: number
  clientes: number // clientes ficam para a importação de novidades
  naoEncontradas: number
  responsaveis: Array<{ nome: string; leads: number }>
}

export type ResultadoImportacao =
  | { ok: true; resumo: ResumoImportacao }
  | { ok: false; motivo: string; status: number }

type Deps = { admin?: SupabaseClient; fetch?: typeof fetch }

// Nome do estado (como o HubSpot costuma trazer) → UF.
const UF_POR_NOME: Record<string, string> = {
  acre: 'AC', alagoas: 'AL', amapa: 'AP', amazonas: 'AM', bahia: 'BA', ceara: 'CE', 'distrito federal': 'DF',
  'espirito santo': 'ES', goias: 'GO', maranhao: 'MA', 'mato grosso': 'MT', 'mato grosso do sul': 'MS',
  'minas gerais': 'MG', para: 'PA', paraiba: 'PB', parana: 'PR', pernambuco: 'PE', piaui: 'PI',
  'rio de janeiro': 'RJ', 'rio grande do norte': 'RN', 'rio grande do sul': 'RS', rondonia: 'RO',
  roraima: 'RR', 'santa catarina': 'SC', 'sao paulo': 'SP', sergipe: 'SE', tocantins: 'TO',
}

export function ufDoEstado(v: string | null | undefined): string | null {
  const t = (v ?? '').trim()
  if (!t) return null
  if ((UFS_BRASIL as readonly string[]).includes(t.toUpperCase())) return t.toUpperCase()
  return UF_POR_NOME[t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()] ?? null
}

const texto = (v: string | null | undefined, max = 200) => {
  const t = (v ?? '').replace(/\s+/g, ' ').trim()
  return t ? t.slice(0, max) : null
}

export interface ContatoPedido {
  hubspot_contact_id: string
  nome: string | null
  cargo: string | null
  email: string
  telefone: string | null
}

export interface EmpresaPedido {
  hubspot_company_id: string
  nome: string | null
  dominio: string | null
  cnpj: string | null
  cidade: string | null
  estado: string | null
  telefone: string | null
  responsavel_id: string
  contatos: ContatoPedido[]
}

// Monta o pedido de uma empresa a partir do que foi lido no HubSpot. Só
// entram contatos com e-mail da própria empresa (decisão do usuário: 1 lead
// por contato corporativo).
export function montarPedido(
  empresa: ObjetoHubspot,
  contatos: readonly ObjetoHubspot[],
  propsCnpj: readonly string[],
  responsavelId: string,
): EmpresaPedido {
  const p = empresa.properties
  const cnpj = propsCnpj.map((k) => soDigitos(p[k])).find((d) => d.length === 14 && cnpjValido(d)) ?? null
  const vistos = new Set<string>()
  const lista: ContatoPedido[] = []
  for (const c of contatos) {
    const email = (c.properties.email ?? '').trim().toLowerCase()
    if (!email || !ehEmailCorporativo(email) || vistos.has(email)) continue
    vistos.add(email)
    const nome = texto([c.properties.firstname, c.properties.lastname].filter(Boolean).join(' '), 120)
    lista.push({
      hubspot_contact_id: c.id,
      nome,
      cargo: texto(c.properties.jobtitle, 120),
      email,
      telefone: texto(c.properties.phone ?? c.properties.mobilephone, 40),
    })
  }
  return {
    hubspot_company_id: empresa.id,
    nome: texto(p.name),
    dominio: normalizarDominio(p.domain),
    cnpj,
    cidade: texto(p.city, 120),
    estado: ufDoEstado(p.state),
    telefone: texto(p.phone, 40),
    responsavel_id: responsavelId,
    contatos: lista,
  }
}

interface LinhaRpc { hubspot_company_id: string | null; email: string | null; status: StatusImportacao; lead_id: string | null }

export async function importarLote(
  org: string,
  loteId: string,
  opcoes: { simular: boolean },
  deps: Deps = {},
): Promise<ResultadoImportacao> {
  if (!/^[0-9a-f-]{36}$/i.test(loteId)) return { ok: false, motivo: 'lote_invalido', status: 400 }
  const admin = deps.admin ?? createSupabaseAdminClient()

  const { data: lote, error: erroLote } = await admin
    .from('hubspot_importacao_lotes')
    .select('id, status')
    .eq('organizacao_id', org)
    .eq('id', loteId)
    .maybeSingle()
  if (erroLote) return { ok: false, motivo: 'erro_banco', status: 500 }
  if (!lote) return { ok: false, motivo: 'lote_nao_encontrado', status: 404 }
  if (!opcoes.simular && lote.status === 'importado') return { ok: false, motivo: 'lote_ja_importado', status: 409 }

  const { data: itens, error: erroItens } = await admin
    .from('hubspot_importacao_itens')
    .select('hubspot_company_id, cliente')
    .eq('organizacao_id', org)
    .eq('lote_id', loteId)
  if (erroItens) return { ok: false, motivo: 'erro_banco', status: 500 }
  const todos = (itens ?? []) as Array<{ hubspot_company_id: string; cliente: boolean | null }>
  const clientes = todos.filter((i) => i.cliente === true).length
  const ids = todos.filter((i) => i.cliente !== true).map((i) => String(i.hubspot_company_id))

  const resumo: ResumoImportacao = {
    simulado: opcoes.simular, empresasTotal: todos.length, empresasComLead: 0, leads: 0, jaEramLead: 0,
    semContatoNovo: 0, jaImportadas: 0, cnpjJaNaBase: 0, semResponsavel: 0, clientes, naoEncontradas: 0, responsaveis: [],
  }
  if (!ids.length) return { ok: true, resumo }

  const token = await getValidHubSpotAccessToken(org, { admin, fetch: deps.fetch })
  if (!token.ok) return { ok: false, motivo: token.motivo, status: token.motivo === 'nao_conectado' ? 404 : 409 }
  const at = token.accessToken

  const propsCnpj = await propriedadesCnpj(at, deps.fetch)
  const [empresas, assoc, responsaveis] = await Promise.all([
    lerObjetosPorIds('companies', at, ids, [...PROPRIEDADES_EMPRESA, ...(propsCnpj ?? [])], deps.fetch),
    lerAssociacoes('companies', 'contacts', at, ids, LIMITE_CONTATOS_POR_EMPRESA, deps.fetch),
    mapaResponsaveis(admin, org),
  ])
  if (!empresas.ok || !assoc.ok) return { ok: false, motivo: 'erro_hubspot', status: 502 }
  const idsContatos = [...new Set([...assoc.dados.values()].flatMap((a) => a.ids))]
  const contatos = await lerObjetosPorIds('contacts', at, idsContatos, PROPRIEDADES_CONTATO, deps.fetch)
  if (!contatos.ok) return { ok: false, motivo: 'erro_hubspot', status: 502 }

  const empresaPorId = new Map(empresas.dados.map((e) => [e.id, e]))
  const contatoPorId = new Map(contatos.dados.map((c) => [c.id, c]))
  const pedido: EmpresaPedido[] = []
  for (const id of ids) {
    const e = empresaPorId.get(id)
    if (!e) { resumo.naoEncontradas++; continue }
    // Responsável pelo mapeamento ATUAL do dono da empresa no HubSpot.
    const usuario = responsaveis.get(e.properties.hubspot_owner_id ?? '')
    if (!usuario) { resumo.semResponsavel++; continue }
    const doContato = (assoc.dados.get(id)?.ids ?? []).map((c) => contatoPorId.get(c)).filter((c): c is ObjetoHubspot => !!c)
    pedido.push(montarPedido(e, doContato, propsCnpj ?? [], usuario))
  }
  if (!pedido.length) return { ok: true, resumo }

  const { data: linhas, error } = await admin.rpc('hubspot_importar', {
    p_org: org,
    p_lote: loteId,
    p_itens: pedido,
    p_simular: opcoes.simular,
  })
  if (error) {
    console.error('[hubspot/importacao] hubspot_importar falhou:', error.message)
    return { ok: false, motivo: 'erro_banco', status: 500 }
  }

  const empresasComLead = new Set<string>()
  const leadsPorResponsavel = new Map<string, number>()
  const responsavelDaEmpresa = new Map(pedido.map((p) => [p.hubspot_company_id, p.responsavel_id]))
  for (const l of (linhas ?? []) as LinhaRpc[]) {
    switch (l.status) {
      case 'importado':
      case 'importavel': {
        resumo.leads++
        empresasComLead.add(String(l.hubspot_company_id))
        const r = responsavelDaEmpresa.get(String(l.hubspot_company_id)) ?? ''
        leadsPorResponsavel.set(r, (leadsPorResponsavel.get(r) ?? 0) + 1)
        break
      }
      case 'ja_e_lead': resumo.jaEramLead++; break
      case 'sem_contato_novo': resumo.semContatoNovo++; break
      case 'empresa_ja_importada': resumo.jaImportadas++; break
      case 'cnpj_ja_na_base': resumo.cnpjJaNaBase++; break
      case 'sem_responsavel': resumo.semResponsavel++; break
    }
  }
  resumo.empresasComLead = empresasComLead.size

  if (leadsPorResponsavel.size) {
    const { data: usuarios } = await admin
      .from('usuarios')
      .select('id, nome')
      .eq('organizacao_id', org)
      .in('id', [...leadsPorResponsavel.keys()])
    const nomes = new Map((usuarios ?? []).map((u) => [String(u.id), String(u.nome ?? '')]))
    resumo.responsaveis = [...leadsPorResponsavel].map(([id, leads]) => ({ nome: nomes.get(id) || 'Responsável', leads }))
  }
  return { ok: true, resumo }
}

export interface LoteResumo {
  id: string
  status: string
  nichoEsperado: string
  totalItens: number
  criadoEm: string
}

export async function listarLotes(org: string, deps: Deps = {}): Promise<LoteResumo[]> {
  const admin = deps.admin ?? createSupabaseAdminClient()
  const { data, error } = await admin
    .from('hubspot_importacao_lotes')
    .select('id, status, nicho_esperado, total_itens, criado_em')
    .eq('organizacao_id', org)
    .order('criado_em', { ascending: false })
    .limit(20)
  if (error) throw new Error(`Falha ao listar lotes: ${error.message}`)
  return (data ?? []).map((l) => ({
    id: String(l.id),
    status: String(l.status),
    nichoEsperado: String(l.nicho_esperado),
    totalItens: Number(l.total_itens ?? 0),
    criadoEm: String(l.criado_em),
  }))
}
