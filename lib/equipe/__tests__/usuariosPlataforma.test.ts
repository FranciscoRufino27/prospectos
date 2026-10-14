import { describe, expect, it } from 'vitest'
import { montarUsuariosPlataforma } from '../usuariosPlataforma'

const ORGS = [
  { id: 'org-a', nome: 'Inovacode' },
  { id: 'org-b', nome: 'Laudo de Brinquedos' },
]

describe('montarUsuariosPlataforma', () => {
  it('junta login, perfil e organização de cada usuário, de todas as orgs', () => {
    const r = montarUsuariosPlataforma(
      [
        { id: 'u1', email: 'a@x.com', created_at: '2026-01-01', confirmed_at: '2026-01-02', last_sign_in_at: null },
        { id: 'u2', email: 'b@y.com', created_at: '2026-02-01', banned_until: '2126-01-01T00:00:00Z' },
      ],
      [
        { id: 'u1', nome: 'Ana', role: 'admin', avatar_url: null, organizacao_id: 'org-a' },
        { id: 'u2', nome: 'Bia', role: 'usuario', avatar_url: 'http://f/b.png', organizacao_id: 'org-b' },
      ],
      ORGS,
    )
    expect(r).toEqual([
      expect.objectContaining({ id: 'u1', nome: 'Ana', role: 'admin', organizacao_id: 'org-a', organizacao_nome: 'Inovacode', bloqueado: false }),
      expect.objectContaining({ id: 'u2', nome: 'Bia', role: 'usuario', organizacao_id: 'org-b', organizacao_nome: 'Laudo de Brinquedos', bloqueado: true }),
    ])
  })

  it('login sem perfil aparece sem organização, como usuário comum', () => {
    const [u] = montarUsuariosPlataforma([{ id: 'u9', email: 'novo@z.com', created_at: '2026-03-01' }], [], ORGS)
    expect(u).toMatchObject({ organizacao_id: null, organizacao_nome: null, role: 'usuario', nome: null })
  })

  it('role desconhecido não vira admin', () => {
    const [u] = montarUsuariosPlataforma(
      [{ id: 'u1', email: 'a@x.com', created_at: '2026-01-01' }],
      [{ id: 'u1', nome: null, role: 'qualquer', avatar_url: null, organizacao_id: 'org-a' }],
      ORGS,
    )
    expect(u.role).toBe('usuario')
  })
})
