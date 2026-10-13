// Rotas de nichos da organização e de pedidos de carga do catálogo, com o RBAC
// de produção sobre o BancoFalso: permissão, organização e isolamento.
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

import { GET, POST } from '@/app/api/prospeccao/nichos/route'
import { DELETE } from '@/app/api/prospeccao/nichos/[id]/route'
import { GET as GET_PEDIDOS, POST as POST_PEDIDOS } from '@/app/api/prospeccao/catalogo/pedidos/route'
import { GET as GET_ATIVIDADES } from '@/app/api/prospeccao/atividades/route'

const ORG_A = 'aaaaaaaa-0000-4000-8000-000000000001'
const ORG_B = 'bbbbbbbb-0000-4000-8000-000000000002'
const ADMIN_A = 'aaaaaaaa-1111-4111-8111-00000000000a'
const COMERCIAL_A = 'aaaaaaaa-1111-4111-8111-00000000000c'
const ADMIN_B = 'bbbbbbbb-1111-4111-8111-00000000000a'
const NICHO_B = { id: 'nicho-b', nome: 'Dentistas', cnaes: ['8630504'], criadoEm: '2026-10-01T00:00:00Z' }
const PEDIDO_B = { id: 'pedido-b', organizacao_id: ORG_B, cnaes: ['8630504'], status: 'em_andamento', erro: null, criado_em: '2026-10-01T00:00:00Z', iniciado_em: '2026-10-01T00:01:00Z', concluido_em: null }

function montarBanco() {
  return new BancoFalso({
    perfis: [
      { id: ADMIN_A, organizacao_id: ORG_A, role: 'admin' },
      { id: COMERCIAL_A, organizacao_id: ORG_A, role: 'usuario' },
      { id: ADMIN_B, organizacao_id: ORG_B, role: 'admin' },
    ],
    perfil_permissoes: [
      { organizacao_id: ORG_A, perfil_id: ADMIN_A, permissao: 'workspace.configure' },
      { organizacao_id: ORG_A, perfil_id: COMERCIAL_A, permissao: 'campaigns.view' },
      { organizacao_id: ORG_B, perfil_id: ADMIN_B, permissao: 'workspace.configure' },
    ],
    organizacoes: [
      { id: ORG_A, configuracoes: { _schema_version: 9, prospeccao: { cnaes: ['5510801'] } } },
      { id: ORG_B, configuracoes: { _schema_version: 10, prospeccao: { cnaes: ['5510801', '8630504'] }, prospeccaoNichos: [NICHO_B] } },
    ],
    catalogo_rf_cargas: [
      { id: 'c1', status: 'concluida', mes_rf: '2026-09', concluida_em: '2026-09-20T00:00:00Z', cnaes: ['5510801'] },
      { id: 'c2', status: 'concluida', mes_rf: '2026-10', concluida_em: '2026-10-05T00:00:00Z', cnaes: ['5620102'] },
    ],
    catalogo_rf_pedidos: [PEDIDO_B],
  })
}

const banco = () => estado.banco as BancoFalso
const configDa = (org: string) => banco().linhas('organizacoes').find((o) => o.id === org)?.configuracoes as Record<string, unknown>
const pedidosDa = (org: string) => banco().linhas('catalogo_rf_pedidos').filter((p) => p.organizacao_id === org)
const post = (corpo: unknown) => ({ method: 'POST', body: JSON.stringify(corpo), headers: { 'Content-Type': 'application/json' } })
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

async function criar(corpo: unknown) {
  const res = await POST(new Request('http://localhost/api/prospeccao/nichos', post(corpo)))
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  vi.stubEnv('GITHUB_DISPATCH_TOKEN', '')
  estado.banco = montarBanco()
  estado.usuarioId = null
})

