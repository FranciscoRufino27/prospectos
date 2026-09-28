'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Ban, Bookmark, Building2, Check, ChevronDown, ChevronRight, Database, Download, Filter, LayoutGrid, Mail,
  Radar, RotateCcw, Search, SlidersHorizontal, Target, Trash2, UserRound, X,
} from 'lucide-react';
import { filtrosDoPerfil, LIMITE_PAGINA, type FiltrosBusca } from '@/lib/prospeccao/filtros';
import type { ResultadoCatalogo, StatusCatalogo } from '@/lib/prospeccao/buscaServidor';
import { ROTULO_QUALIDADE, type QualidadeEmail } from '@/lib/prospeccao/qualidadeEmail';
import { formatarCnae, iniciais, nomeLegivel, rotuloPorte, ROTULO_PORTE } from '@/lib/prospeccao/rotulos';
import { gruposDoPerfil, nichoDaAtividade, nomeAtividade } from '@/lib/prospeccao/nichos';
import { nomeSugerido } from '@/lib/prospeccao/pesquisas';
import { formatarCnpj } from '@/lib/empresas/cnpj';
import {
  PESQUISAS_LIMITES, PORTES_PROSPECCAO, quantidadeValida,
  type PesquisaSalva, type PorteProspeccao, type ProspeccaoConfig,
} from '@/lib/config/workspaceConfig';
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
  totalComEmail: number | null;
  catalogo: StatusCatalogo | null;
  filtros: FiltrosBusca;
  perfil: FiltrosBusca;
  temPerfil: boolean;
}

