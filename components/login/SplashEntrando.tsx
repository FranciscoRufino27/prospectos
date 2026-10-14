'use client';

// Splash do login: plasma do CrystalizedBall em tela cheia (a esfera é maior
// que a tela, então o contorno fica fora e sobram as partículas subindo) e, no
// centro, o logo do ProspectOS se desintegrando em partículas e se remontando,
// em loop, até o /pipeline montar. Sem `bg-black/` na classe: a regra global de
// modais (globals.css) animaria este fundo como se fosse um modal.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import CrystalizedBall from '@/components/ui/CrystalizedBall';
import { TEMPOS_SPLASH, particulasDoAparelho, type ModoSplash } from './splashTempos';

const COR_PLASMA = '#8B6BFF';

// Renderiza direto no <body> (portal): um ancestral com transform (ex.: a
// animação de entrada de página do app/template.tsx) prenderia o `fixed` a ele
// e a splash não cobriria a tela inteira.
//
// Pré-aquecimento: montar a bola custa um travamento de 250–600 ms (compilar
// os shaders e gerar 40 mil partículas). Por isso o login monta a splash
// escondida e pausada (`ativo={false}`) logo que abre; ao entrar, `ativo`
// vira true e a sequência começa sem engasgar.
//
// O login carrega este componente sob demanda (next/dynamic): o ogl e os
// shaders não entram na carga inicial da página.
interface PropsSplash {
  ativo: boolean;
  /** Completa (1ª entrada do dia) ou curta; tempos em splashTempos.ts. */
  modo: ModoSplash;
  aoAbrir?: () => void;
}

export default function SplashEntrando(props: PropsSplash) {
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);
  if (!montado) return null;
  return createPortal(<ConteudoSplash {...props} />, document.body);
}

// Sequência (ms desde o login aceito; valores em TEMPOS_SPLASH):
//   0 → succao               a tela de login é sugada para o centro (classe
//                            .login-sugado na página) enquanto a bola nasce
//                            pequena ali e cresce até o tamanho de bola;
//   succao → bolaFim         a bola, cheia de partículas, segura um instante;
//   bolaFim → +explosao      explode, crescendo até o contorno sair da tela;
//   depois                   plasma em tela cheia com o logo.
// O container tem o tamanho da tela (resolução cheia, partículas nítidas) e o
// raio da esfera é size × menorLado / 2; aberta, ela passa da meia-diagonal da
// tela e o círculo some.
const TAMANHO_SEMENTE = 0.04;
// Cores do site nas partículas: roxo, rosa, lilás, lilás claro e o verde do
// logo (este nas partículas esparsas, como acento).
const TONS = ['#5227FF', '#FF9FFC', '#9d85ff', '#c4b5ff', '#22c55e'] as const;

type Fase = 'succao' | 'bola' | 'explosao' | 'aberta';

// Bola: raio de 30% do menor lado. Aberta: raio 10% maior que a meia-diagonal.
const TAMANHO_BOLA = 0.6;
const tamanhoAberto = () => (1.1 * Math.hypot(window.innerWidth, window.innerHeight)) / Math.min(window.innerWidth, window.innerHeight);
const easeOut = (p: number) => 1 - Math.pow(1 - p, 3);
const easeInOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

