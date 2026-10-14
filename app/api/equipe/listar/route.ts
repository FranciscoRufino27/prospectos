import { NextResponse } from 'next/server';
import type { User } from '@supabase/supabase-js';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { estaBloqueado } from '@/lib/equipe/acesso';

export async function GET() {
  try {
    const supabaseServer = await createSupabaseServerClient();
    const { data: { user } } = await supabaseServer.auth.getUser();
    if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });

    const supabaseAdmin = createSupabaseAdminClient();

    // Multi-tenant: só lista a equipe da PRÓPRIA organização de quem chama.
    // service_role bypassa RLS, então filtramos organizacao_id no código.
    const { data: convidante } = await supabaseAdmin
      .from('perfis').select('organizacao_id').eq('id', user.id).maybeSingle();
    const org = convidante?.organizacao_id as string | undefined;
    if (!org) return NextResponse.json({ erro: 'Usuário sem organização' }, { status: 400 });

    // listUsers é paginado sobre TODAS as organizações (padrão: 50 por página).
    // Sem percorrer as páginas, membros desta org além do 50º login da
    // plataforma sumiam da lista.
    const usuariosAuth: User[] = [];
    for (let page = 1; ; page++) {
      const { data: pagina, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) return NextResponse.json({ erro: error.message }, { status: 400 });
      usuariosAuth.push(...pagina.users);
      if (pagina.users.length < 1000) break;
    }

    const { data: perfis } = await supabaseAdmin
      .from('perfis').select('id, nome, role, nicho, avatar_url').eq('organizacao_id', org);

    // Só os usuários de auth que têm perfil NESTA organização entram na lista.
    const idsDaOrg = new Set((perfis ?? []).map((p) => p.id));

    // Os leads são atribuídos a um responsável da tabela `usuarios`. Já os
    // membros da equipe são usuários de auth; a ligação entre os dois é feita
    // pelo e-mail. `responsavel_id` NÃO é fonte de verdade hoje (100% null):
    // os leads do import HubSpot só têm `responsavel_nome`, com nome COMPLETO
    // ("Francisco Rufino") enquanto `usuarios.nome` é o curto ("Francisco").
    // Mesmo padrão de resolução de lib/api.ts (filtroResponsavelOr /
    // getLeadsPorResponsavel): casa por id OU prefixo case-insensitive do nome.
    const { data: usuarios } = await supabaseAdmin
      .from('usuarios').select('id, nome, email').eq('organizacao_id', org);
    const { data: leads } = await supabaseAdmin
      .from('leads').select('responsavel_id, responsavel_nome').eq('organizacao_id', org);

    const resolverUsuario = (l: { responsavel_id: string | null; responsavel_nome: string | null }) =>
      (usuarios ?? []).find(u =>
        u.id === l.responsavel_id ||
        (!!l.responsavel_nome && !!u.nome &&
          l.responsavel_nome.toLowerCase().startsWith(u.nome.toLowerCase()))
      );

    // usuarios.id -> total de leads atribuídos
    const leadsPorUsuario = new Map<string, number>();
    for (const l of leads ?? []) {
      const usr = resolverUsuario(l);
      if (!usr) continue;
      leadsPorUsuario.set(usr.id, (leadsPorUsuario.get(usr.id) ?? 0) + 1);
    }

    const membros = usuariosAuth.filter(u => idsDaOrg.has(u.id)).map(u => {
      const perfil = perfis?.find(p => p.id === u.id);
      // Membro auth -> SDR de `usuarios`: por e-mail igual quando bate, senão
      // pelo mesmo padrão de prefixo (usuarios.nome curto como prefixo do
      // perfis.nome completo — os convites de auth usam e-mails pessoais que
      // não existem em `usuarios`, ex.: franrufs13@gmail.com). Trade-off: duas
      // contas do mesmo humano (ex.: "Francisco Rufs" admin e "Francisco
      // Rufino") mostram a MESMA contagem do SDR Francisco — preferível a
      // zerar a conta que a pessoa realmente usa.
      const emailMembro = u.email?.toLowerCase();
      const sdr =
        (usuarios ?? []).find(usr => usr.email?.toLowerCase() === emailMembro) ??
        (usuarios ?? []).find(usr =>
          !!perfil?.nome && !!usr.nome &&
          perfil.nome.toLowerCase().startsWith(usr.nome.toLowerCase())
        );
      const totalLeads = sdr ? (leadsPorUsuario.get(sdr.id) ?? 0) : 0;
      return {
        id: u.id,
        email: u.email,
        nome: perfil?.nome || null,
        role: perfil?.role || 'usuario',
        nicho: perfil?.nicho || null,
        confirmed_at: u.confirmed_at,
        last_sign_in_at: u.last_sign_in_at,
        created_at: u.created_at,
        total_leads: totalLeads,
        avatar_url: perfil?.avatar_url || null,
        bloqueado: estaBloqueado(u.banned_until),
      };
    });

    return NextResponse.json({ membros });
  } catch (err) {
    console.error('[equipe/listar] erro interno:', err);
    return NextResponse.json({ erro: 'Erro interno' }, { status: 500 });
  }
}
