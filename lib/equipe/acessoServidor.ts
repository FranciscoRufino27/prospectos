// Ações de acesso sobre um membro (redefinir senha, bloquear, desbloquear),
// compartilhadas pela rota do admin de organização (/api/equipe/[id]/acesso)
// e pela do dono da plataforma (/api/plataforma/usuarios/[id]/acesso).
//
// `org` vem SEMPRE de fonte confiável: a sessão do admin, ou o perfil do alvo
// lido no banco (dono da plataforma) — nunca do corpo da requisição. O alvo é
// conferido em `perfis` com organizacao_id explícito (service_role ignora RLS).
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { podeBloquearMembro } from '@/lib/rbac/guards'
import { enviarEmailConvite } from '@/lib/equipe/conviteEmailServidor'
import { estaBloqueado } from '@/lib/equipe/acesso'

export const ACOES_ACESSO = ['redefinir_senha', 'bloquear', 'desbloquear'] as const
export type AcaoAcesso = (typeof ACOES_ACESSO)[number]

export function isAcaoAcesso(v: unknown): v is AcaoAcesso {
  return typeof v === 'string' && (ACOES_ACESSO as readonly string[]).includes(v)
}

// Bloqueio "por tempo indeterminado": o Supabase só aceita duração; 100 anos.
const BLOQUEIO_INDETERMINADO = '876000h'

// Admins da organização que ainda conseguem entrar (não bloqueados).
async function contarAdminsAtivos(admin: SupabaseClient, org: string): Promise<number> {
  const { data: admins } = await admin
    .from('perfis').select('id').eq('organizacao_id', org).eq('role', 'admin')
  let ativos = 0
  for (const a of admins ?? []) {
    const { data } = await admin.auth.admin.getUserById(a.id as string)
    if (data?.user && !estaBloqueado(data.user.banned_until)) ativos++
  }
  return ativos
}

export async function executarAcaoAcesso(
  admin: SupabaseClient,
  p: { org: string; alvoId: string; chamadorId: string; acao: AcaoAcesso },
): Promise<{ status: number; corpo: Record<string, unknown> }> {
  const { data: alvo } = await admin
    .from('perfis').select('id, role').eq('id', p.alvoId).eq('organizacao_id', p.org).maybeSingle()
  if (!alvo) return { status: 404, corpo: { erro: 'Membro não encontrado' } }

  const { data: authAlvo } = await admin.auth.admin.getUserById(p.alvoId)
  const email = authAlvo?.user?.email
  if (!authAlvo?.user || !email) return { status: 404, corpo: { erro: 'Membro sem acesso cadastrado' } }

  if (p.acao === 'redefinir_senha') {
    if (estaBloqueado(authAlvo.user.banned_until)) {
      return { status: 400, corpo: { erro: 'Desbloqueie o acesso antes de redefinir a senha.' } }
    }
    // Mesmo caminho do convite: gera o link sem o e-mail padrão do Supabase e
    // envia pela conta Gmail do workspace DO ALVO. O link volta na resposta
    // para repasse manual se o e-mail não sair.
    const { data, error } = await admin.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: { redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/definir-senha` },
    })
    if (error) return { status: 400, corpo: { erro: error.message } }
    const link = data?.properties?.action_link ?? null
    const envio = await enviarEmailConvite(admin, p.org, { email, actionLink: link, tipo: 'redefinicao' })
    return { status: 200, corpo: { ok: true, link, ...envio } }
  }

  if (p.acao === 'bloquear') {
    const regra = podeBloquearMembro({
      alvoId: p.alvoId,
      alvoRole: alvo.role as string,
      chamadorId: p.chamadorId,
      adminsAtivos: await contarAdminsAtivos(admin, p.org),
    })
    if (!regra.ok) return { status: regra.status, corpo: { erro: regra.erro } }
  }

  const { error } = await admin.auth.admin.updateUserById(p.alvoId, {
    ban_duration: p.acao === 'bloquear' ? BLOQUEIO_INDETERMINADO : 'none',
  })
  if (error) return { status: 400, corpo: { erro: error.message } }
  return { status: 200, corpo: { ok: true, bloqueado: p.acao === 'bloquear' } }
}
