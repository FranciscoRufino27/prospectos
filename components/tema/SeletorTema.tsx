'use client';

import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { aplicarTema, parseTema, ROTULO_TEMA, TEMAS, type Tema } from '@/lib/tema/tema';

// Miniatura de cada tema (menu lateral + fundo + cartão), com as cores fixas
// daquele tema — a prévia não pode mudar junto com o tema ativo.
const AMOSTRA: Record<Tema, { menu: string; fundo: string; cartao: string; linha: string; borda: string }> = {
  padrao: { menu: '#1e1b4b', fundo: '#041326', cartao: '#06213d', linha: '#c3cee0', borda: '#155987' },
  escuro: { menu: '#111113', fundo: '#0b0b0d', cartao: '#161618', linha: '#a1a1aa', borda: '#2c2c31' },
  claro: { menu: '#ffffff', fundo: '#f4f6fb', cartao: '#ffffff', linha: '#94a3b8', borda: '#d9dfeb' },
};

/** Escolha da aparência do usuário. Aplica na hora e vale para este navegador. */
export default function SeletorTema() {
  const [atual, setAtual] = useState<Tema | null>(null);

  useEffect(() => {
    setAtual(parseTema(document.documentElement.dataset.tema));
  }, []);

  function escolher(tema: Tema) {
    aplicarTema(tema);
    setAtual(tema);
  }

  return (
    <div role="radiogroup" aria-label="Aparência" className="grid grid-cols-3 gap-3">
      {TEMAS.map((tema) => {
        const a = AMOSTRA[tema];
        const ativo = atual === tema;
        return (
          <button
            key={tema}
            type="button"
            role="radio"
            aria-checked={ativo}
            onClick={() => escolher(tema)}
            className={`focus-ring grid gap-2 rounded-xl border p-2 text-left transition-colors ${
              ativo ? 'border-indigo-400 bg-indigo-500/10' : 'border-[var(--border)] hover:border-[var(--border-strong)]'
            }`}
          >
            <span
              aria-hidden="true"
              className="flex h-16 overflow-hidden rounded-lg border"
              style={{ background: a.fundo, borderColor: a.borda }}
            >
              <span className="w-1/4" style={{ background: a.menu, borderRight: `1px solid ${a.borda}` }} />
              <span className="flex flex-1 flex-col gap-1.5 p-2">
                <span className="h-1.5 w-2/3 rounded-full" style={{ background: a.linha }} />
                <span className="flex-1 rounded-md border" style={{ background: a.cartao, borderColor: a.borda }} />
              </span>
            </span>
            <span className="flex items-center justify-between gap-2 px-0.5">
              <span className="text-sm font-semibold text-slate-100">{ROTULO_TEMA[tema].nome}</span>
              {ativo && <Check size={15} className="text-indigo-300" aria-hidden="true" />}
            </span>
            <span className="px-0.5 text-[11px] leading-snug text-slate-400">{ROTULO_TEMA[tema].descricao}</span>
          </button>
        );
      })}
    </div>
  );
}
