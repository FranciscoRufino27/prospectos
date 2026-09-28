'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { getPipelineFiltrosOpcoes } from '@/lib/api';
import PipelineColumn, { type LeadArrastado } from '@/components/pipeline/PipelineColumn';
import MoverLeadModal, { type MovimentoPendente } from '@/components/pipeline/MoverLeadModal';
import GlobalFilters, { type GlobalFilterState } from '@/components/pipeline/GlobalFilters';
import CadenciaView from '@/components/pipeline/cadencia/CadenciaView';
import ListaView from '@/components/pipeline/lista/ListaView';
import CentralRespostasView from '@/components/pipeline/respostas/CentralRespostasView';
import LeadPanel from '@/components/leads/LeadPanel';
import NovoLeadModal from '@/components/leads/NovoLeadModal';
import { COLUNAS_KANBAN } from '@/lib/pipeline-stages';
import { ESTAGIO_DESTINO_POR_COLUNA } from '@/lib/pipeline/mensagemEtapa';
import { estilosModulo as m } from '@/components/tema/Modulo';

// useSearchParams() exige um limite de Suspense (Next) — por isso o conteúdo real
// da página vive em PipelineInner e o default export só o envolve.
export default function PipelinePage() {
  return (
    <Suspense fallback={null}>
      <PipelineInner />
    </Suspense>
  );
}

