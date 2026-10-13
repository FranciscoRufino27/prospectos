'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { CheckCircle2, Clock, Bell, Building2, ListTodo, Activity, Workflow } from 'lucide-react';
import { EsqueletoLinhas } from '@/components/ui/Esqueleto';

// Painel de Execuções — dentro de Automação. As TAREFAS deixaram de ser item de
// sidebar e passam a aparecer contextualmente aqui (geradas por workflows,
// renovações e ações manuais), junto das notificações. Backend preservado
// (/api/tarefas, /api/notificacoes — tabelas validadas em 10/08).

interface Tarefa {
  id: string;
  titulo: string;
  tipo: string | null;
  status: string;
  prioridade: string;
  prazo_em: string | null;
  origem: string | null;
  motivo: string | null;
  lead_id: string | null;
  criado_em: string;
  empresas?: { nome: string | null } | { nome: string | null }[] | null;
}
interface Notificacao {
  id: string; titulo: string | null; mensagem: string | null; origem: string | null; link: string | null; lida: boolean; criado_em: string;
}
interface Execucao {
  id: string; status: string; passo_atual: number; proxima_verificacao_em: string | null;
  iniciado_em: string; atualizado_em: string;
  workflow_id: string; workflow_nome: string | null; lead_id: string | null; lead_empresa: string | null;
}

const COR_EXEC: Record<string, string> = {
  em_andamento: 'bg-sky-500/15 text-sky-300',
  aguardando: 'bg-amber-500/15 text-amber-400',
  concluido: 'bg-green-500/15 text-green-400',
  erro: 'bg-red-500/15 text-red-400',
  cancelado: 'bg-slate-500/15 text-slate-400',
};

function nomeEmpresa(t: Tarefa): string | null {
  const e = t.empresas;
  if (!e) return null;
  return Array.isArray(e) ? (e[0]?.nome ?? null) : (e.nome ?? null);
}
function fmt(d: string | null): string {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('pt-BR'); } catch { return '—'; }
}
const COR_PRIORIDADE: Record<string, string> = {
  alta: 'bg-red-500/15 text-red-400', media: 'bg-amber-500/15 text-amber-400', baixa: 'bg-slate-500/15 text-slate-400',
};
const FILTROS = [
  { id: 'aberta', label: 'Abertas' },
  { id: 'em_andamento', label: 'Em andamento' },
  { id: 'concluida', label: 'Concluídas' },
  { id: '', label: 'Todas' },
] as const;

