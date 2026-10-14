// Visão do dono da plataforma: usuários de TODAS as organizações (puro —
// testável sem banco). Só usado atrás de exigirDonoPlataforma().
import { estaBloqueado } from './acesso'

export interface UsuarioAuthResumo {
  id: string
  email?: string | null
  confirmed_at?: string | null
  last_sign_in_at?: string | null
  created_at: string
  banned_until?: string | null
}

export interface UsuarioPlataforma {
  id: string
  email: string
  nome: string | null
  role: 'admin' | 'usuario'
  confirmed_at: string | null
  last_sign_in_at: string | null
  created_at: string
  avatar_url: string | null
  bloqueado: boolean
  organizacao_id: string | null
  organizacao_nome: string | null
}

export function montarUsuariosPlataforma(
  usuarios: UsuarioAuthResumo[],
  perfis: { id: string; nome: string | null; role: string | null; avatar_url: string | null; organizacao_id: string | null }[],
  organizacoes: { id: string; nome: string | null }[],
): UsuarioPlataforma[] {
  const perfilPorId = new Map(perfis.map((p) => [p.id, p]))
  const nomeOrg = new Map(organizacoes.map((o) => [o.id, o.nome]))
  return usuarios.map((u) => {
    const perfil = perfilPorId.get(u.id)
    const org = perfil?.organizacao_id ?? null
    return {
      id: u.id,
      email: u.email ?? '',
      nome: perfil?.nome || null,
      role: perfil?.role === 'admin' ? 'admin' : 'usuario',
      confirmed_at: u.confirmed_at ?? null,
      last_sign_in_at: u.last_sign_in_at ?? null,
      created_at: u.created_at,
      avatar_url: perfil?.avatar_url || null,
      bloqueado: estaBloqueado(u.banned_until),
      // Login sem perfil (onboarding não concluído) fica sem organização: a
      // tela mostra, mas não oferece ações — elas exigem o perfil na org.
      organizacao_id: org,
      organizacao_nome: org ? (nomeOrg.get(org) ?? null) : null,
    }
  })
}
