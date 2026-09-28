'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Zap, Mail, Lock, Eye, EyeOff, ArrowRight, ArrowLeft, CheckCircle,
  Bot, Repeat, BrainCircuit, Calculator, TrendingUp,
} from 'lucide-react';
import { createSupabaseBrowserClient, definirLembrar } from '@/lib/supabase-browser';

// Recuperação de senha reaproveita a página que já trata o token do hash (a
// mesma do convite): o link do e-mail cai em /definir-senha e o usuário define
// a nova senha. SITE_URL é o domínio publicado (nunca localhost).
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL;

// Diferenciais REAIS da plataforma (funcionalidades já existentes) — nada de
// promessa vazia. Usados na coluna de apresentação.
const DIFERENCIAIS = [
  { Icon: Bot, titulo: 'Prospecção com IA', desc: 'Primeiro contato e follow-ups escritos e disparados pelo motor.' },
  { Icon: Repeat, titulo: 'Cadência inteligente', desc: 'Sequência de 8 follow-ups no timing certo, sem esforço manual.' },
  { Icon: BrainCircuit, titulo: 'Inteligência comercial', desc: 'Leitura por lead: aderência, dor e abordagem sugerida.' },
  { Icon: Calculator, titulo: 'Simulador de propostas', desc: 'Compra ou comodato, com desconto e proposta na hora.' },
];

