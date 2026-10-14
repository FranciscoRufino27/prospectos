import 'server-only'
import type { SupabaseClient, User } from '@supabase/supabase-js'

// Todos os logins da plataforma. listUsers é paginado sobre TODAS as
// organizações (padrão: 50 por página); sem percorrer as páginas, usuários
// além do 50º login sumiam das listas.
export async function listarTodosUsuariosAuth(
  admin: SupabaseClient,
): Promise<{ usuarios: User[] } | { erro: string }> {
  const usuarios: User[] = []
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) return { erro: error.message }
    usuarios.push(...data.users)
    if (data.users.length < 1000) return { usuarios }
  }
}
