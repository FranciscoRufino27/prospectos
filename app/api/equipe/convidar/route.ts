import { NextRequest, NextResponse } from 'next/server';
import { exigirPermissao } from '@/lib/rbac/servidor';
import { convidarMembro } from '@/lib/equipe/convidarServidor';

export async function POST(req: NextRequest) {
  try {
    // SEGURANÇA (Fase 1 RBAC): enforcement no BACKEND por permissão real
    // (`workspace.configure`), não pela checagem hardcoded de role. Admins têm
    // essa permissão pelo backfill (migration 0015), então o comportamento é
    // preservado. `acesso` traz o service_role client + a org de quem chama —
    // a fronteira de confiança continua sendo o servidor, nunca o corpo.
    const acc = await exigirPermissao('workspace.configure');
    if ('erro' in acc) return acc.erro;
    const { admin, org } = acc.acesso;

    const r = await convidarMembro(admin, org, await req.json());
    return NextResponse.json(r.corpo, { status: r.status });
  } catch (err) {
    console.error('[equipe/convidar] erro interno:', err);
    return NextResponse.json({ erro: 'Erro interno' }, { status: 500 });
  }
}
