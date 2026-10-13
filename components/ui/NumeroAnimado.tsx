'use client';

// Número que conta até o valor: do 0 ao aparecer, e do valor anterior ao novo
// quando muda (ex.: "Empresas avaliadas" durante a busca). Só anima número
// real; quem não tem o dado mostra "—" e não usa este componente. Com
// "reduzir movimento" do sistema, mostra o valor direto.
import { useEffect, useRef, useState } from 'react';
import { animate, useReducedMotion } from 'framer-motion';

const formatoPadrao = (n: number) => Math.round(n).toLocaleString('pt-BR');

// Contagem: 1,6 s numa curva que desacelera sem "pular" o começo (ease-out
// cúbico). A primeira começa depois que o card terminou de entrar (atraso).
export function NumeroAnimado({
  valor,
  formatar = formatoPadrao,
  duracao = 1.6,
  atraso = 0.35,
}: {
  valor: number;
  formatar?: (n: number) => string;
  /** Segundos. */
  duracao?: number;
  /** Segundos antes da primeira contagem (as seguintes começam na hora). */
  atraso?: number;
}) {
  const reduzir = useReducedMotion();
  const [exibido, setExibido] = useState(0);
  const atual = useRef(0);
  // Vira true no primeiro quadro de fato contado (não no efeito: o modo
  // estrito roda o efeito duas vezes e gastaria o atraso à toa).
  const contou = useRef(false);

  useEffect(() => {
    if (reduzir) {
      atual.current = valor;
      setExibido(valor);
      return;
    }
    const espera = contou.current ? 0 : atraso;
    const controle = animate(atual.current, valor, {
      duration: duracao,
      delay: espera,
      ease: [0.33, 1, 0.68, 1],
      onUpdate: (v) => {
        contou.current = true;
        atual.current = v;
        setExibido(v);
      },
    });
    return () => controle.stop();
  }, [valor, duracao, atraso, reduzir]);

  return (
    <>
      <span className="sr-only">{formatar(valor)}</span>
      <span aria-hidden="true" className="tabular-nums">{formatar(exibido)}</span>
    </>
  );
}
