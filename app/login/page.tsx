'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Zap, Mail, Lock, Eye, EyeOff, ArrowRight, ArrowLeft, CheckCircle,
  Bot, Repeat, BrainCircuit, Calculator, TrendingUp, Loader2,
} from 'lucide-react';
import { createSupabaseBrowserClient, definirLembrar } from '@/lib/supabase-browser';
import GradientBlinds from '@/components/ui/GradientBlinds';
import SplitText from '@/components/ui/SplitText';
import dynamic from 'next/dynamic';
import { TEMPOS_SPLASH, marcarSplashCompleta, modoDaSplash, type ModoSplash } from '@/components/login/splashTempos';

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

// Splash sob demanda: o ogl e os shaders da bola ficam fora da carga inicial do
// login e são baixados no pré-aquecimento (ver preaquecer).
const SplashEntrando = dynamic(() => import('@/components/login/SplashEntrando'), { ssr: false });

// O autofill do navegador pinta o campo de azul-claro; a sombra interna cobre
// com o fundo do campo e o texto continua branco.
const CLASSE_INPUT = 'w-full bg-transparent py-3.5 text-[15px] text-white caret-white placeholder:text-neutral-500 focus:outline-none autofill:[-webkit-text-fill-color:#fff] autofill:shadow-[0_0_0_1000px_#120f1f_inset] autofill:[transition:background-color_9999s]';
const CLASSE_BOTAO = 'w-full flex items-center justify-center gap-2 bg-[#5227FF] hover:bg-[#6340ff] disabled:opacity-50 text-white font-semibold h-12 rounded-xl text-[15px] transition-colors shadow-[0_8px_24px_-8px_rgba(82,39,255,0.7)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9d85ff] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0914]';

const ERROS_CALLBACK: Record<string, string> = {
  google: 'Não foi possível entrar com o Google. Tente novamente.',
  'sem-conta': 'Esta conta Google não tem acesso ao ProspectOS. Peça um convite ao administrador da sua organização.',
};

function IconeGoogle() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

// Prévia ILUSTRATIVA do produto (motivo visual, não dado de usuário): a tela de
// login é pública, então nada aqui vem do banco e nenhum número é exibido. Os
// cards mostram o período atual e cada coluna do gráfico empilha as mesmas três
// séries; a cada passo entra um período novo e o gráfico anda uma coluna.
const SERIES = [
  { chave: 'leads', rotulo: 'Leads', cor: '#5227FF' },
  { chave: 'respostas', rotulo: 'Respostas', cor: '#9d85ff' },
  { chave: 'reunioes', rotulo: 'Reuniões', cor: '#FF9FFC' },
] as const;
type Periodo = Record<(typeof SERIES)[number]['chave'], number>;

const COLUNAS_PREVIA = 8;
const PASSO_PREVIA_MS = 1500;
// Ponto de partida fixo (igual no servidor e no cliente, sem hidratação divergente).
const PERIODOS_INICIAIS: Periodo[] = [
  [42, 22, 9], [55, 30, 12], [48, 27, 13], [64, 38, 17],
  [58, 35, 18], [72, 44, 21], [67, 42, 22], [82, 52, 27],
].map(([leads, respostas, reunioes]) => ({ leads, respostas, reunioes }));

// Funil plausível: respostas são parte dos leads, reuniões parte das respostas.
function proximoPeriodo(anterior: Periodo): Periodo {
  const leads = Math.round(Math.min(95, Math.max(35, anterior.leads + (Math.random() - 0.45) * 22)));
  const respostas = Math.round(leads * (0.45 + Math.random() * 0.25));
  const reunioes = Math.round(respostas * (0.35 + Math.random() * 0.25));
  return { leads, respostas, reunioes };
}

