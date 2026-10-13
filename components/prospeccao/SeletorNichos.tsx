'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Loader2, Plus, Search, Trash2, X } from 'lucide-react';
import { PROSPECCAO_LIMITES } from '@/lib/config/workspaceConfig';
import { alternarNicho, todosNichos, type Nicho } from '@/lib/prospeccao/nichos';
import CriarNichoModal, { type NichoCriado } from './CriarNichoModal';
import { iconeDoNicho } from './iconesNicho';
import type { NichosOrg } from './useNichosOrg';
import s from './Prospeccao.module.css';

const SEM_EXTRAS: Nicho[] = [];

export default function SeletorNichos({
  cnaes,
  desabilitado = false,
  onChange,
  onAviso,
  nichosOrg,
}: {
  cnaes: string[];
  desabilitado?: boolean;
  onChange: (cnaes: string[]) => void;
  onAviso: (aviso: string | null) => void;
  /** Nichos criados pela organização e a carga deles; sem isso, só os pré-definidos. */
  nichosOrg?: NichosOrg;
}) {
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState('');
  const [criando, setCriando] = useState<string | null>(null);
  // Nicho da organização com a exclusão aberta (pede confirmação na própria linha).
  const [excluindo, setExcluindo] = useState<{ id: string; enviando: boolean } | null>(null);
  const raiz = useRef<HTMLDivElement>(null);
  const entrada = useRef<HTMLInputElement>(null);
  const idLista = useId();
  const extras = nichosOrg?.nichos ?? SEM_EXTRAS;
  const nichos = useMemo(() => todosNichos(extras), [extras]);
  const podeCriar = !!nichosOrg?.podeEditar && !desabilitado;

  const opcoes = useMemo(() => {
    const termo = texto.trim().toLocaleLowerCase('pt-BR');
    if (!termo) return nichos;
    return nichos.filter((nicho) =>
      nicho.nome.toLocaleLowerCase('pt-BR').includes(termo)
      || nicho.atividades.some((atividade) => atividade.nome.toLocaleLowerCase('pt-BR').includes(termo)),
    );
  }, [texto, nichos]);

  const selecionados = nichos.filter((nicho) =>
    nicho.atividades.some((atividade) => cnaes.includes(atividade.codigo)),
  );

  // Nicho com atividade fora do catálogo e pedido de carga aberto: a busca na
  // Receita está trazendo as empresas. Sem pedido, o aviso da tela explica.
  const buscando = (nicho: Nicho) =>
    !!nichosOrg?.carregado && nicho.atividades.some((a) =>
      !nichosOrg.catalogoCnaes.includes(a.codigo)
      && nichosOrg.pedidos.some((p) => (p.status === 'pendente' || p.status === 'em_andamento') && p.cnaes.includes(a.codigo)));

  async function excluir(nicho: Nicho) {
    if (!nichosOrg) return;
    setExcluindo({ id: nicho.id, enviando: true });
    const res = await fetch(`/api/prospeccao/nichos/${encodeURIComponent(nicho.id)}`, { method: 'DELETE' });
    const corpo = await res.json().catch(() => ({}));
    setExcluindo(null);
    if (!res.ok) return onAviso(corpo?.erro || 'Não foi possível excluir o nicho.');
    nichosOrg.aplicar(corpo);
    nichosOrg.recontar(); // o servidor também tirou as atividades do perfil salvo
    // As atividades dele saem do perfil: sem o nicho, ficariam soltas.
    const codigos = new Set(nicho.atividades.map((a) => a.codigo));
    if (cnaes.some((c) => codigos.has(c))) onChange(cnaes.filter((c) => !codigos.has(c)));
    onAviso(`Nicho "${nicho.nome}" excluído.`);
  }

  function abrirCriacao() {
    setCriando(texto.trim());
    setAberto(false);
    setTexto('');
  }

  function aoCriar(resposta: NichoCriado) {
    setCriando(null);
    nichosOrg?.aplicar(resposta);
    // O nicho novo já entra no perfil (se couber). Se todas as atividades já
    // estavam no perfil, alternar tiraria — então não mexe.
    const novo = resposta.nichos.find((n) => n.id === resposta.nichoId);
    if (!novo) return;
    // Diz quais atividades entraram (podem ter saído do nome, no servidor).
    const nomes = novo.atividades.map((a) => a.nome);
    const criado = `Nicho "${novo.nome}" criado com: ${nomes.length > 1 ? `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}` : nomes[0]}.`;
    if (novo.atividades.every((a) => cnaes.includes(a.codigo))) return onAviso(criado);
    const r = alternarNicho(cnaes, resposta.nichoId, PROSPECCAO_LIMITES.cnaes, resposta.nichos);
    if (r.ok) {
      onChange(r.cnaes); // o painel limpa o aviso ao mudar os nichos: avisa depois
      onAviso(criado);
    } else {
      onAviso(`Nicho criado, mas não coube no perfil: libere ${r.faltam} atividade${r.faltam === 1 ? '' : 's'} para selecioná-lo.`);
    }
  }

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
    const resultado = alternarNicho(cnaes, id, PROSPECCAO_LIMITES.cnaes, extras);
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
    const nicho = nichos.find((item) => item.id === id);
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
                  {buscando(nicho) && <small className="shrink-0 text-[10px] text-sky-300">buscando na Receita</small>}
                  {nicho.personalizado && podeCriar && (excluindo?.id === nicho.id ? (
                    <span className="flex shrink-0 items-center gap-1 text-[11px]" onClick={(evento) => evento.stopPropagation()}>
                      {excluindo.enviando ? <Loader2 size={12} className="animate-spin" /> : (
                        <>
                          <span className="text-slate-300">Excluir?</span>
                          <button type="button" onClick={() => excluir(nicho)} className="rounded px-1.5 py-0.5 text-red-300 hover:bg-red-500/15 focus-ring">Sim</button>
                          <button type="button" onClick={() => setExcluindo(null)} className="rounded px-1.5 py-0.5 text-slate-300 hover:bg-white/10 focus-ring">Não</button>
                        </>
                      )}
                    </span>
                  ) : (
                    <button
                      type="button"
                      aria-label={`Excluir o nicho ${nicho.nome}`}
                      title="Excluir nicho"
                      onClick={(evento) => { evento.stopPropagation(); setExcluindo({ id: nicho.id, enviando: false }); }}
                      className="shrink-0 rounded p-1 text-slate-400 hover:bg-red-500/15 hover:text-red-300 focus-ring"
                    >
                      <Trash2 size={13} />
                    </button>
                  ))}
                </li>
              );
            })}
          </ul>
          {podeCriar && (
            <button
              type="button"
              onMouseDown={(evento) => evento.preventDefault()}
              onClick={abrirCriacao}
              className={`${s.comboOption} w-full border-t border-[var(--m-border,rgba(56,104,160,0.35))] text-sky-300`}
            >
              <Plus size={14} className="shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-left">
                {texto.trim() ? <>Criar nicho &quot;{texto.trim()}&quot;</> : 'Criar nicho com outras atividades'}
              </span>
            </button>
          )}
        </div>
      )}

      {selecionados.length > 0 && (
        <div className={s.profileChips} aria-label="Nichos selecionados">
          {selecionados.map((nicho) => {
            return (
              <span key={nicho.id} className={s.profileChip} title={buscando(nicho) ? 'Buscando as empresas na Receita Federal' : undefined}>
                {buscando(nicho) && <Loader2 size={11} className="animate-spin" aria-label="buscando na Receita" />}
                {nicho.nome}
                {!desabilitado && (
                  <button type="button" aria-label={`Remover ${nicho.nome}`} onClick={() => remover(nicho.id)} className="text-indigo-100 [[data-tema=claro]_&]:text-indigo-700 hover:text-[var(--t-strong,#fff)]">
                    <X size={12} />
                  </button>
                )}
              </span>
            );
          })}
        </div>
      )}

      {criando !== null && (
        <CriarNichoModal termoInicial={criando} onFechar={() => setCriando(null)} onCriado={aoCriar} />
      )}
    </div>
  );
}
