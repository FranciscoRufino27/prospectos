'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Ban, Bookmark, Building2, Check, ChevronDown, ChevronRight, Database, Download, FileSpreadsheet, Filter, Globe2, LayoutGrid, Mail,
  Loader2, Radar, RotateCcw, Search, SlidersHorizontal, Square, Target, Trash2, UserSearch,
} from 'lucide-react';
import { cnpjDoTexto, filtrosDoPerfil, LIMITE_BUSCA_ESPECIFICA, OPCOES_ANOS_MINIMOS, OPCOES_CAPITAL_MINIMO, type FiltroTelefone, type FiltrosBusca } from '@/lib/prospeccao/filtros';
import type { ResultadoCatalogo, StatusCatalogo } from '@/lib/prospeccao/buscaServidor';
import { formatarCnae, iniciais, nomeLegivel, nomeSemSufixo, rotuloPorte, ROTULO_PORTE } from '@/lib/prospeccao/rotulos';
import { gruposDoPerfil, nichoDaAtividade, nomeAtividade } from '@/lib/prospeccao/nichos';
import { nomeSugerido } from '@/lib/prospeccao/pesquisas';
import { formatarCnpj } from '@/lib/empresas/cnpj';
import {
  PESQUISAS_LIMITES, PORTES_PROSPECCAO, quantidadeValida,
  type PesquisaSalva, type PorteProspeccao, type ProspeccaoConfig,
} from '@/lib/config/workspaceConfig';
import DetalheEmpresa, { consultarSociosApi, type ConsultaSocios, type Decisor, type EstadoSalvamento } from '@/components/prospeccao/DetalheEmpresa';
import { emLote, normalizarPerfilLinkedIn } from '@/lib/prospeccao/contato';
import { linhaCsv, montarCsv, nomeArquivoCsv } from '@/lib/prospeccao/exportarCsv';
import { emailDoDecisor, type Enriquecimento } from '@/lib/prospeccao/enriquecimento';
import { buscarComDecisor, entraNaLista, ROTULO_PULO, type MotivoPulo, type ResumoBuscaComDecisor } from '@/lib/prospeccao/buscaComDecisor';
import { META_MAXIMA_DECISOR, TETO_TENTATIVAS_DECISOR, type ResultadoDecisorAutomatico } from '@/lib/prospeccao/decisorAutomatico';
import DecisorCelula from '@/components/prospeccao/DecisorCelula';
import ImportarProspeccaoModal from '@/components/prospeccao/ImportarProspeccaoModal';
import CaixaSelecao from '@/components/prospeccao/CaixaSelecao';
import PerfilBuscaPainel, { type DestinoBusca } from '@/components/prospeccao/PerfilBuscaPainel';
import { ProvedorSeloReceita } from '@/components/prospeccao/SeloReceita';
import PesquisasSalvas, { SalvarPesquisa } from '@/components/prospeccao/PesquisasSalvas';
import { iconeDoNicho } from '@/components/prospeccao/iconesNicho';
import { NOME_UF } from '@/lib/prospeccao/estados';
import { CabecalhoBloco, Indicador } from '@/components/prospeccao/Indicador';
import BuscaInternacional, { type PedidoBusca } from '@/components/prospeccao/BuscaInternacional';
import type { PedidoEmpresa } from '@/components/prospeccao/BuscaEmpresaEspecifica';
import type { CodigoPais } from '@/lib/prospeccao/crustdata';
import { nichosInternacionaisDoPerfil } from '@/lib/prospeccao/nichosInternacional';
import ForaDoCatalogo, { EmpresaNaoEncontrada } from '@/components/prospeccao/ForaDoCatalogo';
import s from '@/components/prospeccao/Prospeccao.module.css';

// Prospecção: buscar no catálogo da Receita já com o decisor e o e-mail dele → selecionar →
// importar → iniciar prospecção (wizard de campanha). A busca parte do perfil
// da organização (Configurações › Perfil de busca). Visual alinhado ao Dashboard.

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
  ehAdmin: boolean;
  paisesInternacional: CodigoPais[];
}

const ROTULO_STATUS_EMAIL = { todos: 'Todos', com_email: 'Com e-mail do decisor', sem_email: 'Sem e-mail do decisor' } as const;
type StatusEmailResultado = keyof typeof ROTULO_STATUS_EMAIL;

// Situação do decisor de cada empresa, para o filtro de resultado que vira
// fila de trabalho ("o que ainda falta analisar").
const ROTULO_SITUACAO_DECISOR = {
  todos: 'Todos',
  nao_analisado: 'Não analisado',
  socio_serve: 'Sócio serve',
  precisa_outro: 'Precisa de outro',
  sem_decisor: 'Analisado, sem decisor',
  com_linkedin: 'Com LinkedIn',
} as const;
type SituacaoDecisor = keyof typeof ROTULO_SITUACAO_DECISOR;

function situacaoConfere(situacao: SituacaoDecisor, decisor: Decisor | null | undefined, consulta: ConsultaSocios | undefined): boolean {
  switch (situacao) {
    case 'todos': return true;
    case 'nao_analisado': return !consulta && !decisor?.nome;
    case 'socio_serve': return consulta?.status === 'socio_serve';
    case 'precisa_outro': return consulta?.status === 'precisa_outro_decisor';
    case 'sem_decisor': return !!consulta && !decisor?.nome;
    case 'com_linkedin': return !!normalizarPerfilLinkedIn(decisor?.linkedin);
  }
}

// Resoluções simultâneas: poucas, para não estourar o limite da OpenCNPJ/Anymail.
const CONCORRENCIA_DECISOR = 3;

/** 10000 → "R$ 10 mil"; 1000000 → "R$ 1 milhão". */
function rotuloCapital(valor: number): string {
  return valor >= 1_000_000
    ? `R$ ${(valor / 1_000_000).toLocaleString('pt-BR')} milh${valor >= 2_000_000 ? 'ões' : 'ão'}`
    : `R$ ${(valor / 1_000).toLocaleString('pt-BR')} mil`;
}

