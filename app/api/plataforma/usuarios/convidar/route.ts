// Convite de usuário pelo dono da plataforma (migration 0069), para QUALQUER
// organização. Exceção deliberada à regra "org nunca vem do payload": o dono
// existe justamente para agir em todas as orgs. A org escolhida é conferida no
// banco antes de qualquer escrita; admin de organização recebe 403 aqui e
// convida pela /api/equipe/convidar (org da sessão).
import { NextRequest, NextResponse } from 'next/server';
import { exigirDonoPlataforma } from '@/lib/rbac/plataforma';
import { convidarMembro } from '@/lib/equipe/convidarServidor';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const acc = await exigirDonoPlataforma();
    if ('erro' in acc) return acc.erro;
    const { admin } = acc.acesso;

    const corpo = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const orgId = typeof corpo.organizacao_id === 'string' ? corpo.organizacao_id : '';
    if (!orgId) return NextResponse.json({ erro: 'Escolha a organização do usuário' }, { status: 400 });

    const { data: org } = await admin.from('organizacoes').select('id').eq('id', orgId).maybeSingle();
    if (!org) return NextResponse.json({ erro: 'Organização não encontrada' }, { status: 404 });

    const r = await convidarMembro(admin, org.id as string, corpo);
    return NextResponse.json(r.corpo, { status: r.status });
  } catch (err) {
    console.error('[plataforma/usuarios/convidar] erro interno:', err);
    return NextResponse.json({ erro: 'Erro interno' }, { status: 500 });
  }
}
