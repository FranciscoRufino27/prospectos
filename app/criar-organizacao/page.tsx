'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';

// Onboarding de nova organização (item 1). Página deslogada, em tela cheia
// (ver exceção no ClientLayout). Cria org + primeiro admin via
// POST /api/organizacoes/criar e já loga o usuário na sequência.
export default function CriarOrganizacaoPage() {
  const router = useRouter();
  const [nomeOrg, setNomeOrg] = useState('');
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [codigo, setCodigo] = useState('');
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);

  async function handleCriar(e: React.FormEvent) {
    e.preventDefault();
    setCarregando(true);
    setErro('');

    const resp = await fetch('/api/organizacoes/criar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nomeOrg, nome, email, senha, codigo }),
    });
    const data = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      setErro(data?.erro || 'Não foi possível criar a organização.');
      setCarregando(false);
      return;
    }

    // Conta criada com senha já definida — loga direto e entra na plataforma.
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
    if (error) {
      // Org criada, mas login automático falhou — manda pro login manual.
      router.push('/login');
      return;
    }
    router.push('/pipeline');
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-[var(--t-bg-base,#0f1117)] flex items-center justify-center p-4">
      <div className="bg-[var(--t-bg-card,#1a1f2e)] rounded-2xl shadow-lg p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-slate-100">Criar organização</h1>
          <p className="text-slate-400 text-sm mt-1">Comece uma nova conta no ProspectOS</p>
        </div>

        <form onSubmit={handleCriar} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Nome da organização</label>
            <input
              type="text"
              value={nomeOrg}
              onChange={(e) => setNomeOrg(e.target.value)}
              required
              placeholder="Ex.: Minha Empresa Ltda"
              className="w-full border border-[var(--t-border,#2a3147)] rounded-lg px-3 py-2 text-sm bg-transparent text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Seu nome</label>
            <input
              type="text"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              required
              placeholder="Nome completo"
              className="w-full border border-[var(--t-border,#2a3147)] rounded-lg px-3 py-2 text-sm bg-transparent text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">E-mail</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="seu@email.com"
              className="w-full border border-[var(--t-border,#2a3147)] rounded-lg px-3 py-2 text-sm bg-transparent text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Senha</label>
            <input
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              required
              minLength={6}
              placeholder="Mínimo 6 caracteres"
              className="w-full border border-[var(--t-border,#2a3147)] rounded-lg px-3 py-2 text-sm bg-transparent text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Código de acesso</label>
            <input
              type="text"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              required
              placeholder="Código fornecido pela InovaCode"
              className="w-full border border-[var(--t-border,#2a3147)] rounded-lg px-3 py-2 text-sm bg-transparent text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {erro && <p className="text-red-500 text-sm">{erro}</p>}

          <button
            type="submit"
            disabled={carregando}
            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium py-2 rounded-lg text-sm transition-colors"
          >
            {carregando ? 'Criando...' : 'Criar organização'}
          </button>
        </form>

        <p className="text-center text-slate-500 text-sm mt-6">
          Já tem conta?{' '}
          <Link href="/login" className="text-indigo-400 hover:text-indigo-300">Entrar</Link>
        </p>
      </div>
    </div>
  );
}
