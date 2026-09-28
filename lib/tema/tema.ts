// Aparência escolhida por cada usuário (não é configuração do workspace): fica
// num cookie do navegador, lido pelo layout raiz para já desenhar a página no
// tema certo, sem piscar. O tema vira o atributo `data-tema` do <html>; o CSS
// (globals.css e os módulos do tema) troca as cores a partir dele.

export const TEMAS = ['padrao', 'escuro', 'claro'] as const
export type Tema = (typeof TEMAS)[number]

export const TEMA_PADRAO: Tema = 'padrao'
export const COOKIE_TEMA = 'prospectos-tema'

export const ROTULO_TEMA: Record<Tema, { nome: string; descricao: string }> = {
  padrao: { nome: 'Padrão', descricao: 'Azul-marinho, a aparência original do ProspectOS.' },
  escuro: { nome: 'Escuro', descricao: 'Escuro neutro, em tons de cinza e preto.' },
  claro: { nome: 'Claro', descricao: 'Fundo claro, para ambientes iluminados.' },
}

/** Valor desconhecido, vazio ou adulterado cai no Padrão. */
export function parseTema(valor: string | null | undefined): Tema {
  return (TEMAS as readonly string[]).includes(valor ?? '') ? (valor as Tema) : TEMA_PADRAO
}

/** Aplica no documento aberto e grava o cookie (1 ano) para as próximas cargas. */
export function aplicarTema(tema: Tema): void {
  document.documentElement.dataset.tema = tema
  document.cookie = `${COOKIE_TEMA}=${tema}; path=/; max-age=31536000; samesite=lax`
}