function PipelineInner() {
  const searchParams = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filtros, setFiltros] = useState<GlobalFilterState>({ search: '', responsavel: '', segmento: '', canal: '' });
  // Tabela é a visão PADRÃO (alto volume de leads); Kanban fica restrito a
  // quem já respondeu/tem interesse/virou oportunidade (COLUNAS_KANBAN).
  const [vista, setVista] = useState<'tabela' | 'comercial' | 'cadencia' | 'respostas'>('cadencia'); // aba do board
  const [filtroOpcoes, setFiltroOpcoes] = useState<{ responsaveis: string[]; segmentos: string[]; canais: string[] }>({ responsaveis: [], segmentos: [], canais: [] });
  const [reloadKey, setReloadKey] = useState(0); // bump -> colunas refazem o fetch (após mutação)
  const [loading, setLoading] = useState(true);
  const [useFallback, setUseFallback] = useState(false);
  const [showNovoLead, setShowNovoLead] = useState(false);
  // Kanban: lead solto em outra coluna aguardando "Apenas mover"/"Mover e enviar".
  const [movimento, setMovimento] = useState<MovimentoPendente | null>(null);
  const [avisoMovimento, setAvisoMovimento] = useState<string | null>(null);

  // Cada PipelineColumn busca os seus leads server-side (paginado + COUNT). No
  // mount só fazemos uma sonda leve — carregar as opções dos filtros — que também
  // serve de teste de conexão com o Supabase.
  const bumpReload = useCallback(() => setReloadKey(k => k + 1), []);

  const aoSoltarLead = useCallback((colunaId: string, lead: LeadArrastado) => {
    const para = ESTAGIO_DESTINO_POR_COLUNA[colunaId];
    if (!para) return;
    setMovimento({ leadId: lead.id, empresa: lead.empresa, de: lead.estagio, para });
  }, []);

  useEffect(() => {
    if (!avisoMovimento) return;
    const t = setTimeout(() => setAvisoMovimento(null), 6000);
    return () => clearTimeout(t);
  }, [avisoMovimento]);

  useEffect(() => {
    getPipelineFiltrosOpcoes()
      .then(opts => { setFiltroOpcoes(opts); setLoading(false); })
      .catch(err => { console.error('Erro ao carregar pipeline:', err); setUseFallback(true); setLoading(false); });
  }, []);

  // Deep-link: /pipeline?lead=<id> (ex.: botão do e-mail de tarefa) já abre o
  // LeadPanel daquele lead. searchParams é estável, então roda uma vez; não
  // reabre sozinho quando o usuário fecha o painel manualmente.
  useEffect(() => {
    const leadParam = searchParams.get('lead');
    if (leadParam) setSelectedId(leadParam);
  }, [searchParams]);

  // Supabase é fonte ativa quando carregou sem erro (mesmo que vazio)
  const usingSupabase = !useFallback && !loading;

  return (
    // Paleta do tema dos módulos: as visões pintam com tokens e com os tons
    // azul-marinho dos próprios módulos CSS.
    <div className={`${m.cores} h-screen flex flex-col overflow-hidden`}>
      {vista === 'cadencia' ? (
        <CadenciaView
          filtros={filtros}
          onFiltrosChange={setFiltros}
          responsaveis={filtroOpcoes.responsaveis}
          segmentos={filtroOpcoes.segmentos}
          canais={filtroOpcoes.canais}
          selectedId={selectedId}
          onSelect={setSelectedId}
          reloadKey={reloadKey}
          loading={loading}
          usingSupabase={usingSupabase}
          onOpenList={() => setVista('tabela')}
          onOpenKanban={() => setVista('comercial')}
          onOpenRespostas={() => setVista('respostas')}
          onNovoContato={() => setShowNovoLead(true)}
        />
      ) : vista === 'respostas' ? (
        <CentralRespostasView
          filtros={filtros}
          onFiltrosChange={setFiltros}
          responsaveis={filtroOpcoes.responsaveis}
          segmentos={filtroOpcoes.segmentos}
          onAbrirLead={setSelectedId}
          reloadKey={reloadKey}
          loading={loading}
          usingSupabase={usingSupabase}
          onOpenCadencia={() => setVista('cadencia')}
          onOpenLista={() => setVista('tabela')}
          onOpenKanban={() => setVista('comercial')}
          onNovoContato={() => setShowNovoLead(true)}
        />
      ) : vista === 'tabela' ? (
        <ListaView
          filtros={filtros}
          onFiltrosChange={setFiltros}
          responsaveis={filtroOpcoes.responsaveis}
          segmentos={filtroOpcoes.segmentos}
          canais={filtroOpcoes.canais}
          selectedId={selectedId}
          onSelect={setSelectedId}
          reloadKey={reloadKey}
          loading={loading}
          usingSupabase={usingSupabase}
          onOpenCadencia={() => setVista('cadencia')}
          onOpenKanban={() => setVista('comercial')}
          onOpenRespostas={() => setVista('respostas')}
          onNovoContato={() => setShowNovoLead(true)}
        />
      ) : (<>
      {/* Header */}
      <div className="px-6 pt-6 pb-3 flex items-start justify-between shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Pipeline de Contato</h1>
          <p className="text-sm text-slate-400 mt-0.5">Quem já respondeu. Arraste um lead para outra coluna para mover — com ou sem a mensagem da etapa.</p>
        </div>
      </div>

      {/* Filtros globais + abas (as mesmas das outras visões) */}
      <div className="px-6 pb-3 flex items-center gap-2 flex-wrap shrink-0">
        {/* Aba: forma de VISUALIZAR os mesmos leads. O Kanban só mostra quem já
            respondeu/tem interesse/virou oportunidade (ver COLUNAS_KANBAN). */}
        <div className="flex items-center rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-0.5">
          {([
            { id: 'cadencia', label: 'Cadência' },
            { id: 'tabela', label: 'Lista' },
            { id: 'comercial', label: 'Kanban' },
            { id: 'respostas', label: 'Central de Respostas' },
          ] as const).map(v => (
            <button
              key={v.id}
              type="button"
              aria-pressed={vista === v.id}
              onClick={() => setVista(v.id)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                vista === v.id ? 'bg-indigo-500/20 text-indigo-300' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <GlobalFilters
          value={filtros}
          onChange={setFiltros}
          responsaveis={filtroOpcoes.responsaveis}
          segmentos={filtroOpcoes.segmentos}
          canais={filtroOpcoes.canais}
        />
      </div>

      {/* Área principal — ocupa o resto da altura; o scroll é por coluna */}
      <div className="flex-1 min-h-0">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-slate-500">
            <Loader2 size={18} className="animate-spin" />
            <span className="text-sm">Carregando leads...</span>
          </div>
        ) : !usingSupabase ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-500 gap-2">
            <span className="text-sm font-medium text-slate-400">Sem conexão com os dados.</span>
            <span className="text-xs">Verifique a conexão com o Supabase.</span>
          </div>
        ) : (
          /* Visão KANBAN: só quem já respondeu, tem interesse ou virou
             oportunidade (COLUNAS_KANBAN) — Novos Leads/Em Prospecção ficam
             só na Lista, que aguenta o volume. */
          <div className="h-full flex gap-4 overflow-x-auto px-6 pb-4">
            {COLUNAS_KANBAN.map(col => (
              <PipelineColumn
                key={col.id}
                stage={col}
                filtros={filtros}
                selectedId={selectedId}
                onSelect={setSelectedId}
                reloadKey={reloadKey}
                comFiltroData={col.tipo === 'reservatorio'}
                onSoltar={(lead) => aoSoltarLead(col.id, lead)}
              />
            ))}
          </div>
        )}
      </div>
      </>)}

      {/* Painel lateral completo do lead (compartilhado com a Base de Leads) */}
      <LeadPanel
        leadId={selectedId}
        onClose={() => setSelectedId(null)}
        onChanged={bumpReload}
        usingSupabase={usingSupabase}
        contexto="pipeline"
      />

      {showNovoLead && (
        <NovoLeadModal
          onClose={() => setShowNovoLead(false)}
          onCreated={bumpReload}
        />
      )}

      {movimento && (
        <MoverLeadModal
          movimento={movimento}
          onFechar={() => setMovimento(null)}
          onConcluido={(aviso) => { setMovimento(null); setAvisoMovimento(aviso); bumpReload(); }}
        />
      )}

      {avisoMovimento && (
        <div role="status" className="fixed bottom-5 right-5 z-50 max-w-sm rounded-xl border border-[var(--m-border,#1b68a8)] bg-[var(--m-bg-card,#06213d)] px-4 py-3 text-sm text-slate-100 shadow-2xl">
          {avisoMovimento}
        </div>
      )}
    </div>
  );
}
