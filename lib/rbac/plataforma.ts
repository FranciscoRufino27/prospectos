// Dono da plataforma: papel GLOBAL, acima do admin de organização (migration
// 0069, tabela administradores_plataforma). Só ele enxerga usuários de outras
// organizações. Fecha na dúvida: erro de consulta ou tabela ausente (migration
// não aplicada) = não é dono.
import 'server-only'
import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

export async function ehDonoPlataforma(admin: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await admin
    .from('administradores_plataforma').select('usuario_id').eq('usuario_id', userId).maybeSingle()
  if (error) return false
  return !!data
}

type Resultado =
  | { erro: NextResponse }
  | { acesso: { user: { id: string; email?: string | null }; admin: SupabaseClient } }

// Portão das rotas /api/plataforma/**: 401 sem sessão, 403 para quem não é dono.
export async function exigirDonoPlataforma(): Promise<Resultado> {
  const server = await createSupabaseServerClient()
  const { data: { user } } = await server.auth.getUser()
  if (!user) return { erro: NextResponse.json({ erro: 'Não autenticado' }, { status: 401 }) }
  const admin = createSupabaseAdminClient()
  if (!(await ehDonoPlataforma(admin, user.id))) {
    return { erro: NextResponse.json({ erro: 'Sem permissão para esta ação' }, { status: 403 }) }
  }
  return { acesso: { user, admin } }
}
