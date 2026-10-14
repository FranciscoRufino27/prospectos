import { beforeEach, describe, expect, it, vi } from 'vitest'

// Portão do dono da plataforma e as rotas /api/plataforma/** que ele protege:
// admin de organização (ou qualquer outro login) recebe 403 e nada é lido ou
// alterado fora da própria org.

const mocks = vi.hoisted(() => ({
  user: null as { id: string } | null,
  donos: new Set<string>(),
  tabelaAusente: false,
  listUsers: vi.fn(),
  updateUserById: vi.fn(),
  generateLink: vi.fn(),
  tabelasLidas: [] as string[],
}))

vi.mock('server-only', () => ({}))

vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: mocks.user } }) },
  }),
}))

vi.mock('@/lib/supabase-admin', () => ({
  createSupabaseAdminClient: () => ({
    from: (tabela: string) => {
      mocks.tabelasLidas.push(tabela)
      return {
        select: () => ({
          eq: (_col: string, valor: string) => ({
            maybeSingle: async () => {
              if (tabela !== 'administradores_plataforma') return { data: null, error: null }
              if (mocks.tabelaAusente) {
                return { data: null, error: { message: 'relation "administradores_plataforma" does not exist' } }
              }
              return { data: mocks.donos.has(valor) ? { usuario_id: valor } : null, error: null }
            },
          }),
        }),
      }
    },
    auth: {
      admin: {
        listUsers: mocks.listUsers,
        updateUserById: mocks.updateUserById,
        generateLink: mocks.generateLink,
        getUserById: vi.fn(),
      },
    },
  }),
}))

import { ehDonoPlataforma, exigirDonoPlataforma } from '../plataforma'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { GET as listarPlataforma } from '@/app/api/plataforma/usuarios/route'
import { POST as acessoPlataforma } from '@/app/api/plataforma/usuarios/[id]/acesso/route'

function req(corpo: unknown) {
  return new Request('http://localhost/api', { method: 'POST', body: JSON.stringify(corpo) }) as never
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.user = null
  mocks.donos = new Set(['dono-1'])
  mocks.tabelaAusente = false
  mocks.tabelasLidas.length = 0
})

describe('ehDonoPlataforma', () => {
  it('reconhece só quem está na tabela', async () => {
    const admin = createSupabaseAdminClient()
    expect(await ehDonoPlataforma(admin, 'dono-1')).toBe(true)
    expect(await ehDonoPlataforma(admin, 'admin-org')).toBe(false)
  })

  it('fecha na dúvida: tabela ausente (migration não aplicada) = não é dono', async () => {
    mocks.tabelaAusente = true
    expect(await ehDonoPlataforma(createSupabaseAdminClient(), 'dono-1')).toBe(false)
  })
})

describe('exigirDonoPlataforma', () => {
  it('401 sem sessão', async () => {
    const r = await exigirDonoPlataforma()
    expect('erro' in r && r.erro.status).toBe(401)
  })

  it('403 para quem não é dono (ex.: admin de organização)', async () => {
    mocks.user = { id: 'admin-org' }
    const r = await exigirDonoPlataforma()
    expect('erro' in r && r.erro.status).toBe(403)
  })

  it('libera o dono', async () => {
    mocks.user = { id: 'dono-1' }
    const r = await exigirDonoPlataforma()
    expect('acesso' in r && r.acesso.user.id).toBe('dono-1')
  })
})

describe('rotas /api/plataforma/** recusam quem não é dono', () => {
  it('listagem: 403 sem listar ninguém', async () => {
    mocks.user = { id: 'admin-org' }
    const res = await listarPlataforma()
    expect(res.status).toBe(403)
    expect(mocks.listUsers).not.toHaveBeenCalled()
    expect(mocks.tabelasLidas.filter((t) => t !== 'administradores_plataforma')).toEqual([])
  })

  it('ação de acesso: 403 sem tocar no login do alvo', async () => {
    mocks.user = { id: 'admin-org' }
    const res = await acessoPlataforma(req({ acao: 'bloquear' }), { params: Promise.resolve({ id: 'alvo-outra-org' }) })
    expect(res.status).toBe(403)
    expect(mocks.updateUserById).not.toHaveBeenCalled()
    expect(mocks.generateLink).not.toHaveBeenCalled()
  })

  it('ação de acesso: dono com ação inválida recebe 400', async () => {
    mocks.user = { id: 'dono-1' }
    const res = await acessoPlataforma(req({ acao: 'apagar' }), { params: Promise.resolve({ id: 'x' }) })
    expect(res.status).toBe(400)
    expect(mocks.updateUserById).not.toHaveBeenCalled()
  })

  it('ação de acesso: alvo sem organização → 404, nada alterado', async () => {
    mocks.user = { id: 'dono-1' }
    const res = await acessoPlataforma(req({ acao: 'bloquear' }), { params: Promise.resolve({ id: 'sem-perfil' }) })
    expect(res.status).toBe(404)
    expect(mocks.updateUserById).not.toHaveBeenCalled()
  })
})