// aoAbrir: avisado uma vez, quando a bola termina de explodir (tela cheia).
function ConteudoSplash({ ativo, modo, aoAbrir }: PropsSplash) {
  const [fase, setFase] = useState<Fase>('succao');
  const [tamanho, setTamanho] = useState(TAMANHO_SEMENTE);
  // Fixo por montagem: mudar a contagem recriaria as partículas na GPU.
  const [particulas] = useState(particulasDoAparelho);
  const tempos = TEMPOS_SPLASH[modo];
  const aoAbrirRef = useRef(aoAbrir);
  useEffect(() => { aoAbrirRef.current = aoAbrir; });

  useEffect(() => {
    if (!ativo) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setFase('aberta');
      setTamanho(tamanhoAberto());
      aoAbrirRef.current?.();
      return;
    }
    const bola = TAMANHO_BOLA;
    const aberto = tamanhoAberto();
    const { succao, bolaFim, explosao } = TEMPOS_SPLASH[modo];
    // Relógio próprio, avançando no máximo 50 ms por quadro: se a thread
    // principal travar (ex.: carregando o JS do /pipeline), a sequência pausa
    // e continua de onde estava, em vez de pular direto para o fim.
    let t = 0;
    let anterior = performance.now();
    let raf = 0;
    const quadro = (agora: number) => {
      t += Math.min(50, agora - anterior);
      anterior = agora;
      if (t < succao) {
        // A bola cresce enquanto "engole" a tela de login.
        setTamanho(TAMANHO_SEMENTE + (bola - TAMANHO_SEMENTE) * easeOut(t / succao));
        setFase('succao');
      } else if (t < bolaFim) {
        setTamanho(bola);
        setFase('bola');
      } else {
        const p = Math.min(1, (t - bolaFim) / explosao);
        setTamanho(bola + (aberto - bola) * easeInOut(p));
        setFase(p < 1 ? 'explosao' : 'aberta');
        if (p >= 1) {
          aoAbrirRef.current?.();
          return;
        }
      }
      raf = requestAnimationFrame(quadro);
    };
    raf = requestAnimationFrame(quadro);
    return () => cancelAnimationFrame(raf);
    // modo é lido no instante em que a splash é ativada.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ativo]);

  const explodindo = fase === 'explosao';
  // Inativa (pré-aquecida): invisível, sem eventos, bola pausada e sem
  // interação — só existe para os shaders e as partículas já estarem prontos.
  return (
    <div
      role={ativo ? 'status' : undefined}
      aria-live={ativo ? 'polite' : undefined}
      aria-hidden={!ativo}
      className={`fixed inset-0 z-[100] overflow-hidden ${ativo ? '' : 'invisible pointer-events-none'}`}
    >
      {ativo && <span className="sr-only">Entrando no ProspectOS</span>}
      {/* Fundo escurece junto com a sucção: a tela de login some "dentro" da bola. */}
      {ativo && <div aria-hidden="true" className="login-splash absolute inset-0 bg-[#0b0914]" style={{ animationDuration: `${tempos.succao}ms` }} />}
      <div aria-hidden="true" className="absolute inset-0">
        <CrystalizedBall
          preset="nebula"
          color={COR_PLASMA}
          tones={TONS}
          size={tamanho}
          fill={1}
          // Na explosão o plasma fica mais elétrico: mais brilho, estalos e faíscas.
          crackle={explodindo ? 1 : 0.85}
          strands={6}
          flares={explodindo ? 1 : 0.65}
          glow={explodindo ? 1.6 : 0.9}
          sparks={explodindo ? 1 : 0.6}
          particleCount={particulas}
          motion="rise"
          particleShape="square"
          depth={0.6}
          sway={0.5}
          twinkle={0.5}
          haze={0.8}
          dustSpeed={explodindo ? 2.2 : 1}
          speed={explodindo ? 2 : 1}
          // Sem intro: a bola já nasce cheia de partículas (a intro a acendia aos poucos, vazia).
          intro={false}
          paused={!ativo}
          interactive={ativo}
          hoverStrength={0.7}
        />
      </div>

      {/* Clarão no instante em que a bola estoura. */}
      {(fase === 'explosao' || fase === 'aberta') && (
        <div aria-hidden="true" className="login-splash-clarao pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(196,181,255,0.55)_0%,rgba(139,107,255,0.25)_35%,transparent_70%)]" />
      )}

      {fase === 'aberta' && (
        <div aria-hidden="true" className="login-splash-conteudo relative flex h-full flex-col items-center justify-center">
          {/* Véu escuro no centro: o plasma em tela cheia é denso e competia com o logo e o texto. */}
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_36%_32%_at_center,rgba(11,9,20,0.85)_0%,rgba(11,9,20,0.5)_55%,transparent_100%)]" />
          <LogoDesintegrando />
          <p className="relative mt-2 text-lg font-semibold text-white">
            Entrando no <span className="text-[#9d85ff]">ProspectOS</span>
          </p>
          <p className="relative mt-1.5 text-sm text-neutral-400">Preparando sua operação de prospecção…</p>
        </div>
      )}
    </div>
  );
}

// --- Logo que se desintegra --------------------------------------------------

const LOGO = 112; // lado do logo, em px CSS
const AREA = 520; // canvas maior que o logo: as partículas voam para fora dele
const PASSO = 2; // uma partícula a cada 2px do logo
const CICLO_MS = 3600;
const VERDE = '#22c55e';
const ROXO: [number, number, number] = [157, 133, 255];
// Ícone Zap (lucide), grade 24×24.
const ZAP = 'M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z';

interface Particula {
  x: number; y: number; // posição de casa (px CSS dentro do canvas)
  r: number; g: number; b: number;
  limiar: number; // quando começa a se soltar (varre da esquerda p/ a direita)
  dx: number; dy: number; // direção e distância do voo
  fase: number; giro: number;
}

