// Usuários de TODAS as organizações — só para o dono da plataforma (migration
// 0069). Admin de organização recebe 403: a visão dele é /api/equipe/listar.
import { NextResponse } from 'next/server';
import { exigirDonoPlataforma } from '@/lib/rbac/plataforma';
import { listarTodosUsuariosAuth } from '@/lib/equipe/usuariosAuthServidor';
import { montarUsuariosPlataforma } from '@/lib/equipe/usuariosPlataforma';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const acc = await exigirDonoPlataforma();
    if ('erro' in acc) return acc.erro;
    const { admin } = acc.acesso;

    const todos = await listarTodosUsuariosAuth(admin);
    if ('erro' in todos) return NextResponse.json({ erro: todos.erro }, { status: 400 });

    const [{ data: perfis, error: eP }, { data: orgs, error: eO }] = await Promise.all([
      admin.from('perfis').select('id, nome, role, avatar_url, organizacao_id'),
      admin.from('organizacoes').select('id, nome'),
    ]);
    if (eP || eO) return NextResponse.json({ erro: (eP ?? eO)!.message }, { status: 400 });

    const usuarios = montarUsuariosPlataforma(todos.usuarios, perfis ?? [], orgs ?? []);
    return NextResponse.json({ usuarios });
  } catch (err) {
    console.error('[plataforma/usuarios] erro interno:', err);
    return NextResponse.json({ erro: 'Erro interno' }, { status: 500 });
  }
}
