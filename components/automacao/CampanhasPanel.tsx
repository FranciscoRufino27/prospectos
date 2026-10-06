'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Plus, Play, Pause, CheckCircle2, Megaphone, Users, MessageSquare, Coins,
  Search, FileSpreadsheet, PencilLine, ArrowRight, Activity, Info,
  CalendarDays, AlertTriangle, Trash2, Loader2,
} from 'lucide-react';
import ImportarLeadsModal from '@/components/leads/ImportarLeadsModal';
import { estilosModulo, IndicadorModulo } from '@/components/tema/Modulo';
import { type Campanha, STATUS_BADGE, STATUS_LABEL, resumoPublico } from './tiposCampanha';
import { campanhaEhDisparoUnico, labelTipoCampanha } from '@/lib/campanhas/configuracaoGuiada';
import {
  aguardandoRespostasDoDisparo,
  execucoesPendentes,
  progressoCampanha,
  type ProgressoCampanha,
} from '@/lib/campanhas/situacaoDisparo';
import { motivoBloqueioExclusao } from '@/lib/campanhas/exclusao';

// Painel principal da aba Campanhas (mockup 01): KPIs, filtros, tabela densa,
// "Próximas ações" e "Desempenho recente". Dado REAL de /api/campanhas. Métricas
// atribuídas (contatos/respostas/receita/ROI) dependem do vínculo campanha↔
// resultados (campanha_id — fora do escopo desta fase): aparecem como "não
// calculável", nunca inventadas. "Importar leads" reusa o ImportarLeadsModal
// existente (mesma importação da Base de Leads). "Nova campanha" abre o wizard
// em página própria.

const FILTROS = [
  { id: '', label: 'Todas' },
  { id: 'ativa', label: 'Ativas' },
  { id: 'pausada', label: 'Pausadas' },
  { id: 'concluida', label: 'Concluídas' },
] as const;

const ACOES: Record<string, { para: string; label: string; Icon: typeof Play }[]> = {
  rascunho: [{ para: 'ativa', label: 'Ativar', Icon: Play }],
  ativa: [{ para: 'pausada', label: 'Pausar', Icon: Pause }, { para: 'concluida', label: 'Concluir', Icon: CheckCircle2 }],
  pausada: [{ para: 'ativa', label: 'Retomar', Icon: Play }, { para: 'concluida', label: 'Concluir', Icon: CheckCircle2 }],
  concluida: [],
};

const NC = <span className="text-slate-500 text-xs" title="Não calculável — requer vínculo campanha↔resultados (fora do escopo desta fase)">—</span>;

