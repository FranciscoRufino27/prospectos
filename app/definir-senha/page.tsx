'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';

export default function DefinirSenhaPage() {
  const router = useRouter();
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [sessaoPronta, setSessaoPronta] = useState(false);
  const [preparando, setPreparando] = useState(true);

  // Ao carregar, ativa a sessão a partir dos tokens no hash da URL do convite
  useEffect(() => {
    async function ativarSessao() {
      const hash = window.location.hash.startsWith('#')
        ? window.location.hash.substring(1)
        : window.location.hash;
      const params = new URLSearchParams(hash);
      const access_token = params.get('access_token');
      const refresh_token = params.get('refresh_token');
      const errorDescription = params.get('error_description');

      if (errorDescription) {
        setErro(errorDescription);
        setPreparando(false);
        return;
      }

      if (!access_token || !refresh_token) {
        setErro('Link inválido ou expirado. Solicite um novo convite.');
        setPreparando(false);
        return;
      }

      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.setSession({ access_token, refresh_token });

      if (error) {
        setErro('Não foi possível validar o convite. Solicite um novo link.');
        setPreparando(false);
        return;
      }

      // Limpa os tokens da URL para não ficarem expostos no histórico
      window.history.replaceState(null, '', window.location.pathname);
      setSessaoPronta(true);
      setPreparando(false);
    }

    ativarSessao();
  }, []);

  async function handleDefinirSenha(e: React.FormEvent) {
    e.preventDefault();
    setCarregando(true);
    setErro('');

    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.updateUser({ password: senha });

    if (error) {
      setErro('Não foi possível definir a senha. Tente novamente.');
      setCarregando(false);
      return;
    }

    router.push('/meu-perfil');
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-[var(--t-bg-base,#0f1117)] flex items-center justify-center">
      <div className="bg-[var(--t-bg-card,#1a1f2e)] rounded-2xl shadow-lg p-8 w-full max-w-md">
        {/* Logo / Header */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-slate-100">ProspectOS</h1>
          <p className="text-slate-400 text-sm mt-1">Defina sua senha para acessar a plataforma</p>
        </div>

        {preparando ? (
          <p className="text-center text-slate-500 text-sm">Validando convite...</p>
        ) : sessaoPronta ? (
          <form onSubmit={handleDefinirSenha} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Nova senha</label>
              <input
                type="password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                required
                minLength={6}
                placeholder="••••••••"
                className="w-full border border-[var(--t-border,#2a3147)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            {erro && (
              <p className="text-red-500 text-sm">{erro}</p>
            )}

            <button
              type="submit"
              disabled={carregando}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium py-2 rounded-lg text-sm transition-colors"
            >
              {carregando ? 'Salvando...' : 'Definir senha'}
            </button>
          </form>
        ) : (
          <p className="text-red-500 text-sm text-center">{erro}</p>
        )}
      </div>
    </div>
  );
}
