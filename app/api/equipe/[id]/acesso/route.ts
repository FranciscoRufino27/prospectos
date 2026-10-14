// Acesso de um membro, gerido por um administrador: mandar link de redefinição
// de senha e bloquear/desbloquear o login. A senha em si nunca é lida nem
// exibida — o Supabase só guarda o hash.
//
// Exige `workspace.configure` (RBAC) e só age DENTRO da própria organização:
// service_role bypassa RLS, então o alvo é conferido em `perfis` com
// organizacao_id explícito antes de qualquer chamada ao auth.
import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { exigirPermissao } from '@/lib/rbac/servidor';
import { podeBloquearMembro } from '@/lib/rbac/guards';
import { enviarEmailConvite } from '@/lib/equipe/conviteEmailServidor';
import { estaBloqueado } from '@/lib/equipe/acesso';

export const runtime = 'nodejs';

// Bloqueio "por tempo indeterminado": o Supabase só aceita duração; 100 anos.
const BLOQUEIO_INDETERMINADO = '876000h';

const ACOES = ['redefinir_senha', 'bloquear', 'desbloquear'] as const;
type Acao = (typeof ACOES)[number];

// Admins da organização que ainda conseguem entrar (não bloqueados).
async function contarAdminsAtivos(admin: SupabaseClient, org: string): Promise<number> {
  const { data: admins } = await admin
    .from('perfis').select('id').eq('organizacao_id', org).eq('role', 'admin');
  let ativos = 0;
  for (const a of admins ?? []) {
    const { data } = await admin.auth.admin.getUserById(a.id as string);
    if (data?.user && !estaBloqueado(data.user.banned_until)) ativos++;
  }
  return ativos;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const acc = await exigirPermissao('workspace.configure');
    if ('erro' in acc) return acc.erro;
    const { user, admin, org } = acc.acesso;

    const corpo = (await req.json().catch(() => ({}))) as { acao?: unknown };
    const acao = corpo.acao as Acao;
    if (!ACOES.includes(acao)) return NextResponse.json({ erro: 'Ação inválida' }, { status: 400 });

    // O alvo precisa existir NA mesma organização.
    const { data: alvo } = await admin
      .from('perfis').select('id, role').eq('id', id).eq('organizacao_id', org).maybeSingle();
    if (!alvo) return NextResponse.json({ erro: 'Membro não encontrado' }, { status: 404 });

    const { data: authAlvo } = await admin.auth.admin.getUserById(id);
    const email = authAlvo?.user?.email;
    if (!authAlvo?.user || !email) return NextResponse.json({ erro: 'Membro sem acesso cadastrado' }, { status: 404 });

    if (acao === 'redefinir_senha') {
      if (estaBloqueado(authAlvo.user.banned_until)) {
        return NextResponse.json({ erro: 'Desbloqueie o acesso antes de redefinir a senha.' }, { status: 400 });
      }
      // Mesmo caminho do convite: gera o link sem o e-mail padrão do Supabase
      // e envia pela conta Gmail do workspace. O link volta na resposta para o
      // admin repassar se o e-mail não sair.
      const { data, error } = await admin.auth.admin.generateLink({
        type: 'recovery',
        email,
        options: { redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/definir-senha` },
      });
      if (error) return NextResponse.json({ erro: error.message }, { status: 400 });
      const link = data?.properties?.action_link ?? null;
      const envio = await enviarEmailConvite(admin, org, { email, actionLink: link, tipo: 'redefinicao' });
      return NextResponse.json({ ok: true, link, ...envio });
    }

    if (acao === 'bloquear') {
      const regra = podeBloquearMembro({
        alvoId: id,
        alvoRole: alvo.role as string,
        chamadorId: user.id,
        adminsAtivos: await contarAdminsAtivos(admin, org),
      });
      if (!regra.ok) return NextResponse.json({ erro: regra.erro }, { status: regra.status });
    }

    const { error } = await admin.auth.admin.updateUserById(id, {
      ban_duration: acao === 'bloquear' ? BLOQUEIO_INDETERMINADO : 'none',
    });
    if (error) return NextResponse.json({ erro: error.message }, { status: 400 });

    return NextResponse.json({ ok: true, bloqueado: acao === 'bloquear' });
  } catch (err) {
    console.error('[equipe/[id]/acesso] erro interno:', err);
    return NextResponse.json({ erro: 'Erro interno' }, { status: 500 });
  }
}
