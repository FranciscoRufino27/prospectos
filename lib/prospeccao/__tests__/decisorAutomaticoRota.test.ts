// Rota /api/prospeccao/decisor-automatico com o RBAC de produção sobre o
// BancoFalso e as APIs externas falsas: isolamento por organização e
// reaproveitamento do que a própria org já consultou.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BancoFalso } from '@/lib/templates/__tests__/bancoFalso'

const estado = vi.hoisted(() => ({ usuarioId: null as string | null, banco: null as unknown }))

vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: estado.usuarioId ? { id: estado.usuarioId } : null } }) },
  }),
}))
vi.mock('@/lib/supabase-admin', () => ({
  createSupabaseAdminClient: () => (estado.banco as BancoFalso).cliente(),
}))

import { POST } from '@/app/api/prospeccao/decisor-automatico/route'

const ORG_A = 'aaaaaaaa-0000-4000-8000-000000000001'
const ORG_B = 'bbbbbbbb-0000-4000-8000-000000000002'
const USUARIO_A = 'aaaaaaaa-1111-4111-8111-00000000000a'
const ORG_C = 'cccccccc-0000-4000-8000-000000000003'
const ORG_D = 'dddddddd-0000-4000-8000-000000000004'
const USUARIO_D = 'dddddddd-1111-4111-8111-00000000000d'
const USUARIO_C = 'cccccccc-1111-4111-8111-00000000000c'
const CNPJ = '12345678000199'
const EMAIL_SALVO_B = 'joao.b@hotelsol.com.br'

function montarBanco() {
  return new BancoFalso({
    perfis: [{ id: USUARIO_A, organizacao_id: ORG_A, role: 'admin' }, { id: USUARIO_C, organizacao_id: ORG_C, role: 'admin' }, { id: USUARIO_D, organizacao_id: ORG_D, role: 'admin' }],
    perfil_permissoes: [],
    organizacoes: [
      { id: ORG_A, configuracoes: { _schema_version: 6, enriquecimentoPago: { ativo: true, orcamentoMensal: { crustdata: 100, anymail: 100 } } } },
      { id: ORG_B, configuracoes: { _schema_version: 6 } },
      { id: ORG_C, configuracoes: { _schema_version: 6, enriquecimentoPago: { ativo: true, orcamentoMensal: { crustdata: 100, anymail: 100 } } } },
      // Org sem configuração de enriquecimento pago: padrão DESLIGADO.
      { id: ORG_D, configuracoes: { _schema_version: 11 } },
    ],
    catalogo_estabelecimentos: [
      { cnpj: CNPJ, porte: 'pequeno', mei: false, email: 'contato@hotelsol.com.br', razao_social: 'HOTEL SOL LTDA', nome_fantasia: 'HOTEL SOL' },
    ],
    // Análise que a org B já pagou para o mesmo CNPJ: nunca pode vazar para A.
    prospeccao_decisores: [{
      organizacao_id: ORG_B, cnpj: CNPJ, nome: 'Joao Silva', cargo: 'CEO', linkedin: null,
      consulta: { socios: [], sugerido: { nome: 'Joao Silva', qualificacao: 'Sócio', desde: null }, status: 'sem_criterio', motivo: null, emailNominalDe: null },
      enriquecimento: { anymail: { nome: 'Joao Silva', dominio: 'hotelsol.com.br', status: 'valido', email: EMAIL_SALVO_B, consultadoEm: 'x' } },
    }],
  })
}

const chamadas: string[] = []
function apisFalsas() {
  return vi.fn(async (url: string | URL | Request) => {
    const u = String(url)
    chamadas.push(u)
    if (u.includes('opencnpj')) {
      return Response.json({ QSA: [{ nome_socio: 'MARIA SOUZA LIMA', qualificacao_socio: 'Sócio-Administrador', identificador_socio: 'Pessoa Física' }] })
    }
    if (u.includes('anymailfinder')) return Response.json({ email: 'maria@hotelsol.com.br', email_status: 'valid' })
    if (u.includes('crustdata')) {
      return Response.json({ profiles: [{ basic_profile: { name: 'Maria Lima', current_title: 'CEO' }, social_handles: { professional_network_identifier: { profile_url: 'https://www.linkedin.com/in/marialima' } } }] })
    }
    return new Response('{}', { status: 404 })
  })
}

