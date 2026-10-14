// Convite de um novo membro para uma organização: cria o login (sem senha —
// a pessoa define a própria pelo link), o perfil, as permissões do papel e a
// linha em `usuarios`, e envia o e-mail pela conta Gmail do workspace.
//
// Compartilhado pela rota do admin de organização (/api/equipe/convidar, org
// da sessão) e pela do dono da plataforma (/api/plataforma/usuarios/convidar,
// org escolhida por ele e conferida no banco). `org` chega aqui já confiável.
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ressincronizarPermissoes } from '@/lib/rbac/servidor'
import { enviarEmailConvite } from '@/lib/equipe/conviteEmailServidor'

export async function convidarMembro(
  admin: SupabaseClient,
  org: string,
  entrada: { email?: unknown; nome?: unknown; role?: unknown; nicho?: unknown },
): Promise<{ status: number; corpo: Record<string, unknown> }> {
  const email = typeof entrada.email === 'string' ? entrada.email.trim() : ''
  const nome = typeof entrada.nome === 'string' && entrada.nome.trim() ? entrada.nome.trim() : null
  const nicho = typeof entrada.nicho === 'string' && entrada.nicho ? entrada.nicho : null
  const role = entrada.role ?? 'usuario'
  if (!email) return { status: 400, corpo: { erro: 'Email obrigatório' } }
  // Só papéis conhecidos; nunca deixa o corpo injetar valor arbitrário.
  if (role !== 'admin' && role !== 'usuario') return { status: 400, corpo: { erro: 'Papel inválido' } }

  // `generateLink` cria o usuário de auth (igual `inviteUserByEmail`), mas NÃO
  // dispara o e-mail padrão do Supabase (remetente genérico, rate-limited).
  // O e-mail de convite sai abaixo, pela conta Gmail do workspace da org
  // (mesma de campanhas/Central — ver lib/equipe/conviteEmailServidor).
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'invite',
    email,
    options: { redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/definir-senha` },
  })
  if (error || !data?.user) {
    return { status: 400, corpo: { erro: error?.message ?? 'Falha ao gerar convite' } }
  }

  await admin.from('perfis').upsert({
    id: data.user.id,
    nome,
    role,
    nicho,
    // Novo usuário SEMPRE na organização recebida (já validada pela rota).
    organizacao_id: org,
  })

  // RBAC (Fase 1): concede ao convidado o conjunto padrão de permissões do seu
  // role, para o novo membro já nascer autorizado corretamente.
  await ressincronizarPermissoes(admin, org, data.user.id, role)

  // Garante a linha correspondente em `usuarios` (ligada por e-mail EXATO) já
  // no convite. Antes o convite só criava acesso de login (perfis) e NÃO a
  // linha em usuarios — foi o que causou o bug de CC do follow-up (Rufs/Rufino):
  // leads.responsavel_id aponta p/ usuarios, e sem essa linha o motor não achava
  // o responsável. Idempotente: se já existe usuarios com este e-mail na org,
  // não duplica. Ver [[leads-responsavel-data-model]] e lib/leads/responsavel.ts.
  const emailNorm = email.toLowerCase()
  const { data: jaExiste } = await admin
    .from('usuarios')
    .select('id')
    .eq('organizacao_id', org)
    .ilike('email', emailNorm)
  if (!jaExiste || jaExiste.length === 0) {
    const base: string[] = String(nome || emailNorm).split(/\s+/).filter(Boolean)
    const iniciais = base.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('')
    await admin.from('usuarios').insert({
      nome,
      email: emailNorm,
      ativo: true,
      avatar_iniciais: iniciais || null,
      organizacao_id: org,
    })
  }

  // Envio pela conta Gmail DO WORKSPACE da org. O usuário e as linhas de
  // perfis/usuarios acima já existem mesmo se o e-mail falhar — nunca
  // desfazemos o convite por isso; o link volta para o admin repassar.
  const actionLink = data.properties?.action_link ?? null
  const envio = await enviarEmailConvite(admin, org, { email, actionLink })
  return { status: 200, corpo: { ok: true, link: actionLink, ...envio } }
}