export default function CampanhasPanel() {
  const router = useRouter();
  const [itens, setItens] = useState<Campanha[]>([]);
  const [ativasTotal, setAtivasTotal] = useState(0);
  const [emCadencia, setEmCadencia] = useState<number | null>(null);
  const [naFila, setNaFila] = useState<number | null>(null);
  const [filtro, setFiltro] = useState<string>('');
  const [busca, setBusca] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [negado, setNegado] = useState(false);
  const [importar, setImportar] = useState(false);
  const [apagando, setApagando] = useState<Campanha | null>(null);
  const [confirmacaoExclusao, setConfirmacaoExclusao] = useState('');
  const [excluindo, setExcluindo] = useState(false);
  const [erroExclusao, setErroExclusao] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const qs = filtro ? `?status=${filtro}` : '';
      const [res, resAtivas, resMet] = await Promise.all([
        fetch(`/api/campanhas${qs}`),
        fetch('/api/campanhas?status=ativa'),
        fetch('/api/campanhas/metricas'),
      ]);
      if (res.status === 403) { setNegado(true); setItens([]); return; }
      const r = res.ok ? await res.json() : { campanhas: [] };
      setItens(r.campanhas ?? []);
      const ra = resAtivas.ok ? await resAtivas.json() : { campanhas: [] };
      setAtivasTotal((ra.campanhas ?? []).length);
      const met = resMet.ok ? await resMet.json() : null;
      setEmCadencia(met?.emCadencia ?? null);
      setNaFila(met?.naFila ?? null);
    } catch {
      setItens([]);
    } finally {
      setCarregando(false);
    }
  }, [filtro]);

  useEffect(() => { carregar(); }, [carregar]);

  async function transicionar(id: string, status: string, e: React.MouseEvent) {
    e.stopPropagation();
    await fetch(`/api/campanhas/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
    carregar();
  }

  function abrirExclusao(c: Campanha, e: React.MouseEvent) {
    e.stopPropagation();
    setApagando(c);
    setConfirmacaoExclusao('');
    setErroExclusao(null);
  }

  async function confirmarExclusao() {
    if (!apagando || confirmacaoExclusao !== 'APAGAR') return;
    setExcluindo(true);
    setErroExclusao(null);
    try {
      const res = await fetch(`/api/campanhas/${apagando.id}`, { method: 'DELETE' });
      const dados = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(dados.erro || 'Não foi possível apagar a campanha.');
      setApagando(null);
      carregar();
    } catch (e) {
      setErroExclusao(e instanceof Error ? e.message : 'Não foi possível apagar a campanha.');
    } finally {
      setExcluindo(false);
    }
  }

  const filtrados = useMemo(
    () => itens.filter((c) => !busca.trim() || c.nome.toLowerCase().includes(busca.trim().toLowerCase())),
    [itens, busca],
  );

  // "Próximas ações" derivadas de estado REAL das campanhas.
  const proximas = useMemo(() => {
    const rascunhos = itens.filter((c) => c.status === 'rascunho').length;
    const ativasSemWf = itens.filter((c) => c.status === 'ativa' && !c.workflow_id).length;
    const pausadas = itens.filter((c) => c.status === 'pausada').length;
    return [
      { n: rascunhos, label: 'rascunho(s) aguardando configuração/ativação' },
      { n: ativasSemWf, label: 'ativa(s) sem cadência vinculada' },
      { n: pausadas, label: 'pausada(s) para retomar' },
    ].filter((x) => x.n > 0);
  }, [itens]);

  if (negado) {
    return (
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-10 text-center text-slate-400 text-sm">
        Você não tem permissão para ver campanhas (requer <code className="text-indigo-300">campaigns.view</code>).
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {importar && <ImportarLeadsModal onClose={() => setImportar(false)} onImported={() => setImportar(false)} />}

      {/* Confirmação de exclusão definitiva */}
      {apagando && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm" onClick={() => { if (!excluindo) setApagando(null); }}>
          <div role="dialog" aria-modal="true" aria-labelledby="apagar-campanha-titulo" onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md space-y-4 rounded-2xl border border-red-500/30 bg-[var(--bg-card)] p-6 shadow-2xl">
            <div className="flex items-center gap-2 text-red-400">
              <Trash2 size={18} />
              <h2 id="apagar-campanha-titulo" className="text-lg font-bold">Apagar campanha</h2>
            </div>
            <p className="text-sm leading-relaxed text-slate-300">
              <b className="text-slate-100">{apagando.nome}</b> será apagada de vez, com os contatos inscritos, a linha do tempo e a cadência interna dela. Não dá para desfazer.
            </p>
            {(apagando.resumoExecucoes?.total ?? 0) > 0 && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs leading-relaxed text-amber-200">
                Deixa de existir o registro de {apagando.resumoExecucoes!.total.toLocaleString('pt-BR')} contato(s) inscrito(s) e {apagando.resumoExecucoes!.emailsEnviados.toLocaleString('pt-BR')} mensagem(ns) enviada(s) por esta campanha.
              </div>
            )}
            <p className="text-xs text-slate-500">Leads, o histórico de cada lead e as tarefas continuam.</p>
            <div>
              <label htmlFor="confirmar-exclusao" className="mb-1.5 block text-xs text-slate-400">
                Para confirmar, digite <code className="rounded bg-red-500/20 px-1 text-red-300">APAGAR</code>
              </label>
              <input id="confirmar-exclusao" type="text" value={confirmacaoExclusao} onChange={(e) => setConfirmacaoExclusao(e.target.value)}
                placeholder="APAGAR" autoFocus disabled={excluindo}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-base)] px-3 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:border-red-500/60 focus:outline-none" />
            </div>
            {erroExclusao && (
              <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-xs text-red-300">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {erroExclusao}
              </div>
            )}
            <div className="flex gap-3 pt-1">
              <button type="button" onClick={() => setApagando(null)} disabled={excluindo}
                className="flex-1 rounded-lg border border-[var(--border)] px-4 py-2.5 text-sm text-slate-300 transition-colors hover:bg-[var(--bg-base)] disabled:opacity-40">
                Cancelar
              </button>
              <button type="button" onClick={confirmarExclusao} disabled={confirmacaoExclusao !== 'APAGAR' || excluindo}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40">
                {excluindo ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Apagar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Ações do topo */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-400">Ativações sobre um público, executadas pelo motor de Workflows.</p>
        <div className="flex items-center gap-2">
          <button onClick={() => setImportar(true)}
            className="text-sm px-3 py-2 rounded-lg border border-[var(--border)] text-slate-200 hover:bg-[var(--bg-base)] inline-flex items-center gap-1.5">
            <FileSpreadsheet size={14} /> Importar leads
          </button>
          <Link href="/automacao/campanhas/nova"
            className="text-sm px-4 py-2 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-500 inline-flex items-center gap-1">
            <Plus size={15} /> Nova campanha
          </Link>
        </div>
      </div>

      {/* KPIs */}
      <section className={estilosModulo.kpiGrid}>
        <IndicadorModulo tom="violet" icone={Megaphone} rotulo="Campanhas ativas" valor={String(ativasTotal)} detalhe="com status ativa" />
        <IndicadorModulo
          tom="cyan"
          icone={Users}
          rotulo="Contatos em cadência"
          valor={emCadencia != null ? emCadencia.toLocaleString('pt-BR') : '—'}
          detalhe={emCadencia == null ? 'não calculável' : naFila ? `já contatados · ${naFila.toLocaleString('pt-BR')} na fila do 1º envio` : 'já contatados, aguardando o próximo passo'}
        />
        <IndicadorModulo tom="emerald" icone={MessageSquare} rotulo="Respostas" valor="—" detalhe="não calculável" />
        <IndicadorModulo tom="amber" icone={Coins} rotulo="Conversões" valor="—" detalhe="não calculável" />
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-5">
        {/* Campanhas: filtros + tabela */}
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-[var(--border)] flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-slate-200 mr-1">Campanhas</span>
            <div className="flex items-center gap-1">
              {FILTROS.map((f) => (
                <button key={f.id || 'todas'} onClick={() => setFiltro(f.id)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${filtro === f.id ? 'bg-indigo-500/15 text-indigo-300' : 'text-slate-400 hover:text-slate-200'}`}>
                  {f.label}
                </button>
              ))}
            </div>
            <div className="ml-auto relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar campanha…"
                className="w-48 bg-[var(--bg-base)] border border-[var(--border)] rounded-lg pl-7 pr-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500" />
            </div>
          </div>

          {/* Cabeçalho da tabela SEMPRE visível (mesmo vazio) */}
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-[11px] uppercase tracking-wide text-slate-500">
                <th className="text-left font-medium px-5 py-2.5">Campanha</th>
                <th className="text-right font-medium px-3 py-2.5" title="Mensagens que saíram de fato (cada passo da cadência conta; ensaio não conta)">Enviadas</th>
                <th className="text-right font-medium px-3 py-2.5" title="Contatos que responderam, sobre os já contatados">Respostas</th>
                <th className="text-right font-medium px-3 py-2.5" title="E-mails devolvidos (endereço inexistente, bloqueio, caixa cheia), sobre os já contatados. Acima de 2% pede atenção; acima de 5% prejudica a reputação da conta de envio.">Devoluções</th>
                <th className="text-left font-medium px-3 py-2.5">Status</th>
                <th className="px-5 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {carregando ? (
                <tr><td colSpan={6} className="px-5 py-10 text-center text-slate-500 text-sm">Carregando…</td></tr>
              ) : filtrados.length === 0 ? (
                <tr><td colSpan={6} className="px-5 py-10 text-center text-slate-500 text-sm">
                  Nenhuma campanha {filtro && `(${STATUS_LABEL[filtro] ?? filtro})`}. Crie a primeira em <b className="text-slate-300">Nova campanha</b>.
                </td></tr>
              ) : filtrados.map((c) => {
                const resumo = c.resumoExecucoes;
                const progresso = resumo ? progressoCampanha(resumo) : null;
                const comErro = (resumo?.erros ?? 0) > 0;
                const pendentes = execucoesPendentes(resumo);
                const emEnsaio = c.dry_run !== false;
                const aguardandoResposta = aguardandoRespostasDoDisparo({
                  disparoUnico: campanhaEhDisparoUnico(c.tipo),
                  status: c.status,
                  emEnsaio,
                  resumo,
                });
                return (
                <tr key={c.id} onClick={() => router.push(`/automacao/campanhas/${c.id}`)}
                  className={`border-b last:border-0 align-top hover:bg-[var(--bg-base)] transition-colors cursor-pointer ${comErro ? 'border-red-500/25 bg-red-500/[0.04]' : 'border-[var(--border)]'}`}>
                  <td className="px-5 py-3.5 min-w-[280px]">
                    <div className="flex items-center gap-2">
                      {comErro && <AlertTriangle size={14} className="shrink-0 text-red-400" />}
                      <span className="font-semibold text-slate-100">{c.nome}</span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500">
                      {[labelTipoCampanha(c.tipo), resumoPublico(c.publico)].filter(Boolean).join(' · ')}
                    </div>
                    {progresso && progresso.total > 0 && <ProgressoContatos p={progresso} />}
                  </td>
                  <td className="px-3 py-3.5 text-right">
                    {resumo ? (
                      <>
                        <div className="text-base font-bold text-slate-100 tabular-nums">{resumo.emailsEnviados.toLocaleString('pt-BR')}</div>
                        <div className="text-[11px] text-slate-500">{emEnsaio && resumo.emailsEnviados === 0 && resumo.total > 0 ? 'em ensaio' : 'e-mails'}</div>
                      </>
                    ) : NC}
                  </td>
                  <td className="px-3 py-3.5 text-right">
                    {progresso ? (
                      <>
                        <div className="text-base font-bold text-slate-100 tabular-nums">{(resumo?.respostas ?? 0).toLocaleString('pt-BR')}</div>
                        <div className="text-[11px] text-slate-500">{progresso.taxaResposta === null ? '—' : pct(progresso.taxaResposta)}</div>
                      </>
                    ) : NC}
                  </td>
                  <td className="px-3 py-3.5 text-right">
                    {progresso ? (
                      <>
                        <div className={`text-base font-bold tabular-nums ${COR_DEVOLUCAO[progresso.nivelDevolucao]}`}>{progresso.devolvidos.toLocaleString('pt-BR')}</div>
                        <div className={`text-[11px] ${progresso.nivelDevolucao === 'ok' ? 'text-slate-500' : COR_DEVOLUCAO[progresso.nivelDevolucao]}`}>
                          {progresso.taxaDevolucao === null ? '—' : pct(progresso.taxaDevolucao)}
                        </div>
                      </>
                    ) : NC}
                  </td>
                  <td className="px-3 py-3.5">
                    <div className="flex flex-col items-start gap-1">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full ${aguardandoResposta ? 'bg-indigo-500/15 text-indigo-300' : STATUS_BADGE[c.status] ?? STATUS_BADGE.rascunho}`}>
                        {aguardandoResposta ? 'Aguardando respostas' : STATUS_LABEL[c.status] ?? c.status}
                      </span>
                      {comErro && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-500/15 text-red-300">{resumo!.erros} com erro</span>
                      )}
                      {c.status === 'ativa' && emEnsaio && (
                        <span className="text-[11px] text-amber-400/80" title="Nenhuma mensagem real sai até ativar o envio real">em ensaio</span>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center justify-end gap-1.5">
                      {c.status === 'rascunho' && (
                        <Link href={`/automacao/campanhas/${c.id}/editar`} onClick={(e) => e.stopPropagation()}
                          className="text-xs px-2 py-1.5 rounded-lg bg-[var(--bg-input)] text-slate-200 hover:bg-[var(--bg-card-hover)] inline-flex items-center gap-1">
                          <PencilLine size={12} /> Editar
                        </Link>
                      )}
                      {(ACOES[c.status] ?? []).map(({ para, label, Icon }) => (
                        <button key={para} onClick={(e) => transicionar(c.id, para, e)}
                          className="text-xs px-2.5 py-1.5 rounded-lg bg-[var(--bg-input)] text-slate-200 hover:bg-[var(--bg-card-hover)] inline-flex items-center gap-1 whitespace-nowrap">
                          <Icon size={12} /> {label}
                        </button>
                      ))}
                      {!campanhaEhDisparoUnico(c.tipo) && (c.status === 'ativa' || c.status === 'pausada') && (
                        <Link href={`/automacao/campanhas/${c.id}`} onClick={(e) => e.stopPropagation()}
                          title="Editar agenda" aria-label={`Editar agenda de ${c.nome}`}
                          className="text-xs p-1.5 rounded-lg bg-[var(--bg-input)] text-slate-300 hover:bg-indigo-500/20 hover:text-indigo-200 inline-flex items-center">
                          <CalendarDays size={13} />
                        </Link>
                      )}
                      {(() => {
                        const bloqueio = motivoBloqueioExclusao(c.status, pendentes);
                        // O span segura o clique (botão desabilitado não abre o
                        // detalhe) e mostra o motivo mesmo sem hover no botão.
                        return (
                          <span title={bloqueio ?? 'Apagar registro da campanha'} onClick={(e) => e.stopPropagation()}>
                            <button type="button" onClick={(e) => abrirExclusao(c, e)} disabled={!!bloqueio} aria-label={`Apagar ${c.nome}`}
                              className="text-xs p-1.5 rounded-lg bg-[var(--bg-input)] text-slate-400 hover:bg-red-500/15 hover:text-red-300 inline-flex items-center disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-[var(--bg-input)] disabled:hover:text-slate-400">
                              <Trash2 size={13} />
                            </button>
                          </span>
                        );
                      })()}
                      <ArrowRight size={13} className="text-slate-600" />
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Próximas ações */}
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-5 self-start">
          <h3 className="font-semibold text-slate-200 text-sm mb-3 flex items-center gap-2"><Activity size={15} className="text-indigo-400" /> Próximas ações</h3>
          {proximas.length === 0 ? (
            <p className="text-xs text-slate-500">Nenhuma ação pendente nas campanhas carregadas.</p>
          ) : (
            <ul className="space-y-2.5">
              {proximas.map((p, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-indigo-500/15 text-indigo-300 text-sm font-bold shrink-0">{p.n}</span>
                  <span className="text-xs text-slate-400 pt-1">{p.label}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Desempenho recente */}
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-5">
        <h3 className="font-semibold text-slate-200 text-sm mb-1">Desempenho recente</h3>
        <p className="text-xs text-slate-500 mb-4">Respostas e oportunidades atribuídas às campanhas ao longo do tempo.</p>
        <div className="h-40 rounded-lg bg-[var(--bg-base)] border border-dashed border-[var(--border)] flex items-center justify-center">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Info size={14} className="text-slate-600" />
            Sem desempenho atribuído ainda — requer vínculo campanha↔resultados (fora do escopo desta fase).
          </div>
        </div>
      </div>
    </div>
  );
}

const pct = (v: number) => `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

const COR_DEVOLUCAO: Record<ProgressoCampanha['nivelDevolucao'], string> = {
  ok: 'text-slate-100',
  atencao: 'text-amber-300',
  alto: 'text-red-300',
};

// Barra única dos contatos da campanha: cada contato está em um só segmento.
function ProgressoContatos({ p }: { p: ProgressoCampanha }) {
  const segmentos = [
    { chave: 'concluidos', valor: p.concluidos, cor: 'bg-emerald-400', rotulo: 'concluíram' },
    { chave: 'cadencia', valor: p.emCadencia, cor: 'bg-indigo-400', rotulo: 'na cadência' },
    { chave: 'devolvidos', valor: p.devolvidos, cor: p.nivelDevolucao === 'alto' ? 'bg-red-400' : 'bg-amber-400', rotulo: p.devolvidos === 1 ? 'devolvido' : 'devolvidos' },
    { chave: 'sairam', valor: p.sairam, cor: 'bg-slate-400', rotulo: 'saíram (resposta/descadastro)' },
    { chave: 'erros', valor: p.erros, cor: 'bg-red-500', rotulo: 'com erro' },
    { chave: 'fila', valor: p.naFila, cor: 'bg-white/[0.14]', rotulo: 'na fila do 1º envio' },
  ].filter((s) => s.valor > 0);
  return (
    <div className="mt-2.5 max-w-[420px]">
      <div className="flex items-center gap-2">
        <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-white/[0.06]" role="img"
          aria-label={segmentos.map((s) => `${s.valor} ${s.rotulo}`).join(', ')}>
          {segmentos.map((s) => (
            <div key={s.chave} className={`h-full ${s.cor}`} style={{ width: `${(s.valor / p.total) * 100}%` }} />
          ))}
        </div>
        <span className="text-[11px] tabular-nums text-slate-400 whitespace-nowrap">
          <b className="font-semibold text-slate-200">{p.contatados.toLocaleString('pt-BR')}</b>/{p.total.toLocaleString('pt-BR')} contatados
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
        {segmentos.map((s) => (
          <span key={s.chave} className="inline-flex items-center gap-1">
            <span className={`h-1.5 w-1.5 rounded-full ${s.cor}`} />
            <span className="tabular-nums text-slate-300">{s.valor.toLocaleString('pt-BR')}</span> {s.rotulo}
          </span>
        ))}
      </div>
    </div>
  );
}