// Rótulo em cima, campo embaixo: cada filtro lê como um item de formulário.
// div, não <label>: dentro de um label, o clique numa opção dos seletores de
// estado/município "clica" também o primeiro botão do campo (o X da 1ª
// etiqueta) e desfaz a escolha. Cada controle leva o próprio aria-label.
function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className={s.fieldLabel}>
      <span>{rotulo}</span>
      {children}
    </div>
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
  const [perfilAberto, setPerfilAberto] = useState(false);
  const [temPerfil, setTemPerfil] = useState<boolean | null>(null);
  const [catalogo, setCatalogo] = useState<StatusCatalogo | null>(null);
  const [ehAdmin, setEhAdmin] = useState(false);
  // Países-alvo do perfil para a aba Internacional.
  const [paisesPerfil, setPaisesPerfil] = useState<CodigoPais[]>([]);
  const [itens, setItens] = useState<ResultadoCatalogo[]>([]);
  // Busca com decisor: a lista só recebe empresas completas (decisor + e-mail
  // válido dele). `buscando` = em andamento; `resumoBusca` = última concluída.
  const [buscando, setBuscando] = useState(false);
  const [progresso, setProgresso] = useState<{ completos: number; tentativas: number } | null>(null);
  const [resumoBusca, setResumoBusca] = useState<(ResumoBuscaComDecisor & { meta: number }) | null>(null);
  const [pulados, setPulados] = useState<{ item: ResultadoCatalogo; motivo: MotivoPulo; erro?: string }[]>([]);
  const [candidatosVistos, setCandidatosVistos] = useState(0);
  // Meta da busca feita (ou em andamento); null = nenhuma busca ainda.
  const [metaDaBusca, setMetaDaBusca] = useState<number | null>(null);
  // Critério mínimo "Decisor obrigatório": ligado = só empresas com decisor e
  // e-mail dele; desligado = também as sem decisor (com o motivo).
  const [decisorObrigatorio, setDecisorObrigatorio] = useState(true);
  // Por que cada empresa da lista ficou sem decisor/e-mail (só com o critério desligado).
  const [motivosSemDecisor, setMotivosSemDecisor] = useState<Record<string, MotivoPulo>>({});
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
  const [filtroResultadoDecisor, setFiltroResultadoDecisor] = useState<SituacaoDecisor>('todos');
  const [ocultarJaNaBase, setOcultarJaNaBase] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const [selecionados, setSelecionados] = useState<Map<string, ResultadoCatalogo>>(() => new Map());
  const [decisores, setDecisores] = useState<Record<string, Decisor | null>>({});
  // Espelho síncrono de `decisores` (a consulta em lote decide sem esperar render).
  const decisoresRef = useRef<Record<string, Decisor | null>>({});
  // Salvamento automático do decisor por CNPJ (0057), com debounce.
  const [salvamentos, setSalvamentos] = useState<Record<string, EstadoSalvamento>>({});
  const timersSalvar = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  // Consulta de sócios por CNPJ: alimenta a coluna Decisor e o detalhe.
  const [consultas, setConsultas] = useState<Record<string, ConsultaSocios>>({});
  // Consultas pagas (Crustdata/Anymail) por CNPJ; o servidor guarda (0060).
  const [enriquecimentos, setEnriquecimentos] = useState<Record<string, Enriquecimento>>({});
  // Busca de decisores dos selecionados em andamento (concluídos/total).
  const [buscaDecisores, setBuscaDecisores] = useState<{ feitos: number; total: number } | null>(null);
  const [falhasDecisores, setFalhasDecisores] = useState(0);
  const [confirmandoDescarte, setConfirmandoDescarte] = useState(false);
  const [importando, setImportando] = useState(false);
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
  // Brasil = catálogo da Receita; internacional = Crustdata (paga, só no clique).
  const [modo, setModo] = useState<'brasil' | 'internacional'>('brasil');
  // Atalho "Procurar fora do catálogo": abre a aba internacional já buscando.
  const [pedidoInternacional, setPedidoInternacional] = useState<PedidoBusca | null>(null);
  // Texto da última busca específica no Brasil; null = a lista veio do perfil.
  const [buscaEspecifica, setBuscaEspecifica] = useState<string | null>(null);
  // Empresa específica fora da Receita: busca na Crustdata (Brasil), mostrada
  // aqui mesmo na aba Brasil no lugar da lista vazia do catálogo.
  const [crustdataBrasil, setCrustdataBrasil] = useState<PedidoBusca | null>(null);
  // Só a resposta da busca mais recente pode escrever no estado.
  const buscaAtual = useRef(0);

  // Contagem e filtros efetivos do catálogo (grátis): cards e painel. Não
  // mexe na lista — ela só muda quando o usuário clica em Buscar.
  const contagemAtual = useRef(0);
  const carregarContagem = useCallback(async (f: FiltrosBusca | null) => {
    const id = ++contagemAtual.current;
    setCarregando(true);
    try {
      const res = await fetch('/api/prospeccao/busca', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filtros: f ?? undefined, limite: 1 }),
      });
      const corpo = (await res.json().catch(() => ({}))) as Partial<RespostaApi> & { erro?: string };
      if (id !== contagemAtual.current) return;
      if (!res.ok) throw new Error(corpo.erro || 'Falha na busca');
      setCatalogo(corpo.catalogo ?? null);
      setEhAdmin(corpo.ehAdmin === true);
      setTemPerfil(!!corpo.temPerfil);
      setPerfil(corpo.perfil ?? null);
      setPaisesPerfil(corpo.paisesInternacional ?? []);
      if (!f) setFiltros(corpo.filtros ?? null);
      setTotal(corpo.total ?? null);
      setTotalComEmail(corpo.totalComEmail ?? null);
    } catch (e) {
      if (id === contagemAtual.current) setErro(e instanceof Error ? e.message : 'Erro na busca');
    } finally {
      if (id === contagemAtual.current) setCarregando(false);
    }
  }, []);

  // 1ª carga: sem filtros → o servidor aplica o perfil e devolve os filtros efetivos.
  useEffect(() => { carregarContagem(null); }, [carregarContagem]);

  // Meta da busca com decisor: a quantidade pedida, nunca acima do teto dos testes.
  const meta = Math.min(quantidade ?? META_MAXIMA_DECISOR, META_MAXIMA_DECISOR);

  // Percorre o catálogo (melhores notas primeiro) e resolve o decisor empresa a
  // empresa até ter `meta` completas. Cada resolução pode gastar crédito
  // (Anymail/Crustdata); o servidor reaproveita o que a org já consultou.
  // `especifica`: texto de uma empresa específica — ignora o perfil (o servidor
  // procura em todo o catálogo), traz poucos resultados e mostra mesmo sem decisor.
  async function buscarEmpresasComDecisor(f: FiltrosBusca | null = filtros, pedidoEmpresa: Extract<PedidoEmpresa, { modo: 'brasil' }> | null = null) {
    const especifica = pedidoEmpresa?.texto ?? null;
    if (buscando || (!f && !especifica)) return;
    const id = ++buscaAtual.current;
    const ativo = () => id === buscaAtual.current;
    // Domínio próprio vem do e-mail da Receita: com decisor obrigatório, sem
    // e-mail não há como achar o do decisor. Desligado, vale o critério de e-mail.
    const filtrosBusca = especifica ? { texto: especifica } : { ...f!, soComEmail: decisorObrigatorio ? true : f!.soComEmail };
    const metaBusca = especifica ? LIMITE_BUSCA_ESPECIFICA : meta;
    setMetaDaBusca(metaBusca);
    let cursorAtual: string | null = null;
    let vistos = 0;
    setCrustdataBrasil(null);
    // "Decisor obrigatório" desligado (ou empresa específica): sem decisor/e-mail também entra.
    const aceitaIncompletas = !!especifica || !decisorObrigatorio;
    setBuscaEspecifica(especifica);
    // Consulta de sócios das incompletas, guardada até o desfecho chegar.
    const consultasIncompletas = new Map<string, ConsultaSocios>();
    setBuscando(true);
    setErro(null);
    setAberto(null);
    setItens([]);
    setPulados([]);
    setMotivosSemDecisor({});
    setSelecionados(new Map());
    setConfirmandoDescarte(false);
    setCandidatosVistos(0);
    setResumoBusca(null);
    setProgresso({ completos: 0, tentativas: 0 });
    setDescartadosSessao(0);
    setFiltroResultadoTexto('');
    setFiltroResultadoEmail('todos');
    setFiltroResultadoNicho('');
    setFiltroResultadoPorte('');
    setFiltroResultadoUf('');
    try {
      const resumo = await buscarComDecisor<ResultadoCatalogo, Extract<ResultadoDecisorAutomatico, { status: 'completo' }>>({
        meta: metaBusca,
        teto: especifica ? LIMITE_BUSCA_ESPECIFICA : TETO_TENTATIVAS_DECISOR,
        concorrencia: CONCORRENCIA_DECISOR,
        aceitaIncompletas,
        cancelado: () => !ativo(),
        proximaPagina: async () => {
          const res = await fetch('/api/prospeccao/busca', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              filtros: filtrosBusca,
              cursor: cursorAtual,
              ...(pedidoEmpresa ? { especifica: true, limite: LIMITE_BUSCA_ESPECIFICA, uf: pedidoEmpresa.uf, cidade: pedidoEmpresa.cidade, site: pedidoEmpresa.site } : {}),
            }),
          });
          const corpo = (await res.json().catch(() => ({}))) as Partial<RespostaApi> & { erro?: string };
          if (!res.ok) throw new Error(corpo.erro || 'Falha na busca');
          cursorAtual = corpo.proximoCursor ?? null;
          vistos += corpo.itens?.length ?? 0;
          if (ativo()) setCandidatosVistos(vistos);
          return { itens: corpo.itens ?? [], fim: !cursorAtual };
        },
        resolver: async (item) => {
          const res = await fetch('/api/prospeccao/decisor-automatico', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cnpj: item.cnpj }),
          });
          const corpo = (await res.json().catch(() => ({}))) as ResultadoDecisorAutomatico & { erro?: string };
          // Sem crédito, sem chave ou limite: parar já, senão as próximas falham igual.
          if (!res.ok) return { tipo: 'falha', erro: corpo.erro || 'Falha ao buscar o decisor.', fatal: [402, 429, 503].includes(res.status) };
          if (corpo.status === 'completo') return { tipo: 'completo', dados: corpo };
          if (corpo.status === 'incompleto' && corpo.consulta) consultasIncompletas.set(item.cnpj, corpo.consulta);
          // Fonte paga bloqueada (travas, chave, crédito): só esta empresa fica de fora; a busca segue.
          return { tipo: 'pulado', motivo: corpo.status === 'incompleto' ? corpo.motivo : 'erro', erro: corpo.status === 'incompleto' ? corpo.bloqueio?.mensagem : undefined };
        },
        aoDesfecho: (item, d) => {
          if (!ativo()) return;
          if (d.tipo === 'pulado') {
            if (!entraNaLista(d, aceitaIncompletas)) {
              // Empresa específica já na base: aparece (com o selo), sem consultar nada.
              if (especifica && d.motivo === 'ja_na_base') setItens((l) => [...l, item]);
              else setPulados((l) => [...l, { item, motivo: d.motivo, erro: d.erro }]);
              return;
            }
            // Entra sem decisor completo: mostra o sócio sugerido (se houver)
            // e o motivo; sem e-mail do decisor, não importa.
            setItens((l) => [...l, item]);
            setMotivosSemDecisor((m) => ({ ...m, [item.cnpj]: d.motivo }));
            const consulta = consultasIncompletas.get(item.cnpj);
            if (consulta) registrarConsulta(item.cnpj, consulta);
            return;
          }
          const { decisor, consulta, enriquecimento } = d.dados;
          setItens((l) => [...l, item]);
          // Edição do usuário ainda a caminho do servidor prevalece.
          if (!timersSalvar.current.has(item.cnpj)) {
            decisoresRef.current = { ...decisoresRef.current, [item.cnpj]: decisor };
            setDecisores(decisoresRef.current);
          }
          setConsultas((m) => ({ ...m, [item.cnpj]: consulta }));
          setEnriquecimentos((m) => ({ ...m, [item.cnpj]: enriquecimento }));
        },
        aoProgresso: (p) => { if (ativo()) setProgresso(p); },
      });
      if (!ativo()) return;
      setResumoBusca({ ...resumo, meta: metaBusca });
      if (resumo.erro) setErro(resumo.erro);
      // Empresa específica que não está na Receita (o catálogo só tem as
      // atividades carregadas): segue na Crustdata, no Brasil, com decisor.
      // CNPJ fica na tela: a OpenCNPJ mostra os dados oficiais dele.
      if (especifica && !resumo.erro && vistos === 0 && !cnpjDoTexto(especifica)) {
        setCrustdataBrasil({
          nome: especifica, pais: 'BRA', id: Date.now(), origem: 'receita',
          estado: pedidoEmpresa?.uf ? NOME_UF[pedidoEmpresa.uf as keyof typeof NOME_UF] : '',
          cidade: pedidoEmpresa?.cidade ?? '',
          site: pedidoEmpresa?.site ?? null,
        });
      }
    } catch (e) {
      if (ativo()) setErro(e instanceof Error ? e.message : 'Erro na busca');
    } finally {
      if (ativo()) { setBuscando(false); setProgresso(null); }
    }
  }

  // "Buscar empresa específica" do Perfil de busca: Brasil no catálogo (com
  // desvio para a Crustdata); internacional direto na Crustdata.
  function buscarEmpresaEspecifica(pedido: PedidoEmpresa) {
    setPerfilAberto(false);
    if (pedido.modo === 'internacional') {
      setPedidoInternacional({ nome: pedido.texto, pais: pedido.pais, estado: pedido.estado, cidade: pedido.cidade, site: pedido.site, id: Date.now() });
      setModo('internacional');
      return;
    }
    setPedidoInternacional(null);
    setModo('brasil');
    buscarEmpresasComDecisor(null, pedido);
  }

  // Interrompe a busca em andamento: o que já completou fica na lista.
  function pararBusca() {
    buscaAtual.current++;
    setBuscando(false);
    setResumoBusca({ completos: itens.length, tentativas: progresso?.tentativas ?? 0, parada: 'cancelado', erro: null, meta });
    setProgresso(null);
  }

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


  // Filtro mudou: só atualiza a contagem (grátis). A busca com decisor, que
  // gasta crédito, roda apenas no clique de Buscar.
  const primeiraExecucao = useRef(true);
  useEffect(() => {
    if (!filtros) return;
    if (primeiraExecucao.current) { primeiraExecucao.current = false; return; }
    carregarContagem(filtros);
  }, [filtros, carregarContagem]);

  // Perfil salvo no painel: recomeça pelo novo perfil sem perder os ajustes
  // da busca atual que ainda não fazem parte da configuração persistida.
  // `destino`: botão clicado no painel — busca no catálogo da Receita (com
  // decisor) ou na aba internacional, com os nichos e países do perfil.
  function aoSalvarPerfil(novoPerfil: ProspeccaoConfig | null, destino: DestinoBusca) {
    setPerfilAberto(false);
    setNicho('');
    setPaisesPerfil(novoPerfil?.paises ?? []);
    primeiraExecucao.current = true;
    if (!novoPerfil) {
      carregarContagem(null);
      return;
    }
    // Filtros que só existem na tela (nome/CNPJ, tempo, capital, telefone)
    // continuam valendo na busca disparada pelo painel.
    const novosFiltros = {
      ...filtrosDoPerfil(novoPerfil),
      soComEmail: filtros?.soComEmail ?? false,
      texto: filtros?.texto ?? '',
      anosMinimos: filtros?.anosMinimos ?? null,
      capitalMinimo: filtros?.capitalMinimo ?? null,
      telefone: filtros?.telefone ?? '',
    };
    setTemPerfil(!!novoPerfil.cnaes?.length);
    setPerfil(novosFiltros);
    setFiltros(novosFiltros);
    carregarContagem(novosFiltros);
    if (destino === 'internacional') {
      setPedidoInternacional({ nome: '', pais: '', id: Date.now(), doPerfil: true });
      setModo('internacional');
    } else {
      setPedidoInternacional(null);
      setModo('brasil');
      if (novosFiltros.cnaes.length) buscarEmpresasComDecisor(novosFiltros);
    }
  }

  // Atalho "Procurar fora do catálogo": aba internacional já buscando no Brasil.
  function buscarForaDoCatalogo(nome: string) {
    setPedidoInternacional({ nome, pais: 'BRA', id: Date.now() });
    setModo('internacional');
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
      anosMinimos: f.anosMinimos ?? null,
      capitalMinimo: f.capitalMinimo ?? null,
      telefone: f.telefone ?? '',
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
    // Só grava os filtros extras ligados (ausente = sem filtro).
    ...(filtros.anosMinimos !== null ? { anosMinimos: filtros.anosMinimos } : {}),
    ...(filtros.capitalMinimo !== null ? { capitalMinimo: filtros.capitalMinimo } : {}),
    ...(filtros.telefone ? { telefone: filtros.telefone } : {}),
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

  // Troca o decisor de um CNPJ e agenda o salvamento (o último valor vence).
  function alterarDecisor(cnpj: string, decisor: Decisor | null) {
    decisoresRef.current = { ...decisoresRef.current, [cnpj]: decisor };
    setDecisores(decisoresRef.current);
    setSalvamentos((m) => ({ ...m, [cnpj]: 'salvando' }));
    const timers = timersSalvar.current;
    clearTimeout(timers.get(cnpj));
    timers.set(cnpj, setTimeout(async () => {
      timers.delete(cnpj);
      const atual = decisoresRef.current[cnpj];
      try {
        const res = await fetch('/api/prospeccao/decisores', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cnpj, nome: atual?.nome ?? null, cargo: atual?.cargo ?? null, linkedin: atual?.linkedin ?? null }),
        });
        // Outra edição agendada depois desta decide o estado final.
        if (timers.has(cnpj)) return;
        setSalvamentos((m) => ({ ...m, [cnpj]: res.ok ? 'salvo' : 'erro' }));
      } catch {
        if (!timers.has(cnpj)) setSalvamentos((m) => ({ ...m, [cnpj]: 'erro' }));
      }
    }, 700));
  }

  // Guarda a consulta e, se ainda não há decisor escolhido, adota o sugerido.
  function registrarConsulta(cnpj: string, consulta: ConsultaSocios) {
    setConsultas((m) => ({ ...m, [cnpj]: consulta }));
    const sugerido = consulta.sugerido;
    if (sugerido && !decisoresRef.current[cnpj]) alterarDecisor(cnpj, { nome: sugerido.nome, cargo: sugerido.qualificacao });
  }

  // Consulta os sócios dos selecionados que ainda não foram consultados, poucos
  // por vez para não sobrecarregar a OpenCNPJ.
  async function buscarDecisoresSelecionados() {
    const pendentes = [...selecionados.keys()].filter((cnpj) => !consultas[cnpj]);
    if (pendentes.length === 0 || buscaDecisores) return;
    setFalhasDecisores(0);
    setBuscaDecisores({ feitos: 0, total: pendentes.length });
    const resultados = await emLote(
      pendentes,
      3,
      async (cnpj) => {
        const consulta = await consultarSociosApi(cnpj);
        registrarConsulta(cnpj, consulta);
        return consulta;
      },
      (feitos) => setBuscaDecisores({ feitos, total: pendentes.length }),
    );
    setFalhasDecisores(resultados.filter((r) => !r.ok).length);
    setBuscaDecisores(null);
  }

  // Baixa os selecionados em CSV, com o que já está na tela (sem ir ao servidor).
  function exportarSelecionados() {
    const linhas = [...selecionados.values()].map((i) => linhaCsv(i, decisores[i.cnpj], consultas[i.cnpj], emailDoDecisor(enriquecimentos[i.cnpj], decisores[i.cnpj]?.nome)));
    const url = URL.createObjectURL(new Blob([montarCsv(linhas)], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = nomeArquivoCsv();
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const selecionadosSemConsulta = [...selecionados.keys()].filter((cnpj) => !consultas[cnpj]).length;

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
      const temEmailDecisor = !!emailDoDecisor(enriquecimentos[i.cnpj], decisores[i.cnpj]?.nome);
      if (filtroResultadoEmail === 'com_email' && !temEmailDecisor) return false;
      if (filtroResultadoEmail === 'sem_email' && temEmailDecisor) return false;
      if (filtroResultadoNicho && nichoDaAtividade(i.cnae_principal)?.id !== filtroResultadoNicho) return false;
      if (filtroResultadoPorte && i.porte !== filtroResultadoPorte) return false;
      if (filtroResultadoUf && i.uf !== filtroResultadoUf) return false;
      if (ocultarJaNaBase && i.ja_na_base) return false;
      if (!situacaoConfere(filtroResultadoDecisor, decisores[i.cnpj], consultas[i.cnpj])) return false;
      if (!termo) return true;
      const nome = (i.nome_fantasia ?? i.razao_social ?? '').toLocaleLowerCase('pt-BR');
      const cidade = `${i.municipio ?? ''} ${i.municipio_nome ?? ''}`.toLocaleLowerCase('pt-BR');
      const nicho = (nomeAtividade(i.cnae_principal) ?? '').toLocaleLowerCase('pt-BR');
      return nome.includes(termo) || cidade.includes(termo) || nicho.includes(termo) || i.cnpj.includes(termo.replace(/\D/g, ''));
    });
  }, [itens, filtroResultadoTexto, filtroResultadoEmail, filtroResultadoNicho, filtroResultadoPorte, filtroResultadoUf, ocultarJaNaBase, filtroResultadoDecisor, decisores, consultas, enriquecimentos]);

  const haFiltroResultadoAtivo = !!filtroResultadoTexto || filtroResultadoEmail !== 'todos' || !!filtroResultadoNicho || !!filtroResultadoPorte || !!filtroResultadoUf || ocultarJaNaBase || filtroResultadoDecisor !== 'todos';

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
    // Só o e-mail verificado do decisor atual; o servidor confere de novo.
    email: emailDoDecisor(enriquecimentos[i.cnpj], decisores[i.cnpj]?.nome),
    contato_nome: decisores[i.cnpj]?.nome?.trim() || null,
    contato_cargo: decisores[i.cnpj]?.cargo?.trim() || null,
    contato_linkedin: normalizarPerfilLinkedIn(decisores[i.cnpj]?.linkedin),
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
      filtros.anosMinimos !== null,
      filtros.capitalMinimo !== null,
      filtros.telefone !== '',
      filtros.texto !== '',
      quantidade !== null,
    ].filter(Boolean).length;
  }, [filtros, perfil, quantidade]);

  const semPerfil = temPerfil === false;

  // Atividade e Porte são selects: "todas" ou um valor específico.
  const valorAtividade = filtros && filtros.cnaes.length === 1 && atividadesBase.length > 1 ? filtros.cnaes[0] : '';
  const valorPorte = filtros
    ? (filtros.portes.length === 0 ? '' : filtros.portes.length === 1 ? filtros.portes[0] : '__varios__')
    : '';
  const carregados = itens.length;
  // Indicadores da busca atual (cards do topo). Avaliadas = toda empresa que
  // recebeu um veredito; descartadas = fora da lista + descartes manuais.
  const avaliadasNaBusca = itens.length + pulados.length;
  const comDecisorNaBusca = itens.filter((i) => !!emailDoDecisor(enriquecimentos[i.cnpj], decisores[i.cnpj]?.nome)).length;
  const descartadasNaBusca = pulados.length + descartadosSessao;

  // Empresas puladas, por motivo, para o resumo da busca.
  const puladosPorMotivo = useMemo(() => {
    const contagem = new Map<MotivoPulo, number>();
    for (const p of pulados) contagem.set(p.motivo, (contagem.get(p.motivo) ?? 0) + 1);
    return [...contagem.entries()];
  }, [pulados]);

  function focarPerfil() {
    setPerfilAberto(true);
  }

  return (
    <ProvedorSeloReceita value={{ visivel: ehAdmin, mesRf: catalogo?.mesRf ?? null }}>
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
              <button type="button" onClick={focarPerfil} className={`${s.outlineButton} focus-ring`}>
                <SlidersHorizontal size={15} /> Perfil de busca
              </button>
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

          {/* Origem: catálogo da Receita ou busca internacional (Crustdata) */}
          <div className={s.nichoRow}>
            <div className={s.nichoTabs} role="group" aria-label="Origem da busca">
              <button type="button" onClick={() => { setPedidoInternacional(null); setModo('brasil'); }} aria-pressed={modo === 'brasil'} className={`${modo === 'brasil' ? s.nichoAtivo : ''} focus-ring`}>
                <Database size={15} aria-hidden="true" /> Brasil · Receita Federal
              </button>
              <button type="button" onClick={() => { setPedidoInternacional(null); setModo('internacional'); }} aria-pressed={modo === 'internacional'} className={`${modo === 'internacional' ? s.nichoAtivo : ''} focus-ring`}>
                <Globe2 size={15} aria-hidden="true" /> Internacional · nicho e país
              </button>
            </div>
          </div>

          {/* Nichos do perfil */}
          {modo === 'brasil' && !semPerfil && perfil && grupos.length > 0 && (
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

          {modo === 'brasil' && !semPerfil && (
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
          {modo === 'internacional' ? (
            <BuscaInternacional
              pedido={pedidoInternacional}
              nichos={nichosInternacionaisDoPerfil(perfil?.cnaes ?? [])}
              paisesPerfil={paisesPerfil}
              meta={meta}
              decisorObrigatorio={decisorObrigatorio}
              onAbrirPerfil={focarPerfil}
            />
          ) : semPerfil ? (
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
                        onClick={() => { setNicho(''); definirQuantidade(null); setPesquisaAtiva(null); setFiltros({ ...perfil }); }}
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

                  {/* Estado e município ficam só no perfil de busca. */}
                  <div className={`${s.filterGrid} ${s.filterGridBusca}`}>
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

                    <Campo rotulo="Tempo de empresa">
                      <Selecao
                        rotuloAcessivel="Tempo de empresa"
                        valor={filtros.anosMinimos === null ? '' : String(filtros.anosMinimos)}
                        onChange={(v) => atualizar({ anosMinimos: v === '' ? null : Number(v) })}
                      >
                        <option value="">Qualquer idade</option>
                        {OPCOES_ANOS_MINIMOS.map((n) => <option key={n} value={n}>Aberta há {n}+ ano{n === 1 ? '' : 's'}</option>)}
                      </Selecao>
                    </Campo>

                    <Campo rotulo="Capital social">
                      <Selecao
                        rotuloAcessivel="Capital social mínimo"
                        valor={filtros.capitalMinimo === null ? '' : String(filtros.capitalMinimo)}
                        onChange={(v) => atualizar({ capitalMinimo: v === '' ? null : Number(v) })}
                      >
                        <option value="">Qualquer capital</option>
                        {OPCOES_CAPITAL_MINIMO.map((n) => <option key={n} value={n}>A partir de {rotuloCapital(n)}</option>)}
                      </Selecao>
                    </Campo>

                    <Campo rotulo="Telefone">
                      <Selecao
                        rotuloAcessivel="Telefone"
                        valor={filtros.telefone}
                        onChange={(v) => atualizar({ telefone: v as FiltroTelefone })}
                      >
                        <option value="">Com ou sem telefone</option>
                        <option value="com">Com telefone</option>
                        <option value="celular">Com celular (WhatsApp)</option>
                      </Selecao>
                    </Campo>

                  </div>

                  <div className={s.toggleRow}>                    <Alternar ativo={filtros.excluirMei} onChange={(v) => atualizar({ excluirMei: v })}>Excluir MEI</Alternar>
                    <Alternar ativo={filtros.incluirCnaesSecundarios} onChange={(v) => atualizar({ incluirCnaesSecundarios: v })}>Incluir atividade secundária</Alternar>
                  </div>
                </section>
              )}

              {/* Resumo — Meta = quantidade desejada; avaliadas/com e-mail/descartadas
                  vêm da contagem real do servidor, sem depender do que já carregou. */}
              {/* Indicadores DA BUSCA feita (não do catálogo inteiro): vazios até
                  buscar, ao vivo durante a busca e zerados numa busca nova. Com a
                  empresa vinda da Crustdata, os indicadores são os dela, abaixo. */}
              {!crustdataBrasil && (
                <section className={s.kpiGrid}>
                  <Indicador
                    tom="cyan"
                    icone={Target}
                    rotulo="Meta"
                    valor={metaDaBusca === null ? '—' : metaDaBusca.toLocaleString('pt-BR')}
                    detalhe={metaDaBusca === null
                      ? 'aparece ao buscar'
                      : buscaEspecifica ? 'resultados da busca pelo nome' : decisorObrigatorio ? 'empresas com decisor e e-mail dele' : 'empresas (decisor não obrigatório)'}
                  />
                  <Indicador
                    tom="violet"
                    icone={Building2}
                    rotulo="Empresas avaliadas"
                    valor={metaDaBusca === null ? '—' : avaliadasNaBusca.toLocaleString('pt-BR')}
                    detalhe={metaDaBusca === null ? 'aparece ao buscar' : buscando ? 'avaliando…' : 'nesta busca'}
                  />
                  <Indicador
                    tom="emerald"
                    icone={Mail}
                    rotulo="Com decisor e e-mail"
                    valor={metaDaBusca === null ? '—' : comDecisorNaBusca.toLocaleString('pt-BR')}
                    proporcao={metaDaBusca === null ? null : comDecisorNaBusca / Math.max(1, metaDaBusca)}
                    detalhe={metaDaBusca === null ? 'aparece ao buscar' : `${comDecisorNaBusca} de ${metaDaBusca} da meta`}
                  />
                  <Indicador
                    tom="amber"
                    icone={Ban}
                    rotulo="Descartadas"
                    valor={metaDaBusca === null ? '—' : descartadasNaBusca.toLocaleString('pt-BR')}
                    detalhe={metaDaBusca === null ? 'aparece ao buscar' : 'fora da lista ou descartadas manualmente nesta busca'}
                  />
                </section>
              )}

              {erro && (
                <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{erro}</p>
              )}

              {crustdataBrasil ? (
                <BuscaInternacional embutido pedido={crustdataBrasil} meta={meta} decisorObrigatorio={decisorObrigatorio} />
              ) : (<>
              {buscaEspecifica && resumoBusca && !buscando && (
                <ForaDoCatalogo
                  texto={buscaEspecifica}
                  semResultado={carregados === 0}
                  onBuscarFora={buscarForaDoCatalogo}
                />
              )}

              {/* Resultados */}
              <section className={`${s.panel} overflow-hidden`}>
                <div className={`${s.panelHeader} ${s.panelHeaderBar}`}>
                  <CabecalhoBloco
                    icone={Radar}
                    titulo="Resultados"
                    subtitulo={buscaEspecifica
                      ? `Resultados para “${buscaEspecifica}” em todo o catálogo da Receita (ignora o perfil).`
                      : `Empresas${grupoAtivo ? ` de ${grupoAtivo.nome}` : ''} do catálogo da Receita, já com o decisor e o e-mail dele.`}
                  />
                  <div className="flex items-center gap-4">
                    {buscando ? (
                      <>
                        <span className="flex items-center gap-2 text-xs text-slate-300" role="status">
                          <Loader2 size={14} className="animate-spin" />
                          {progresso?.completos ?? 0} de {meta} encontradas · {progresso?.tentativas ?? 0} analisada{progresso?.tentativas === 1 ? '' : 's'}
                        </span>
                        <button type="button" onClick={pararBusca} className={`${s.outlineButton} focus-ring`}>
                          <Square size={13} /> Parar
                        </button>
                      </>
                    ) : null}
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
                          aria-label="Filtrar nesta lista"
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
                    <Campo rotulo="Decisor">
                      <Selecao rotuloAcessivel="Situação do decisor" valor={filtroResultadoDecisor} onChange={(v) => setFiltroResultadoDecisor(v as SituacaoDecisor)}>
                        {(Object.keys(ROTULO_SITUACAO_DECISOR) as SituacaoDecisor[]).map((v) => <option key={v} value={v}>{ROTULO_SITUACAO_DECISOR[v]}</option>)}
                      </Selecao>
                    </Campo>
                  </div>
                  <div className={s.toggleRow}>
                    <Alternar ativo={ocultarJaNaBase} onChange={setOcultarJaNaBase}>Ocultar empresas já na base</Alternar>
                  </div>
                  {haFiltroResultadoAtivo && (
                    <button
                      type="button"
                      onClick={() => { setFiltroResultadoTexto(''); setFiltroResultadoEmail('todos'); setFiltroResultadoNicho(''); setFiltroResultadoPorte(''); setFiltroResultadoUf(''); setFiltroResultadoDecisor('todos'); setOcultarJaNaBase(false); }}
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
                      <th className="w-[12%]">Localização</th>
                      <th className="w-[10%]">Porte</th>
                      <th className="w-[13%]">Nicho</th>
                      <th className="w-[19%]">E-mail</th>
                      <th className="w-[16%]">Decisor</th>
                      <th className="w-28"><span className="sr-only">Situação</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {buscando && carregados === 0 ? (
                      <LinhasEsqueleto />
                    ) : !resumoBusca && carregados === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-24 text-center">
                          <UserSearch size={30} className="mx-auto text-slate-600" />
                          <p className="mt-4 text-sm font-medium text-slate-300">Pronto para buscar</p>
                          <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
                            A busca é disparada no Perfil de busca, em “Salvar e buscar no Brasil”: a lista traz até {meta} empresa{meta === 1 ? '' : 's'}{decisorObrigatorio ? ' já com o decisor e o e-mail dele' : ''}.
                          </p>
                          <button type="button" onClick={focarPerfil} className={`${s.outlineButton} mx-auto mt-5 focus-ring`}>
                            <SlidersHorizontal size={15} /> Abrir Perfil de busca
                          </button>
                        </td>
                      </tr>
                    ) : carregados === 0 && buscaEspecifica && candidatosVistos === 0 ? (
                      <tr>
                        <td colSpan={8}>
                          <EmpresaNaoEncontrada
                            texto={buscaEspecifica}
                            // `total` ignora o filtro de e-mail: se há empresas e nenhuma
                            // apareceu, o "só com e-mail" é que as escondeu.
                            // A busca com decisor exige e-mail na Receita: empresa sem
                            // e-mail não teria como dar o e-mail do decisor.
                            escondidasPorEmail={0}
                            onMostrarSemEmail={() => atualizar({ soComEmail: false })}
                            onBuscarFora={buscarForaDoCatalogo}
                            onLimpar={() => { setBuscaEspecifica(null); setResumoBusca(null); }}
                          />
                        </td>
                      </tr>
                    ) : carregados === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-24 text-center">
                          <Building2 size={30} className="mx-auto text-slate-600" />
                          <p className="mt-4 text-sm font-medium text-slate-300">
                            {candidatosVistos === 0 ? 'Nenhuma empresa com esses filtros' : 'Nenhuma empresa com decisor e e-mail encontrado'}
                          </p>
                          <p className="mt-1 text-sm text-slate-500">
                            {candidatosVistos === 0 ? 'Tente ampliar os estados, o porte ou o nicho.' : 'Veja abaixo por que as empresas analisadas ficaram de fora.'}
                          </p>
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
                        const emailDecisor = emailDoDecisor(enriquecimentos[i.cnpj], decisor?.nome);
                        const nome = nomeSemSufixo(nomeLegivel(i.nome_fantasia ?? i.razao_social)) || formatarCnpj(i.cnpj);
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
                                    <span className="mt-1 flex items-center gap-1 font-mono text-xs text-slate-500">{formatarCnpj(i.cnpj)}</span>
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-2.5">
                                <div className="flex min-w-0 items-center gap-1"><span className="truncate text-slate-200">{i.municipio_nome ?? (nomeLegivel(i.municipio) || '—')}</span></div>
                                <div className="mt-0.5 text-xs text-slate-500">{i.uf ?? ''}</div>
                              </td>
                              <td className="px-4 py-2.5 whitespace-nowrap text-slate-300">
                                {rotuloPorte(i.porte)}
                                {i.mei && <span className="chip chip-warning ml-2">MEI</span>}
                              </td>
                              <td className="px-4 py-2.5">
                                <span className="inline-flex items-center gap-1">
                                  <span className={s.activityTag} title={formatarCnae(i.cnae_principal)}>{atividade ?? formatarCnae(i.cnae_principal)}</span>
                                </span>
                              </td>
                              <td className="px-4 py-2.5">
                                {emailDecisor ? (
                                  <>
                                    <div className="flex items-center gap-2 min-w-0">
                                      <Mail size={13} className="shrink-0 text-slate-500" />
                                      <span className="min-w-0 truncate text-slate-200" title={emailDecisor}>{emailDecisor}</span>
                                    </div>
                                    <div className="mt-1 flex items-center gap-1.5 pl-5 text-xs text-emerald-400">
                                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                                      do decisor · verificado
                                    </div>
                                  </>
                                ) : (
                                  // Só vale o e-mail do decisor: o cadastral da Receita fica no detalhe.
                                  <span className="text-sm text-slate-500" title={motivosSemDecisor[i.cnpj] ? ROTULO_PULO[motivosSemDecisor[i.cnpj]] : undefined}>
                                    Sem e-mail do decisor
                                    {motivosSemDecisor[i.cnpj] && <span className="mt-0.5 block text-xs text-slate-600">{ROTULO_PULO[motivosSemDecisor[i.cnpj]]}</span>}
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-2.5">
                                <DecisorCelula decisor={decisor ?? null} avaliacao={consultas[i.cnpj] ?? null} />
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
                                  <DetalheEmpresa empresa={i} decisor={decisor ?? null} onDecisor={(d) => alterarDecisor(i.cnpj, d)} salvamento={salvamentos[i.cnpj] ?? null}
                                    consulta={consultas[i.cnpj] ?? null} onConsulta={(c) => registrarConsulta(i.cnpj, c)}
                                    enriquecimento={enriquecimentos[i.cnpj] ?? null}
                                    onEnriquecimento={(e) => setEnriquecimentos((m) => ({ ...m, [i.cnpj]: e }))}
                                  />
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })
                    )}
                  </tbody>
                </table>
                {resumoBusca && !buscando && (
                  <div className="border-t border-[var(--border-subtle)] px-5 py-4 text-sm text-slate-400">
                    <p>
                      {decisorObrigatorio && !buscaEspecifica
                        ? <><span className="font-semibold text-slate-200">{carregados} de {resumoBusca.meta}</span> com decisor e e-mail</>
                        : <><span className="font-semibold text-slate-200">{carregados} de {resumoBusca.meta}</span> empresas · {carregados - Object.keys(motivosSemDecisor).length} com decisor e e-mail</>}
                      {' · '}{resumoBusca.tentativas} empresa{resumoBusca.tentativas === 1 ? '' : 's'} analisada{resumoBusca.tentativas === 1 ? '' : 's'}
                      {resumoBusca.parada === 'teto' && ` · parou no limite de ${TETO_TENTATIVAS_DECISOR} análises por busca`}
                      {resumoBusca.parada === 'fim' && carregados < resumoBusca.meta && ' · o catálogo acabou para estes filtros'}
                      {resumoBusca.parada === 'cancelado' && ' · busca interrompida'}
                    </p>
                    {pulados.length > 0 && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-slate-300">
                          {pulados.length} empresa{pulados.length === 1 ? '' : 's'} fora da lista: {puladosPorMotivo.map(([m, n]) => `${n} ${ROTULO_PULO[m]}`).join(' · ')}
                        </summary>
                        <ul className="mt-2 space-y-1 text-xs">
                          {pulados.map((p) => (
                            <li key={p.item.cnpj}>
                              <span className="text-slate-300">{nomeSemSufixo(nomeLegivel(p.item.nome_fantasia ?? p.item.razao_social)) || formatarCnpj(p.item.cnpj)}</span>
                              <span className="text-slate-500"> · {ROTULO_PULO[p.motivo]}{p.erro ? ` (${p.erro})` : ''}</span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                )}
              </section>
              </>)}

              {/* Espaço para a barra flutuante não cobrir o fim da lista. */}
              {selecionados.size > 0 && <div className="h-16" />}
            </>
          )}
          </div>
        </div>
      </div>

      {perfilAberto && (
      <PerfilBuscaPainel
        catalogoCnaes={catalogo?.cnaes ?? null}
        modo={modo}
        quantidadeTexto={quantidadeTexto}
        soComEmail={filtros?.soComEmail ?? false}
        decisorObrigatorio={decisorObrigatorio}
        onDecisorObrigatorioChange={setDecisorObrigatorio}
        telefoneObrigatorio={!!filtros?.telefone}
        onTelefoneObrigatorioChange={(ativo) => atualizar({ telefone: ativo ? (filtros?.telefone || 'com') : '' })}
        filtrosDisponiveis={!!filtros}
        onQuantidadeChange={setQuantidadeTexto}
        onSoComEmailChange={(ativo) => atualizar({ soComEmail: ativo })}
        onFechar={() => setPerfilAberto(false)}
        onSalvo={aoSalvarPerfil}
        onBuscarEmpresa={buscarEmpresaEspecifica}
      />
      )}

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
            {buscaDecisores ? (
              <span className="flex h-10 items-center gap-2 px-2 text-sm text-slate-300" role="status">
                <Loader2 size={15} className="animate-spin" /> Buscando decisores {buscaDecisores.feitos}/{buscaDecisores.total}
              </span>
            ) : selecionadosSemConsulta > 0 ? (
              <button type="button" onClick={buscarDecisoresSelecionados} className="flex h-10 items-center gap-2 rounded-lg px-4 text-sm text-slate-300 hover:bg-white/5 focus-ring" title="Consulta o quadro societário (OpenCNPJ) e sugere o decisor de cada empresa">
                <UserSearch size={15} /> Buscar decisores ({selecionadosSemConsulta})
              </button>
            ) : null}
            {!buscaDecisores && falhasDecisores > 0 && (
              <span className="text-xs text-amber-300" role="status">{falhasDecisores} sem resposta da OpenCNPJ</span>
            )}
            <button type="button" onClick={exportarSelecionados} className="flex h-10 items-center gap-2 rounded-lg px-4 text-sm text-slate-300 hover:bg-white/5 focus-ring" title="Baixa as empresas selecionadas em planilha (CSV)">
              <FileSpreadsheet size={15} /> Exportar CSV
            </button>
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
    </ProvedorSeloReceita>
  );
}
