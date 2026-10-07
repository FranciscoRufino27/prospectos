'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { ChevronRight, Database, Plus, FileSpreadsheet, Megaphone, Rocket } from 'lucide-react';
import { formatDate, dash } from '@/lib/utils';
import { labelEstagio, corEstagio } from '@/lib/pipeline-stages';
import { getTodosLeads, getPipelineFiltrosOpcoes, type BaseLeadsFiltros } from '@/lib/api';
import type { Lead } from '@/lib/supabase';
import { camposUIEfetivos, type CampoUI } from '@/lib/config/workspaceConfig';
import LeadPanel from '@/components/leads/LeadPanel';
import NovoLeadModal from '@/components/leads/NovoLeadModal';
import ImportarLeadsModal from '@/components/leads/ImportarLeadsModal';
import FiltrosBase, { FILTRO_VAZIO, type BaseFiltroForm } from '@/components/base/FiltrosBase';
import { EstadoTabela, PaginacaoTabela } from '@/components/ui/tabela';
import CaixaSelecao from '@/components/prospeccao/CaixaSelecao';
import { estilosModulo as m, TituloSecao } from '@/components/tema/Modulo';

const PAGE = 50;

// Limites do filtro de data (item 4). Colunas são timestamptz (UTC) e o display
// mostra a data-calendário UTC — então os limites são UTC pra bater com a tela.
// Início do dia (inclusivo) e início do PRÓXIMO dia (exclusivo → usado com `.lt`,
// cobre o dia inteiro sem depender de "23:59:59.999").
function inicioDiaUTC(dia: string): string {
  return `${dia}T00:00:00.000Z`;
}
function fimExclusivoUTC(dia: string): string {
  const d = new Date(`${dia}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

// Etapa de follow-up (cache followups_enviados) → rótulo curto.
function etapaFollowup(n?: number): string {
  if (!n) return '—';
  return n >= 4 ? '4º+' : `${n}º`;
}

// Cor do score (0-100): frio (baixo) → quente (alto). Score alto = respondeu rápido.
function corScore(score?: number): string {
  const s = score ?? 0;
  if (s >= 85) return '#22c55e';
  if (s >= 65) return '#eab308';
  return '#64748b';
}

export default function BaseLeadsPage() {
  const [form, setForm] = useState<BaseFiltroForm>(FILTRO_VAZIO);
  const [filtroOpcoes, setFiltroOpcoes] = useState<{ responsaveis: string[]; segmentos: string[]; canais: string[] }>({ responsaveis: [], segmentos: [], canais: [] });
  const [camposUI, setCamposUI] = useState<CampoUI[]>(camposUIEfetivos([]));
  const [data, setData] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [useFallback, setUseFallback] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [modal, setModal] = useState<null | 'novo' | 'importar'>(null);
  const [selecionadosCampanha, setSelecionadosCampanha] = useState<Set<string>>(() => new Set());
  // Ordenação da tabela (item 2.8): clique no cabeçalho "Score" ordena por score.
  const [ordenarPor, setOrdenarPor] = useState<{ campo: 'score'; asc: boolean } | null>(null);

  // Opções dos selects + sonda de conexão + config de campos.
  useEffect(() => {
    getPipelineFiltrosOpcoes()
      .then(setFiltroOpcoes)
      .catch(err => { console.error('Erro ao carregar Base de Leads:', err); setUseFallback(true); });
    fetch('/api/configuracoes/workspace')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setCamposUI(camposUIEfetivos(d.config?.camposUI)); })
      .catch(() => {});
  }, []);

  // Debounce só do FORM (campos digitados: busca, cidade, estado…); cliques de
  // página e o reload pós-mutação disparam o fetch imediatamente.
  const [formDebounced, setFormDebounced] = useState(form);
  useEffect(() => {
    const t = setTimeout(() => setFormDebounced(form), 250);
    return () => clearTimeout(t);
  }, [form]);

  // Form (strings) → filtros server-side da query.
  const filtros: BaseLeadsFiltros = useMemo(() => ({
    busca: formDebounced.busca || undefined,
    responsavel: formDebounced.responsavel || undefined,
    segmento: formDebounced.segmento || undefined,
    estagio: formDebounced.estagio || undefined,
    followups: formDebounced.followup === '1' ? 1 : formDebounced.followup === '2' ? 2 : formDebounced.followup === '3' ? 3 : formDebounced.followup === '4+' ? { gte: 4 } : undefined,
    cidade: formDebounced.cidade || undefined,
    estado: formDebounced.estado || undefined,
    // Datas de cadastro/interação: intervalo MEIO-ABERTO [início, fim+1dia). As
    // colunas são timestamptz (UTC) e o display (formatDate) mostra a data-
    // calendário UTC — então os limites também são UTC, pra display e filtro
    // baterem. O fim é o PRÓXIMO dia (exclusivo, `.lt` na query): garante o dia
    // inteiro sem perder registro por horário/borda (item 4). Ver getTodosLeads.
    cadastroDe: formDebounced.cadastroDe ? inicioDiaUTC(formDebounced.cadastroDe) : null,
    cadastroAte: formDebounced.cadastroAte ? fimExclusivoUTC(formDebounced.cadastroAte) : null,
    interacaoDe: formDebounced.interacaoDe ? inicioDiaUTC(formDebounced.interacaoDe) : null,
    interacaoAte: formDebounced.interacaoAte ? fimExclusivoUTC(formDebounced.interacaoAte) : null,
    atalho: formDebounced.atalho || undefined,
    ordenarPor: ordenarPor ?? undefined,
  }), [formDebounced, ordenarPor]);

  // Alterna a ordenação por score: 1º clique = maior→menor, 2º = menor→maior, 3º = limpa.
  const toggleOrdenarScore = useCallback(() => {
    setOrdenarPor(prev => (prev == null ? { campo: 'score', asc: false } : prev.asc ? null : { campo: 'score', asc: true }));
  }, []);

  // Troca de filtro volta para a primeira página.
  useEffect(() => { setPage(0); }, [filtros]);

  // Nº de sequência do fetch: resposta antiga em voo não sobrescreve a nova.
  const seqRef = useRef(0);

  const carregar = useCallback(async () => {
    const seq = ++seqRef.current;
    setLoading(true);
    const { data, total } = await getTodosLeads(filtros, { limit: PAGE, offset: page * PAGE });
    if (seq !== seqRef.current) return;
    setData(data);
    setTotal(total);
    setLoading(false);
    // Mutação pode encolher o total com a página além do fim: volta pra última válida.
    const ultimaPagina = Math.max(0, Math.ceil(total / PAGE) - 1);
    if (page > ultimaPagina) setPage(ultimaPagina);
  }, [filtros, page]);

  useEffect(() => { carregar(); }, [carregar, reloadKey]);

  const todosDaPaginaSelecionados = data.length > 0 && data.every((lead) => selecionadosCampanha.has(lead.id));
  const hrefProspeccao = `/campanhas/nova?tipo=prospeccao&leads=${encodeURIComponent([...selecionadosCampanha].join(','))}`;
  const hrefComunicado = `/campanhas/nova?tipo=novidade_clientes&leads=${encodeURIComponent([...selecionadosCampanha].join(','))}`;

  const alternarSelecao = useCallback((id: string) => {
    setSelecionadosCampanha((atuais) => {
      const proximos = new Set(atuais);
      if (proximos.has(id)) proximos.delete(id);
      else proximos.add(id);
      return proximos;
    });
  }, []);

  const alternarPagina = useCallback(() => {
    setSelecionadosCampanha((atuais) => {
      const proximos = new Set(atuais);
      const marcar = !data.every((lead) => proximos.has(lead.id));
      for (const lead of data) {
        if (marcar) proximos.add(lead.id);
        else proximos.delete(lead.id);
      }
      return proximos;
    });
  }, [data]);

  return (
    // Tema dos módulos (components/tema): mesma paleta e cabeçalho da Prospecção.
    // A página segue em altura de tela: só a tabela rola, a paginação fica fixa.
    <div className={`${m.cores} h-screen flex flex-col overflow-hidden`}>
      {/* Header */}
      <header className={`${m.pageHeader} px-6 pt-5 pb-3 shrink-0`}>
        <nav className={m.breadcrumb} aria-label="Navegação estrutural">
          <span>Execução</span><ChevronRight size={13} aria-hidden="true" /><strong>Base de Leads</strong>
        </nav>
        <div className={m.titleRow}>
          <div>
            <h1>Base de Leads</h1>
            <p>Banco geral — todos os leads, em qualquer estado.</p>
          </div>
          <div className={m.actions}>
            {selecionadosCampanha.size > 0 && (
              <>
                <Link href={hrefProspeccao} className={`${m.primaryButton} focus-ring`}>
                  <Rocket size={14} /> Iniciar prospecção ({selecionadosCampanha.size})
                </Link>
                <Link href={hrefComunicado} className={`${m.outlineButton} focus-ring`}>
                  <Megaphone size={14} /> Enviar novidade
                </Link>
              </>
            )}
            <button type="button" onClick={() => setModal('importar')} className={`${m.outlineButton} focus-ring`}>
              <FileSpreadsheet size={14} /> Importar leads
            </button>
            <button type="button" onClick={() => setModal('novo')} className={`${selecionadosCampanha.size > 0 ? m.outlineButton : m.primaryButton} focus-ring`}>
              <Plus size={14} /> Novo lead
            </button>
          </div>
        </div>
      </header>

      {/* Filtros */}
      <section className={`${m.painel} mx-6 mb-3 shrink-0 px-4 py-3`}>
        <FiltrosBase
          value={form}
          onChange={setForm}
          responsaveis={filtroOpcoes.responsaveis}
          segmentos={filtroOpcoes.segmentos}
        />
      </section>

      {/* Tabela + paginação num painel; só o miolo rola */}
      <section className={`${m.painel} mx-6 mb-4 flex-1 min-h-0 flex flex-col overflow-hidden`}>
        <div className={`${m.painelBarra} shrink-0`}>
          <TituloSecao icone={Database} titulo="Leads" subtitulo="Clique numa linha para abrir o lead; marque para montar uma campanha." />
          {!useFallback && (
            <div className="text-right shrink-0">
              <div className="text-xl font-bold text-slate-100 leading-none tabular-nums">{total.toLocaleString('pt-BR')}</div>
              <div className="text-xs text-slate-400 mt-1">
                {total === 1 ? 'lead' : 'leads'}{loading ? '…' : ''}
              </div>
            </div>
          )}
        </div>

        {/* Tabela */}
        <div className="flex-1 min-h-0 overflow-auto">
          {useFallback ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-500 gap-2">
              <span className="text-sm font-medium text-slate-400">Sem conexão com os dados.</span>
              <span className="text-xs">Verifique a conexão com o Supabase.</span>
            </div>
          ) : (
            <table className="w-full text-sm border-separate border-spacing-0">
              <thead className="sticky top-0 z-10">
                <tr className="text-left text-xs uppercase tracking-wide text-slate-400 bg-[var(--bg-elevated)]">
                  <th className="w-10 border-b border-[var(--border)] px-3 py-2.5">
                    <CaixaSelecao marcado={todosDaPaginaSelecionados} onChange={alternarPagina} rotulo="Selecionar todos os leads desta página" />
                  </th>
                  {camposUI.find(c => c.chave === 'empresa')?.visivel !== false && (
                    <th className="font-semibold px-3 py-2.5 border-b border-[var(--border)] whitespace-nowrap">Empresa</th>
                  )}
                  {camposUI.find(c => c.chave === 'contato_nome')?.visivel !== false && (
                    <th className="font-semibold px-3 py-2.5 border-b border-[var(--border)] whitespace-nowrap">Contato</th>
                  )}
                  {camposUI.find(c => c.chave === 'responsavel_id')?.visivel !== false && (
                    <th className="font-semibold px-3 py-2.5 border-b border-[var(--border)] whitespace-nowrap">Responsável</th>
                  )}
                  {camposUI.find(c => c.chave === 'estagio')?.visivel !== false && (
                    <th className="font-semibold px-3 py-2.5 border-b border-[var(--border)] whitespace-nowrap">Status</th>
                  )}
                  <th className="font-semibold px-3 py-2.5 border-b border-[var(--border)] whitespace-nowrap">Follow-up</th>
                  {camposUI.find(c => c.chave === 'score')?.visivel !== false && (
                    <th className="font-semibold px-3 py-2.5 border-b border-[var(--border)] whitespace-nowrap">
                      <button onClick={toggleOrdenarScore}
                        className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-slate-300 transition-colors focus-ring rounded"
                        title="Ordenar por score">
                        Score {ordenarPor ? (ordenarPor.asc ? '↑' : '↓') : '↕'}
                      </button>
                    </th>
                  )}
                  {camposUI.find(c => c.chave === 'data_validade')?.visivel === true && (
                    <th className="font-semibold px-3 py-2.5 border-b border-[var(--border)] whitespace-nowrap">Val. laudo</th>
                  )}
                  {['Cidade/UF', 'Última interação', 'Cadastrado em'].map(h => (
                    <th key={h} className="font-semibold px-3 py-2.5 border-b border-[var(--border)] whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.length === 0 ? (
                  <EstadoTabela colSpan={10} loading={loading} />
                ) : (
                  data.map(lead => {
                    const responsavel = lead.usuarios?.nome ?? lead.responsavel_nome ?? null;
                    const cidadeUf = [lead.cidade, lead.estado].filter(Boolean).join('/');
                    const selecionado = selectedId === lead.id;
                    return (
                      <tr
                        key={lead.id}
                        onClick={() => setSelectedId(lead.id)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedId(lead.id); } }}
                        tabIndex={0}
                        role="button"
                        aria-label={`Abrir ${lead.empresa ?? 'lead'}`}
                        className={`cursor-pointer transition-colors focus-ring ${selecionado ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--bg-card)]'}`}
                      >
                        <td className="w-10 border-b border-[var(--border-subtle)] px-3 py-2.5" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                          <CaixaSelecao
                            marcado={selecionadosCampanha.has(lead.id)}
                            onChange={() => alternarSelecao(lead.id)}
                            rotulo={`Selecionar ${lead.empresa ?? lead.contato_nome ?? 'lead'} para campanha`}
                          />
                        </td>
                        {camposUI.find(c => c.chave === 'empresa')?.visivel !== false && (
                          <td className={`px-3 py-2.5 border-b border-[var(--border-subtle)] font-medium text-slate-100 max-w-56 truncate ${selecionado ? 'border-l-2 border-l-[var(--accent)]' : 'border-l-2 border-l-transparent'}`}>{dash(lead.empresa)}</td>
                        )}
                        {camposUI.find(c => c.chave === 'contato_nome')?.visivel !== false && (
                          <td className="px-3 py-2.5 border-b border-[var(--border-subtle)] max-w-56">
                            <div className="text-slate-300 truncate">{dash(lead.contato_nome)}</div>
                            {lead.contato_email && camposUI.find(c => c.chave === 'contato_email')?.visivel !== false && (
                              <div className="text-xs text-slate-500 truncate">{lead.contato_email}</div>
                            )}
                          </td>
                        )}
                        {camposUI.find(c => c.chave === 'responsavel_id')?.visivel !== false && (
                          <td className="px-3 py-2.5 border-b border-[var(--border-subtle)] text-slate-300 whitespace-nowrap">{dash(responsavel)}</td>
                        )}
                        {camposUI.find(c => c.chave === 'estagio')?.visivel !== false && (
                          <td className="px-3 py-2.5 border-b border-[var(--border-subtle)] whitespace-nowrap">
                            <span className="inline-flex items-center gap-1.5 text-xs text-slate-300">
                              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: corEstagio(lead.estagio) }} />
                              {labelEstagio(lead.estagio)}
                            </span>
                          </td>
                        )}
                        <td className="px-3 py-2.5 border-b border-[var(--border-subtle)] text-slate-300 whitespace-nowrap">{etapaFollowup(lead.followups_enviados)}</td>
                        {camposUI.find(c => c.chave === 'score')?.visivel !== false && (
                          <td className="px-3 py-2.5 border-b border-[var(--border-subtle)] whitespace-nowrap">
                            <span className="inline-flex items-center gap-1.5 text-slate-300 tabular-nums">
                              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: corScore(lead.score) }} />
                              {lead.score ?? '—'}
                            </span>
                          </td>
                        )}
                        {camposUI.find(c => c.chave === 'data_validade')?.visivel === true && (
                          <td className="px-3 py-2.5 border-b border-[var(--border-subtle)] text-slate-300 whitespace-nowrap">
                            {lead.data_validade ? formatDate(lead.data_validade) : '—'}
                          </td>
                        )}
                        <td className="px-3 py-2.5 border-b border-[var(--border-subtle)] text-slate-300 whitespace-nowrap">{dash(cidadeUf)}</td>
                        <td className="px-3 py-2.5 border-b border-[var(--border-subtle)] text-slate-400 whitespace-nowrap">{lead.ultimo_contato ? formatDate(lead.ultimo_contato) : '—'}</td>
                        <td className="px-3 py-2.5 border-b border-[var(--border-subtle)] text-slate-400 whitespace-nowrap">{lead.created_at ? formatDate(lead.created_at) : '—'}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}
        </div>

        <PaginacaoTabela
          total={total}
          page={page}
          pageSize={PAGE}
          loading={loading}
          onPageChange={setPage}
          className="px-4 py-3 shrink-0 border-t border-[var(--border-subtle)]"
        />
      </section>

      {/* Painel lateral completo (componente compartilhado em components/leads) */}
      <LeadPanel
        leadId={selectedId}
        onClose={() => setSelectedId(null)}
        onChanged={() => setReloadKey(k => k + 1)}
        usingSupabase={!useFallback}
        contexto="base"
      />

      {modal === 'novo' && (
        <NovoLeadModal onClose={() => setModal(null)} onCreated={() => setReloadKey(k => k + 1)} />
      )}
      {modal === 'importar' && (
        <ImportarLeadsModal onClose={() => setModal(null)} onImported={() => setReloadKey(k => k + 1)} />
      )}
    </div>
  );
}
