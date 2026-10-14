import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ enviar: vi.fn(), ressincronizar: vi.fn() }))
vi.mock('@/lib/equipe/conviteEmailServidor', () => ({ enviarEmailConvite: mocks.enviar }))
vi.mock('@/lib/rbac/servidor', () => ({ ressincronizarPermissoes: mocks.ressincronizar }))

import { convidarMembro } from '../convidarServidor'

function adminStub() {
  const escritas: { tabela: string; op: string; valor: Record<string, unknown> }[] = []
  const generateLink = vi.fn(async () => ({
    data: { user: { id: 'novo-1' }, properties: { action_link: 'https://convite' } },
    error: null,
  }))
  const admin = {
    from: (tabela: string) => {
      const q = {
        upsert: async (valor: Record<string, unknown>) => { escritas.push({ tabela, op: 'upsert', valor }); return {} },
        insert: async (valor: Record<string, unknown>) => { escritas.push({ tabela, op: 'insert', valor }); return {} },
        select: () => q,
        eq: () => q,
        ilike: async () => ({ data: [] }),
      }
      return q
    },
    auth: { admin: { generateLink } },
  } as unknown as SupabaseClient
  return { admin, escritas, generateLink }
}

beforeEach(() => {
  mocks.enviar.mockReset()
  mocks.ressincronizar.mockReset()
  mocks.enviar.mockResolvedValue({ emailEnviado: true, simulado: false, remetente: 'org@gmail.com' })
})

describe('convidarMembro', () => {
  it('cria o membro SEMPRE na organização recebida e envia pela conta dela', async () => {
    const { admin, escritas } = adminStub()
    // Um organizacao_id no corpo é ignorado: vale só a org passada pela rota.
    const corpo: Record<string, unknown> = {
      email: ' Novo@Empresa.com ', nome: 'Novo Membro', role: 'admin', nicho: 'Saúde', organizacao_id: 'org-b',
    }
    const r = await convidarMembro(admin, 'org-a', corpo)
    expect(r.status).toBe(200)
    expect(escritas).toEqual([
      { tabela: 'perfis', op: 'upsert', valor: { id: 'novo-1', nome: 'Novo Membro', role: 'admin', nicho: 'Saúde', organizacao_id: 'org-a' } },
      { tabela: 'usuarios', op: 'insert', valor: expect.objectContaining({ email: 'novo@empresa.com', organizacao_id: 'org-a', avatar_iniciais: 'NM' }) },
    ])
    expect(mocks.ressincronizar).toHaveBeenCalledWith(admin, 'org-a', 'novo-1', 'admin')
    expect(mocks.enviar).toHaveBeenCalledWith(admin, 'org-a', { email: 'Novo@Empresa.com', actionLink: 'https://convite' })
  })

  it('sem e-mail ou com papel desconhecido não cria login', async () => {
    const { admin, generateLink } = adminStub()
    expect((await convidarMembro(admin, 'org-a', { email: '  ' })).status).toBe(400)
    expect((await convidarMembro(admin, 'org-a', { email: 'a@b.com', role: 'dono' })).status).toBe(400)
    expect(generateLink).not.toHaveBeenCalled()
  })
})