export default function LoginPage() {
  const router = useRouter();
  const [modo, setModo] = useState<'login' | 'recuperar'>('login');

  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [verSenha, setVerSenha] = useState(false);
  const [lembrar, setLembrar] = useState(true);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [recuperado, setRecuperado] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setCarregando(true);
    setErro('');

    // Grava a preferência ANTES de criar o client — ele lê isso para decidir a
    // persistência do cookie (sessão vs. 400 dias). "Lembrar de mim" real.
    definirLembrar(lembrar);
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });

    if (error) {
      setErro('E-mail ou senha incorretos.');
      setCarregando(false);
      return;
    }
    router.push('/pipeline');
    router.refresh();
  }

  async function handleRecuperar(e: React.FormEvent) {
    e.preventDefault();
    setCarregando(true);
    setErro('');
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${SITE_URL ?? window.location.origin}/definir-senha`,
    });
    setCarregando(false);
    if (error) {
      setErro('Não foi possível enviar o e-mail de recuperação. Verifique o endereço.');
      return;
    }
    setRecuperado(true);
  }

  return (
    <div className="min-h-screen bg-[var(--t-bg-base,#0f1117)] text-slate-100 lg:grid lg:grid-cols-2">
      {/* Coluna de apresentação (marca + valor + prévia) — some no mobile */}
      <div className="hidden lg:flex flex-col justify-between p-12 bg-gradient-to-br from-[var(--t-hero,oklch(25.7%_0.09_281.288))] via-[var(--t-bg-subtle,#141a2e)] to-[var(--t-bg-base,#0f1117)] relative overflow-hidden">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-green-500 flex items-center justify-center shadow-lg">
            <Zap size={18} className="text-white" />
          </div>
          <div>
            <div className="text-[var(--t-strong,#fff)] font-bold leading-tight">ProspectOS</div>
            <div className="text-indigo-300 text-xs leading-tight">InovaCode</div>
          </div>
        </div>

        <div className="relative z-10 max-w-md flex-1 flex flex-col justify-center py-8">
          <h2 className="text-3xl font-bold leading-tight mb-3">
            Sua prospecção no piloto automático, do primeiro contato à reunião.
          </h2>
          <p className="text-slate-400 text-sm mb-8">
            Plataforma de prospecção B2B da InovaCode: o motor de IA encontra, aborda
            e faz follow-up dos leads — e você foca em fechar.
          </p>

          {/* Prévia ilustrativa do produto (motivo visual, não dado de usuário) */}
          <div className="rounded-xl border border-white/10 bg-[var(--t-bg-base,#0f1117)]/70 backdrop-blur p-3 shadow-2xl mb-8">
            <div className="flex items-center gap-1.5 mb-2.5">
              <span className="w-2 h-2 rounded-full bg-red-400/70" />
              <span className="w-2 h-2 rounded-full bg-amber-400/70" />
              <span className="w-2 h-2 rounded-full bg-green-400/70" />
              <span className="ml-2 text-[10px] text-slate-500">Dashboard · ProspectOS</span>
            </div>
            <div className="grid grid-cols-3 gap-2 mb-2.5">
              {['Leads', 'Respostas', 'Reuniões'].map((l, i) => (
                <div key={l} className="rounded-lg bg-[var(--t-bg-card,#1a1f2e)] border border-white/5 p-2">
                  <div className="text-[9px] text-slate-500">{l}</div>
                  <div className="h-1.5 mt-1.5 rounded-full bg-indigo-500/60" style={{ width: `${[80, 55, 30][i]}%` }} />
                </div>
              ))}
            </div>
            <div className="rounded-lg bg-[var(--t-bg-card,#1a1f2e)] border border-white/5 p-2.5">
              <div className="flex items-center gap-1 text-[9px] text-slate-500 mb-1.5">
                <TrendingUp size={10} className="text-indigo-400" /> Evolução da prospecção
              </div>
              <div className="flex items-end gap-1 h-12">
                {[30, 45, 38, 60, 52, 70, 64, 82].map((h, i) => (
                  <div key={i} className="flex-1 rounded-t bg-gradient-to-t from-indigo-500/30 to-indigo-400/70" style={{ height: `${h}%` }} />
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {DIFERENCIAIS.map(d => (
              <div key={d.titulo} className="flex gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-indigo-500/15 flex items-center justify-center shrink-0">
                  <d.Icon size={14} className="text-indigo-300" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-200">{d.titulo}</div>
                  <div className="text-[11px] text-slate-500 leading-snug">{d.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="relative z-10 text-xs text-slate-600">© {new Date().getFullYear()} InovaCode · ProspectOS</p>
      </div>

      {/* Coluna do formulário */}
      <div className="flex items-center justify-center p-6 min-h-screen lg:min-h-0">
        <div className="w-full max-w-sm">
          {/* Marca (aparece no mobile, onde a coluna de apresentação some) */}
          <div className="flex items-center gap-2.5 mb-8 lg:hidden">
            <div className="w-9 h-9 rounded-xl bg-green-500 flex items-center justify-center">
              <Zap size={18} className="text-white" />
            </div>
            <div>
              <div className="text-[var(--t-strong,#fff)] font-bold leading-tight">ProspectOS</div>
              <div className="text-indigo-300 text-xs leading-tight">InovaCode</div>
            </div>
          </div>

          {modo === 'login' ? (
            <>
              <h1 className="text-2xl font-bold text-slate-100">Entrar na sua conta</h1>
              <p className="text-slate-400 text-sm mt-1 mb-6">Bem-vindo de volta. Acesse sua operação de prospecção.</p>

              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">E-mail</label>
                  <div className="flex items-center gap-2 border border-[var(--t-border,#2a3147)] rounded-lg px-3 bg-[var(--t-bg-card,#1a1f2e)] focus-within:ring-2 focus-within:ring-indigo-500">
                    <Mail size={15} className="text-slate-500 shrink-0" />
                    <input
                      type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
                      placeholder="seu@email.com"
                      className="w-full bg-transparent py-2 text-sm text-slate-100 focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Senha</label>
                  <div className="flex items-center gap-2 border border-[var(--t-border,#2a3147)] rounded-lg px-3 bg-[var(--t-bg-card,#1a1f2e)] focus-within:ring-2 focus-within:ring-indigo-500">
                    <Lock size={15} className="text-slate-500 shrink-0" />
                    <input
                      type={verSenha ? 'text' : 'password'} value={senha} onChange={(e) => setSenha(e.target.value)} required
                      placeholder="••••••••"
                      className="w-full bg-transparent py-2 text-sm text-slate-100 focus:outline-none"
                    />
                    <button type="button" onClick={() => setVerSenha(v => !v)} className="text-slate-500 hover:text-slate-300 shrink-0" aria-label={verSenha ? 'Ocultar senha' : 'Mostrar senha'}>
                      {verSenha ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer select-none">
                    <input
                      type="checkbox" checked={lembrar} onChange={(e) => setLembrar(e.target.checked)}
                      className="w-4 h-4 rounded border-[var(--t-border,#2a3147)] bg-[var(--t-bg-card,#1a1f2e)] text-indigo-600 focus:ring-indigo-500 focus:ring-offset-0"
                    />
                    Lembrar de mim
                  </label>
                  <button type="button" onClick={() => { setModo('recuperar'); setErro(''); setRecuperado(false); }}
                    className="text-sm text-indigo-400 hover:text-indigo-300">
                    Esqueci minha senha
                  </button>
                </div>

                {erro && <p className="text-red-500 text-sm">{erro}</p>}

                <button
                  type="submit" disabled={carregando}
                  className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
                >
                  {carregando ? 'Entrando...' : <>Entrar <ArrowRight size={15} /></>}
                </button>
              </form>

              <p className="text-center text-slate-500 text-sm mt-6">
                Nova empresa?{' '}
                <a href="/criar-organizacao" className="text-indigo-400 hover:text-indigo-300 font-medium">Criar organização</a>
              </p>
            </>
          ) : (
            <>
              <button onClick={() => { setModo('login'); setErro(''); }} className="flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200 mb-4">
                <ArrowLeft size={14} /> Voltar ao login
              </button>
              <h1 className="text-2xl font-bold text-slate-100">Recuperar senha</h1>

              {recuperado ? (
                <div className="mt-6 flex items-start gap-3 rounded-lg border border-green-500/30 bg-green-500/10 p-4">
                  <CheckCircle size={18} className="text-green-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-green-300">E-mail enviado</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Se houver uma conta para <b>{email}</b>, você receberá um link para redefinir a senha. Confira também o spam.
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-slate-400 text-sm mt-1 mb-6">Enviaremos um link para você criar uma nova senha.</p>
                  <form onSubmit={handleRecuperar} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-1">E-mail</label>
                      <div className="flex items-center gap-2 border border-[var(--t-border,#2a3147)] rounded-lg px-3 bg-[var(--t-bg-card,#1a1f2e)] focus-within:ring-2 focus-within:ring-indigo-500">
                        <Mail size={15} className="text-slate-500 shrink-0" />
                        <input
                          type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
                          placeholder="seu@email.com"
                          className="w-full bg-transparent py-2 text-sm text-slate-100 focus:outline-none"
                        />
                      </div>
                    </div>
                    {erro && <p className="text-red-500 text-sm">{erro}</p>}
                    <button
                      type="submit" disabled={carregando}
                      className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
                    >
                      {carregando ? 'Enviando...' : 'Enviar link de recuperação'}
                    </button>
                  </form>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
