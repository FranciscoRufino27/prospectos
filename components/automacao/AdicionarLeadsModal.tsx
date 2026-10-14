'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Search, UserPlus, X } from 'lucide-react';
import CaixaSelecao from '@/components/prospeccao/CaixaSelecao';
import { STATUS_COMERCIAL_OPCOES, labelEstagio } from '@/lib/pipeline-stages';

// Adiciona leads da base a uma campanha que já está em envio real: filtra,
// mostra empresas e contatos com o motivo de quem não pode entrar, e inscreve
// só os marcados depois da confirmação digitada.

type Motivo = 'excluido_campanha' | 'sem_email' | 'bloqueado' | 'incompativel' | 'duplicado';
interface Candidato {
  id: string; empresa: string | null; contato: string | null; email: string | null;
  segmento: string | null; estagio: string | null; elegivel: boolean; motivo: Motivo | null;
}
interface Previa {
  encontrados: number; jaNaCampanha: number; elegiveis: number; emailsAusentesOuInvalidos: number;
  duplicados: number; bloqueados: number; incompativeis: number; truncado: boolean; candidatos: Candidato[];
}
interface Resultado { inscritos: number; ja_inscritos: number; falhas: number }

const MOTIVO_LABEL: Record<Motivo, string> = {
  excluido_campanha: 'excluído desta campanha',
  sem_email: 'sem e-mail válido',
  bloqueado: 'opt-out, devolvido ou perdido',
  incompativel: 'em outra automação',
  duplicado: 'e-mail repetido',
};

const inputCls = 'w-full rounded-lg border border-[var(--border)] bg-[var(--bg-base)] px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-indigo-500/60 focus:outline-none';

