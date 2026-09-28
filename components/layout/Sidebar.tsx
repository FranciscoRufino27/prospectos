'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LayoutDashboard, Settings, Zap, LogOut } from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import { agruparMenu, EVENTO_MENU_ATUALIZADO, itensVisiveis } from '@/lib/navegacao/menu';
import { ICONE_MENU } from './iconesMenu';

// Navegação consolidada (auditoria 11/08): Oportunidades, Campanhas, ROI,
// Processo comercial, Tarefas e Workflows deixaram de ser itens de 1º nível —
// viraram abas/visões dentro de módulos maiores (Automação, Comercial,
// Inteligência Comercial, Configurações). As rotas antigas redirecionam.
// A organização escolhe o que aparece (Configurações > Personalização > Menu);
// a lista, os grupos (Visão / Execução / Gestão / Administração) e a regra
// ficam em lib/navegacao/menu.ts.

interface PerfilSidebar {
  nome: string | null;
  email: string | null;
  avatar_url: string | null;
}

function avatarFallback(nome: string | null, email: string | null) {
  const seed = nome || email || 'Usuário';
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(seed)}&background=4F46E5&color=fff&size=64&bold=true`;
}

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [perfil, setPerfil] = useState<PerfilSidebar | null>(null);
  // Configurações governa o workspace inteiro (motor, pipelines, personalização).
  // Sem `workspace.configure` o item nem aparece — a página e as APIs recusam de
  // qualquer forma, isto só evita oferecer um caminho que termina em erro.
  const [podeConfigurar, setPodeConfigurar] = useState(false);
  // null = ainda carregando: não desenha a lista para não piscar item escondido.
  const [modulos, setModulos] = useState<Record<string, boolean> | null>(null);

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + '/');

  useEffect(() => {
    let ativo = true;
    fetch('/api/perfil')
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (!ativo || !data) return;
        setPerfil({
          nome: data.perfil?.nome ?? null,
          email: data.email ?? null,
          avatar_url: data.perfil?.avatar_url ?? null,
        });
      })
      .catch(() => {});
    fetch('/api/configuracoes/workspace')
      .then(r => (r.ok ? r.json() : null))
      .then(data => { if (ativo) setModulos(data?.config?.modulos ?? {}); })
      .catch(() => { if (ativo) setModulos({}); });
    fetch('/api/rbac/permissoes')
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (!ativo) return;
        const minhas: string[] = Array.isArray(data?.minhas) ? data.minhas : [];
        setPodeConfigurar(minhas.includes('workspace.configure'));
      })
      .catch(() => {});
    // Salvar em Personalização > Menu reflete aqui sem recarregar a página.
    const aoAtualizar = (e: Event) => setModulos((e as CustomEvent<Record<string, boolean>>).detail ?? {});
    window.addEventListener(EVENTO_MENU_ATUALIZADO, aoAtualizar);
    return () => { ativo = false; window.removeEventListener(EVENTO_MENU_ATUALIZADO, aoAtualizar); };
  }, []);

  async function handleLogout() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  const navItemClasses = (active: boolean) =>
    `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all border-l-[3px] ${
      active
        ? 'bg-[var(--sb-active)] text-[var(--sb-text-strong)] border-indigo-400'
        : 'text-indigo-200 border-transparent hover:bg-[var(--sb-hover)] hover:text-[var(--sb-text-strong)]'
    }`;

  return (
    <aside className="flex flex-col w-60 min-h-screen shrink-0 bg-[var(--sb-bg)] border-r border-[var(--sb-edge)]">
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-5 py-5 border-b border-[var(--sb-line)]">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-green-500 shadow-sm">
          <Zap size={16} className="text-white" />
        </div>
        <div>
          <div className="text-[var(--sb-text-strong)] font-bold text-sm leading-tight">ProspectOS</div>
        </div>
      </div>

      {/* Main Navigation — em grupos; grupo vazio some. Administração fica
          enquanto houver Configurações para mostrar. */}
      <nav className="flex-1 px-3 py-4 space-y-4">
        {modulos !== null && agruparMenu(itensVisiveis(modulos), podeConfigurar ? ['administracao'] : []).map((grupo) => (
          <div key={grupo.id} role="group" aria-labelledby={`menu-grupo-${grupo.id}`}>
            <p
              id={`menu-grupo-${grupo.id}`}
              className="px-3 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-indigo-300/60"
            >
              {grupo.label}
            </p>
            <div className="space-y-1">
              {grupo.itens.map(({ id, href, label }) => {
                const Icon = ICONE_MENU[id] ?? LayoutDashboard;
                return (
                  <Link key={href} href={href} className={navItemClasses(isActive(href))}>
                    <Icon size={18} strokeWidth={1.8} />
                    {label}
                  </Link>
                );
              })}
              {grupo.id === 'administracao' && podeConfigurar && (
                <Link href="/configuracoes" className={navItemClasses(isActive('/configuracoes'))}>
                  <Settings size={18} strokeWidth={1.8} />
                  Configurações
                </Link>
              )}
            </div>
          </div>
        ))}
      </nav>

      {/* Sair */}
      <div className="px-3 pb-2 border-t border-[var(--sb-line)] pt-3">
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all border-l-[3px] border-transparent w-full text-[#FC8181] [[data-tema=claro]_&]:text-red-600 hover:bg-red-500/10"
        >
          <LogOut size={18} strokeWidth={1.8} />
          Sair
        </button>
      </div>

      {/* Usuário logado */}
      <Link
        href="/perfil"
        className="flex items-center gap-3 px-4 py-3 border-t border-[var(--sb-line)] hover:bg-[var(--sb-hover)] transition-colors"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={perfil?.avatar_url || avatarFallback(perfil?.nome ?? null, perfil?.email ?? null)}
          alt={perfil?.nome || 'Usuário'}
          className="w-8 h-8 rounded-full object-cover shrink-0"
        />
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--sb-text-strong)] truncate">
            {perfil?.nome || 'Meu perfil'}
          </p>
          <p className="text-xs text-indigo-300 truncate">
            {perfil?.email || 'Ver conta'}
          </p>
        </div>
      </Link>
    </aside>
  );
}
