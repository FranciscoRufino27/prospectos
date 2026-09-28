'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import s from './Prospeccao.module.css';

export interface OpcaoPerfil {
  valor: string;
  rotulo: string;
}

export default function SeletorOpcoesPerfil({
  rotuloAcessivel,
  placeholder,
  opcoes,
  selecionados,
  desabilitado = false,
  onChange,
}: {
  rotuloAcessivel: string;
  placeholder: string;
  opcoes: readonly OpcaoPerfil[];
  selecionados: string[];
  desabilitado?: boolean;
  onChange: (valores: string[]) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState('');
  const raiz = useRef<HTMLDivElement>(null);
  const entrada = useRef<HTMLInputElement>(null);
  const idLista = useId();

  const filtradas = useMemo(() => {
    const termo = texto.trim().toLocaleLowerCase('pt-BR');
    return termo ? opcoes.filter((opcao) => opcao.rotulo.toLocaleLowerCase('pt-BR').includes(termo)) : opcoes;
  }, [opcoes, texto]);

  useEffect(() => {
    if (!aberto) return;
    const fechar = (evento: MouseEvent) => {
      if (!raiz.current?.contains(evento.target as Node)) {
        setAberto(false);
        setTexto('');
      }
    };
    document.addEventListener('mousedown', fechar);
    return () => document.removeEventListener('mousedown', fechar);
  }, [aberto]);

  function alternar(valor: string) {
    onChange(selecionados.includes(valor) ? selecionados.filter((item) => item !== valor) : [...selecionados, valor]);
    setTexto('');
    entrada.current?.focus();
  }

  return (
    <div ref={raiz} className="relative">
      <div
        className={`${s.field} ${s.comboField} ${desabilitado ? 'opacity-60' : 'cursor-text'}`}
        onMouseDown={(evento) => {
          if (desabilitado || evento.target === entrada.current) return;
          evento.preventDefault();
          entrada.current?.focus();
          setAberto(true);
        }}
      >
        <Search size={14} className="shrink-0 text-slate-400" aria-hidden="true" />
        <input
          ref={entrada}
          value={texto}
          disabled={desabilitado}
          onChange={(evento) => { setTexto(evento.target.value); setAberto(true); }}
          onFocus={() => setAberto(true)}
          onKeyDown={(evento) => {
            if (evento.key === 'Escape' && aberto) {
              evento.preventDefault();
              setAberto(false);
              setTexto('');
            }
          }}
          placeholder={placeholder}
          role="combobox"
          aria-expanded={aberto}
          aria-controls={idLista}
          aria-autocomplete="list"
          aria-label={rotuloAcessivel}
          className={s.comboInput}
        />
        <ChevronDown size={15} className={`shrink-0 text-slate-400 transition-transform ${aberto ? 'rotate-180' : ''}`} aria-hidden="true" />
      </div>

      {aberto && !desabilitado && (
        <div className={`${s.popover} ${s.comboMenu}`}>
          <ul id={idLista} role="listbox" aria-multiselectable="true" className={s.comboList}>
            {filtradas.length === 0 && <li className="px-3 py-2 text-xs text-slate-500">Nenhuma opção encontrada</li>}
            {filtradas.map((opcao) => {
              const marcada = selecionados.includes(opcao.valor);
              return (
                <li
                  key={opcao.valor}
                  role="option"
                  aria-selected={marcada}
                  onMouseDown={(evento) => evento.preventDefault()}
                  onClick={() => alternar(opcao.valor)}
                  className={s.comboOption}
                >
                  <span className={`${s.atividadeCheck} ${marcada ? s.checkMarcado : ''}`}>{marcada && <Check size={11} />}</span>
                  <span className="flex-1 truncate">{opcao.rotulo}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {selecionados.length > 0 && (
        <div className={s.profileChips}>
          {selecionados.map((valor) => {
            const rotulo = opcoes.find((opcao) => opcao.valor === valor)?.rotulo ?? valor;
            return (
              <span key={valor} className={s.profileChip}>
                {rotulo}
                {!desabilitado && <button type="button" aria-label={`Remover ${rotulo}`} onClick={() => alternar(valor)}><X size={12} /></button>}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
