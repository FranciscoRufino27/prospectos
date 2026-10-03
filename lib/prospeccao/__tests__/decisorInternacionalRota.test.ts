// Rota /api/prospeccao/decisor-internacional com o RBAC de produção sobre o
// BancoFalso e APIs falsas: isolamento por organização no cache da 0063.
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

import { POST } from '@/app/api/prospeccao/decisor-internacional/route'

const ORG_A = 'aaaaaaaa-0000-4000-8000-000000000001'
const ORG_B = 'bbbbbbbb-0000-4000-8000-000000000002'
const USUARIO_A = 'aaaaaaaa-1111-4111-8111-00000000000a'
const EMAIL_B = 'ceo.b@hotel.pt'

const chamadas: string[] = []

beforeEach(() => {
  estado.banco = new BancoFalso({
    perfis: [{ id: USUARIO_A, organizacao_id: ORG_A, role: 'admin' }],
    perfil_permissoes: [],
    organizacoes: [{ id: ORG_A, configuracoes: { _schema_version: 9 } }, { id: ORG_B, configuracoes: { _schema_version: 9 } }],
    // A org B já pagou por este domínio: nunca pode vazar para a A.
    prospeccao_decisores_internacionais: [{
      organizacao_id: ORG_B, dominio: 'hotel.pt',
      candidatos: [{ nome: 'Bia Reis', cargo: 'CEO', linkedin: null, local: null }],
      anymail: [{ nome: 'Bia Reis', dominio: 'hotel.pt', status: 'valido', email: EMAIL_B, consultadoEm: 'x' }],
    }],
  })
  estado.usuarioId = USUARIO_A
  chamadas.length = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
    const u = String(url)
    chamadas.push(u)
    if (u.includes('crustdata')) return Response.json({ profiles: [{ basic_profile: { name: 'Ana Costa', current_title: 'CEO' } }] })
    if (u.includes('anymailfinder')) return Response.json({ email: 'ana@hotel.pt', email_status: 'valid' })
    return new Response('{}', { status: 404 })
  }))
  vi.stubEnv('ANYMAILFINDER_API_KEY', 'chave-teste')
  vi.stubEnv('CRUSTDATA_API_KEY', 'chave-teste')
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

const chamar = async (corpo: unknown) => {
  const res = await POST(new Request('http://localhost/api/prospeccao/decisor-internacional', { method: 'POST', body: JSON.stringify(corpo), headers: { 'Content-Type': 'application/json' } }))
  return { status: res.status, body: await res.json() }
}
const banco = () => estado.banco as BancoFalso

describe('POST /api/prospeccao/decisor-internacional', () => {
  it('sem sessão: 401 e nenhuma API chamada', async () => {
    estado.usuarioId = null
    expect((await chamar({ dominio: 'hotel.pt' })).status).toBe(401)
    expect(chamadas).toHaveLength(0)
  })

  it('domínio inválido: 400 sem chamar APIs pagas', async () => {
    expect((await chamar({ dominio: 'não é domínio' })).status).toBe(400)
    expect(chamadas).toHaveLength(0)
  })

  it('consulta para a org da sessão e não usa o cache da org B', async () => {
    const r = await chamar({ dominio: 'hotel.pt' })
    expect(r.body).toMatchObject({ status: 'completo', email: 'ana@hotel.pt', decisor: { nome: 'Ana Costa' } })
    expect(JSON.stringify(r.body)).not.toContain(EMAIL_B)
    const linhas = banco().linhas('prospeccao_decisores_internacionais')
    expect(linhas.filter((l) => l.organizacao_id === ORG_A)).toHaveLength(1)
    const daB = linhas.find((l) => l.organizacao_id === ORG_B)
    expect((daB?.anymail as { email: string }[])[0].email).toBe(EMAIL_B)
  })

  it('segunda busca da mesma org não chama nenhuma API de novo', async () => {
    await chamar({ dominio: 'hotel.pt' })
    chamadas.length = 0
    expect((await chamar({ dominio: 'hotel.pt' })).body.status).toBe('completo')
    expect(chamadas).toHaveLength(0)
  })
})
