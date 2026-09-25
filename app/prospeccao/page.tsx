'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Bookmark, Building2, Check, ChevronDown, ChevronRight, Database, Download, Filter, LayoutGrid, ListChecks, Mail,
  Plus, Radar, RotateCcw, Search, Settings, SlidersHorizontal, Trash2, X,
} from 'lucide-react';
import { LIMITE_PAGINA, type FiltrosBusca } from '@/lib/prospeccao/filtros';
import type { ResultadoCatalogo, StatusCatalogo } from '@/lib/prospeccao/buscaServidor';
import { ROTULO_QUALIDADE, type QualidadeEmail } from '@/lib/prospeccao/qualidadeEmail';
import { formatarCnae, iniciais, nomeLegivel, rotuloPorte, ROTULO_PORTE } from '@/lib/prospeccao/rotulos';
import { gruposDoPerfil, nomeAtividade } from '@/lib/prospeccao/nichos';
import { nomeSugerido } from '@/lib/prospeccao/pesquisas';
import { formatarCnpj } from '@/lib/empresas/cnpj';
import { PESQUISAS_LIMITES, PORTES_PROSPECCAO, quantidadeValida, type PesquisaSalva, type PorteProspeccao } from '@/lib/config/workspaceConfig';
import DetalheEmpresa, { type Decisor } from '@/components/prospeccao/DetalheEmpresa';
import ImportarProspeccaoModal from '@/components/prospeccao/ImportarProspeccaoModal';
import CaixaSelecao from '@/components/prospeccao/CaixaSelecao';
import PerfilBuscaPainel from '@/components/prospeccao/PerfilBuscaPainel';
import SeletorEstados from '@/components/prospeccao/SeletorEstados';
import SeletorMunicipios from '@/components/prospeccao/SeletorMunicipios';
import PesquisasSalvas, { SalvarPesquisa } from '@/components/prospeccao/PesquisasSalvas';
import { iconeDoNicho } from '@/components/prospeccao/iconesNicho';
import s from '@/components/prospeccao/Prospeccao.module.css';

// Prospecção: buscar no catálogo da Receita → analisar → selecionar →
// importar → iniciar prospecção (wizard de campanha). A busca parte do perfil
// da organização (Configurações › Perfil de busca). Visual alinhado ao Dashboard.

// Qualidade do e-mail como texto colorido discreto (sem caixa), para não
// competir com o próprio e-mail na linha.
const COR_QUALIDADE: Record<QualidadeEmail, string> = {
  corporativo: 'text-emerald-400',
  generico: 'text-sky-400',
  pessoal: 'text-amber-400',
  contabilidade: 'text-red-400',
  digitacao: 'text-red-400',
  sem_email: 'text-slate-500',
};
const PONTO_QUALIDADE: Record<QualidadeEmail, string> = {
  corporativo: 'bg-emerald-400',
  generico: 'bg-sky-400',
  pessoal: 'bg-amber-400',
  contabilidade: 'bg-red-400',
  digitacao: 'bg-red-400',
  sem_email: 'bg-slate-600',
};

// Paleta discreta para o avatar, estável por CNPJ.
const CORES_AVATAR = [
  'bg-indigo-500/15 text-indigo-300',
  'bg-sky-500/15 text-sky-300',
  'bg-emerald-500/15 text-emerald-300',
  'bg-amber-500/15 text-amber-300',
  'bg-rose-500/15 text-rose-300',
  'bg-violet-500/15 text-violet-300',
];
function corAvatar(cnpj: string): string {
  let h = 0;
  for (const ch of cnpj) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CORES_AVATAR[h % CORES_AVATAR.length];
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
function mesRfLegivel(mes: string): string {
  const [ano, m] = mes.split('-');
  return `${MESES[Number(m) - 1] ?? m}/${ano}`;
}

/** 'Hotéis · 5510-8/01', ou só o código quando a atividade não tem nome. */
function rotuloAtividade(codigo: string): string {
  const nome = nomeAtividade(codigo);
  return nome ? `${nome} · ${formatarCnae(codigo)}` : formatarCnae(codigo);
}

interface RespostaApi {
  itens: ResultadoCatalogo[];
  proximoCursor: string | null;
  total: number | null;
  catalogo: StatusCatalogo | null;
  filtros: FiltrosBusca;
  perfil: FiltrosBusca;
  temPerfil: boolean;
}

// Rótulo em cima, campo embaixo: cada filtro lê como um item de formulário.
function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <label className={s.fieldLabel}>
      <span>{rotulo}</span>
      {children}
    </label>
  );
}

// <select> nativo com a aparência dos demais campos.
function Selecao({
  valor, onChange, children, rotuloAcessivel,
}: { valor: string; onChange: (v: string) => void; children: React.ReactNode; rotuloAcessivel: string }) {
  return (
    <div className="relative">
      <select
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        aria-label={rotuloAcessivel}
        className={`${s.field} appearance-none pl-3 pr-9 cursor-pointer focus-ring`}
      >
        {children}
      </select>
      <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
    </div>
  );
}

