'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, MapPin, X } from 'lucide-react';
import { filtrarEstados, NOME_UF } from '@/lib/prospeccao/estados';
import s from './Prospeccao.module.css';

// Select de estados com busca: digita sigla ou nome ("sp", "sao paulo"),
// marca vários. Nenhum marcado = Brasil inteiro. Usado no filtro da tela e no
// perfil de busca.

type Uf = keyof typeof NOME_UF;

const MAX_ETIQUETAS = 4;

export default function SeletorEstados({
  selecionadas, onChange, desabilitado = false,
}: {
  selecionadas: string[];
  onChange: (ufs: string[]) => void;
  desabilitado?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState('');
  const [ativo, setAtivo] = useState(0);
  const raiz = useRef<HTMLDivElement>(null);
  const entrada = useRef<HTMLInputElement>(null);
  const lista = useRef<HTMLUListElement>(null);
  const idLista = useId();

  const opcoes = useMemo(() => filtrarEstados(texto), [texto]);

  useEffect(() => { setAtivo(0); }, [texto]);

  useEffect(() => {
    if (!aberto) return;
    const fechar = (e: MouseEvent) => { if (!raiz.current?.contains(e.target as Node)) { setAberto(false); setTexto(''); } };
    document.addEventListener('mousedown', fechar);
    return () => document.removeEventListener('mousedown', fechar);
  }, [aberto]);

  // Mantém a opção destacada visível ao navegar pelo teclado.
  useEffect(() => {
    lista.current?.querySelector<HTMLElement>(`[data-indice="${ativo}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [ativo]);

  function alternar(uf: Uf) {
    onChange(selecionadas.includes(uf) ? selecionadas.filter((u) => u !== uf) : [...selecionadas, uf]);
    setTexto('');
    entrada.current?.focus();
  }

  function teclado(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setAberto(true); setAtivo((i) => Math.min(i + 1, opcoes.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAtivo((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (aberto && opcoes[ativo]) alternar(opcoes[ativo]); else setAberto(true); }
    // preventDefault avisa o painel (que ouve Esc no document) que este Esc já
    // fechou o menu — senão fecharia o painel junto, perdendo o que não foi salvo.
    else if (e.key === 'Escape') { if (aberto) { e.preventDefault(); setAberto(false); setTexto(''); } }
    else if (e.key === 'Backspace' && !texto && selecionadas.length) onChange(selecionadas.slice(0, -1));
  }

  const visiveis = selecionadas.slice(0, MAX_ETIQUETAS);
  const ocultas = selecionadas.length - visiveis.length;

  return (
    <div ref={raiz} className="relative">
      <div
        className={`${s.field} ${s.comboField} ${desabilitado ? 'opacity-60' : 'cursor-text'}`}
        onMouseDown={(e) => {
          if (desabilitado || e.target === entrada.current) return;
          e.preventDefault();
          entrada.current?.focus();
          setAberto(true);
        }}
      >
        <MapPin size={14} className="shrink-0 text-sky-300" aria-hidden="true" />
        {visiveis.map((uf) => (
          <span key={uf} className={s.comboTag} title={NOME_UF[uf as Uf]}>
            {uf}
            {!desabilitado && (
              <button
                type="button"
                aria-label={`Remover ${NOME_UF[uf as Uf] ?? uf}`}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => onChange(selecionadas.filter((u) => u !== uf))}
                className="text-indigo-200 hover:text-[var(--t-strong,#fff)]"
              >
                <X size={11} />
              </button>
            )}
          </span>
        ))}
        {ocultas > 0 && <span className={s.comboTag}>+{ocultas}</span>}
        <input
          ref={entrada}
          value={texto}
          disabled={desabilitado}
          onChange={(e) => { setTexto(e.target.value); setAberto(true); }}
          onFocus={() => setAberto(true)}
          onKeyDown={teclado}
          placeholder={selecionadas.length ? 'Adicionar estado…' : 'Todo o Brasil — digite um estado'}
          role="combobox"
          aria-expanded={aberto}
          aria-controls={idLista}
          aria-autocomplete="list"
          aria-label="Estados"
          className={s.comboInput}
        />
        <ChevronDown size={15} className={`shrink-0 text-slate-400 transition-transform ${aberto ? 'rotate-180' : ''}`} aria-hidden="true" />
      </div>

      {aberto && !desabilitado && (
        <div className={`${s.popover} ${s.comboMenu}`}>
          {selecionadas.length > 0 && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onChange([]); setTexto(''); }}
              className={`${s.comboClear} focus-ring`}
            >
              Buscar no Brasil inteiro
            </button>
          )}
          <ul ref={lista} id={idLista} role="listbox" aria-multiselectable="true" className={s.comboList}>
            {opcoes.length === 0 && <li className="px-3 py-2 text-xs text-slate-500">Nenhum estado encontrado</li>}
            {opcoes.map((uf, i) => {
              const marcado = selecionadas.includes(uf);
              return (
                <li
                  key={uf}
                  role="option"
                  aria-selected={marcado}
                  data-indice={i}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => alternar(uf)}
                  onMouseEnter={() => setAtivo(i)}
                  className={`${s.comboOption} ${i === ativo ? s.comboOptionAtiva : ''}`}
                >
                  <span className={`${s.atividadeCheck} ${marcado ? s.checkMarcado : ''}`}>{marcado && <Check size={11} />}</span>
                  <span className="flex-1 truncate">{NOME_UF[uf]}</span>
                  <span className="font-mono text-[11px] text-slate-500">{uf}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
