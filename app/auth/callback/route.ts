import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';

// Retorno do login com Google (OAuth, fluxo PKCE). Troca o `code` pela sessão e
// só deixa entrar quem já tem perfil numa organização: o Google autentica a
// pessoa, mas o acesso continua vindo de convite / criação de organização.
// Conta sem organização sai deslogada, com aviso na tela de login.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const voltar = (erro?: string) =>
    NextResponse.redirect(new URL(erro ? `/login?erro=${erro}` : '/pipeline', origin));

  const code = searchParams.get('code');
  if (!code) return voltar('google');

  // "Lembrar de mim" (ver lib/supabase-browser.ts): sem lembrar, cookie de
  // sessão (sem Max-Age), descartado ao fechar o navegador.
  const lembrar = searchParams.get('lembrar') !== '0';
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, lembrar ? options : { ...options, maxAge: undefined }),
          );
        },
      },
    },
  );

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) return voltar('google');

  const admin = createSupabaseAdminClient();
  const { data: perfil } = await admin
    .from('perfis').select('organizacao_id').eq('id', data.user.id).maybeSingle();
  if (!perfil?.organizacao_id) {
    await supabase.auth.signOut();
    return voltar('sem-conta');
  }

  return voltar();
}