const ROTULO_STATUS_EMAIL = { todos: 'Todos', com_email: 'Com e-mail', sem_email: 'Sem e-mail' } as const;
type StatusEmailResultado = keyof typeof ROTULO_STATUS_EMAIL;

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
  const [totalComEmail, setTotalComEmail] = useState<number | null>(null);
  // Quantas empresas o usuário descartou manualmente nesta sessão de busca
  // (duplicada, fora do perfil etc.) — some ao reabrir a busca do zero.
  const [descartadosSessao, setDescartadosSessao] = useState(0);
  // Filtros do resultado: analisam o que já foi carregado, sem re-consultar o
  // servidor (diferente dos filtros acima, que ajustam o perfil da busca).
  const [filtroResultadoTexto, setFiltroResultadoTexto] = useState('');
  const [filtroResultadoEmail, setFiltroResultadoEmail] = useState<StatusEmailResultado>('todos');
  const [filtroResultadoNicho, setFiltroResultadoNicho] = useState('');
  const [filtroResultadoPorte, setFiltroResultadoPorte] = useState('');
  const [filtroResultadoUf, setFiltroResultadoUf] = useState('');
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
      if (!apos) {
        setTotal(corpo.total ?? null);
        setTotalComEmail(corpo.totalComEmail ?? null);
        setDescartadosSessao(0);
        setFiltroResultadoTexto('');
        setFiltroResultadoEmail('todos');
        setFiltroResultadoNicho('');
        setFiltroResultadoPorte('');
        setFiltroResultadoUf('');
      }
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

  // Perfil salvo no painel: recomeça pelo novo perfil sem perder os ajustes
  // da busca atual que ainda não fazem parte da configuração persistida.
  function aoSalvarPerfil(novoPerfil: ProspeccaoConfig | null) {
    setNicho('');
    setTexto('');
    primeiraExecucao.current = true;
    if (!novoPerfil) {
      buscar(null, null, quantidade ? Math.min(quantidade, LIMITE_PAGINA) : undefined);
      return;
    }
    const novosFiltros = {
      ...filtrosDoPerfil(novoPerfil),
      soComEmail: filtros?.soComEmail ?? false,
    };
    setTemPerfil(true);
    setPerfil(novosFiltros);
    setFiltros(novosFiltros);
    buscar(novosFiltros, null, quantidade ? Math.min(quantidade, LIMITE_PAGINA) : undefined);
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

  // Opções dos filtros de resultado: só o que existe de verdade no que já
  // carregou (nunca oferece opção sem nenhuma empresa por trás).
  const nichosPresentes = useMemo(() => {
    const vistos = new Map<string, string>();
    for (const i of itens) {
      const nicho = nichoDaAtividade(i.cnae_principal);
      if (nicho) vistos.set(nicho.id, nicho.nome);
    }
    return [...vistos.entries()].map(([id, nome]) => ({ id, nome }));
  }, [itens]);
  const portesPresentes = useMemo(() => [...new Set(itens.map((i) => i.porte).filter((p): p is string => !!p))], [itens]);
  const ufsPresentes = useMemo(() => [...new Set(itens.map((i) => i.uf).filter((u): u is string => !!u))].sort(), [itens]);

  const itensFiltrados = useMemo(() => {
    const termo = filtroResultadoTexto.trim().toLocaleLowerCase('pt-BR');
    return itens.filter((i) => {
      if (filtroResultadoEmail === 'com_email' && !i.email) return false;
      if (filtroResultadoEmail === 'sem_email' && i.email) return false;
      if (filtroResultadoNicho && nichoDaAtividade(i.cnae_principal)?.id !== filtroResultadoNicho) return false;
      if (filtroResultadoPorte && i.porte !== filtroResultadoPorte) return false;
      if (filtroResultadoUf && i.uf !== filtroResultadoUf) return false;
      if (!termo) return true;
      const nome = (i.nome_fantasia ?? i.razao_social ?? '').toLocaleLowerCase('pt-BR');
      const cidade = (i.municipio ?? '').toLocaleLowerCase('pt-BR');
      const nicho = (nomeAtividade(i.cnae_principal) ?? '').toLocaleLowerCase('pt-BR');
      return nome.includes(termo) || cidade.includes(termo) || nicho.includes(termo) || i.cnpj.includes(termo.replace(/\D/g, ''));
    });
  }, [itens, filtroResultadoTexto, filtroResultadoEmail, filtroResultadoNicho, filtroResultadoPorte, filtroResultadoUf]);

  const haFiltroResultadoAtivo = !!filtroResultadoTexto || filtroResultadoEmail !== 'todos' || !!filtroResultadoNicho || !!filtroResultadoPorte || !!filtroResultadoUf;

  const selecionaveis = useMemo(() => itensFiltrados.filter((i) => !i.ja_na_base), [itensFiltrados]);
  const todosSelecionados = selecionaveis.length > 0 && selecionaveis.every((i) => selecionados.has(i.cnpj));

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
    const comEmailDescartados = [...selecionados.values()].filter((i) => !!i.email).length;
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
      setTotalComEmail((t) => (t === null ? t : Math.max(0, t - comEmailDescartados)));
      setDescartadosSessao((n) => n + cnpjs.length);
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

  function focarPerfil() {
    const titulo = document.getElementById('perfil-busca-titulo');
    titulo?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    titulo?.focus({ preventScroll: true });
  }

  return (
    <div className={s.workspace}>
      <div className={s.mainColumn}>
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
              <button type="button" onClick={focarPerfil} className={`${s.primaryButton} mt-6 focus-ring`}>
                <SlidersHorizontal size={15} /> Configurar no painel ao lado
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

                  </div>

                  <div className={s.toggleRow}>
                    <Alternar ativo={filtros.excluirMei} onChange={(v) => atualizar({ excluirMei: v })}>Excluir MEI</Alternar>
                    <Alternar ativo={filtros.incluirCnaesSecundarios} onChange={(v) => atualizar({ incluirCnaesSecundarios: v })}>Incluir atividade secundária</Alternar>
                  </div>
                </section>
              )}

              {/* Resumo — Meta = quantidade desejada; avaliadas/com e-mail/descartadas
                  vêm da contagem real do servidor, sem depender do que já carregou. */}
              <section className={s.kpiGrid}>
                <Indicador
                  tom="cyan"
                  icone={Target}
                  rotulo="Meta"
                  valor={quantidade ? `${quantidade.toLocaleString('pt-BR')}` : '—'}
                  detalhe={
                    !quantidade
                      ? 'defina a quantidade no painel'
                      : filtros?.soComEmail
                        ? 'leads com e-mail válido'
                        : 'empresas — ligue "e-mail obrigatório" para valer como leads válidos'
                  }
                />
                <Indicador
                  tom="violet"
                  icone={Building2}
                  rotulo="Empresas avaliadas"
                  valor={total === null ? '—' : total.toLocaleString('pt-BR')}
                  detalhe={carregando && carregados === 0 ? 'Buscando…' : 'no catálogo, com os filtros atuais'}
                />
                <Indicador
                  tom="emerald"
                  icone={Mail}
                  rotulo="Com e-mail válido"
                  valor={totalComEmail === null ? '—' : totalComEmail.toLocaleString('pt-BR')}
                  proporcao={total && totalComEmail !== null ? totalComEmail / Math.max(1, total) : null}
                  detalhe={
                    total && totalComEmail !== null
                      ? `${Math.round((totalComEmail / Math.max(1, total)) * 100)}% do avaliado`
                      : 'aguardando contagem'
                  }
                />
                <Indicador
                  tom="amber"
                  icone={Ban}
                  rotulo="Descartadas"
                  valor={
                    total === null || totalComEmail === null
                      ? descartadosSessao.toLocaleString('pt-BR')
                      : (Math.max(0, total - totalComEmail) + descartadosSessao).toLocaleString('pt-BR')
                  }
                  detalhe="sem e-mail ou descartadas manualmente nesta busca"
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
                  <div className="flex items-center gap-4">
                    <span className="text-xs text-slate-400">
                      <span className="font-semibold tabular-nums text-slate-200">{selecionados.size}</span> selecionada{selecionados.size === 1 ? '' : 's'}
                    </span>
                    <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                      <CaixaSelecao marcado={todosSelecionados} onChange={alternarTodos} />
                      Selecionar todas as {selecionaveis.length.toLocaleString('pt-BR')} filtradas
                    </label>
                  </div>
                </div>

                {/* Filtros de resultado: analisam o que já carregou nesta busca —
                    diferente dos filtros acima, não voltam ao servidor. */}
                <div className={`${s.panelHeader}`} style={{ borderBottom: '1px solid var(--m-border-subtle, #17496e)' }}>
                  <div className={s.filterGrid} style={{ marginTop: 0, flex: 1 }}>
                    <Campo rotulo="Filtrar nesta lista">
                      <div className="relative">
                        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                          value={filtroResultadoTexto}
                          onChange={(e) => setFiltroResultadoTexto(e.target.value)}
                          placeholder="Empresa, cidade ou nicho…"
                          className={`${s.field} pl-9 pr-9 focus-ring`}
                        />
                      </div>
                    </Campo>
                    <Campo rotulo="E-mail">
                      <Selecao rotuloAcessivel="E-mail" valor={filtroResultadoEmail} onChange={(v) => setFiltroResultadoEmail(v as StatusEmailResultado)}>
                        {(Object.keys(ROTULO_STATUS_EMAIL) as StatusEmailResultado[]).map((v) => <option key={v} value={v}>{ROTULO_STATUS_EMAIL[v]}</option>)}
                      </Selecao>
                    </Campo>
                    <Campo rotulo="Nicho">
                      <Selecao rotuloAcessivel="Nicho" valor={filtroResultadoNicho} onChange={setFiltroResultadoNicho}>
                        <option value="">Todos</option>
                        {nichosPresentes.map((n) => <option key={n.id} value={n.id}>{n.nome}</option>)}
                      </Selecao>
                    </Campo>
                    <Campo rotulo="Porte">
                      <Selecao rotuloAcessivel="Porte" valor={filtroResultadoPorte} onChange={setFiltroResultadoPorte}>
                        <option value="">Todos</option>
                        {portesPresentes.map((p) => <option key={p} value={p}>{rotuloPorte(p)}</option>)}
                      </Selecao>
                    </Campo>
                    <Campo rotulo="Localização">
                      <Selecao rotuloAcessivel="Localização" valor={filtroResultadoUf} onChange={setFiltroResultadoUf}>
                        <option value="">Todas</option>
                        {ufsPresentes.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
                      </Selecao>
                    </Campo>
                  </div>
                  {haFiltroResultadoAtivo && (
                    <button
                      type="button"
                      onClick={() => { setFiltroResultadoTexto(''); setFiltroResultadoEmail('todos'); setFiltroResultadoNicho(''); setFiltroResultadoPorte(''); setFiltroResultadoUf(''); }}
                      className={`${s.linkAction} focus-ring rounded`}
                    >
                      <RotateCcw size={12} /> Limpar filtros de resultado
                    </button>
                  )}
                </div>

                <table className={s.table}>
                  <thead>
                    <tr>
                      <th className="w-12"><span className="sr-only">Selecionar</span></th>
                      <th className="w-[24%]">Empresa</th>
                      <th className="w-[14%]">Localização</th>
                      <th className="w-[10%]">Porte</th>
                      <th className="w-[13%]">Nicho</th>
                      <th className="w-[19%]">E-mail</th>
                      <th className="w-[14%]">Decisor</th>
                      <th className="w-28"><span className="sr-only">Situação</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {carregando && carregados === 0 ? (
                      <LinhasEsqueleto />
                    ) : carregados === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-24 text-center">
                          <Building2 size={30} className="mx-auto text-slate-600" />
                          <p className="mt-4 text-sm font-medium text-slate-300">Nenhuma empresa com esses filtros</p>
                          <p className="mt-1 text-sm text-slate-500">Tente ampliar os estados, o porte ou o nicho.</p>
                        </td>
                      </tr>
                    ) : itensFiltrados.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-24 text-center">
                          <Filter size={30} className="mx-auto text-slate-600" />
                          <p className="mt-4 text-sm font-medium text-slate-300">Nenhuma empresa com esse filtro de resultado</p>
                          <p className="mt-1 text-sm text-slate-500">{carregados} carregada{carregados === 1 ? '' : 's'} nesta busca — tente limpar o filtro acima.</p>
                        </td>
                      </tr>
                    ) : (
                      itensFiltrados.map((i) => {
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
                              <td className={`w-12 px-5 py-2.5 ${selecionado ? 'shadow-[inset_3px_0_0_var(--accent)]' : ''}`} onClick={(e) => e.stopPropagation()}>
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
                                    <span className="mt-1 block font-mono text-xs text-slate-500">{formatarCnpj(i.cnpj)}</span>
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
                                <span className={s.activityTag} title={formatarCnae(i.cnae_principal)}>{atividade ?? formatarCnae(i.cnae_principal)}</span>
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
                              <td className="px-4 py-2.5">
                                {decisor?.nome ? (
                                  <div className="flex items-start gap-1.5 text-xs text-indigo-300">
                                    <UserRound size={13} className="mt-0.5 shrink-0" />
                                    <span>
                                      <span className="block text-slate-200">{decisor.nome}</span>
                                      {decisor.cargo && <span className="block text-slate-500">{decisor.cargo}</span>}
                                    </span>
                                  </div>
                                ) : (
                                  <span className="text-xs text-slate-500">Não verificado</span>
                                )}
                              </td>
                              <td className="w-28 px-5 py-2.5 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                                {i.ja_na_base && (
                                  i.lead_id
                                    ? <Link href={`/leads/${i.lead_id}`} className="chip chip-success hover:brightness-125"><Check size={11} /> Já na base</Link>
                                    : <span className="chip chip-success"><Check size={11} /> Já na base</span>
                                )}
                              </td>
                            </tr>
                            {expandido && (
                              <tr>
                                <td colSpan={8} className="p-0">
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
      </div>

      <PerfilBuscaPainel
        catalogoCnaes={catalogo?.cnaes ?? null}
        quantidadeTexto={quantidadeTexto}
        soComEmail={filtros?.soComEmail ?? false}
        filtrosDisponiveis={!!filtros}
        onQuantidadeChange={setQuantidadeTexto}
        onSoComEmailChange={(ativo) => atualizar({ soComEmail: ativo })}
        onSalvo={aoSalvarPerfil}
      />

      {/* Barra de ações da seleção — left-60 = largura do menu lateral. */}
      {selecionados.size > 0 && (
        <div className={`${s.selectionDock} pointer-events-none fixed bottom-6 z-40 flex justify-center`}>
          <div className={`${s.selectionBar} pointer-events-auto animate-in`}>
            <span className="text-sm text-slate-200">
              <span className="font-semibold tabular-nums">{selecionados.size}</span> selecionada{selecionados.size === 1 ? '' : 's'}
            </span>
            <button type="button" onClick={() => { setSelecionados(new Map()); setConfirmandoDescarte(false); }} className="text-sm text-slate-400 hover:text-slate-200 focus-ring rounded">
              Limpar
            </button>
            <div className="h-6 w-px bg-[var(--m-border-subtle,#17496e)]" />
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

      {importando && (
        <ImportarProspeccaoModal itens={itensImportacao} onFechar={() => setImportando(false)} onImportado={aoImportar} />
      )}
    </div>
  );
}