export default function ExecucoesPanel() {
  const [tarefas, setTarefas] = useState<Tarefa[]>([]);
  const [notificacoes, setNotificacoes] = useState<Notificacao[]>([]);
  const [execucoes, setExecucoes] = useState<Execucao[]>([]);
  const [filtro, setFiltro] = useState<string>('aberta');
  const [carregando, setCarregando] = useState(true);
  const [carregandoExec, setCarregandoExec] = useState(true);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const qs = filtro ? `?status=${filtro}` : '';
      const [rt, rn] = await Promise.all([
        fetch(`/api/tarefas${qs}`).then((r) => (r.ok ? r.json() : { tarefas: [] })),
        fetch('/api/notificacoes').then((r) => (r.ok ? r.json() : { notificacoes: [] })),
      ]);
      setTarefas(rt.tarefas ?? []);
      setNotificacoes(rn.notificacoes ?? []);
    } catch {
      setTarefas([]); setNotificacoes([]);
    } finally {
      setCarregando(false);
    }
  }, [filtro]);

  useEffect(() => { carregar(); }, [carregar]);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/workflows/execucoes');
        const data = r.ok ? await r.json() : { execucoes: [] };
        setExecucoes(data.execucoes ?? []);
      } catch {
        setExecucoes([]);
      } finally {
        setCarregandoExec(false);
      }
    })();
  }, []);

  async function concluir(id: string) {
    await fetch(`/api/tarefas/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'concluida' }),
    });
    carregar();
  }

  return (
    <div className="space-y-6">
      {/* Execuções de workflow — dado real de workflow_execucoes */}
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--border)] flex items-center gap-2 text-slate-200 font-semibold text-sm">
          <Activity size={15} className="text-indigo-400" /> Execuções de workflow
          {!carregandoExec && <span className="text-xs font-normal text-slate-500">· {execucoes.length}</span>}
        </div>
        {carregandoExec ? (
          <EsqueletoLinhas linhas={4} className="p-6" />
        ) : execucoes.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-sm">Nenhuma execução de workflow ainda.</div>
        ) : (
          <ul className="divide-y divide-[var(--border)] max-h-[40vh] overflow-auto">
            {execucoes.map((e) => (
              <li key={e.id} className="px-5 py-3 flex items-start gap-3 hover:bg-[var(--bg-base)] transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link href={`/workflows/${e.workflow_id}`} className="font-medium text-slate-100 hover:text-indigo-300 inline-flex items-center gap-1">
                      <Workflow size={12} className="text-indigo-400" /> {e.workflow_nome ?? 'Workflow'}
                    </Link>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${COR_EXEC[e.status] ?? COR_EXEC.em_andamento}`}>{e.status}</span>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
                    {e.lead_empresa && <span className="inline-flex items-center gap-1"><Building2 size={11} /> {e.lead_empresa}</span>}
                    <span>passo {e.passo_atual}</span>
                    {e.proxima_verificacao_em && <span className="inline-flex items-center gap-1"><Clock size={11} /> próx. {fmt(e.proxima_verificacao_em)}</span>}
                    <span>· atualizado {fmt(e.atualizado_em)}</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Tarefas geradas por execuções */}
      <div className="lg:col-span-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--border)] flex items-center gap-2">
          <ListTodo size={15} className="text-indigo-400" />
          <span className="text-sm font-semibold text-slate-200 mr-2">Tarefas</span>
          <div className="flex items-center gap-1">
            {FILTROS.map((f) => (
              <button key={f.id || 'todas'} onClick={() => setFiltro(f.id)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${filtro === f.id ? 'bg-indigo-500/15 text-indigo-300' : 'text-slate-400 hover:text-slate-200'}`}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
        {carregando ? (
          <EsqueletoLinhas linhas={5} className="p-6" />
        ) : tarefas.length === 0 ? (
          <div className="p-10 text-center text-slate-500 text-sm">Nenhuma tarefa.</div>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {tarefas.map((t) => {
              const emp = nomeEmpresa(t);
              const vencida = t.prazo_em && new Date(t.prazo_em) < new Date() && t.status !== 'concluida';
              return (
                <li key={t.id} className="px-5 py-3 flex items-start gap-3 hover:bg-[var(--bg-base)] transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-slate-100">{t.titulo}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${COR_PRIORIDADE[t.prioridade] ?? COR_PRIORIDADE.baixa}`}>{t.prioridade}</span>
                      {t.origem && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--bg-input)] text-slate-400">{t.origem}</span>}
                      {t.status === 'concluida' && <span className="text-[10px] text-green-400 inline-flex items-center gap-1"><CheckCircle2 size={11} /> concluída</span>}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
                      {emp && <span className="inline-flex items-center gap-1"><Building2 size={11} /> {emp}</span>}
                      <span className={`inline-flex items-center gap-1 ${vencida ? 'text-red-400' : ''}`}><Clock size={11} /> prazo {fmt(t.prazo_em)}</span>
                      {t.motivo && <span className="truncate">· {t.motivo}</span>}
                    </div>
                  </div>
                  {t.status !== 'concluida' && t.status !== 'cancelada' && (
                    <button onClick={() => concluir(t.id)}
                      className="shrink-0 text-xs px-2.5 py-1.5 rounded-lg bg-green-600/20 text-green-300 hover:bg-green-600/30 transition-colors inline-flex items-center gap-1">
                      <CheckCircle2 size={13} /> Concluir
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Notificações */}
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--border)] flex items-center gap-2 text-slate-200 font-semibold text-sm">
          <Bell size={15} className="text-indigo-400" /> Notificações
        </div>
        {notificacoes.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-sm">Sem notificações.</div>
        ) : (
          <ul className="divide-y divide-[var(--border)] max-h-[70vh] overflow-auto">
            {notificacoes.map((n) => (
              <li key={n.id} className="px-5 py-3">
                <div className="text-sm text-slate-200">{n.titulo ?? 'Notificação'}</div>
                {n.mensagem && <div className="text-xs text-slate-400 mt-0.5">{n.mensagem}</div>}
                <div className="text-[10px] text-slate-600 mt-1">{n.origem ?? ''} · {fmt(n.criado_em)}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
      </div>
    </div>
  );
}