function Alternar({ ativo, onChange, children }: { ativo: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ativo}
      onClick={() => onChange(!ativo)}
      className={`flex items-center gap-2.5 text-sm focus-ring rounded-md ${ativo ? 'text-slate-100' : 'text-slate-400 hover:text-slate-200'}`}
    >
      <span className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${ativo ? 'bg-[var(--accent)] shadow-[0_0_10px_rgba(99,102,241,0.5)]' : 'bg-slate-700'}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${ativo ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </span>
      {children}
    </button>
  );
}

const TOM_KPI = { cyan: s.kpiCyan, violet: s.kpiViolet, emerald: s.kpiEmerald, amber: s.kpiAmber };

// Indicador no padrão do Dashboard. `proporcao` (0–1) desenha a barra; sem ela,
// o card fica só com o número — nada de barra decorativa sem dado por trás.
function Indicador({ icone: Icone, rotulo, valor, detalhe, tom, proporcao }: {
  icone: typeof Building2; rotulo: string; valor: string; detalhe: string;
  tom: keyof typeof TOM_KPI; proporcao?: number | null;
}) {
  return (
    <article className={`${s.kpiCard} ${TOM_KPI[tom]}`}>
      <div className={s.kpiTop}>
        <span className={s.kpiIcon}><Icone size={19} strokeWidth={1.8} aria-hidden="true" /></span>
        <div className={s.kpiIdentity}>
          <span className={s.kpiLabel}>{rotulo}</span>
          <strong>{valor}</strong>
        </div>
      </div>
      {proporcao != null && (
        <div className={s.kpiMeter} aria-hidden="true">
          <span style={{ width: `${Math.round(Math.min(1, Math.max(0, proporcao)) * 100)}%` }} />
        </div>
      )}
      <span className={s.kpiSubtitle}>{detalhe}</span>
    </article>
  );
}

function CabecalhoBloco({ icone: Icone, titulo, subtitulo }: { icone: typeof Building2; titulo: string; subtitulo: string }) {
  return (
    <div className={s.sectionHeading}>
      <span className={s.sectionIcon}><Icone size={17} aria-hidden="true" /></span>
      <div><h2>{titulo}</h2><p>{subtitulo}</p></div>
    </div>
  );
}

function LinhasEsqueleto() {
  return (
    <>
      {Array.from({ length: 6 }, (_, i) => (
        <tr key={i} className="skeleton-pulse">
          <td className="px-5 py-3.5"><div className="h-4 w-4 rounded bg-slate-700/60" /></td>
          <td className="px-3 py-3.5">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-lg bg-slate-700/60" />
              <div className="space-y-2"><div className="h-3 w-48 rounded bg-slate-700/60" /><div className="h-2.5 w-28 rounded bg-slate-700/40" /></div>
            </div>
          </td>
          <td className="px-4 py-3.5"><div className="h-3 w-28 rounded bg-slate-700/50" /></td>
          <td className="px-4 py-3.5"><div className="h-3 w-20 rounded bg-slate-700/50" /></td>
          <td className="px-4 py-3.5"><div className="h-3 w-44 rounded bg-slate-700/50" /></td>
          <td className="px-5 py-3.5" />
        </tr>
      ))}
    </>
  );
}

