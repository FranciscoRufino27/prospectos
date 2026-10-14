// Tempos e escolhas da splash do login, separados de SplashEntrando.tsx: a
// página de login importa isto direto, e a splash (com ogl/WebGL) só é baixada
// sob demanda (next/dynamic). Importar as constantes do próprio componente
// puxaria o bundle inteiro dele para a carga inicial do login.

export type ModoSplash = 'completa' | 'curta';

export interface TemposSplash {
  /** Tela de login sugada para o centro enquanto a bola nasce. */
  succao: number;
  /** Fim da bola parada (início da explosão). Igual a `succao` = sem pausa. */
  bolaFim: number;
  /** Explosão até o contorno sair da tela. */
  explosao: number;
  /** Logo na tela cheia antes de ir para o /pipeline. */
  logoNaTela: number;
}

// Completa: primeira entrada do dia (~4,3 s). Curta: as seguintes (~1,5 s),
// mesma sequência sem a pausa da bola e mais rápida.
export const TEMPOS_SPLASH: Record<ModoSplash, TemposSplash> = {
  completa: { succao: 900, bolaFim: 1700, explosao: 1600, logoNaTela: 1000 },
  curta: { succao: 450, bolaFim: 450, explosao: 700, logoNaTela: 350 },
};

const CHAVE_SPLASH_COMPLETA = 'prospectos_splash_completa';
const hoje = () => new Date().toLocaleDateString('sv-SE'); // AAAA-MM-DD, fuso local

/** Completa só na primeira entrada do dia neste navegador; depois, curta. */
export function modoDaSplash(): ModoSplash {
  try {
    return localStorage.getItem(CHAVE_SPLASH_COMPLETA) === hoje() ? 'curta' : 'completa';
  } catch {
    return 'completa';
  }
}

export function marcarSplashCompleta() {
  try {
    localStorage.setItem(CHAVE_SPLASH_COMPLETA, hoje());
  } catch {
    /* sem localStorage (aba privada etc.): a próxima entrada repete a completa */
  }
}

/**
 * Partículas da bola conforme o aparelho: 40 mil em máquina folgada, 15 mil em
 * celular/tela pequena ou com poucos núcleos/pouca memória (onde 40 mil
 * engasgam a GPU).
 */
export function particulasDoAparelho(): number {
  const nucleos = navigator.hardwareConcurrency || 4;
  const memoria = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const pequeno = Math.min(window.innerWidth, window.innerHeight) < 600 || window.matchMedia('(pointer: coarse)').matches;
  return pequeno || nucleos <= 4 || memoria <= 4 ? 15000 : 40000;
}
