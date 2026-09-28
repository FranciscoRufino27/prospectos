'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Building2, Check, ChevronDown, X } from 'lucide-react';
import { PROSPECCAO_LIMITES } from '@/lib/config/workspaceConfig';
import { podarMunicipios, type Municipio } from '@/lib/prospeccao/municipios';
import { nomeLegivel } from '@/lib/prospeccao/rotulos';
import s from './Prospeccao.module.css';

// Select de municípios com busca no catálogo RF (/api/prospeccao/municipios).
// Guarda o CÓDIGO da RF; o nome vem do servidor. Nenhum marcado = todos os
// municípios dos estados escolhidos. Usado no filtro da tela e no perfil.

const MAX_ETIQUETAS = 3;
const LIMITE = PROSPECCAO_LIMITES.municipios;
const ESPERA_DIGITACAO_MS = 250;

async function consultar(params: URLSearchParams): Promise<Municipio[]> {
  const res = await fetch(`/api/prospeccao/municipios?${params}`);
  const corpo = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(corpo?.erro || 'Não foi possível carregar os municípios.');
  return corpo.municipios ?? [];
}

export default function SeletorMunicipios({
  selecionados, ufs, onChange, desabilitado = false,
}: {
  selecionados: string[];
  ufs: string[];
  onChange: (codigos: string[]) => void;
  desabilitado?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState('');
  const [ativo, setAtivo] = useState(0);
  const [opcoes, setOpcoes] = useState<Municipio[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [conhecidos, setConhecidos] = useState<Record<string, Municipio>>({});
  const raiz = useRef<HTMLDivElement>(null);
  const entrada = useRef<HTMLInputElement>(null);
  const lista = useRef<HTMLUListElement>(null);
  const ultimaConsulta = useRef(0);
  const idLista = useId();
  const chaveUfs = ufs.join(',');

  function lembrar(ms: Municipio[]) {
    if (ms.length) setConhecidos((c) => ({ ...c, ...Object.fromEntries(ms.map((m) => [m.codigo, m])) }));
  }

  // Nomes dos códigos já salvos (perfil, pesquisa salva) que ainda não conhecemos.
  const desconhecidos = selecionados.filter((c) => !conhecidos[c]).join(',');
  useEffect(() => {
    if (!desconhecidos) return;
    const params = new URLSearchParams();
    desconhecidos.split(',').forEach((c) => params.append('codigo', c));
    consultar(params).then(lembrar).catch(() => { /* etiqueta mostra o código */ });
  }, [desconhecidos]);

  // Sugestões: estados escolhidos + texto digitado. Resposta antiga não
  // sobrescreve a nova (o usuário digita mais rápido que a rede).
  useEffect(() => {
    if (!aberto || desabilitado) return;
    const id = ++ultimaConsulta.current;
    if (!texto.trim() && !chaveUfs) { setOpcoes([]); setErro(null); setCarregando(false); return; }
    const params = new URLSearchParams();
    if (chaveUfs) chaveUfs.split(',').forEach((uf) => params.append('uf', uf));
    if (texto.trim()) params.set('q', texto.trim());
    setCarregando(true);
    const t = setTimeout(() => {
      consultar(params)
        .then((ms) => { if (id === ultimaConsulta.current) { setOpcoes(ms); setErro(null); lembrar(ms); } })
        .catch((e) => { if (id === ultimaConsulta.current) { setOpcoes([]); setErro(e instanceof Error ? e.message : 'Erro'); } })
        .finally(() => { if (id === ultimaConsulta.current) setCarregando(false); });
    }, texto ? ESPERA_DIGITACAO_MS : 0);
    return () => clearTimeout(t);
  }, [aberto, desabilitado, texto, chaveUfs]);

  useEffect(() => { setAtivo(0); }, [opcoes]);

  // Estado removido leva junto os municípios dele (senão a busca volta vazia).
  const ultimoSelecionados = useRef(selecionados);
  ultimoSelecionados.current = selecionados;
  const ultimoOnChange = useRef(onChange);
  ultimoOnChange.current = onChange;
  useEffect(() => {
    const atuais = ultimoSelecionados.current;
    const podados = podarMunicipios(atuais, chaveUfs ? chaveUfs.split(',') : [], conhecidos);
    if (podados.length !== atuais.length) ultimoOnChange.current(podados);
  }, [chaveUfs, conhecidos]);

  useEffect(() => {
    if (!aberto) return;
    const fechar = (e: MouseEvent) => { if (!raiz.current?.contains(e.target as Node)) { setAberto(false); setTexto(''); } };
    document.addEventListener('mousedown', fechar);
    return () => document.removeEventListener('mousedown', fechar);
  }, [aberto]);

  useEffect(() => {
    lista.current?.querySelector<HTMLElement>(`[data-indice="${ativo}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [ativo]);

  const cheio = selecionados.length >= LIMITE;

  function alternar(m: Municipio) {
    if (selecionados.includes(m.codigo)) onChange(selecionados.filter((c) => c !== m.codigo));
    else if (!cheio) onChange([...selecionados, m.codigo]);
    setTexto('');
    entrada.current?.focus();
  }

  function teclado(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setAberto(true); setAtivo((i) => Math.min(i + 1, opcoes.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAtivo((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (aberto && opcoes[ativo]) alternar(opcoes[ativo]); else setAberto(true); }
    // preventDefault avisa o painel (que ouve Esc no document) que este Esc já fechou o menu.
    else if (e.key === 'Escape') { if (aberto) { e.preventDefault(); setAberto(false); setTexto(''); } }
    else if (e.key === 'Backspace' && !texto && selecionados.length) onChange(selecionados.slice(0, -1));
  }

  const rotulo = (codigo: string) => {
    const m = conhecidos[codigo];
    return m ? nomeLegivel(m.nome) : `Município ${codigo}`;
  };
  const visiveis = selecionados.slice(0, MAX_ETIQUETAS);
  const ocultos = selecionados.length - visiveis.length;
  const semEstado = !chaveUfs;

  let mensagem: string | null = null;
  if (erro) mensagem = erro;
  else if (!texto.trim() && semEstado) mensagem = 'Digite o nome da cidade';
  else if (carregando && opcoes.length === 0) mensagem = 'Buscando…';
  else if (opcoes.length === 0) mensagem = 'Nenhum município com empresas no catálogo';

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
        <Building2 size={14} className="shrink-0 text-sky-300" aria-hidden="true" />
        {visiveis.map((codigo) => (
          <span key={codigo} className={s.comboTag} title={conhecidos[codigo] ? `${rotulo(codigo)}/${conhecidos[codigo].uf}` : undefined}>
            <span className="max-w-[110px] truncate">{rotulo(codigo)}</span>
            {!desabilitado && (
              <button
                type="button"
                aria-label={`Remover ${rotulo(codigo)}`}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => onChange(selecionados.filter((c) => c !== codigo))}
                className="text-indigo-200 hover:text-white"
              >
                <X size={11} />
              </button>
            )}
          </span>
        ))}
        {ocultos > 0 && <span className={s.comboTag} title={selecionados.slice(MAX_ETIQUETAS).map(rotulo).join(', ')}>+{ocultos}</span>}
        <input
          ref={entrada}
          value={texto}
          disabled={desabilitado}
          onChange={(e) => { setTexto(e.target.value); setAberto(true); }}
          onFocus={() => setAberto(true)}
          onKeyDown={teclado}
          placeholder={selecionados.length ? 'Adicionar cidade…' : semEstado ? 'Todas — digite uma cidade' : 'Todas dos estados'}
          role="combobox"
          aria-expanded={aberto}
          aria-controls={idLista}
          aria-autocomplete="list"
          aria-label="Municípios"
          className={s.comboInput}
        />
        <ChevronDown size={15} className={`shrink-0 text-slate-400 transition-transform ${aberto ? 'rotate-180' : ''}`} aria-hidden="true" />
      </div>

      {aberto && !desabilitado && (
        <div className={`${s.popover} ${s.comboMenu}`}>
          {selecionados.length > 0 && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onChange([]); setTexto(''); }}
              className={`${s.comboClear} focus-ring`}
            >
              {semEstado ? 'Todos os municípios' : 'Todos os municípios dos estados'}
            </button>
          )}
          {cheio && <p className="px-3 py-2 text-xs text-amber-300">Limite de {LIMITE} municípios atingido.</p>}
          <ul ref={lista} id={idLista} role="listbox" aria-multiselectable="true" aria-busy={carregando} className={s.comboList}>
            {mensagem && <li className={`px-3 py-2 text-xs ${erro ? 'text-red-300' : 'text-slate-500'}`}>{mensagem}</li>}
            {opcoes.map((m, i) => {
              const marcado = selecionados.includes(m.codigo);
              return (
                <li
                  key={m.codigo}
                  role="option"
                  aria-selected={marcado}
                  aria-disabled={!marcado && cheio}
                  data-indice={i}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => alternar(m)}
                  onMouseEnter={() => setAtivo(i)}
                  className={`${s.comboOption} ${i === ativo ? s.comboOptionAtiva : ''} ${!marcado && cheio ? 'opacity-50' : ''}`}
                >
                  <span className={`${s.atividadeCheck} ${marcado ? s.checkMarcado : ''}`}>{marcado && <Check size={11} />}</span>
                  <span className="flex-1 truncate">{nomeLegivel(m.nome)}</span>
                  <span className="font-mono text-[11px] text-slate-500">{m.uf}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
