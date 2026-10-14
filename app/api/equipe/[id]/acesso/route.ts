// Acesso de um membro, gerido por um administrador: mandar link de redefinição
// de senha e bloquear/desbloquear o login. A senha em si nunca é lida nem
// exibida — o Supabase só guarda o hash.
//
// Exige `workspace.configure` (RBAC) e só age DENTRO da própria organização
// (org da sessão). A lógica fica em lib/equipe/acessoServidor.ts, compartilhada
// com a rota do dono da plataforma.
import { NextRequest, NextResponse } from 'next/server';
import { exigirPermissao } from '@/lib/rbac/servidor';
import { executarAcaoAcesso, isAcaoAcesso } from '@/lib/equipe/acessoServidor';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const acc = await exigirPermissao('workspace.configure');
    if ('erro' in acc) return acc.erro;
    const { user, admin, org } = acc.acesso;

    const corpo = (await req.json().catch(() => ({}))) as { acao?: unknown };
    if (!isAcaoAcesso(corpo.acao)) return NextResponse.json({ erro: 'Ação inválida' }, { status: 400 });

    const r = await executarAcaoAcesso(admin, { org, alvoId: id, chamadorId: user.id, acao: corpo.acao });
    return NextResponse.json(r.corpo, { status: r.status });
  } catch (err) {
    console.error('[equipe/[id]/acesso] erro interno:', err);
    return NextResponse.json({ erro: 'Erro interno' }, { status: 500 });
  }
}