const banco = () => estado.banco as BancoFalso
const chamar = async (corpo: unknown) => {
  const res = await POST(new Request('http://localhost/api/prospeccao/decisor-automatico', { method: 'POST', body: JSON.stringify(corpo), headers: { 'Content-Type': 'application/json' } }))
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  estado.banco = montarBanco()
  estado.usuarioId = USUARIO_A
  chamadas.length = 0
  vi.stubGlobal('fetch', apisFalsas())
  vi.stubEnv('ANYMAILFINDER_API_KEY', 'chave-teste')
  vi.stubEnv('CRUSTDATA_API_KEY', 'chave-teste')
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('POST /api/prospeccao/decisor-automatico', () => {
  it('sem sessão: 401 e nenhuma API chamada', async () => {
    estado.usuarioId = null
    const r = await chamar({ cnpj: CNPJ })
    expect(r.status).toBe(401)
    expect(chamadas).toHaveLength(0)
  })

  it('CNPJ fora do catálogo: 404 sem chamar APIs pagas', async () => {
    const r = await chamar({ cnpj: '99999999000199' })
    expect(r.status).toBe(404)
    expect(chamadas).toHaveLength(0)
  })

  it('resolve para a org da sessão sem reaproveitar o que a org B pagou', async () => {
    const r = await chamar({ cnpj: CNPJ })
    expect(r.status).toBe(200)
    // Sócio serve (perfil sem critério): decisor da Receita, e-mail pela Anymail, Crustdata NÃO chamada.
    expect(r.body).toMatchObject({ status: 'completo', email: 'maria@hotelsol.com.br', decisor: { nome: 'Maria Souza Lima', cargo: 'Sócio-Administrador' } })
    expect(chamadas.some((u) => u.includes('crustdata'))).toBe(false)
    expect(JSON.stringify(r.body)).not.toContain(EMAIL_SALVO_B)
    // Consumo da org A: 1 chamada paga à Anymail (1 crédito), origem API.
    expect(banco().linhas('prospeccao_consumo')).toEqual([expect.objectContaining({ organizacao_id: ORG_A, fonte: 'anymail', operacao: 'email', origem: 'api', resultado: 'ok', custo: 1, usuario_id: USUARIO_A })])

    const linhas = banco().linhas('prospeccao_decisores')
    const daA = linhas.filter((l) => l.organizacao_id === ORG_A && l.cnpj === CNPJ)
    expect(daA).toHaveLength(1)
    expect(daA[0]).toMatchObject({ nome: 'Maria Souza Lima', atualizado_por: USUARIO_A })
    // A linha da org B continua intacta.
    const daB = linhas.find((l) => l.organizacao_id === ORG_B)
    expect(daB).toMatchObject({ nome: 'Joao Silva' })
    expect((daB?.enriquecimento as { anymail: { email: string } }).anymail.email).toBe(EMAIL_SALVO_B)
  })

  it('outra org reaproveita os fatos já consultados (cache global) sem chamar API, com a própria análise', async () => {
    await chamar({ cnpj: CNPJ })
    const cache = banco().linhas('enriquecimento_cache')
    expect(cache.map((l) => l.tipo).sort()).toEqual(['anymail_email', 'opencnpj'])
    expect(cache.every((l) => l.pago_por_organizacao === ORG_A)).toBe(true)

    chamadas.length = 0
    estado.usuarioId = USUARIO_C
    const r = await chamar({ cnpj: CNPJ })
    expect(r.body).toMatchObject({ status: 'completo', email: 'maria@hotelsol.com.br', decisor: { nome: 'Maria Souza Lima' } })
    expect(chamadas).toHaveLength(0)
    // Cache hit não gera custo: a org C registra a consulta com origem 'cache' e custo 0.
    const daCConsumo = banco().linhas('prospeccao_consumo').filter((l) => l.organizacao_id === ORG_C)
    expect(daCConsumo).toEqual([expect.objectContaining({ fonte: 'anymail', origem: 'cache', custo: 0 })])
    // A análise (decisor escolhido) é da org C; a da org B segue intacta e invisível.
    const daC = banco().linhas('prospeccao_decisores').filter((l) => l.organizacao_id === ORG_C)
    expect(daC).toHaveLength(1)
    expect(daC[0]).toMatchObject({ nome: 'Maria Souza Lima', atualizado_por: USUARIO_C })
    expect(JSON.stringify(r.body)).not.toContain(EMAIL_SALVO_B)
  })

  it('enriquecimento pago desligado (org sem configuração): 200, empresa bloqueada pela Anymail, sem chamá-la', async () => {
    estado.usuarioId = USUARIO_D
    const r = await chamar({ cnpj: CNPJ })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ status: 'incompleto', motivo: 'bloqueado_anymail', bloqueio: { fonte: 'anymail', motivo: 'pago_desligado' } })
    expect(r.body.bloqueio.mensagem).toMatch(/desligado/)
    // Fonte grátis (sócios) funcionou; a paga não foi chamada nem cobrada.
    expect(chamadas.some((u) => u.includes('opencnpj'))).toBe(true)
    expect(chamadas.some((u) => u.includes('anymailfinder'))).toBe(false)
    expect(banco().linhas('prospeccao_consumo')).toHaveLength(0)
  })

  it('orçamento do mês esgotado: 200, empresa bloqueada com o gasto no motivo; mês anterior não conta', async () => {
    const agora = new Date().toISOString()
    banco().linhas('prospeccao_consumo').push(
      { organizacao_id: ORG_A, fonte: 'anymail', operacao: 'email', origem: 'api', custo: 99.5, criado_em: agora },
      // Cache e mês passado não somam no orçamento.
      { organizacao_id: ORG_A, fonte: 'anymail', operacao: 'email', origem: 'cache', custo: 50, criado_em: agora },
      { organizacao_id: ORG_A, fonte: 'anymail', operacao: 'email', origem: 'api', custo: 500, criado_em: '2020-01-15T12:00:00Z' },
    )
    const r = await chamar({ cnpj: CNPJ })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ status: 'incompleto', motivo: 'bloqueado_anymail', bloqueio: { motivo: 'orcamento_esgotado' } })
    expect(r.body.bloqueio.mensagem).toMatch(/99,5 de 100 créditos/)
    expect(chamadas.some((u) => u.includes('anymailfinder'))).toBe(false)
  })

  it('segunda busca da mesma org não chama nenhuma API de novo', async () => {
    await chamar({ cnpj: CNPJ })
    chamadas.length = 0
    const r = await chamar({ cnpj: CNPJ })
    expect(r.body.status).toBe('completo')
    expect(chamadas).toHaveLength(0)
  })
})
