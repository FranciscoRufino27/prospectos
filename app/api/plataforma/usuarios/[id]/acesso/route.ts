// Acesso de qualquer usuário da plataforma, gerido pelo dono da plataforma
// (migration 0069). A organização do alvo vem do perfil dele no banco, nunca
// do corpo; as travas (auto-bloqueio, último admin ativo da org do alvo) são as
// mesmas da rota do admin de organização.
import { NextRequest, NextResponse } from 'next/server';
import { exigirDonoPlataforma } from '@/lib/rbac/plataforma';
import { executarAcaoAcesso, isAcaoAcesso } from '@/lib/equipe/acessoServidor';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const acc = await exigirDonoPlataforma();
    if ('erro' in acc) return acc.erro;
    const { user, admin } = acc.acesso;

    const corpo = (await req.json().catch(() => ({}))) as { acao?: unknown };
    if (!isAcaoAcesso(corpo.acao)) return NextResponse.json({ erro: 'Ação inválida' }, { status: 400 });

    const { data: perfil } = await admin
      .from('perfis').select('organizacao_id').eq('id', id).maybeSingle();
    const org = perfil?.organizacao_id as string | undefined;
    if (!org) return NextResponse.json({ erro: 'Usuário sem organização' }, { status: 404 });

    const r = await executarAcaoAcesso(admin, { org, alvoId: id, chamadorId: user.id, acao: corpo.acao });
    return NextResponse.json(r.corpo, { status: r.status });
  } catch (err) {
    console.error('[plataforma/usuarios/[id]/acesso] erro interno:', err);
    return NextResponse.json({ erro: 'Erro interno' }, { status: 500 });
  }
}
