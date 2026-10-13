'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import {
  BrainCircuit, Send, MessageSquare, CalendarCheck, TrendingUp, Repeat,
  Radio, Layers, Trophy, Save, Download, FlaskConical,
} from 'lucide-react';
import EmptyState from '@/components/charts/EmptyState';
import ChartContainer from '@/components/charts/ChartContainer';
import ChartTooltip from '@/components/charts/ChartTooltip';
import { SdrPill } from '@/components/ui/SdrAvatar';
import { estilosModulo, IndicadorModulo, PaginaModulo } from '@/components/tema/Modulo';
import { getEstagioPipelineLabel } from '@/lib/utils';
import type { EstagioPipeline } from '@/lib/types';
import { getDadosInteligenciaComercial } from '@/lib/api';
import type { LeadIC, InteracaoIC, FiltrosIC, TemplateVarianteIC } from '@/lib/inteligencia';
import {
  FILTROS_IC_PADRAO, filtrarLeads, calcularKpis, evolucao, performancePorCanal,
  respostasPorFollowup, topLeadsPorResposta, opcoesFiltro, taxaRespostaPorVariante,
} from '@/lib/inteligencia';

export default function InteligenciaComercialPage() {
  return (
    <PaginaModulo grupo="Visão" titulo="Inteligência Comercial" subtitulo="Análises detalhadas da sua prospecção.">
      <div className="animate-in">
        <Analises />
      </div>
    </PaginaModulo>
  );
}

const PERIODOS: { label: string; dias: number | null }[] = [
  { label: 'Últimos 7 dias', dias: 7 },
  { label: 'Últimos 30 dias', dias: 30 },
  { label: 'Últimos 90 dias', dias: 90 },
  { label: 'Todo o período', dias: null },
];

// Select reutilizável dos filtros. Quando não há opções (ex.: nicho/região que os
// leads importados não têm), fica desabilitado com um aviso — honesto, não some.
function FiltroSelect({
  label, value, options, onChange, vazioMsg,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  vazioMsg?: string;
}) {
  const vazio = options.length === 0;
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={vazio}
      title={vazio ? vazioMsg : undefined}
      className="text-sm border border-[var(--border)] rounded-lg px-3 py-2 bg-[var(--bg-card)] text-slate-300 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <option value="">{vazio && vazioMsg ? vazioMsg : `Todos — ${label}`}</option>
      {options.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  );
}

// Botão "em breve": presente mas desabilitado, com tooltip — nunca botão morto
// sem indicação (regra do item 5).
function BotaoEmBreve({ Icon, children }: { Icon: typeof Save; children: React.ReactNode }) {
  return (
    <button
      type="button"
      disabled
      title="Em breve"
      className="flex items-center gap-1.5 text-sm text-slate-400 border border-[var(--border)] rounded-lg px-3 py-2 bg-[var(--bg-card)] opacity-50 cursor-not-allowed"
    >
      <Icon size={14} /> {children}
    </button>
  );
}

const CANAL_CORES: Record<string, string> = {
  email: '#6366f1', whatsapp: '#22c55e', linkedin: '#3b82f6', telefone: '#a855f7',
};