const suave = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Progresso da desintegração ao longo do ciclo: inteiro (o logo aparece logo
// de cara) → solta → remonta → inteiro. Sem pausa "disperso": o logo nunca
// some por muito tempo.
function progressoDoCiclo(t: number): number {
  const c = (t % CICLO_MS) / CICLO_MS;
  if (c < 0.25) return 0;
  if (c < 0.62) return (c - 0.25) / 0.37;
  if (c < 0.66) return 1;
  return 1 - suave(0, 1, (c - 0.66) / 0.34);
}

function desenharLogo(ctx: CanvasRenderingContext2D, lado: number) {
  ctx.fillStyle = VERDE;
  ctx.beginPath();
  ctx.roundRect(0, 0, lado, lado, lado * 0.28);
  ctx.fill();
  const escala = (lado * 0.46) / 24;
  ctx.save();
  ctx.translate((lado - 24 * escala) / 2, (lado - 24 * escala) / 2);
  ctx.scale(escala, escala);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke(new Path2D(ZAP));
  ctx.restore();
}

function LogoDesintegrando() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = AREA * dpr;
    canvas.height = AREA * dpr;
    ctx.scale(dpr, dpr);
    const origem = (AREA - LOGO) / 2;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      ctx.translate(origem, origem);
      desenharLogo(ctx, LOGO);
      return;
    }

    // Amostra o logo desenhado fora da tela: cada pixel opaco vira partícula.
    const fora = document.createElement('canvas');
    fora.width = LOGO;
    fora.height = LOGO;
    const fctx = fora.getContext('2d');
    if (!fctx) return;
    desenharLogo(fctx, LOGO);
    const { data } = fctx.getImageData(0, 0, LOGO, LOGO);
    const particulas: Particula[] = [];
    for (let y = 0; y < LOGO; y += PASSO) {
      for (let x = 0; x < LOGO; x += PASSO) {
        const i = (y * LOGO + x) * 4;
        if (data[i + 3] < 128) continue;
        const angulo = -Math.PI / 2 + (Math.random() - 0.35) * 1.4;
        const distancia = 70 + Math.random() * 170;
        particulas.push({
          x: origem + x, y: origem + y,
          r: data[i], g: data[i + 1], b: data[i + 2],
          limiar: (x / LOGO) * 0.65 + Math.random() * 0.25,
          dx: Math.cos(angulo) * distancia, dy: Math.sin(angulo) * distancia,
          fase: Math.random() * Math.PI * 2, giro: 1.5 + Math.random() * 2.5,
        });
      }
    }

    let raf = 0;
    const inicio = performance.now();
    const quadro = (agora: number) => {
      const t = agora - inicio;
      const g = progressoDoCiclo(t);
      ctx.clearRect(0, 0, AREA, AREA);
      // Brilho verde atrás do logo enquanto ele está inteiro.
      const inteiro = 1 - suave(0, 0.5, g);
      if (inteiro > 0.01) {
        const brilho = ctx.createRadialGradient(AREA / 2, AREA / 2, LOGO * 0.2, AREA / 2, AREA / 2, LOGO * 1.1);
        brilho.addColorStop(0, `rgba(34,197,94,${0.35 * inteiro})`);
        brilho.addColorStop(1, 'rgba(34,197,94,0)');
        ctx.fillStyle = brilho;
        ctx.fillRect(0, 0, AREA, AREA);
      }
      for (const p of particulas) {
        const k = suave(p.limiar * 0.55, p.limiar * 0.55 + 0.45, g);
        if (k >= 0.999) continue;
        const voo = 1 - Math.pow(1 - k, 2);
        const tremor = Math.sin(t * 0.001 * p.giro + p.fase) * 6 * k;
        const x = p.x + p.dx * voo + tremor;
        const y = p.y + p.dy * voo + Math.cos(t * 0.0013 * p.giro + p.fase) * 4 * k;
        // A partícula solta esfria do verde do logo para o roxo do plasma.
        const r = Math.round(p.r + (ROXO[0] - p.r) * k);
        const gg = Math.round(p.g + (ROXO[1] - p.g) * k);
        const b = Math.round(p.b + (ROXO[2] - p.b) * k);
        ctx.globalAlpha = 1 - Math.pow(k, 1.3);
        ctx.fillStyle = `rgb(${r},${gg},${b})`;
        const lado = PASSO * (1 - k * 0.35) + 0.4;
        ctx.fillRect(x, y, lado, lado);
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(quadro);
    };
    raf = requestAnimationFrame(quadro);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Margem negativa: o canvas é maior que o logo, mas o texto fica colado nele.
  return <canvas ref={ref} aria-hidden="true" className="relative -my-[180px]" style={{ width: AREA, height: AREA }} />;
}
