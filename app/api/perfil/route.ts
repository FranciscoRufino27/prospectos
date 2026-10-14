import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';
import { ehDonoPlataforma } from '@/lib/rbac/plataforma';

// GET — buscar perfil do usuário logado
export async function GET() {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });

    const admin = createSupabaseAdminClient();
    const { data: perfil } = await admin
      .from('perfis')
      .select('nome, role, nicho, avatar_url, telefone')
      .eq('id', user.id)
      .single();

    // Só decide o que a tela oferece; as rotas /api/plataforma/** conferem de novo.
    const donoPlataforma = await ehDonoPlataforma(admin, user.id);

    return NextResponse.json({ perfil: perfil || null, email: user.email, donoPlataforma });
  } catch {
    return NextResponse.json({ erro: 'Erro interno' }, { status: 500 });
  }
}

// POST — salvar/atualizar perfil do usuário logado
export async function POST(req: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });

    const { nome, nicho, avatar_url, telefone } = await req.json();

    const admin = createSupabaseAdminClient();

    // Papel do próprio usuário é a fonte de verdade (nunca o payload). Decide se
    // ele pode alterar o nicho.
    const { data: perfilAtual } = await admin
      .from('perfis')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();
    if (!perfilAtual) return NextResponse.json({ erro: 'Perfil não encontrado para este usuário.' }, { status: 404 });

    // UPDATE (não upsert): o perfil já existe (criado no onboarding/convite). O
    // upsert fazia INSERT...ON CONFLICT, e o braço de INSERT viola o NOT NULL de
    // organizacao_id (multi-tenant, migrations 0006/0007) — quebrando todo save.
    // Update por id só mexe nas colunas do formulário e preserva organizacao_id/role.
    const campos: Record<string, unknown> = { nome, avatar_url, telefone: telefone || null };

    // SEGURANÇA (item 1): o NICHO só é alterável por ADMIN. Para usuário comum, o
    // nicho vem do convite (definido pelo admin) e é IMUTÁVEL — ignoramos qualquer
    // valor vindo do cliente (frontend OU requisição manual à API). Ver doc de
    // ajustes: "a rota que processa o primeiro acesso deve ignorar/rejeitar
    // qualquer nicho vindo do payload, usando sempre o valor gravado no convite".
    if (perfilAtual.role === 'admin') campos.nicho = nicho;

    const { error } = await admin
      .from('perfis')
      .update(campos)
      .eq('id', user.id);

    if (error) return NextResponse.json({ erro: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ erro: 'Erro interno' }, { status: 500 });
  }
}
