// Configuração das travas de custo pela tela: leitura do uso do mês e gravação
// do liga/desliga + orçamento, sempre na organização DA SESSÃO, com o RBAC de
// produção sobre o BancoFalso.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BancoFalso } from '@/lib/templates/__tests__/bancoFalso'
import { validarEnriquecimentoPago } from '@/lib/config/workspaceConfig'
import { consumoDoMes } from '../travasCusto'

const estado = vi.hoisted(() => ({ usuarioId: null as string | null, banco: null as unknown }))

vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: estado.usuarioId ? { id: estado.usuarioId } : null } }) },
  }),
}))
vi.mock('@/lib/supabase-admin', () => ({
  createSupabaseAdminClient: () => (estado.banco as BancoFalso).cliente(),
}))

import { GET } from '@/app/api/configuracoes/enriquecimento/route'
import { PUT } from '@/app/api/configuracoes/workspace/route'

const ORG_A = 'aaaaaaaa-0000-4000-8000-000000000001'
const ORG_B = 'bbbbbbbb-0000-4000-8000-000000000002'
const ADMIN_A = 'aaaaaaaa-1111-4111-8111-00000000000a'
const USUARIO_A = 'aaaaaaaa-1111-4111-8111-00000000000b'
const ADMIN_B = 'bbbbbbbb-1111-4111-8111-00000000000a'
const agoraIso = () => new Date().toISOString()

function montarBanco() {
  return new BancoFalso({
    perfis: [
      { id: ADMIN_A, organizacao_id: ORG_A, role: 'admin' },
      { id: USUARIO_A, organizacao_id: ORG_A, role: 'usuario' },
      { id: ADMIN_B, organizacao_id: ORG_B, role: 'admin' },
    ],
    perfil_permissoes: [],
    organizacoes: [
      { id: ORG_A, configuracoes: { _schema_version: 11, enriquecimentoPago: { ativo: true, orcamentoMensal: { crustdata: 100, anymail: 200 } } } },
      { id: ORG_B, configuracoes: { _schema_version: 11, enriquecimentoPago: { ativo: false, orcamentoMensal: { anymail: 5 } } } },
    ],
    prospeccao_consumo: [
      { organizacao_id: ORG_A, fonte: 'crustdata', origem: 'api', custo: 40, criado_em: agoraIso() },
      { organizacao_id: ORG_A, fonte: 'crustdata', origem: 'api', custo: 2, criado_em: agoraIso() },
      { organizacao_id: ORG_A, fonte: 'anymail', origem: 'api', custo: 87, criado_em: agoraIso() },
      // Não entram no uso da org A: cache, mês passado e outra organização.
      { organizacao_id: ORG_A, fonte: 'anymail', origem: 'cache', custo: 0, criado_em: agoraIso() },
      { organizacao_id: ORG_A, fonte: 'anymail', origem: 'api', custo: 300, criado_em: '2020-01-10T12:00:00Z' },
      { organizacao_id: ORG_B, fonte: 'anymail', origem: 'api', custo: 999, criado_em: agoraIso() },
    ],
  })
}

const banco = () => estado.banco as BancoFalso
const configDe = (org: string) => banco().linhas('organizacoes').find((o) => o.id === org)?.configuracoes as Record<string, unknown>
const ler = async () => { const res = await GET(); return { status: res.status, body: await res.json() } }
const gravar = async (corpo: unknown) => {
  const res = await PUT(new Request('http://localhost/api/configuracoes/workspace', { method: 'PUT', body: JSON.stringify(corpo), headers: { 'Content-Type': 'application/json' } }))
  return { status: res.status, body: await res.json() }
}

beforeEach(() => { estado.banco = montarBanco(); estado.usuarioId = ADMIN_A })
afterEach(() => { vi.unstubAllGlobals() })

describe('GET /api/configuracoes/enriquecimento', () => {
  it('sem sessão: 401', async () => {
    estado.usuarioId = null
    expect((await ler()).status).toBe(401)
  })

  it('devolve liga/desliga, orçamento e uso do mês SÓ da org da sessão (cache, mês passado e outra org fora)', async () => {
    const r = await ler()
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({
      ativo: true,
      podeEditar: true,
      fontes: [
        { fonte: 'crustdata', orcamento: 100, usado: 42 },
        { fonte: 'anymail', orcamento: 200, usado: 87 },
      ],
    })
    expect(r.body.mes).toMatch(/^\d{4}-\d{2}$/)

    estado.usuarioId = ADMIN_B
    expect((await ler()).body).toMatchObject({
      ativo: false,
      fontes: [{ fonte: 'crustdata', orcamento: null, usado: 0 }, { fonte: 'anymail', orcamento: 5, usado: 999 }],
    })
  })

  it('membro sem permissão de configurar vê, mas não pode editar', async () => {
    estado.usuarioId = USUARIO_A
    expect((await ler()).body).toMatchObject({ podeEditar: false })
  })
})

