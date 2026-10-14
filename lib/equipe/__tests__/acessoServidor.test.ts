import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('server-only', () => ({}))
const enviar = vi.hoisted(() => vi.fn())
vi.mock('@/lib/equipe/conviteEmailServidor', () => ({ enviarEmailConvite: enviar }))

import { executarAcaoAcesso } from '../acessoServidor'

// perfis: membro u1 na org-a; admins da org-a: a1 (ativo).
const PERFIS = [
  { id: 'u1', role: 'usuario', organizacao_id: 'org-a' },
  { id: 'a1', role: 'admin', organizacao_id: 'org-a' },
]

function adminStub() {
  const updateUserById = vi.fn(async () => ({ error: null }))
  const generateLink = vi.fn(async () => ({ data: { properties: { action_link: 'https://link' } }, error: null }))
  const admin = {
    from: () => {
      const filtros: Record<string, string> = {}
      const q = {
        select: () => q,
        eq: (c: string, v: string) => { filtros[c] = v; return q },
        maybeSingle: async () => ({
          data: PERFIS.find((p) => p.id === filtros.id && p.organizacao_id === filtros.organizacao_id) ?? null,
        }),
        then: (res: (v: unknown) => void) =>
          res({ data: PERFIS.filter((p) => p.organizacao_id === filtros.organizacao_id && (!filtros.role || p.role === filtros.role)) }),
      }
      return q
    },
    auth: {
      admin: {
        getUserById: async (id: string) => ({ data: { user: { id, email: `${id}@x.com`, banned_until: null } } }),
        updateUserById,
        generateLink,
      },
    },
  } as unknown as SupabaseClient
  return { admin, updateUserById, generateLink }
}

beforeEach(() => {
  enviar.mockReset()
  enviar.mockResolvedValue({ emailEnviado: true, simulado: false, remetente: 'org@gmail.com' })
})

describe('executarAcaoAcesso — isolamento por organização', () => {
  it('alvo de OUTRA organização → 404, sem bloquear nem gerar link', async () => {
    const { admin, updateUserById, generateLink } = adminStub()
    for (const acao of ['bloquear', 'desbloquear', 'redefinir_senha'] as const) {
      const r = await executarAcaoAcesso(admin, { org: 'org-b', alvoId: 'u1', chamadorId: 'b-admin', acao })
      expect(r.status).toBe(404)
    }
    expect(updateUserById).not.toHaveBeenCalled()
    expect(generateLink).not.toHaveBeenCalled()
    expect(enviar).not.toHaveBeenCalled()
  })

  it('alvo da própria organização é bloqueado', async () => {
    const { admin, updateUserById } = adminStub()
    const r = await executarAcaoAcesso(admin, { org: 'org-a', alvoId: 'u1', chamadorId: 'a1', acao: 'bloquear' })
    expect(r).toEqual({ status: 200, corpo: { ok: true, bloqueado: true } })
    expect(updateUserById).toHaveBeenCalledWith('u1', { ban_duration: '876000h' })
  })

  it('redefinição envia pela conta da organização do alvo', async () => {
    const { admin, generateLink } = adminStub()
    const r = await executarAcaoAcesso(admin, { org: 'org-a', alvoId: 'u1', chamadorId: 'a1', acao: 'redefinir_senha' })
    expect(r.status).toBe(200)
    expect(generateLink).toHaveBeenCalledWith(expect.objectContaining({ type: 'recovery', email: 'u1@x.com' }))
    expect(enviar).toHaveBeenCalledWith(admin, 'org-a', expect.objectContaining({ tipo: 'redefinicao', actionLink: 'https://link' }))
  })

  it('não bloqueia o último admin ativo', async () => {
    const { admin, updateUserById } = adminStub()
    const r = await executarAcaoAcesso(admin, { org: 'org-a', alvoId: 'a1', chamadorId: 'dono-1', acao: 'bloquear' })
    expect(r.status).toBe(400)
    expect(updateUserById).not.toHaveBeenCalled()
  })
})
