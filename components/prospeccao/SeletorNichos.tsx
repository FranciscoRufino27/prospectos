'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { PROSPECCAO_LIMITES } from '@/lib/config/workspaceConfig';
import { alternarNicho, NICHOS } from '@/lib/prospeccao/nichos';
import { iconeDoNicho } from './iconesNicho';
import s from './Prospeccao.module.css';

export default function SeletorNichos({
  cnaes,
  desabilitado = false,
  onChange,
  onAviso,
}: {
  cnaes: string[];
  desabilitado?: boolean;
  onChange: (cnaes: string[]) => void;
  onAviso: (aviso: string | null) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState('');
  const raiz = useRef<HTMLDivElement>(null);
  const entrada = useRef<HTMLInputElement>(null);
  const idLista = useId();

  const opcoes = useMemo(() => {
    const termo = texto.trim().toLocaleLowerCase('pt-BR');
    if (!termo) return NICHOS;
    return NICHOS.filter((nicho) =>
      nicho.nome.toLocaleLowerCase('pt-BR').includes(termo)
      || nicho.atividades.some((atividade) => atividade.nome.toLocaleLowerCase('pt-BR').includes(termo)),
    );
  }, [texto]);

  const selecionados = NICHOS.filter((nicho) =>
    nicho.atividades.some((atividade) => cnaes.includes(atividade.codigo)),
  );

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

  function alternar(id: string) {
    const resultado = alternarNicho(cnaes, id, PROSPECCAO_LIMITES.cnaes);
    if (!resultado.ok) {
      onAviso(`Não cabe: libere ${resultado.faltam} atividade${resultado.faltam === 1 ? '' : 's'} para selecionar este nicho.`);
      return;
    }
    onAviso(null);
    onChange(resultado.cnaes);
    setTexto('');
    entrada.current?.focus();
  }

  function remover(id: string) {
    const nicho = NICHOS.find((item) => item.id === id);
    if (!nicho) return;
    const codigos = new Set(nicho.atividades.map((atividade) => atividade.codigo));
    onAviso(null);
    onChange(cnaes.filter((codigo) => !codigos.has(codigo)));
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
        <Search size={14} className="shrink-0 text-sky-300" aria-hidden="true" />
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
          placeholder="Selecione um ou mais nichos"
          role="combobox"
          aria-expanded={aberto}
          aria-controls={idLista}
          aria-autocomplete="list"
          aria-label="Nichos de interesse"
          className={s.comboInput}
        />
        <ChevronDown size={15} className={`shrink-0 text-slate-400 transition-transform ${aberto ? 'rotate-180' : ''}`} aria-hidden="true" />
      </div>

      {aberto && !desabilitado && (
        <div className={`${s.popover} ${s.comboMenu}`}>
          <ul id={idLista} role="listbox" aria-multiselectable="true" className={s.comboList}>
            {opcoes.length === 0 && <li className="px-3 py-2 text-xs text-slate-500">Nenhum nicho encontrado</li>}
            {opcoes.map((nicho) => {
              const codigos = nicho.atividades.map((atividade) => atividade.codigo);
              const marcadas = codigos.filter((codigo) => cnaes.includes(codigo)).length;
              const Icone = iconeDoNicho(nicho.id);
              return (
                <li
                  key={nicho.id}
                  role="option"
                  aria-selected={marcadas > 0}
                  onMouseDown={(evento) => evento.preventDefault()}
                  onClick={() => alternar(nicho.id)}
                  className={s.comboOption}
                >
                  <span className={`${s.atividadeCheck} ${marcadas ? s.checkMarcado : ''}`}>{marcadas > 0 && <Check size={11} />}</span>
                  <Icone size={14} className="shrink-0 text-sky-300" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{nicho.nome}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {selecionados.length > 0 && (
        <div className={s.profileChips} aria-label="Nichos selecionados">
          {selecionados.map((nicho) => {
            return (
              <span key={nicho.id} className={s.profileChip}>
                {nicho.nome}
                {!desabilitado && (
                  <button type="button" aria-label={`Remover ${nicho.nome}`} onClick={() => remover(nicho.id)} className="text-indigo-100 hover:text-white">
                    <X size={12} />
                  </button>
                )}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