describe('PUT /api/configuracoes/workspace (enriquecimentoPago)', () => {
  it('grava liga/desliga e orçamento na org da sessão, ignorando organizacao_id enviado', async () => {
    const r = await gravar({ organizacao_id: ORG_B, enriquecimentoPago: { ativo: false, orcamentoMensal: { crustdata: 50 } } })
    expect(r.status).toBe(200)
    expect(configDe(ORG_A).enriquecimentoPago).toEqual({ ativo: false, orcamentoMensal: { crustdata: 50 } })
    // A org B continua exatamente como estava.
    expect(configDe(ORG_B).enriquecimentoPago).toEqual({ ativo: false, orcamentoMensal: { anymail: 5 } })
  })

  it('orçamento negativo, acima do máximo ou de fonte desconhecida: 400 e nada muda', async () => {
    const antes = JSON.stringify(configDe(ORG_A))
    for (const orcamentoMensal of [{ crustdata: -1 }, { anymail: 100_001 }, { hunter: 10 }, { crustdata: 'dez' }]) {
      const r = await gravar({ enriquecimentoPago: { ativo: true, orcamentoMensal } })
      expect(r.status).toBe(400)
      expect(r.body.erro).toBeTruthy()
    }
    expect(JSON.stringify(configDe(ORG_A))).toBe(antes)
  })

  it('fonte sem orçamento (omitida) fica sem orçamento = bloqueada; null desliga tudo', async () => {
    await gravar({ enriquecimentoPago: { ativo: true, orcamentoMensal: { anymail: 10 } } })
    expect(configDe(ORG_A).enriquecimentoPago).toEqual({ ativo: true, orcamentoMensal: { anymail: 10 } })
    expect((await ler()).body.fontes[0]).toMatchObject({ fonte: 'crustdata', orcamento: null })
    await gravar({ enriquecimentoPago: null })
    expect(configDe(ORG_A).enriquecimentoPago).toBeUndefined()
    expect((await ler()).body).toMatchObject({ ativo: false })
  })

  it('só quem configura o workspace altera (membro comum: 403)', async () => {
    estado.usuarioId = USUARIO_A
    const r = await gravar({ enriquecimentoPago: { ativo: true, orcamentoMensal: { anymail: 999 } } })
    expect(r.status).toBe(403)
    expect(configDe(ORG_A).enriquecimentoPago).toEqual({ ativo: true, orcamentoMensal: { crustdata: 100, anymail: 200 } })
  })
})

describe('validarEnriquecimentoPago / consumoDoMes', () => {
  it('validação estrita do que a tela envia', () => {
    expect(validarEnriquecimentoPago({ ativo: true, orcamentoMensal: { crustdata: 0, anymail: 12.5 } })).toBeNull()
    expect(validarEnriquecimentoPago({ ativo: true, orcamentoMensal: { crustdata: null } })).toBeNull()
    expect(validarEnriquecimentoPago(null)).toBeNull()
    expect(validarEnriquecimentoPago({ ativo: 'sim' })).toMatch(/verdadeiro ou falso/)
    expect(validarEnriquecimentoPago({ orcamentoMensal: { anymail: -0.01 } })).toMatch(/0 a 100\.000/)
    expect(validarEnriquecimentoPago('x')).toBeTruthy()
  })

  it('uso ilegível (função do banco falhou) vira null, nunca zero inventado', async () => {
    const b = montarBanco()
    b.falharRpc = true
    const r = await consumoDoMes(b.cliente(), ORG_A, { ativo: true, orcamentoMensal: { crustdata: 100 } }, Date.UTC(2026, 9, 5, 15))
    expect(r).toEqual({ ativo: true, mes: '2026-10', fontes: [{ fonte: 'crustdata', orcamento: 100, usado: null }, { fonte: 'anymail', orcamento: null, usado: null }] })
  })
})