function Analises() {
  const [leads, setLeads] = useState<LeadIC[]>([]);
  const [interacoes, setInteracoes] = useState<InteracaoIC[]>([]);
  const [templates, setTemplates] = useState<TemplateVarianteIC[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(false);
  const [filtros, setFiltros] = useState<FiltrosIC>(FILTROS_IC_PADRAO);

  useEffect(() => {
    getDadosInteligenciaComercial()
      .then(({ leads, interacoes, templates }) => { setLeads(leads); setInteracoes(interacoes); setTemplates(templates); })
      .catch((e) => { console.error('Erro ao carregar Inteligência Comercial:', e); setErro(true); })
      .finally(() => setLoading(false));
  }, []);

  // A/B de templates (item 6): cumulativo (não filtra por período — a taxa por
  // variante acumula ao longo do tempo). Usa todos os leads + interações.
  const variantes = useMemo(
    () => taxaRespostaPorVariante(leads, interacoes, templates),
    [leads, interacoes, templates],
  );

  // Opções de filtro derivam de TODOS os leads (não do recorte já filtrado).
  const opcoes = useMemo(() => opcoesFiltro(leads), [leads]);

  // Recorte + agregações recalculam a cada mudança de filtro (em memória, sem refetch).
  const leadsFiltrados = useMemo(() => filtrarLeads(leads, filtros), [leads, filtros]);
  const kpis = useMemo(() => calcularKpis(leadsFiltrados), [leadsFiltrados]);
  const serieEvolucao = useMemo(() => evolucao(interacoes, filtros.periodoDias), [interacoes, filtros.periodoDias]);
  const canais = useMemo(() => performancePorCanal(leadsFiltrados), [leadsFiltrados]);
  const respFollowup = useMemo(() => respostasPorFollowup(leadsFiltrados), [leadsFiltrados]);
  const topLeads = useMemo(() => topLeadsPorResposta(leadsFiltrados), [leadsFiltrados]);

  const set = (patch: Partial<FiltrosIC>) => setFiltros((f) => ({ ...f, ...patch }));

  // Erro de conexão OU base totalmente vazia: estado vazio honesto (não zera KPIs).
  if (erro || (!loading && leads.length === 0)) {
    return (
      <div className="card p-5">
        <EmptyState
          icon={BrainCircuit}
          title={erro ? 'Não foi possível carregar os dados' : 'Nenhum lead na base ainda'}
          description={erro
            ? 'Houve um erro ao conectar com o banco. Tente recarregar a página.'
            : 'Assim que houver leads e envios do motor, as análises aparecem aqui automaticamente.'}
          className="py-16"
        />
      </div>
    );
  }

  const temEvolucao = serieEvolucao.some((p) => p.prospectados || p.respostas || p.reunioes);

  return (
    <div className="space-y-5">
      {/* Filtros */}
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={String(filtros.periodoDias ?? 'null')}
          onChange={(e) => set({ periodoDias: e.target.value === 'null' ? null : Number(e.target.value) })}
          className="text-sm border border-[var(--border)] rounded-lg px-3 py-2 bg-[var(--bg-card)] text-slate-300 focus:outline-none"
        >
          {PERIODOS.map((p) => (
            <option key={p.label} value={String(p.dias ?? 'null')}>{p.label}</option>
          ))}
        </select>
        <FiltroSelect label="nichos" value={filtros.segmento ?? ''} options={opcoes.segmentos}
          onChange={(v) => set({ segmento: v || null })} vazioMsg="Nicho indisponível nos leads" />
        <FiltroSelect label="canais" value={filtros.canal ?? ''} options={opcoes.canais}
          onChange={(v) => set({ canal: v || null })} />
        <FiltroSelect label="responsáveis" value={filtros.responsavel ?? ''} options={opcoes.responsaveis}
          onChange={(v) => set({ responsavel: v || null })} />
        <FiltroSelect label="regiões" value={filtros.estado ?? ''} options={opcoes.estados}
          onChange={(v) => set({ estado: v || null })} vazioMsg="Região indisponível nos leads" />
        <div className="ml-auto flex items-center gap-2">
          <BotaoEmBreve Icon={Save}>Salvar visão</BotaoEmBreve>
          <BotaoEmBreve Icon={Download}>Exportar</BotaoEmBreve>
        </div>
      </div>

      {/* KPIs */}
      <section className={`${estilosModulo.kpiGrid} ${estilosModulo.kpiGrid5}`}>
        <IndicadorModulo tom="violet" icone={Send} rotulo="Leads prospectados"
          valor={loading ? '—' : kpis.prospectados}
          detalhe={loading ? 'Carregando…' : 'no recorte dos filtros'} />
        <IndicadorModulo tom="emerald" icone={MessageSquare} rotulo="Responderam"
          valor={loading ? '—' : kpis.responderam}
          detalhe={loading ? 'Carregando…' : kpis.prospectados
            ? `${Math.round((kpis.responderam / kpis.prospectados) * 100)}% dos prospectados`
            : 'sem prospectados no recorte'} />
        <IndicadorModulo tom="amber" icone={CalendarCheck} rotulo="Reuniões agendadas"
          valor={loading ? '—' : kpis.reunioes}
          detalhe={loading ? 'Carregando…' : 'leads no estágio de reunião'} />
        <IndicadorModulo tom="cyan" icone={TrendingUp} rotulo="Conversão geral"
          valor={loading ? '—' : `${kpis.conversao.toLocaleString('pt-BR')}%`}
          detalhe={loading ? 'Carregando…' : 'ganhos ÷ prospectados'} />
        <IndicadorModulo tom="blue" icone={Repeat} rotulo="Follow-ups realizados"
          valor={loading ? '—' : kpis.followups}
          detalhe={loading ? 'Carregando…' : 'enviados aos leads do recorte'} />
      </section>

      {/* Evolução da prospecção */}
      <ChartContainer
        title="Evolução da prospecção"
        icon={TrendingUp}
        iconColor="text-indigo-500"
        loading={loading}
        empty={!temEvolucao}
        emptyTitle="Sem atividade no período"
        emptyDescription="Prospecções, respostas e reuniões aparecem aqui conforme o motor registra as interações."
        skeletonHeight={220}
      >
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={serieEvolucao} margin={{ left: -10 }}>
            <defs>
              <linearGradient id="icProsp" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.14} /><stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="icResp" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#22c55e" stopOpacity={0.14} /><stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="icReun" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.14} /><stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#17496e" />
            <XAxis dataKey="dia" tick={{ fontSize: 10 }} interval="preserveStartEnd" minTickGap={24} />
            <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
            <Tooltip content={<ChartTooltip />} />
            <Legend iconType="circle" iconSize={8} formatter={(v) => <span style={{ fontSize: 11, color: '#64748b' }}>{v}</span>} />
            <Area type="monotone" dataKey="prospectados" stroke="#6366f1" strokeWidth={2} fill="url(#icProsp)" name="Prospectados" dot={false} isAnimationActive animationDuration={800} />
            <Area type="monotone" dataKey="respostas" stroke="#22c55e" strokeWidth={2} fill="url(#icResp)" name="Respostas" dot={false} isAnimationActive animationDuration={800} />
            <Area type="monotone" dataKey="reunioes" stroke="#f59e0b" strokeWidth={2} fill="url(#icReun)" name="Reuniões" dot={false} isAnimationActive animationDuration={800} />
          </AreaChart>
        </ResponsiveContainer>
      </ChartContainer>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Performance por canal */}
        <ChartContainer
          title="Performance por canal"
          icon={Radio}
          iconColor="text-indigo-500"
          loading={loading}
          empty={canais.length === 0}
          emptyTitle="Sem canais com prospecção no período"
          skeletonVariant="table"
          skeletonRows={4}
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)]">
                {['Canal', 'Prospectados', 'Responderam', 'Taxa'].map((h) => (
                  <th key={h} className={`py-2 px-2 text-xs text-slate-400 font-medium ${h === 'Canal' ? 'text-left' : 'text-right'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {canais.map((c) => (
                <tr key={c.canal} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--bg-base)] transition-colors">
                  <td className="py-2.5 px-2">
                    <span className="inline-flex items-center gap-2 capitalize text-slate-200">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: CANAL_CORES[c.canal] ?? '#94a3b8' }} />
                      {c.canal}
                    </span>
                  </td>
                  <td className="py-2.5 px-2 text-right text-slate-300">{c.prospectados.toLocaleString('pt-BR')}</td>
                  <td className="py-2.5 px-2 text-right text-slate-300">{c.responderam.toLocaleString('pt-BR')}</td>
                  <td className="py-2.5 px-2 text-right font-semibold text-emerald-400">{c.taxa.toLocaleString('pt-BR')}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ChartContainer>

        {/* Respostas por follow-up */}
        <ChartContainer
          title="Respostas por etapa da cadência"
          icon={Repeat}
          iconColor="text-green-500"
          loading={loading}
          empty={respFollowup.length === 0}
          emptyTitle="Nenhuma resposta registrada ainda"
          emptyDescription="Quando os leads começarem a responder, a distribuição por etapa do follow-up aparece aqui."
          skeletonVariant="bars"
          skeletonRows={4}
        >
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={respFollowup} margin={{ left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#17496e" />
              <XAxis dataKey="etapa" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
              <Tooltip cursor={{ fill: 'rgba(99,102,241,0.08)' }}
                content={<ChartTooltip formatter={(i) => `${i.value} resposta${Number(i.value) === 1 ? '' : 's'}`} />} />
              <Bar dataKey="respostas" fill="#22c55e" name="Respostas" radius={[3, 3, 0, 0]} isAnimationActive animationDuration={800} />
            </BarChart>
          </ResponsiveContainer>
        </ChartContainer>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Por segmento — honesto: os leads importados não têm segmento/região */}
        <ChartContainer
          title="Conversões e reuniões por segmento"
          icon={Layers}
          iconColor="text-indigo-500"
          loading={loading}
          empty={opcoes.segmentos.length === 0}
          emptyTitle="Segmento não disponível nos leads"
          emptyDescription="Os leads importados do HubSpot não trouxeram a coluna de segmento/nicho. Assim que os leads tiverem segmento, o recorte por segmento aparece aqui."
        >
          <SegmentoTabela leads={leadsFiltrados} />
        </ChartContainer>

        {/* Leads com maior índice de resposta */}
        <ChartContainer
          title="Leads com maior índice de resposta"
          icon={Trophy}
          iconColor="text-amber-500"
          loading={loading}
          empty={topLeads.length === 0}
          emptyTitle="Nenhum lead prospectado no período"
          skeletonVariant="table"
          skeletonRows={6}
        >
          <div className="space-y-1.5">
            {topLeads.map((l) => (
              <Link key={l.id} href={`/pipeline?lead=${l.id}`}
                className="flex items-center gap-2 p-2 rounded-lg border border-[var(--border)] hover:bg-[var(--bg-base)] transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-200 truncate">{l.empresa}</div>
                  <div className="text-xs text-slate-500">{getEstagioPipelineLabel(l.estagio as EstagioPipeline)}</div>
                </div>
                <SdrPill name={l.responsavel} />
                <span className="text-sm font-bold tabular-nums w-10 text-right"
                  style={{ color: l.score >= 70 ? '#22c55e' : l.score >= 50 ? '#f59e0b' : '#94a3b8' }}>
                  {l.score}
                </span>
              </Link>
            ))}
          </div>
        </ChartContainer>
      </div>

      {/* A/B de templates — resposta por variante (item 6). Cumulativo. */}
      <ChartContainer
        title="A/B de templates — resposta por variante"
        icon={FlaskConical}
        iconColor="text-fuchsia-400"
        loading={loading}
        empty={variantes.length === 0}
        emptyTitle="Nenhum envio com variante registrada ainda"
        emptyDescription="Crie 2+ variantes de um template (Comercial > Templates) e o motor passa a testá-las por lead automaticamente. A taxa de resposta de cada variante aparece aqui conforme os leads respondem."
        skeletonVariant="table"
        skeletonRows={4}
      >
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)]">
              {['Variante', 'Estágio · Segmento', 'Envios', 'Responderam', 'Taxa'].map((h) => (
                <th key={h} className={`py-2 px-2 text-xs text-slate-400 font-medium ${h === 'Variante' ? 'text-left' : 'text-right'}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {variantes.map((v) => (
              <tr key={v.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--bg-base)] transition-colors">
                <td className="py-2.5 px-2 text-slate-200">{v.nome}</td>
                <td className="py-2.5 px-2 text-slate-400 text-xs">{v.tipo} · {v.nicho ?? 'Genérico'}</td>
                <td className="py-2.5 px-2 text-right text-slate-300">{v.envios.toLocaleString('pt-BR')}</td>
                <td className="py-2.5 px-2 text-right text-slate-300">{v.responderam.toLocaleString('pt-BR')}</td>
                <td className="py-2.5 px-2 text-right font-semibold text-emerald-400">{v.taxa.toLocaleString('pt-BR')}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ChartContainer>
    </div>
  );
}

// Recorte por segmento: só renderiza quando há segmento real. Enquanto a coluna
// vem vazia, o ChartContainer acima já mostra o EmptyState (empty=true).
function SegmentoTabela({ leads }: { leads: LeadIC[] }) {
  const linhas = useMemo(() => {
    const mapa = new Map<string, { reunioes: number; respostas: number }>();
    for (const l of leads) {
      const seg = (l.segmento ?? '').trim();
      if (!seg) continue;
      const r = mapa.get(seg) ?? { reunioes: 0, respostas: 0 };
      if (l.estagio === 'reuniao_agendada') r.reunioes++;
      if (['interessado', 'respondeu', 'com_closer', 'reuniao_agendada', 'ganho'].includes(l.estagio)) r.respostas++;
      mapa.set(seg, r);
    }
    return [...mapa.entries()].map(([segmento, v]) => ({ segmento, ...v })).sort((a, b) => b.respostas - a.respostas);
  }, [leads]);

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-[var(--border)]">
          {['Segmento', 'Responderam', 'Reuniões'].map((h) => (
            <th key={h} className={`py-2 px-2 text-xs text-slate-400 font-medium ${h === 'Segmento' ? 'text-left' : 'text-right'}`}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {linhas.map((l) => (
          <tr key={l.segmento} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--bg-base)] transition-colors">
            <td className="py-2.5 px-2 text-slate-200">{l.segmento}</td>
            <td className="py-2.5 px-2 text-right text-slate-300">{l.respostas}</td>
            <td className="py-2.5 px-2 text-right font-semibold text-amber-400">{l.reunioes}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