function PreviaDashboard() {
  const [periodos, setPeriodos] = useState(PERIODOS_INICIAIS);
  const [montado, setMontado] = useState(false);

  useEffect(() => {
    // Um quadro depois de montar: as barras crescem do zero (transição de CSS).
    const quadro = requestAnimationFrame(() => setMontado(true));
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return () => cancelAnimationFrame(quadro);
    const id = window.setInterval(() => {
      if (document.hidden) return;
      setPeriodos((ps) => [...ps.slice(1), proximoPeriodo(ps[ps.length - 1])]);
    }, PASSO_PREVIA_MS);
    return () => { cancelAnimationFrame(quadro); window.clearInterval(id); };
  }, []);

  const atual = periodos[periodos.length - 1];
  const transicao = 'transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]';

  return (
    <div className="rounded-2xl border border-white/10 bg-black/45 p-3.5 mb-6" aria-hidden="true">
      <div className="flex items-center gap-1.5 mb-3">
        <span className="w-2 h-2 rounded-full bg-red-400/70" />
        <span className="w-2 h-2 rounded-full bg-amber-400/70" />
        <span className="w-2 h-2 rounded-full bg-green-400/70" />
        <span className="ml-2 text-[10px] text-neutral-400">Dashboard · ProspectOS</span>
      </div>
      <div className="grid grid-cols-3 gap-2 mb-2.5">
        {SERIES.map((s) => (
          <div key={s.chave} className="rounded-lg bg-white/[0.05] border border-white/5 p-2">
            <div className="flex items-center gap-1.5 text-[10px] text-neutral-400">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.cor }} />
              {s.rotulo}
            </div>
            <div className="mt-1.5 h-1.5 rounded-full bg-white/[0.06]">
              <div className={`h-full rounded-full ${transicao}`} style={{ width: montado ? `${atual[s.chave]}%` : 0, background: s.cor }} />
            </div>
          </div>
        ))}
      </div>
      <div className="rounded-lg bg-white/[0.05] border border-white/5 p-2.5">
        <div className="flex items-center gap-1 text-[10px] text-neutral-400 mb-1.5">
          <TrendingUp size={11} className="text-[#c4b5ff]" /> Evolução da prospecção
        </div>
        <div className="flex items-end gap-1 h-14">
          {periodos.slice(-COLUNAS_PREVIA).map((p, i) => (
            // Séries sobrepostas a partir da base (cada uma cabe na anterior).
            <div key={i} className="relative flex-1 h-full">
              {SERIES.map((s) => (
                <div
                  key={s.chave}
                  className={`absolute left-0 right-0 bottom-0 rounded-t ${transicao}`}
                  style={{ height: montado ? `${p[s.chave]}%` : 0, background: s.cor, opacity: s.chave === 'leads' ? 0.55 : 0.9 }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Marca() {
  return (
    <>
      <div className="w-9 h-9 rounded-xl bg-green-500 flex items-center justify-center shadow-lg">
        <Zap size={18} className="text-white" />
      </div>
      <div className="text-left">
        <div className="text-white font-bold leading-tight">ProspectOS</div>
        <div className="text-[#c4b5ff] text-xs leading-tight">InovaCode</div>
      </div>
    </>
  );
}

// Campo com ícone; o rótulo fica para leitores de tela e o placeholder faz o
// papel visual (como no modelo).
function Campo({ icone: Icone, rotulo, className = '', children }: { icone: typeof Mail; rotulo: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`${className} flex items-center gap-2.5 rounded-xl border border-[#2a2340] bg-[#120f1f] px-4 transition-colors hover:border-[#3b3160] focus-within:border-[#5227FF] focus-within:ring-2 focus-within:ring-[#5227FF]/30`}>
      <span className="sr-only">{rotulo}</span>
      <Icone size={18} className="text-neutral-500 shrink-0" aria-hidden="true" />
      {children}
    </label>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [modo, setModo] = useState<'login' | 'recuperar'>('login');

  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [verSenha, setVerSenha] = useState(false);
  const [lembrar, setLembrar] = useState(true);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);
  // Login aceito: a splash cobre a tela até o /pipeline montar (a página de
  // login desmonta na navegação e leva a splash junto).
  const [entrando, setEntrando] = useState(false);
  // Completa na 1ª entrada do dia; curta nas seguintes (splashTempos.ts).
  const [modoSplash, setModoSplash] = useState<ModoSplash>('completa');
  // Monta a splash escondida pouco depois de abrir o login (ver SplashEntrando:
  // pré-aquecimento), para o clique em Entrar não engasgar a sucção.
  const [preaquecer, setPreaquecer] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setPreaquecer(true), 600);
    return () => window.clearTimeout(id);
  }, []);
  const [recuperado, setRecuperado] = useState(false);
  const [googleAtivo, setGoogleAtivo] = useState(false);
  const [carregandoGoogle, setCarregandoGoogle] = useState(false);

  useEffect(() => {
    // Erro devolvido por /auth/callback (login com Google).
    const codigo = new URLSearchParams(window.location.search).get('erro');
    if (codigo) setErro(ERROS_CALLBACK[codigo] ?? ERROS_CALLBACK.google);

    // Pergunta ao Supabase se o provedor Google está habilitado (endpoint
    // público de configuração do Auth). Falhou a consulta → botão não aparece.
    const controle = new AbortController();
    fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! },
      signal: controle.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg) => setGoogleAtivo(cfg?.external?.google === true))
      .catch(() => {});
    return () => controle.abort();
  }, []);

  async function handleGoogle() {
    setCarregandoGoogle(true);
    setErro('');
    definirLembrar(lembrar);
    const supabase = createSupabaseBrowserClient();
    // O callback troca o código pela sessão e confere se o usuário tem conta
    // numa organização; `lembrar` decide a persistência do cookie lá.
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback?lembrar=${lembrar ? 1 : 0}` },
    });
    if (error) {
      setErro('Não foi possível entrar com o Google. Tente novamente.');
      setCarregandoGoogle(false);
    }
  }

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
    setModoSplash(modoDaSplash());
    // A navegação acontece em splashAberta(), quando a bola termina de explodir.
    setEntrando(true);
  }

  // Só depois da explosão: carregar o JS do /pipeline trava a thread principal
  // (em dev, por segundos) e engasgaria a sucção e a explosão. O logo fica
  // logoNaTela ms na tela cheia enquanto o pipeline carrega.
  function splashAberta() {
    if (modoSplash === 'completa') marcarSplashCompleta();
    router.prefetch('/pipeline');
    window.setTimeout(() => {
      router.push('/pipeline');
      router.refresh();
    }, TEMPOS_SPLASH[modoSplash].logoNaTela);
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
    <>
    {(preaquecer || entrando) && <SplashEntrando ativo={entrando} modo={modoSplash} aoAbrir={splashAberta} />}
    {/* Ao entrar, a tela inteira é sugada para a bola da splash (.login-sugado). */}
    <div
      className={`min-h-screen bg-[#0b0914] text-neutral-100 lg:grid lg:grid-cols-[1.35fr_1fr] lg:gap-3 lg:p-3 ${entrando ? 'login-sugado' : ''}`}
      style={entrando ? { animationDuration: `${TEMPOS_SPLASH[modoSplash].succao}ms` } : undefined}
    >
      {/* Painel de apresentação — some no mobile. Fundo interativo (a luz
          segue o ponteiro, clique solta uma onda) com o texto centralizado. */}
      <div className="hidden lg:block relative overflow-hidden rounded-[28px] bg-black ring-1 ring-[#5227FF]/25 lg:min-h-[calc(100vh-1.5rem)]">
        {/* O wrapper absoluto é necessário: o CSS do componente usa position:
            relative e venceria um `absolute` passado por className. */}
        <div className="absolute inset-0">
        <GradientBlinds
          gradientColors={['#FF9FFC', '#5227FF']}
          angle={20}
          blindCount={16}
          blindMinWidth={60}
          spotlightRadius={0.5}
          shine={0.4}
          relief={0.5}
          glow={0.4}
          sway={0.35}
          hoverTilt={0.6}
          clickEffect="ripple"
          noise={0.3}
          mouseDampening={0.15}
          idle="drift"
          intro
          // Pausa durante a sucção: libera a GPU para a bola da splash.
          paused={entrando}
        />
        </div>
        <div className="pointer-events-none relative z-10 flex min-h-[calc(100vh-1.5rem)] flex-col items-center justify-between p-10">
          <div className="flex items-center gap-2.5 self-start">
            <Marca />
          </div>

          {/* Cartão de vidro: borra a animação por baixo e segura o conteúdo. */}
          <div className="my-8 w-full max-w-xl rounded-[24px] border border-white/15 bg-black/35 p-8 shadow-[0_24px_80px_-20px_rgba(0,0,0,0.8)] backdrop-blur-2xl backdrop-saturate-150">
            <div className="text-center">
              <SplitText
                tag="h2" splitType="chars" delay={18} duration={1} textAlign="center" aoRolar={false}
                className="text-[2rem] font-bold leading-tight mb-3 text-white"
                text="Sua prospecção no piloto automático, do primeiro contato à reunião."
              />
              <SplitText
                tag="p" splitType="chars" delay={8} duration={0.9} textAlign="center" aoRolar={false}
                className="text-neutral-200/85 text-[15px] mb-7 mx-auto max-w-md"
                text="Plataforma de prospecção B2B da InovaCode: o motor de IA encontra, aborda e faz follow-up dos leads — e você foca em fechar."
              />
            </div>

            <PreviaDashboard />

            <div className="grid grid-cols-2 gap-x-5 gap-y-4">
              {DIFERENCIAIS.map(d => (
                <div key={d.titulo} className="flex gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center shrink-0">
                    <d.Icon size={15} className="text-[#c4b5ff]" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-neutral-100">{d.titulo}</div>
                    <div className="text-xs text-neutral-300/75 leading-snug mt-0.5">{d.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <p className="text-xs text-neutral-300/70">© {new Date().getFullYear()} InovaCode · ProspectOS</p>
        </div>
      </div>

      {/* Coluna do formulário */}
      <div className="relative isolate flex min-h-screen flex-col overflow-hidden px-6 py-5 lg:min-h-0">
        {/* Brilho roxo saindo do canto + grade de pontos apagada: liga esta
            coluna à animação e quebra o preto chapado. */}
        <div aria-hidden="true" className="pointer-events-none absolute -right-40 -top-40 -z-10 h-[520px] w-[520px] rounded-full bg-[#5227FF]/25 blur-[120px]" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-48 -left-32 -z-10 h-[420px] w-[420px] rounded-full bg-[#FF9FFC]/10 blur-[120px]" />
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(rgba(255,255,255,0.07)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />

        <div className="flex items-center justify-end gap-3">
          <p className="flex items-center gap-2.5 text-xs text-neutral-400">
            <span className="hidden sm:inline">Nova empresa?</span>
            <a href="/criar-organizacao" className="rounded-lg border border-[#2a2340] bg-[#17132a] px-3 py-1.5 font-medium text-neutral-100 transition-colors hover:bg-[#211b3b]">
              Criar organização
            </a>
          </p>
        </div>

        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[420px]">
            {modo === 'login' ? (
              <>
                <div className="text-center mb-9">
                  <div className="animate-in stagger-1 mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-green-500 shadow-[0_12px_40px_-8px_rgba(34,197,94,0.6)] ring-1 ring-white/15">
                    <Zap size={26} className="text-white" />
                  </div>
                  <SplitText tag="h1" splitType="chars" delay={40} duration={1.1} textAlign="center" aoRolar={false} className="text-3xl font-semibold tracking-tight text-white">
                    Entrar no <span className="text-[#9d85ff]">ProspectOS</span>
                  </SplitText>
                  <SplitText
                    tag="p" splitType="chars" delay={10} duration={0.9} textAlign="center" aoRolar={false}
                    className="text-neutral-400 text-[15px] mt-2.5"
                    text="Bem-vindo de volta. Informe seus dados para acessar sua operação de prospecção."
                  />
                </div>

                <form onSubmit={handleLogin} className="space-y-4">
                  <Campo icone={Mail} rotulo="E-mail" className="animate-in stagger-4">
                    <input
                      type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
                      placeholder="E-mail" autoComplete="email"
                      className={CLASSE_INPUT}
                    />
                  </Campo>

                  <Campo icone={Lock} rotulo="Senha" className="animate-in stagger-5">
                    <input
                      type={verSenha ? 'text' : 'password'} value={senha} onChange={(e) => setSenha(e.target.value)} required
                      placeholder="Senha" autoComplete="current-password"
                      className={CLASSE_INPUT}
                    />
                    <button type="button" onClick={() => setVerSenha(v => !v)} className="text-neutral-500 hover:text-neutral-200 shrink-0 transition-colors" aria-label={verSenha ? 'Ocultar senha' : 'Mostrar senha'}>
                      {verSenha ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </Campo>

                  <div className="animate-in stagger-6 flex items-center justify-between pt-1">
                    <label className="flex items-center gap-2 text-sm text-neutral-400 cursor-pointer select-none">
                      <input
                        type="checkbox" checked={lembrar} onChange={(e) => setLembrar(e.target.checked)}
                        className="w-4 h-4 rounded border-[#3b3160] bg-[#120f1f] text-[#5227FF] focus:ring-[#5227FF] focus:ring-offset-0"
                      />
                      Lembrar de mim
                    </label>
                    <button type="button" onClick={() => { setModo('recuperar'); setErro(''); setRecuperado(false); }}
                      className="text-sm font-medium text-[#9d85ff] hover:text-[#b9a8ff] transition-colors">
                      Esqueceu a senha?
                    </button>
                  </div>

                  {erro && <p className="text-red-400 text-sm" role="alert">{erro}</p>}

                  <button type="submit" disabled={carregando || carregandoGoogle} className={`animate-in stagger-7 ${CLASSE_BOTAO}`}>
                    {carregando ? 'Entrando...' : <>Entrar <ArrowRight size={15} /></>}
                  </button>
                </form>

                {/* Só aparece quando o provedor Google está ativo no Supabase:
                    sem ele, o botão não teria efeito. */}
                {googleAtivo && (
                  <>
                    <div className="animate-in stagger-8 my-5 flex items-center gap-3 text-xs uppercase tracking-wider text-neutral-500">
                      <span className="h-px flex-1 bg-[#2a2340]" /> ou <span className="h-px flex-1 bg-[#2a2340]" />
                    </div>
                    <button
                      type="button" onClick={handleGoogle} disabled={carregando || carregandoGoogle}
                      className="animate-in stagger-9 w-full flex items-center justify-center gap-2.5 h-12 rounded-xl border border-[#2a2340] bg-[#120f1f] text-[15px] font-medium text-neutral-100 transition-colors hover:border-[#3b3160] hover:bg-[#17132a] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9d85ff]"
                    >
                      {carregandoGoogle ? <Loader2 size={18} className="animate-spin" /> : <IconeGoogle />}
                      Entrar com Google
                    </button>
                  </>
                )}
              </>
            ) : (
              <>
                <button onClick={() => { setModo('login'); setErro(''); }} className="flex items-center gap-1 text-sm text-neutral-400 hover:text-neutral-100 mb-5 transition-colors">
                  <ArrowLeft size={14} /> Voltar ao login
                </button>
                <SplitText tag="h1" splitType="chars" delay={40} duration={1.1} textAlign="left" aoRolar={false} className="text-3xl font-semibold tracking-tight text-white" text="Recuperar senha" />

                {recuperado ? (
                  <div className="mt-6 flex items-start gap-3 rounded-xl border border-green-500/30 bg-green-500/10 p-4">
                    <CheckCircle size={18} className="text-green-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-green-300">E-mail enviado</p>
                      <p className="text-xs text-neutral-400 mt-0.5">
                        Se houver uma conta para <b>{email}</b>, você receberá um link para redefinir a senha. Confira também o spam.
                      </p>
                    </div>
                  </div>
                ) : (
                  <>
                    <SplitText tag="p" splitType="chars" delay={10} duration={0.9} textAlign="left" aoRolar={false} className="text-neutral-400 text-[15px] mt-2.5 mb-6" text="Enviaremos um link para você criar uma nova senha." />
                    <form onSubmit={handleRecuperar} className="space-y-4">
                      <Campo icone={Mail} rotulo="E-mail" className="animate-in stagger-3">
                        <input
                          type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
                          placeholder="E-mail" autoComplete="email"
                          className={CLASSE_INPUT}
                        />
                      </Campo>
                      {erro && <p className="text-red-400 text-sm" role="alert">{erro}</p>}
                      <button type="submit" disabled={carregando} className={CLASSE_BOTAO}>
                        {carregando ? 'Enviando...' : 'Enviar link de recuperação'}
                      </button>
                    </form>
                  </>
                )}
              </>
            )}
          </div>
        </div>

        <p className="text-center text-xs text-neutral-600 lg:hidden">© {new Date().getFullYear()} InovaCode · ProspectOS</p>
      </div>
    </div>
    </>
  );
}