export default function ProspeccaoPage() {
  const [filtros, setFiltros] = useState<FiltrosBusca | null>(null);
  const [perfil, setPerfil] = useState<FiltrosBusca | null>(null);
  const [temPerfil, setTemPerfil] = useState<boolean | null>(null);
  const [catalogo, setCatalogo] = useState<StatusCatalogo | null>(null);
  const [itens, setItens] = useState<ResultadoCatalogo[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const [selecionados, setSelecionados] = useState<Map<string, ResultadoCatalogo>>(() => new Map());
  const [decisores, setDecisores] = useState<Record<string, Decisor | null>>({});
  const [confirmandoDescarte, setConfirmandoDescarte] = useState(false);
  const [importando, setImportando] = useState(false);
  const [texto, setTexto] = useState('');
  // '' = todos os nichos do perfil.
  const [nicho, setNicho] = useState('');
  const [editandoPerfil, setEditandoPerfil] = useState(false);
  // Quantidade desejada: a lista para nela (null = sem limite). O texto do
  // campo aplica com debounce; valor fora de 1–500 não vale.
  const [quantidade, setQuantidade] = useState<number | null>(null);
  const [quantidadeTexto, setQuantidadeTexto] = useState('');
  const [pesquisas, setPesquisas] = useState<PesquisaSalva[]>([]);
  const [podeEditarPesquisas, setPodeEditarPesquisas] = useState(false);
  const [pesquisaAtiva, setPesquisaAtiva] = useState<string | null>(null);
  const [salvandoPesquisa, setSalvandoPesquisa] = useState(false);
  // Só a resposta da busca mais recente pode escrever no estado.
  const buscaAtual = useRef(0);

  const buscar = useCallback(async (f: FiltrosBusca | null, apos: string | null, limite?: number) => {
    const id = ++buscaAtual.current;
    setCarregando(true);
    setErro(null);
    try {
      const res = await fetch('/api/prospeccao/busca', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filtros: f ?? undefined, cursor: apos, limite }),
      });
      const corpo = (await res.json().catch(() => ({}))) as Partial<RespostaApi> & { erro?: string };
      if (id !== buscaAtual.current) return;
      if (!res.ok) throw new Error(corpo.erro || 'Falha na busca');
      setCatalogo(corpo.catalogo ?? null);
      setTemPerfil(!!corpo.temPerfil);
      setPerfil(corpo.perfil ?? null);
      if (!f) setFiltros(corpo.filtros ?? null);
      setItens((atual) => (apos ? [...atual, ...(corpo.itens ?? [])] : corpo.itens ?? []));
      setCursor(corpo.proximoCursor ?? null);
      if (!apos) setTotal(corpo.total ?? null);
    } catch (e) {
      if (id === buscaAtual.current) setErro(e instanceof Error ? e.message : 'Erro na busca');
    } finally {
      if (id === buscaAtual.current) setCarregando(false);
    }
  }, []);

  // 1ª carga: sem filtros → o servidor aplica o perfil e devolve os filtros efetivos.
  useEffect(() => { buscar(null, null); }, [buscar]);

  useEffect(() => {
    fetch('/api/prospeccao/pesquisas')
      .then((res) => (res.ok ? res.json() : null))
      .then((corpo) => {
        if (!corpo) return;
        setPesquisas(corpo.pesquisas ?? []);
        setPodeEditarPesquisas(!!corpo.podeEditar);
      })
      .catch(() => { /* sem atalhos: a busca segue funcionando */ });
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      const bruto = quantidadeTexto.trim();
      const n = bruto === '' ? null : quantidadeValida(Number(bruto));
      if (bruto !== '' && n === null) return; // inválido: não aplica
      if (n !== quantidade) { setQuantidade(n); setPesquisaAtiva(null); }
    }, 400);
    return () => clearTimeout(t);
  }, [quantidadeTexto, quantidade]);

  // Texto com debounce; demais filtros disparam na hora.
  useEffect(() => {
    if (!filtros) return;
    const t = setTimeout(() => {
      if (texto !== filtros.texto) setFiltros((f) => (f ? { ...f, texto } : f));
    }, 300);
    return () => clearTimeout(t);
  }, [texto, filtros]);

  const primeiraExecucao = useRef(true);
  useEffect(() => {
    if (!filtros) return;
    if (primeiraExecucao.current) { primeiraExecucao.current = false; return; }
    setAberto(null);
    buscar(filtros, null, quantidade ? Math.min(quantidade, LIMITE_PAGINA) : undefined);
  }, [filtros, quantidade, buscar]);

  // Perfil salvo no painel: recomeça do perfil novo (o servidor devolve os
  // filtros efetivos, e o efeito de filtros não dispara uma 2ª busca).
  function aoSalvarPerfil() {
    setEditandoPerfil(false);
    setNicho('');
    setTexto('');
    primeiraExecucao.current = true;
    buscar(null, null);
  }

  function atualizar(patch: Partial<FiltrosBusca>) {
    setPesquisaAtiva(null);
    setFiltros((f) => (f ? { ...f, ...patch } : f));
  }

  function definirQuantidade(n: number | null) {
    setQuantidade(n);
    setQuantidadeTexto(n ? String(n) : '');
  }

  // Aplica uma pesquisa salva por inteiro (filtros + quantidade).
  function aplicarPesquisa(p: PesquisaSalva) {
    const f = p.filtros;
    const cnaes = f.cnaes ?? [];
    const grupo = grupos.find((g) => g.cnaes.length === cnaes.length && g.cnaes.every((c) => cnaes.includes(c)));
    setNicho(grupo?.id ?? '');
    setTexto('');
    definirQuantidade(p.quantidade);
    setFiltros({
      cnaes,
      ufs: f.ufs ?? [],
      municipios: f.municipios ?? [],
      portes: f.portes ?? [],
      excluirMei: !!f.excluirMei,
      incluirCnaesSecundarios: !!f.incluirCnaesSecundarios,
      soComEmail: !!f.soComEmail,
      texto: '',
    });
    setPesquisaAtiva(p.id);
  }

  const filtrosParaSalvar = filtros && {
    cnaes: filtros.cnaes,
    ufs: filtros.ufs,
    municipios: filtros.municipios,
    portes: filtros.portes,
    excluirMei: filtros.excluirMei,
    incluirCnaesSecundarios: filtros.incluirCnaesSecundarios,
    soComEmail: filtros.soComEmail,
  };

  // Chamada às rotas de pesquisas salvas; devolve a mensagem de erro, se houver.
  async function chamarPesquisas(url: string, metodo: string, corpo?: unknown): Promise<{ erro: string | null; lista: PesquisaSalva[] }> {
    try {
      const res = await fetch(url, {
        method: metodo,
        headers: corpo ? { 'Content-Type': 'application/json' } : undefined,
        body: corpo ? JSON.stringify(corpo) : undefined,
      });
      const r = await res.json().catch(() => ({}));
      if (!res.ok) return { erro: r?.erro || 'Não foi possível concluir.', lista: pesquisas };
      const lista: PesquisaSalva[] = r.pesquisas ?? [];
      setPesquisas(lista);
      return { erro: null, lista };
    } catch {
      return { erro: 'Sem conexão. Tente de novo.', lista: pesquisas };
    }
  }

  async function salvarPesquisa(nome: string): Promise<string | null> {
    const antes = new Set(pesquisas.map((p) => p.id));
    const r = await chamarPesquisas('/api/prospeccao/pesquisas', 'POST', { nome, filtros: filtrosParaSalvar, quantidade });
    // A pesquisa recém-salva é a que está aplicada.
    if (!r.erro) setPesquisaAtiva(r.lista.find((p) => !antes.has(p.id))?.id ?? null);
    return r.erro;
  }

  const grupos = useMemo(() => gruposDoPerfil(perfil?.cnaes ?? []), [perfil]);
  const grupoAtivo = grupos.find((g) => g.id === nicho) ?? null;
  // Atividades oferecidas no seletor: as do nicho escolhido, ou todas do perfil.
  const atividadesBase = grupoAtivo?.cnaes ?? perfil?.cnaes ?? [];

  function escolherNicho(id: string) {
    if (!perfil) return;
    setNicho(id);
    const grupo = grupos.find((g) => g.id === id);
    atualizar({ cnaes: grupo ? [...grupo.cnaes] : [...perfil.cnaes] });
  }

  function alternarSelecao(item: ResultadoCatalogo) {
    if (item.ja_na_base) return;
    setConfirmandoDescarte(false);
    setSelecionados((m) => {
      const n = new Map(m);
      if (n.has(item.cnpj)) n.delete(item.cnpj); else n.set(item.cnpj, item);
      return n;
    });
  }

  const selecionaveis = useMemo(() => itens.filter((i) => !i.ja_na_base), [itens]);
  const todosSelecionados = selecionaveis.length > 0 && selecionaveis.every((i) => selecionados.has(i.cnpj));
  const comEmail = useMemo(() => itens.filter((i) => !!i.email).length, [itens]);

  function alternarTodos() {
    setConfirmandoDescarte(false);
    setSelecionados((m) => {
      const n = new Map(m);
      if (todosSelecionados) selecionaveis.forEach((i) => n.delete(i.cnpj));
      else selecionaveis.forEach((i) => n.set(i.cnpj, i));
      return n;
    });
  }

  async function descartar() {
    const cnpjs = [...selecionados.keys()];
    setConfirmandoDescarte(false);
    try {
      const res = await fetch('/api/prospeccao/descartar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cnpjs }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.erro || 'Falha ao descartar');
      setItens((atual) => atual.filter((i) => !selecionados.has(i.cnpj)));
      setTotal((t) => (t === null ? t : Math.max(0, t - cnpjs.length)));
      setSelecionados(new Map());
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao descartar');
    }
  }

  function aoImportar(cnpjs: string[]) {
    const importados = new Set(cnpjs);
    setItens((atual) => atual.map((i) => (importados.has(i.cnpj) ? { ...i, ja_na_base: true } : i)));
    setSelecionados((m) => {
      const n = new Map(m);
      cnpjs.forEach((c) => n.delete(c));
      return n;
    });
  }

  const itensImportacao = [...selecionados.values()].map((i) => ({
    cnpj: i.cnpj,
    nome: i.nome_fantasia ?? i.razao_social ?? i.cnpj,
    email: i.email,
    contato_nome: decisores[i.cnpj]?.nome?.trim() || null,
    contato_cargo: decisores[i.cnpj]?.cargo?.trim() || null,
  }));

  // Quantos filtros diferem do perfil — orienta o "Voltar ao perfil".
  const ajustesAtivos = useMemo(() => {
    if (!filtros || !perfil) return 0;
    const igual = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
    return [
      !igual(filtros.cnaes, perfil.cnaes),
      !igual(filtros.ufs, perfil.ufs),
      !igual(filtros.municipios, perfil.municipios),
      !igual(filtros.portes, perfil.portes),
      filtros.soComEmail !== perfil.soComEmail,
      filtros.excluirMei !== perfil.excluirMei,
      filtros.incluirCnaesSecundarios !== perfil.incluirCnaesSecundarios,
      !!texto,
      quantidade !== null,
    ].filter(Boolean).length;
  }, [filtros, perfil, texto, quantidade]);

  const semPerfil = temPerfil === false;

  // Atividade e Porte são selects: "todas" ou um valor específico.
  const valorAtividade = filtros && filtros.cnaes.length === 1 && atividadesBase.length > 1 ? filtros.cnaes[0] : '';
  const valorPorte = filtros
    ? (filtros.portes.length === 0 ? '' : filtros.portes.length === 1 ? filtros.portes[0] : '__varios__')
    : '';
  const carregados = itens.length;
  // Há mais para carregar: o servidor tem próxima página E a quantidade não foi atingida.
  const temMais = !!cursor && (quantidade === null || carregados < quantidade);

  return (
    <div className="h-screen overflow-y-auto">
      <div className={s.page}>
        {/* Cabeçalho */}
        <header className={s.pageHeader}>
          <nav className={s.breadcrumb} aria-label="Navegação estrutural">
            <span>Execução</span><ChevronRight size={13} aria-hidden="true" /><strong>Prospecção</strong>
          </nav>
          <div className={s.titleRow}>
            <div>
              <h1>Prospecção</h1>
              <p>Encontre empresas novas na Receita Federal e traga para a base as que fazem sentido.</p>
            </div>
            <div className={s.headerActions}>
              {catalogo ? (
                <span
                  className={s.catalogBadge}
                  title={catalogo.concluidaEm ? `Carga concluída em ${new Date(catalogo.concluidaEm).toLocaleString('pt-BR')}` : undefined}
                >
                  <Database size={13} /> Dados da Receita de {mesRfLegivel(catalogo.mesRf)}
                </span>
              ) : temPerfil !== null && (
                <span className="chip chip-warning"><Database size={11} /> Catálogo sem carga concluída</span>
              )}
              <button type="button" onClick={() => setEditandoPerfil(true)} className={`${s.outlineButton} focus-ring`}>
                <Settings size={15} /> Perfil de busca
              </button>
            </div>
          </div>

          {/* Nichos do perfil */}
          {!semPerfil && perfil && grupos.length > 0 && (
            <div className={s.nichoRow}>
              <div className={s.nichoTabs} role="group" aria-label="Nicho">
                <button type="button" onClick={() => escolherNicho('')} aria-pressed={nicho === ''} className={`${nicho === '' ? s.nichoAtivo : ''} focus-ring`}>
                  <LayoutGrid size={15} aria-hidden="true" /> Todos os nichos
                </button>
                {grupos.map((g) => {
                  const Icone = iconeDoNicho(g.id);
                  return (
                    <button key={g.id} type="button" onClick={() => escolherNicho(g.id)} aria-pressed={nicho === g.id} className={`${nicho === g.id ? s.nichoAtivo : ''} focus-ring`}>
                      <Icone size={15} aria-hidden="true" /> {g.nome}
                    </button>
                  );
                })}
              </div>
              <button type="button" onClick={() => setEditandoPerfil(true)} className={`${s.addNicho} focus-ring rounded`}>
                <Plus size={13} /> Adicionar nicho
              </button>
            </div>
          )}

          {!semPerfil && (
            <PesquisasSalvas
              pesquisas={pesquisas}
              ativa={pesquisaAtiva}
              podeEditar={podeEditarPesquisas}
              onAplicar={aplicarPesquisa}
              onRenomear={async (id, nome) => (await chamarPesquisas(`/api/prospeccao/pesquisas/${encodeURIComponent(id)}`, 'PATCH', { nome })).erro}
              onExcluir={async (id) => {
                const r = await chamarPesquisas(`/api/prospeccao/pesquisas/${encodeURIComponent(id)}`, 'DELETE');
                if (!r.erro && pesquisaAtiva === id) setPesquisaAtiva(null);
                return r.erro;
              }}
            />
          )}
        </header>

        <div className={s.content}>
          {semPerfil ? (
            <section className={`${s.panel} ${s.emptyHero}`}>
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-500/15 text-sky-300 shadow-[0_0_24px_rgba(14,165,233,0.25)]">
                <SlidersHorizontal size={24} />
              </div>
              <h2 className="mt-5 text-lg font-semibold text-slate-100">Defina o perfil de busca</h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">
                Escolha os nichos, estados e porte das empresas que você quer prospectar. A busca começa por ele.
              </p>
              <button type="button" onClick={() => setEditandoPerfil(true)} className={`${s.primaryButton} mt-6 focus-ring`}>
                <Settings size={15} /> Configurar perfil de busca
              </button>
            </section>
          ) : (
            <>
              {/* Filtros */}
              {filtros && perfil && (
                <section className={`${s.panel} ${s.panelBody}`}>
                  <div className={s.panelHeader}>
                    <CabecalhoBloco icone={Filter} titulo="Filtros" subtitulo="Partem do perfil de busca; ajuste à vontade nesta pesquisa." />
                    <div className="flex items-center gap-4">
                    {podeEditarPesquisas && !salvandoPesquisa && (
                      <button
                        type="button"
                        onClick={() => setSalvandoPesquisa(true)}
                        disabled={pesquisas.length >= PESQUISAS_LIMITES.total || filtros.cnaes.length === 0}
                        title={pesquisas.length >= PESQUISAS_LIMITES.total ? `Limite de ${PESQUISAS_LIMITES.total} pesquisas salvas` : 'Guardar estes filtros como atalho'}
                        className={`${s.linkAction} disabled:opacity-50 focus-ring rounded`}
                      >
                        <Bookmark size={12} /> Salvar pesquisa
                      </button>
                    )}
                    {ajustesAtivos > 0 && (
                      <button
                        type="button"
                        onClick={() => { setTexto(''); setNicho(''); definirQuantidade(null); setPesquisaAtiva(null); setFiltros({ ...perfil }); }}
                        className={`${s.linkAction} focus-ring rounded`}
                      >
                        <RotateCcw size={12} /> Voltar ao perfil
                      </button>
                    )}
                    </div>
                  </div>

                  {salvandoPesquisa && filtrosParaSalvar && (
                    <div className="mt-3">
                      <SalvarPesquisa
                        sugestao={nomeSugerido(filtrosParaSalvar, quantidade)}
                        onSalvar={salvarPesquisa}
                        onFechar={() => setSalvandoPesquisa(false)}
                      />
                    </div>
                  )}

                  <div className={s.filterGrid}>
                    <Campo rotulo="Buscar">
                      <div className="relative">
                        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-sky-300" />
                        <input
                          value={texto}
                          onChange={(e) => setTexto(e.target.value)}
                          placeholder="Nome da empresa ou CNPJ"
                          className={`${s.field} pl-9 pr-9 focus-ring`}
                        />
                        {texto && (
                          <button type="button" onClick={() => setTexto('')} aria-label="Limpar busca" className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-100">
                            <X size={14} />
                          </button>
                        )}
                      </div>
                    </Campo>

                    <Campo rotulo="Atividade">
                      <Selecao
                        rotuloAcessivel="Atividade"
                        valor={valorAtividade}
                        onChange={(v) => atualizar({ cnaes: v === '' ? [...atividadesBase] : [v] })}
                      >
                        <option value="">
                          {grupoAtivo ? `Todas de ${grupoAtivo.nome} (${atividadesBase.length})` : `Todas do perfil (${atividadesBase.length})`}
                        </option>
                        {atividadesBase.map((c) => <option key={c} value={c}>{rotuloAtividade(c)}</option>)}
                      </Selecao>
                    </Campo>

                    <Campo rotulo="Estado">
                      <SeletorEstados selecionadas={filtros.ufs} onChange={(ufs) => atualizar({ ufs })} />
                    </Campo>

                    <Campo rotulo="Município">
                      <SeletorMunicipios selecionados={filtros.municipios} ufs={filtros.ufs} onChange={(municipios) => atualizar({ municipios })} />
                    </Campo>

                    <Campo rotulo="Porte">
                      <Selecao
                        rotuloAcessivel="Porte"
                        valor={valorPorte}
                        onChange={(v) => atualizar({ portes: v === '' ? [] : [v as PorteProspeccao] })}
                      >
                        <option value="">Todos os portes</option>
                        {valorPorte === '__varios__' && <option value="__varios__" disabled>{filtros.portes.length} portes (perfil)</option>}
                        {PORTES_PROSPECCAO.map((p) => <option key={p} value={p}>{ROTULO_PORTE[p]}</option>)}
                      </Selecao>
                    </Campo>

                    <Campo rotulo="Quantidade">
                      <input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={PESQUISAS_LIMITES.quantidadeMax}
                        value={quantidadeTexto}
                        onChange={(e) => setQuantidadeTexto(e.target.value)}
                        placeholder="Sem limite"
                        className={`${s.field} px-3 focus-ring`}
                      />
                    </Campo>
                  </div>
                  {quantidadeTexto.trim() !== '' && quantidadeValida(Number(quantidadeTexto)) === null && (
                    <p className="mt-2 text-xs text-amber-300">
                      Quantidade entre 1 e {PESQUISAS_LIMITES.quantidadeMax}.
                    </p>
                  )}

                  <div className={s.toggleRow}>
                    <Alternar ativo={filtros.soComEmail} onChange={(v) => atualizar({ soComEmail: v })}>Só com e-mail</Alternar>
                    <Alternar ativo={filtros.excluirMei} onChange={(v) => atualizar({ excluirMei: v })}>Excluir MEI</Alternar>
                    <Alternar ativo={filtros.incluirCnaesSecundarios} onChange={(v) => atualizar({ incluirCnaesSecundarios: v })}>Incluir atividade secundária</Alternar>
                  </div>
                </section>
              )}

              {/* Resumo */}
              <section className={s.kpiGrid}>
                <Indicador
                  tom="cyan"
                  icone={Building2}
                  rotulo="Empresas encontradas"
                  valor={total === null ? '—' : total.toLocaleString('pt-BR')}
                  detalhe={carregando && carregados === 0 ? 'Buscando…' : 'no catálogo, com os filtros atuais'}
                />
                <Indicador
                  tom="violet"
                  icone={ListChecks}
                  rotulo="Na lista"
                  valor={carregados.toLocaleString('pt-BR')}
                  proporcao={quantidade ? carregados / Math.max(1, Math.min(quantidade, total ?? quantidade)) : total ? carregados / total : null}
                  detalhe={
                    quantidade && total !== null && total > quantidade
                      ? `de ${quantidade.toLocaleString('pt-BR')} desejadas${temMais ? ' — use “Carregar mais”' : ''}`
                      : temMais ? 'use “Carregar mais” no fim da lista' : 'todas as encontradas estão na lista'
                  }
                />
                <Indicador
                  tom="emerald"
                  icone={Mail}
                  rotulo="Com e-mail na lista"
                  valor={comEmail.toLocaleString('pt-BR')}
                  proporcao={carregados ? comEmail / carregados : null}
                  detalhe={carregados ? `${Math.round((comEmail / carregados) * 100)}% da lista tem e-mail da Receita` : 'nenhuma empresa na lista'}
                />
                <Indicador
                  tom="amber"
                  icone={Check}
                  rotulo="Selecionadas"
                  valor={selecionados.size.toLocaleString('pt-BR')}
                  proporcao={selecionaveis.length ? Math.min(1, selecionados.size / selecionaveis.length) : null}
                  detalhe={selecionados.size ? 'prontas para importar' : 'marque as empresas que interessam'}
                />
              </section>

              {erro && (
                <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{erro}</p>
              )}

              {/* Resultados */}
              <section className={`${s.panel} overflow-hidden`}>
                <div className={`${s.panelHeader} ${s.panelHeaderBar}`}>
                  <CabecalhoBloco
                    icone={Radar}
                    titulo="Resultados"
                    subtitulo={grupoAtivo ? `Empresas de ${grupoAtivo.nome} no catálogo da Receita.` : 'Empresas do catálogo da Receita para o seu perfil.'}
                  />
                  <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                    <CaixaSelecao marcado={todosSelecionados} onChange={alternarTodos} />
                    Selecionar todas da lista
                  </label>
                </div>
                <table className={s.table}>
                  <thead>
                    <tr>
                      <th className="w-14"><span className="sr-only">Selecionar</span></th>
                      <th className="w-[34%]">Empresa</th>
                      <th className="w-[18%]">Cidade</th>
                      <th className="w-[14%]">Porte</th>
                      <th>E-mail</th>
                      <th className="w-36"><span className="sr-only">Situação</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {carregando && carregados === 0 ? (
                      <LinhasEsqueleto />
                    ) : carregados === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-24 text-center">
                          <Building2 size={30} className="mx-auto text-slate-600" />
                          <p className="mt-4 text-sm font-medium text-slate-300">Nenhuma empresa com esses filtros</p>
                          <p className="mt-1 text-sm text-slate-500">Tente ampliar os estados, o porte ou o nicho.</p>
                        </td>
                      </tr>
                    ) : (
                      itens.map((i) => {
                        const expandido = aberto === i.cnpj;
                        const selecionado = selecionados.has(i.cnpj);
                        const decisor = decisores[i.cnpj];
                        const nome = nomeLegivel(i.nome_fantasia ?? i.razao_social) || formatarCnpj(i.cnpj);
                        const atividade = nomeAtividade(i.cnae_principal);
                        return (
                          <Fragment key={i.cnpj}>
                            <tr
                              onClick={() => setAberto(expandido ? null : i.cnpj)}
                              className={`group cursor-pointer ${selecionado ? s.rowSelected : expandido ? s.rowOpen : ''}`}
                            >
                              <td className={`w-14 px-5 py-2.5 ${selecionado ? 'shadow-[inset_3px_0_0_var(--accent)]' : ''}`} onClick={(e) => e.stopPropagation()}>
                                <CaixaSelecao
                                  desabilitado={i.ja_na_base}
                                  marcado={selecionado}
                                  onChange={() => alternarSelecao(i)}
                                  rotulo={i.ja_na_base ? `${nome} já está na base` : `Selecionar ${nome}`}
                                />
                              </td>
                              <td className="px-3 py-2.5">
                                <div className="flex items-center gap-3 min-w-0">
                                  <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold ${corAvatar(i.cnpj)}`}>
                                    {iniciais(nome)}
                                  </div>
                                  <div className="min-w-0">
                                    <div className="flex min-w-0 items-center gap-1.5">
                                      <span className="min-w-0 font-medium text-slate-100 truncate">{nome}</span>
                                      <ChevronRight size={14} className={`shrink-0 text-slate-600 transition-transform group-hover:text-slate-400 ${expandido ? 'rotate-90 text-slate-300' : ''}`} />
                                    </div>
                                    <div className="mt-1 flex min-w-0 items-center gap-2">
                                      <span className="shrink-0 font-mono text-xs text-slate-500">{formatarCnpj(i.cnpj)}</span>
                                      <span className={s.activityTag} title={formatarCnae(i.cnae_principal)}>{atividade ?? formatarCnae(i.cnae_principal)}</span>
                                    </div>
                                    {decisor?.nome && (
                                      <div className="mt-1 flex items-center gap-1 text-xs text-indigo-300"><Check size={11} /> {decisor.nome}</div>
                                    )}
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-2.5">
                                <div className="truncate text-slate-200">{nomeLegivel(i.municipio) || '—'}</div>
                                <div className="mt-0.5 text-xs text-slate-500">{i.uf ?? ''}</div>
                              </td>
                              <td className="px-4 py-2.5 whitespace-nowrap text-slate-300">
                                {rotuloPorte(i.porte)}
                                {i.mei && <span className="chip chip-warning ml-2">MEI</span>}
                              </td>
                              <td className="px-4 py-2.5">
                                {i.email ? (
                                  <>
                                    <div className="flex items-center gap-2 min-w-0">
                                      <Mail size={13} className="shrink-0 text-slate-500" />
                                      <span className="min-w-0 truncate text-slate-200" title={i.email}>{i.email}</span>
                                    </div>
                                    <div className={`mt-1 flex items-center gap-1.5 pl-5 text-xs ${COR_QUALIDADE[i.qualidade_email]}`}>
                                      <span className={`h-1.5 w-1.5 rounded-full ${PONTO_QUALIDADE[i.qualidade_email]}`} />
                                      {ROTULO_QUALIDADE[i.qualidade_email]}
                                    </div>
                                  </>
                                ) : (
                                  <span className="text-sm text-slate-500">Sem e-mail</span>
                                )}
                              </td>
                              <td className="w-36 px-5 py-2.5 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                                {i.ja_na_base && (
                                  i.lead_id
                                    ? <Link href={`/leads/${i.lead_id}`} className="chip chip-success hover:brightness-125"><Check size={11} /> Já na base</Link>
                                    : <span className="chip chip-success"><Check size={11} /> Já na base</span>
                                )}
                              </td>
                            </tr>
                            {expandido && (
                              <tr>
                                <td colSpan={6} className="p-0">
                                  <DetalheEmpresa empresa={i} decisor={decisor ?? null} onDecisor={(d) => setDecisores((m) => ({ ...m, [i.cnpj]: d }))} />
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })
                    )}
                  </tbody>
                </table>
                {temMais && (
                  <div className={s.loadMore}>
                    <button
                      type="button"
                      onClick={() => buscar(filtros, cursor, quantidade ? quantidade - carregados : undefined)}
                      disabled={carregando}
                      className={`${s.outlineButton} focus-ring`}
                    >
                      {carregando ? 'Carregando…' : 'Carregar mais empresas'}
                    </button>
                  </div>
                )}
              </section>

              {/* Espaço para a barra flutuante não cobrir o fim da lista. */}
              {selecionados.size > 0 && <div className="h-16" />}
            </>
          )}
        </div>
      </div>

      {/* Barra de ações da seleção — left-60 = largura do menu lateral. */}
      {selecionados.size > 0 && (
        <div className="pointer-events-none fixed left-60 right-0 bottom-6 z-40 flex justify-center">
          <div className={`${s.selectionBar} pointer-events-auto animate-in`}>
            <span className="text-sm text-slate-200">
              <span className="font-semibold tabular-nums">{selecionados.size}</span> selecionada{selecionados.size === 1 ? '' : 's'}
            </span>
            <button type="button" onClick={() => { setSelecionados(new Map()); setConfirmandoDescarte(false); }} className="text-sm text-slate-400 hover:text-slate-200 focus-ring rounded">
              Limpar
            </button>
            <div className="h-6 w-px bg-[#17496e]" />
            {confirmandoDescarte ? (
              <button type="button" onClick={descartar} className="flex h-10 items-center gap-2 rounded-lg bg-red-500/15 px-4 text-sm font-medium text-red-300 ring-1 ring-inset ring-red-500/40 hover:bg-red-500/25 focus-ring">
                <Trash2 size={15} /> Confirmar descarte
              </button>
            ) : (
              <button type="button" onClick={() => setConfirmandoDescarte(true)} className="flex h-10 items-center gap-2 rounded-lg px-4 text-sm text-slate-300 hover:bg-white/5 focus-ring" title="Some da busca desta organização">
                <Trash2 size={15} /> Descartar
              </button>
            )}
            <button type="button" onClick={() => setImportando(true)} className={`${s.primaryButton} focus-ring`}>
              <Download size={15} /> Importar {selecionados.size}
            </button>
          </div>
        </div>
      )}

      {editandoPerfil && (
        <PerfilBuscaPainel
          catalogoCnaes={catalogo?.cnaes ?? null}
          onFechar={() => setEditandoPerfil(false)}
          onSalvo={aoSalvarPerfil}
        />
      )}

      {importando && (
        <ImportarProspeccaoModal itens={itensImportacao} onFechar={() => setImportando(false)} onImportado={aoImportar} />
      )}
    </div>
  );
}