export default function AdicionarLeadsModal({
  campanhaId, onClose, onAdicionados,
}: { campanhaId: string; onClose: () => void; onAdicionados: () => void }) {
  const [estagios, setEstagios] = useState<string[]>(['novos_leads']);
  const [segmento, setSegmento] = useState('');
  const [responsavelId, setResponsavelId] = useState('');
  const [cadastradoDe, setCadastradoDe] = useState('');
  const [cadastradoAte, setCadastradoAte] = useState('');
  const [busca, setBusca] = useState('');
  const [opcoes, setOpcoes] = useState<{ segmentos: string[]; responsaveis: { id: string; nome: string }[] }>({ segmentos: [], responsaveis: [] });

  const [previa, setPrevia] = useState<Previa | null>(null);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [etapa, setEtapa] = useState<'selecao' | 'confirmacao' | 'feito'>('selecao');
  const [confirmacaoTexto, setConfirmacaoTexto] = useState('');
  const [inscrevendo, setInscrevendo] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const requisicao = useRef(0);

  useEffect(() => {
    fetch(`/api/campanhas/${campanhaId}/adicionar-leads`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setOpcoes({ segmentos: d.segmentos ?? [], responsaveis: d.responsaveis ?? [] }); })
      .catch(() => {});
  }, [campanhaId]);

  const buscar = useCallback(async () => {
    const minha = ++requisicao.current;
    setBuscando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/campanhas/${campanhaId}/adicionar-leads/previa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estagios, segmento, responsavelId, cadastradoDe, cadastradoAte, busca }),
      });
      const d = await r.json().catch(() => ({}));
      if (minha !== requisicao.current) return;
      if (!r.ok) { setErro(d.erro || 'Não foi possível buscar os leads.'); setPrevia(null); return; }
      const p = d.previa as Previa;
      setPrevia(p);
      setSelecionados(new Set(p.candidatos.filter((c) => c.elegivel).map((c) => c.id)));
    } catch {
      if (minha === requisicao.current) setErro('Erro de conexão ao buscar os leads.');
    } finally {
      if (minha === requisicao.current) setBuscando(false);
    }
  }, [campanhaId, estagios, segmento, responsavelId, cadastradoDe, cadastradoAte, busca]);

  // Abre já com a busca padrão (novos leads), que é o caso mais comum.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { buscar(); }, []);

  const grupos = useMemo(() => {
    const mapa = new Map<string, Candidato[]>();
    for (const c of previa?.candidatos ?? []) {
      const nome = c.empresa?.trim() || 'Sem empresa';
      mapa.set(nome, [...(mapa.get(nome) ?? []), c]);
    }
    return [...mapa.entries()].sort(([a], [b]) => a.localeCompare(b, 'pt-BR'));
  }, [previa]);

  const elegiveisIds = useMemo(() => (previa?.candidatos ?? []).filter((c) => c.elegivel).map((c) => c.id), [previa]);
  const totalMarcados = elegiveisIds.filter((id) => selecionados.has(id)).length;
  const todosMarcados = elegiveisIds.length > 0 && totalMarcados === elegiveisIds.length;

  function alternar(id: string) {
    setSelecionados((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id); else novo.add(id);
      return novo;
    });
  }
  function alternarEmpresa(contatos: Candidato[]) {
    const ids = contatos.filter((c) => c.elegivel).map((c) => c.id);
    const todos = ids.every((id) => selecionados.has(id));
    setSelecionados((atual) => {
      const novo = new Set(atual);
      for (const id of ids) { if (todos) novo.delete(id); else novo.add(id); }
      return novo;
    });
  }
  function alternarEstagio(valor: string) {
    setEstagios((atual) => (atual.includes(valor) ? atual.filter((e) => e !== valor) : [...atual, valor]));
  }

  async function inscrever() {
    if (confirmacaoTexto !== 'CONFIRMAR' || inscrevendo) return;
    setInscrevendo(true);
    setErro(null);
    try {
      const leadIds = elegiveisIds.filter((id) => selecionados.has(id));
      const r = await fetch(`/api/campanhas/${campanhaId}/adicionar-leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadIds, confirmarQuantidade: leadIds.length }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(d.erro || 'Não foi possível adicionar os leads.'); return; }
      setResultado({ inscritos: d.inscritos ?? 0, ja_inscritos: d.ja_inscritos ?? 0, falhas: d.falhas ?? 0 });
      setEtapa('feito');
      onAdicionados();
    } catch {
      setErro('Erro de conexão ao adicionar os leads.');
    } finally {
      setInscrevendo(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm" onClick={() => !inscrevendo && onClose()}>
      <div
        role="dialog"
        aria-label="Adicionar leads à campanha"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-4xl flex-col rounded-2xl border border-indigo-500/30 bg-[var(--bg-card)] shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-6 py-4">
          <div className="flex items-start gap-3">
            <span className="rounded-lg bg-indigo-500/15 p-2 text-indigo-300"><UserPlus size={20} /></span>
            <div>
              <h2 className="text-lg font-bold text-slate-100">Adicionar leads à campanha</h2>
              <p className="mt-0.5 text-sm text-slate-400">
                Filtre a base, revise as empresas e marque quem entra. O público-base da campanha não muda.
              </p>
            </div>
          </div>
          <button onClick={() => !inscrevendo && onClose()} className="text-slate-500 hover:text-slate-300" aria-label="Fechar"><X size={20} /></button>
        </div>

        {etapa === 'feito' && resultado ? (
          <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <CheckCircle2 size={40} className="text-emerald-400" />
            <p className="font-medium text-slate-100">
              {resultado.inscritos} contato{resultado.inscritos === 1 ? '' : 's'} adicionado{resultado.inscritos === 1 ? '' : 's'} à campanha
            </p>
            <p className="text-sm text-slate-400">
              A 1ª mensagem entra na fila agora, dentro da agenda da campanha.
              {resultado.ja_inscritos > 0 && ` ${resultado.ja_inscritos} já estavam inscritos.`}
            </p>
            {resultado.falhas > 0 && (
              <p className="text-sm text-rose-300">{resultado.falhas} não puderam ser inscritos; revise as execuções da campanha.</p>
            )}
            <button onClick={onClose} className="mt-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500">Fechar</button>
          </div>
        ) : etapa === 'confirmacao' ? (
          <div className="space-y-4 px-6 py-6">
            <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>
                Esta campanha está em <b>envio real</b>. Ao confirmar, <b>{totalMarcados} contato{totalMarcados === 1 ? '' : 's'}</b> entram
                na cadência: a 1ª mensagem vai para a fila agora, 1 a cada 2 minutos, dentro dos dias e horários da campanha, com cópia para o responsável.
              </span>
            </div>
            <p className="text-sm text-slate-300">
              Para confirmar, digite exatamente <code className="rounded bg-red-500/20 px-1 text-red-300">CONFIRMAR</code>.
            </p>
            <input
              type="text"
              value={confirmacaoTexto}
              onChange={(e) => setConfirmacaoTexto(e.target.value)}
              placeholder="CONFIRMAR"
              className={`${inputCls} focus:border-red-500/60`}
              autoFocus
            />
            {erro && <p className="text-sm text-rose-400">{erro}</p>}
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => { setEtapa('selecao'); setConfirmacaoTexto(''); setErro(null); }}
                disabled={inscrevendo}
                className="flex-1 rounded-lg border border-[var(--border)] px-4 py-2.5 text-sm text-slate-300 hover:bg-[var(--bg-base)] disabled:opacity-40"
              >
                Voltar
              </button>
              <button
                onClick={inscrever}
                disabled={confirmacaoTexto !== 'CONFIRMAR' || inscrevendo}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {inscrevendo && <Loader2 size={14} className="animate-spin" />} Inscrever {totalMarcados}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-3 border-b border-[var(--border)] px-6 py-4">
              <div>
                <span className="mb-1.5 block text-xs font-semibold text-slate-400">Status</span>
                <div className="flex flex-wrap gap-1.5">
                  {STATUS_COMERCIAL_OPCOES.map((op) => {
                    const ativo = estagios.includes(op.value);
                    return (
                      <button
                        key={op.value}
                        type="button"
                        onClick={() => alternarEstagio(op.value)}
                        aria-pressed={ativo}
                        className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${ativo ? 'border-indigo-500 bg-indigo-500/15 text-indigo-200' : 'border-[var(--border-strong)] text-slate-500 hover:text-slate-300'}`}
                      >
                        {op.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-400">Segmento</span>
                  <select value={segmento} onChange={(e) => setSegmento(e.target.value)} className={inputCls}>
                    <option value="">Todos</option>
                    {opcoes.segmentos.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-400">Responsável</span>
                  <select value={responsavelId} onChange={(e) => setResponsavelId(e.target.value)} className={inputCls}>
                    <option value="">Todos</option>
                    {opcoes.responsaveis.map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-400">Cadastrado de</span>
                  <input type="date" value={cadastradoDe} onChange={(e) => setCadastradoDe(e.target.value)} className={inputCls} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-400">até</span>
                  <input type="date" value={cadastradoAte} onChange={(e) => setCadastradoAte(e.target.value)} className={inputCls} />
                </label>
              </div>
              <div className="flex gap-2">
                <input
                  type="search"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') buscar(); }}
                  placeholder="Buscar por empresa, contato ou e-mail"
                  className={inputCls}
                />
                <button
                  type="button"
                  onClick={buscar}
                  disabled={buscando}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-40"
                >
                  {buscando ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} Buscar
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
              {erro && <p className="mb-3 text-sm text-rose-400">{erro}</p>}
              {buscando && !previa && (
                <div className="flex items-center gap-2 text-sm text-slate-400"><Loader2 size={14} className="animate-spin" /> Buscando leads…</div>
              )}
              {previa && (
                <>
                  <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
                    <span><b className="text-emerald-300">{previa.elegiveis}</b> podem entrar</span>
                    {previa.jaNaCampanha > 0 && <span><b className="text-slate-200">{previa.jaNaCampanha}</b> já estão nesta campanha (ocultos)</span>}
                    {previa.bloqueados > 0 && <span><b className="text-amber-300">{previa.bloqueados}</b> opt-out/devolvidos/perdidos</span>}
                    {previa.emailsAusentesOuInvalidos > 0 && <span><b className="text-amber-300">{previa.emailsAusentesOuInvalidos}</b> sem e-mail válido</span>}
                    {previa.incompativeis > 0 && <span><b className="text-amber-300">{previa.incompativeis}</b> em outra automação</span>}
                    {previa.duplicados > 0 && <span><b className="text-amber-300">{previa.duplicados}</b> e-mails repetidos</span>}
                  </div>
                  {previa.truncado && (
                    <p className="mb-3 text-xs text-amber-300/90">Mais de 2.000 leads encontrados — só os primeiros aparecem. Refine os filtros.</p>
                  )}
                  {grupos.length === 0 ? (
                    <p className="py-8 text-center text-sm text-slate-500">Nenhum lead encontrado com esses filtros fora desta campanha.</p>
                  ) : (
                    <>
                      {elegiveisIds.length > 0 && (
                        <label className="mb-2 flex cursor-pointer items-center gap-2 text-xs text-slate-400">
                          <CaixaSelecao
                            marcado={todosMarcados}
                            onChange={() => setSelecionados(todosMarcados ? new Set() : new Set(elegiveisIds))}
                            rotulo="Marcar todos"
                          />
                          Marcar todos os que podem entrar
                        </label>
                      )}
                      <div className="space-y-2">
                        {grupos.map(([empresa, contatos]) => {
                          const elegiveisEmpresa = contatos.filter((c) => c.elegivel);
                          const marcadosEmpresa = elegiveisEmpresa.filter((c) => selecionados.has(c.id)).length;
                          return (
                            <div key={empresa} className="rounded-lg border border-[var(--border)] bg-[var(--bg-base)]">
                              <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2">
                                <CaixaSelecao
                                  marcado={elegiveisEmpresa.length > 0 && marcadosEmpresa === elegiveisEmpresa.length}
                                  desabilitado={elegiveisEmpresa.length === 0}
                                  onChange={() => alternarEmpresa(contatos)}
                                  rotulo={`Marcar contatos de ${empresa}`}
                                />
                                <span className="truncate text-sm font-medium text-slate-200">{empresa}</span>
                                <span className="ml-auto shrink-0 text-xs text-slate-500">
                                  {marcadosEmpresa}/{contatos.length} contato{contatos.length === 1 ? '' : 's'}
                                </span>
                              </div>
                              {contatos.map((c) => (
                                <div key={c.id} className={`flex items-center gap-2 px-3 py-1.5 text-xs ${c.elegivel ? '' : 'opacity-50'}`}>
                                  <CaixaSelecao
                                    marcado={c.elegivel && selecionados.has(c.id)}
                                    desabilitado={!c.elegivel}
                                    onChange={() => alternar(c.id)}
                                    rotulo={`Marcar ${c.contato ?? c.email ?? 'contato'}`}
                                  />
                                  <span className="min-w-0 flex-1 truncate text-slate-300">
                                    {c.contato || '—'} <span className="text-slate-500">{c.email ? `· ${c.email}` : ''}</span>
                                  </span>
                                  <span className="hidden shrink-0 text-slate-500 sm:inline">{c.segmento || 'sem segmento'}</span>
                                  <span className="shrink-0 text-slate-500">{labelEstagio(c.estagio)}</span>
                                  {c.motivo && <span className="shrink-0 text-amber-300/90">{MOTIVO_LABEL[c.motivo]}</span>}
                                </div>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] px-6 py-4">
              <span className="text-sm text-slate-400">{totalMarcados} marcado{totalMarcados === 1 ? '' : 's'}</span>
              <div className="flex gap-2">
                <button onClick={onClose} className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-slate-300 hover:bg-[var(--bg-base)]">Cancelar</button>
                <button
                  onClick={() => { setEtapa('confirmacao'); setConfirmacaoTexto(''); setErro(null); }}
                  disabled={totalMarcados === 0 || buscando}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <UserPlus size={14} /> Adicionar {totalMarcados || ''}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