describe('/api/prospeccao/nichos', () => {
  it('sem sessão → 401', async () => {
    expect((await GET()).status).toBe(401)
    expect((await criar({ nome: 'X', cnaes: ['9313100'] })).status).toBe(401)
    expect((await GET_PEDIDOS()).status).toBe(401)
    expect((await GET_ATIVIDADES(new Request('http://x/api/prospeccao/atividades?q=academia'))).status).toBe(401)
  })

  it('lista só os nichos e pedidos da própria organização, com o catálogo de todas as cargas', async () => {
    estado.usuarioId = COMERCIAL_A
    expect(await (await GET()).json()).toEqual({ nichos: [], catalogoCnaes: ['5620102', '5510801'], pedidos: [], podeEditar: false, nomesAtividades: {} })
    estado.usuarioId = ADMIN_B
    const b = await (await GET()).json()
    expect(b.nichos).toEqual([{ id: 'nicho-b', nome: 'Dentistas', personalizado: true, atividades: [{ codigo: '8630504', nome: 'Atividade odontológica' }] }])
    expect(b.pedidos.map((p: { id: string }) => p.id)).toEqual(['pedido-b'])
  })

  it('sem workspace.configure não cria, não exclui, não pede carga e não grava nada', async () => {
    estado.usuarioId = COMERCIAL_A
    expect((await criar({ nome: 'X', cnaes: ['9313100'] })).status).toBe(403)
    expect((await DELETE(new Request('http://x', { method: 'DELETE' }), ctx('nicho-b'))).status).toBe(403)
    expect((await POST_PEDIDOS(new Request('http://x', post({ cnaes: ['9313100'] })))).status).toBe(403)
    expect(banco().escritas('organizacoes').filter((o) => o.tipo !== 'select')).toHaveLength(0)
    expect(banco().escritas('catalogo_rf_pedidos').filter((o) => o.tipo !== 'select')).toHaveLength(0)
  })

  it('criar grava na própria org e pede a carga do que falta no catálogo, só uma vez', async () => {
    estado.usuarioId = ADMIN_A
    const r = await criar({ nome: 'Academias', cnaes: ['9313100'] })
    expect(r.status).toBe(201)
    expect(r.body.nichos.map((n: { nome: string }) => n.nome)).toEqual(['Academias'])
    expect(r.body.pedido).toMatchObject({ cnaes: ['9313100'], status: 'pendente' })
    expect((configDa(ORG_A).prospeccaoNichos as unknown[])).toHaveLength(1)
    expect(configDa(ORG_A).prospeccao).toEqual({ cnaes: ['5510801'] })
    expect(configDa(ORG_B).prospeccaoNichos).toEqual([NICHO_B])
    expect(pedidosDa(ORG_A)).toHaveLength(1)
    expect(pedidosDa(ORG_A)[0]).toMatchObject({ solicitado_por: ADMIN_A })

    // Pedir de novo as mesmas atividades não duplica (pedido aberto cobre).
    const de_novo = await POST_PEDIDOS(new Request('http://x', post({ cnaes: ['9313100'] })))
    expect(de_novo.status).toBe(200)
    expect(pedidosDa(ORG_A)).toHaveLength(1)
  })

  it('só com o nome, as atividades saem da pesquisa forte pelo nome', async () => {
    estado.usuarioId = ADMIN_A
    const r = await criar({ nome: 'Dentistas', cnaes: [] })
    expect(r.status).toBe(201)
    const criado = r.body.nichos.find((n: { id: string }) => n.id === r.body.nichoId)
    expect(criado.atividades).toEqual([{ codigo: '8630504', nome: 'Atividade odontológica' }])
    expect(r.body.pedido).toMatchObject({ cnaes: ['8630504'] })
  })

  it('só com o nome, sem atividade correspondente ou já usada → 422 sem gravar', async () => {
    estado.usuarioId = ADMIN_A
    const nada = await criar({ nome: 'Xyzwq' })
    expect(nada.status).toBe(422)
    expect(nada.body.erro).toContain('Não achamos atividade')
    // "Hotéis" e "Apart-hotéis" já são de Hotelaria: não sobra a "Construção de
    // edifícios" que só casa por nome popular.
    const ocupada = await criar({ nome: 'Hotéis' })
    expect(ocupada.status).toBe(422)
    expect(ocupada.body.erro).toContain('Hotelaria')
    expect(banco().escritas('organizacoes').filter((o) => o.tipo === 'update')).toHaveLength(0)
  })

  it('atividade de nicho pré-definido é recusada e não gera pedido', async () => {
    estado.usuarioId = ADMIN_A
    expect((await criar({ nome: 'Buffets da casa', cnaes: ['5620102'] })).status).toBe(409)
    expect(pedidosDa(ORG_A)).toHaveLength(0)
  })

  it('nicho só com atividade já no catálogo não gera pedido', async () => {
    banco().linhas('catalogo_rf_cargas').push({ id: 'c3', status: 'concluida', mes_rf: '2026-10', concluida_em: '2026-10-06T00:00:00Z', cnaes: ['9602501'] })
    estado.usuarioId = ADMIN_A
    const r = await criar({ nome: 'Salões', cnaes: ['9602501'] })
    expect(r.status).toBe(201)
    expect(r.body.pedido).toBeNull()
    expect(pedidosDa(ORG_A)).toHaveLength(0)
  })

  it('pedido de outra org não cobre o pedido desta (cada org acompanha o seu)', async () => {
    estado.usuarioId = ADMIN_A
    const r = await criar({ nome: 'Dentistas A', cnaes: ['8630504'] })
    expect(r.status).toBe(201)
    expect(pedidosDa(ORG_A)).toHaveLength(1)
    expect(pedidosDa(ORG_B)).toEqual([PEDIDO_B])
  })

  it('excluir nicho de outra organização não acha nada e não grava', async () => {
    estado.usuarioId = ADMIN_A
    expect((await DELETE(new Request('http://x', { method: 'DELETE' }), ctx('nicho-b'))).status).toBe(404)
    expect(configDa(ORG_B).prospeccaoNichos).toEqual([NICHO_B])
    estado.usuarioId = ADMIN_B
    const res = await DELETE(new Request('http://x', { method: 'DELETE' }), ctx('nicho-b'))
    expect(res.status).toBe(200)
    expect(configDa(ORG_B).prospeccaoNichos).toBeUndefined()
    // As atividades do nicho excluído saem do perfil salvo; o resto fica.
    expect(configDa(ORG_B).prospeccao).toEqual({ cnaes: ['5510801'] })
  })

  it('pesquisa de atividades marca o que já está no catálogo', async () => {
    estado.usuarioId = COMERCIAL_A
    const res = await GET_ATIVIDADES(new Request('http://x/api/prospeccao/atividades?q=hoteis'))
    const { atividades } = await res.json()
    expect(atividades[0]).toEqual({ codigo: '5510801', nome: 'Hotéis', noCatalogo: true })
    expect(atividades.find((a: { codigo: string }) => a.codigo === '5510802')?.noCatalogo).toBe(false)
  })
})
