'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  ChevronRight, Loader2, PencilLine, Play, Pause, CheckCircle2, Building2, Users,
  MessageSquare, BarChart3, ClipboardList, Workflow, Info, AlertTriangle, Activity, CalendarDays, Clock,
  Send, CornerUpLeft, UserCheck, XCircle, MailX, UserPlus,
} from 'lucide-react';
import AdicionarLeadsModal from './AdicionarLeadsModal';
import { type Campanha, type Publico, STATUS_BADGE, STATUS_LABEL, fmtData, resumoPublico } from './tiposCampanha';
import {
  NAO_CONFIGURADO,
  formatarCadenciaOperacional,
  formatarMensagensOperacionais,
  formatarPublicoOperacional,
  formatarRegraResposta,
  formatarStatusOperacional,
  proximaAcaoOperacional,
  type ContextoResumoOperacional,
} from '@/lib/campanhas/resumoOperacional';
import { DIAS_CAMPANHA, normalizarDiasCampanha, type DiaCampanha } from '@/lib/campanhas/agenda';
import { descreverCadencia, rotuloDoDia, rotuloDaEspera } from '@/lib/campanhas/cadenciaLegivel';
import { campanhaEhDisparoUnico, labelTipoCampanha } from '@/lib/campanhas/configuracaoGuiada';
import PainelCadencia from './PainelCadencia';
import {
  aguardandoRespostasDoDisparo,
  execucoesPendentes,
  temFalhaOperacional as calcularFalhaOperacional,
} from '@/lib/campanhas/situacaoDisparo';

// Detalhe de campanha com abas internas. Visão geral/Empresas/Decisores/Mensagens
// mostram o que REALMENTE persiste (colunas + publico jsonb + workflow vinculado).
// Resultados mostra a linha do tempo por destinatário — envio, resposta e aviso ao
// closer — composta de execuções, eventos de execução e interações já gravadas.
// Continua valendo a regra: nada de receita/ROI/oportunidade enquanto não houver
// vínculo confiável. Métrica que não existe não vira caixa vazia na tela.

type Aba = 'geral' | 'empresas' | 'decisores' | 'mensagens' | 'resultados';
interface EventoDestinatario { tipo: string; em: string; detalhe?: string | null }
interface DestinatarioCampanha {
  execucaoId: string; leadId: string | null; empresa: string; contato: string | null;
  email: string | null; statusExecucao: string; iniciadoEm: string;
  enviadoEm: string | null; respondeuEm: string | null; closerAvisadoEm: string | null;
  eventos: EventoDestinatario[];
}
interface LinhaDoTempo {
  destinatarios: DestinatarioCampanha[];
  totais: { publico: number; enviados: number; respostas: number; falhas: number; pendentes: number };
}
interface ResumoExecucoes {
  total: number; emAndamento: number; aguardando: number; concluidas: number;
  canceladas: number; erros: number; emailsEnviados: number; respostas: number;
  aguardandoPrimeiroEnvio?: number; jaContatados?: number; devolvidos?: number;
}
const ABAS: { id: Aba; label: string; Icon: typeof Building2 }[] = [
  { id: 'geral', label: 'Visão geral', Icon: ClipboardList },
  { id: 'empresas', label: 'Empresas', Icon: Building2 },
  { id: 'decisores', label: 'Decisores', Icon: Users },
  { id: 'mensagens', label: 'Mensagens', Icon: MessageSquare },
  { id: 'resultados', label: 'Resultados', Icon: BarChart3 },
];

const ACOES: Record<string, { para: string; label: string; Icon: typeof Play }[]> = {
  rascunho: [],
  ativa: [{ para: 'pausada', label: 'Pausar', Icon: Pause }, { para: 'concluida', label: 'Concluir', Icon: CheckCircle2 }],
  pausada: [{ para: 'ativa', label: 'Retomar', Icon: Play }, { para: 'concluida', label: 'Concluir', Icon: CheckCircle2 }],
  concluida: [],
};

const card = 'bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-5';

export default function CampanhaDetalhe({ id }: { id: string }) {
  const [c, setC] = useState<Campanha | null>(null);
  const [contextoResumo, setContextoResumo] = useState<ContextoResumoOperacional>({ remetente: null, responsavel: null, workflow: null });
  const [previaPublico, setPreviaPublico] = useState<{ totalSelecionado: number; elegiveis: number } | null>(null);
  const [estado, setEstado] = useState<'carregando' | 'ok' | 'erro'>('carregando');
  const [aba, setAba] = useState<Aba>('geral');
  const [agindo, setAgindo] = useState(false);
  const [modalDryRun, setModalDryRun] = useState(false);
  const [modalAgenda, setModalAgenda] = useState(false);
  const [modalAdicionarLeads, setModalAdicionarLeads] = useState(false);
  const [diasAgenda, setDiasAgenda] = useState<DiaCampanha[]>([]);
  const [salvandoAgenda, setSalvandoAgenda] = useState(false);
  const [erroAgenda, setErroAgenda] = useState<string | null>(null);
  const [confirmacaoTexto, setConfirmacaoTexto] = useState('');
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const [envioRealDisponivel, setEnvioRealDisponivel] = useState(false);
  const [resumoExecucoes, setResumoExecucoes] = useState<ResumoExecucoes | null>(null);
  const [linhaDoTempo, setLinhaDoTempo] = useState<LinhaDoTempo | null>(null);
  const [erroLinhaDoTempo, setErroLinhaDoTempo] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch(`/api/campanhas/${id}`);
      if (!r.ok) { setEstado('erro'); return; }
      const d = await r.json();
      setC(d.campanha);
      setContextoResumo(d.resumoOperacional ?? { remetente: null, responsavel: null, workflow: null });
      setPreviaPublico(d.previaPublico ?? null);
      setEnvioRealDisponivel(d.envioRealDisponivel === true);
      setResumoExecucoes(d.resumoExecucoes ?? null);
      setEstado('ok');
    } catch { setEstado('erro'); }
  }, [id]);

  useEffect(() => { carregar(); }, [carregar]);

  // A linha do tempo varre execuções e interações; só busca quando a aba abre.
  // A flag de cancelamento impede que uma resposta antiga sobrescreva a atual.
  useEffect(() => {
    if (aba !== 'resultados') return;
    let cancelado = false;
    setErroLinhaDoTempo(null);
    (async () => {
      try {
        const r = await fetch(`/api/campanhas/${id}/linha-do-tempo`);
        const d = await r.json();
        if (cancelado) return;
        if (!r.ok) { setErroLinhaDoTempo(d?.erro || 'Não foi possível carregar o que aconteceu.'); return; }
        setLinhaDoTempo(d);
      } catch {
        if (!cancelado) setErroLinhaDoTempo('Não foi possível carregar o que aconteceu.');
      }
    })();
    return () => { cancelado = true; };
  }, [aba, id]);

  async function transicionar(status: string) {
    setAgindo(true);
    setErroAcao(null);
    try {
      const resposta = await fetch(`/api/campanhas/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
      const dados = await resposta.json();
      if (!resposta.ok) throw new Error(dados.erro || 'Não foi possível atualizar a campanha.');
      await carregar();
    } catch (e) {
      setErroAcao(e instanceof Error ? e.message : 'Não foi possível atualizar a campanha.');
    } finally { setAgindo(false); }
  }

  async function ativarEnvioReal() {
    if (confirmacaoTexto !== 'CONFIRMAR') return;
    setAgindo(true);
    setErroAcao(null);
    try {
      const resposta = await fetch(`/api/campanhas/${id}/enrollar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmarQuantidade: previaPublico?.elegiveis }),
      });
      const dados = await resposta.json();
      if (!resposta.ok) throw new Error(dados.erro || 'Não foi possível ativar o envio real.');
      setModalDryRun(false);
      setConfirmacaoTexto('');
      await carregar();
      if (dados.falhas > 0) {
        setErroAcao(`${dados.falhas} contato(s) não puderam ser inscritos; revise as execuções antes de continuar.`);
      }
    } catch (e) {
      setErroAcao(e instanceof Error ? e.message : 'Não foi possível ativar o envio real.');
    } finally { setAgindo(false); }
  }

  function abrirAgenda() {
    setDiasAgenda(normalizarDiasCampanha(c?.publico?.agenda?.diasSemana));
    setErroAgenda(null);
    setModalAgenda(true);
  }

  function alternarDiaAgenda(dia: DiaCampanha) {
    setDiasAgenda((atuais) => atuais.includes(dia)
      ? atuais.filter((item) => item !== dia)
      : DIAS_CAMPANHA.map((item) => item.id).filter((item) => [...atuais, dia].includes(item)));
  }

  async function salvarAgenda() {
    if (!diasAgenda.length) {
      setErroAgenda('Escolha ao menos um dia de execução.');
      return;
    }
    setSalvandoAgenda(true);
    setErroAgenda(null);
    try {
      const resposta = await fetch(`/api/campanhas/${id}/agenda`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ diasSemana: diasAgenda }),
      });
      const dados = await resposta.json();
      if (!resposta.ok) throw new Error(dados.erro || 'Não foi possível atualizar a agenda.');
      await carregar();
      setModalAgenda(false);
    } catch (e) {
      setErroAgenda(e instanceof Error ? e.message : 'Não foi possível atualizar a agenda.');
    } finally {
      setSalvandoAgenda(false);
    }
  }

  if (estado === 'carregando') return <div className="flex items-center justify-center gap-2 py-24 text-slate-500"><Loader2 size={18} className="animate-spin" /> Carregando campanha…</div>;
  if (estado === 'erro' || !c) return (
    <div className="p-6">
      <Link href="/campanhas?tab=campanhas" className="text-sm text-indigo-300 hover:text-indigo-200">← Campanhas</Link>
      <div className="text-center py-20 text-slate-400 text-sm">Campanha não encontrada.</div>
    </div>
  );

  const pub: Publico = c.publico ?? {};
  const emp = pub.empresas ?? {};
  const dec = pub.decisores ?? {};
  const disparoUnico = campanhaEhDisparoUnico(c.tipo) || pub.operacao?.modoEnvio === 'disparo_unico';

  const emEnsaio = c.dry_run !== false;
  const execucoesAtivas = execucoesPendentes(resumoExecucoes);
  const temFalhaOperacional = calcularFalhaOperacional(resumoExecucoes);
  const aguardandoRespostas = aguardandoRespostasDoDisparo({
    disparoUnico, status: c.status, emEnsaio, resumo: resumoExecucoes,
  });
  const publicoOperacional = previaPublico
    ? `${previaPublico.elegiveis} elegíveis de ${previaPublico.totalSelecionado} selecionados — ${formatarPublicoOperacional(c.publico)}`
    : formatarPublicoOperacional(c.publico);
  const mensagensOperacionais = formatarMensagensOperacionais(contextoResumo.workflow?.definicao ?? null, pub.operacao);
  // Sequência legível da cadência — evita mandar o usuário ao builder para
  // descobrir o que a campanha faz.
  const cadencia = descreverCadencia(contextoResumo.workflow?.definicao ?? null, pub.operacao);
  const cadenciaOperacional = disparoUnico
    ? 'Disparo único — somente a mensagem inicial'
    : formatarCadenciaOperacional(contextoResumo.workflow, pub.agenda, pub.operacao);
  const regraResposta = disparoUnico
    ? 'Encaminhar resposta ao responsável'
    : formatarRegraResposta(pub.operacao?.resposta?.pararCadencia ?? pub.agenda?.pararAoResponder);
  const statusOperacional = formatarStatusOperacional(c.status, c.dry_run);
  const proximaAcao = disparoUnico
    ? c.status === 'rascunho'
      ? 'Revisar e disparar comunicação'
      : c.status === 'ativa' && c.dry_run !== false
        ? 'Confirmar disparo real'
        : c.status === 'ativa'
          ? 'Aguardar processamento do disparo'
          : c.status === 'pausada'
            ? 'Retomar disparo'
            : 'Nenhuma ação pendente'
    : proximaAcaoOperacional(c.status, c.dry_run, c.workflow_id);

  return (
    <div className="p-6 max-w-[100rem] mx-auto space-y-5">
      {/* Banner dry_run */}
      {emEnsaio ? (
        <div className="flex items-center justify-between gap-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-amber-300">
            <AlertTriangle size={15} className="shrink-0" />
            <span><b>Modo ensaio ativo</b> — nenhum e-mail real está sendo enviado e nenhuma execução real é criada por esta revisão.</span>
          </div>
          {c.status === 'ativa' && (
            <button
              onClick={() => { setModalDryRun(true); setConfirmacaoTexto(''); setErroAcao(null); }}
              disabled={!previaPublico?.elegiveis || !envioRealDisponivel}
              title={!envioRealDisponivel ? 'Envio real indisponível: revise MODO_ENSAIO e a conta Gmail no Vercel.' : undefined}
              className="text-xs px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/30 font-semibold whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            >
              Ativar envio real
            </button>
          )}
        </div>
      ) : (
        <div className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-sm ${aguardandoRespostas ? 'border-indigo-500/25 bg-indigo-500/10 text-indigo-300' : c.status === 'ativa' ? 'border-green-500/25 bg-green-500/10 text-green-300' : 'border-slate-500/25 bg-slate-500/10 text-slate-300'}`}>
          {c.status === 'ativa' ? <CheckCircle2 size={15} className="shrink-0" /> : <Info size={15} className="shrink-0" />}
          {c.status === 'ativa' ? (
            aguardandoRespostas
              ? <span><b>Aguardando respostas</b> — todos os envios saíram da fila, mas a campanha permanece aberta para acompanhar os retornos.</span>
              : disparoUnico
              ? <span><b>Disparo em processamento</b> — a fila envia um contato a cada 2 minutos, com cópia para o responsável; não há recorrência.</span>
              : <span><b>Envio real ativo</b> — a mensagem inicial entra na fila imediatamente, com intervalo de 2 minutos e cópia para o responsável.</span>
          ) : c.status === 'pausada' ? (
            <span><b>Campanha pausada</b> — as execuções estão preservadas, mas nenhuma ação será processada até a retomada.</span>
          ) : c.status === 'concluida' ? (
            disparoUnico
              ? <span><b>Disparo concluído</b> — o público confirmado já saiu da fila ativa e não existe recorrência.</span>
              : <span><b>Campanha concluída</b> — novos contatos não serão inscritos; execuções já iniciadas ainda podem terminar.</span>
          ) : (
            <span><b>Envio real configurado</b> — publique a campanha para iniciar o processamento.</span>
          )}
        </div>
      )}

      {resumoExecucoes && resumoExecucoes.erros > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-red-500/35 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <AlertTriangle size={17} className="mt-0.5 shrink-0 text-red-400" />
          <div>
            <div className="font-semibold">{resumoExecucoes.erros} execução(ões) parada(s) com erro</div>
            <div className="mt-1 text-xs text-red-300/90">
              Esses contatos não avançam na cadência até o erro ser resolvido. Revise as execuções antes de concluir a campanha.
            </div>
          </div>
        </div>
      )}

      {erroAcao && (
        <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {erroAcao}
        </div>
      )}

      {/* Modal de confirmação dry_run → real */}
      {modalDryRun && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-[var(--bg-card)] border border-red-500/30 rounded-2xl p-7 w-full max-w-md shadow-2xl space-y-5">
            <div className="flex items-center gap-2 text-red-400">
              <AlertTriangle size={20} />
              <h2 className="text-lg font-bold">Ativar envio real</h2>
            </div>
            <p className="text-sm text-slate-300 leading-relaxed">
              Esta ação recalcula o público, desativa o modo ensaio e inscreve <b>{previaPublico?.elegiveis ?? 'um número não calculado de'} contatos elegíveis</b> no workflow. A primeira mensagem entra na fila imediatamente; as seguintes saem a cada 2 minutos, com cópia para o responsável comercial.<br /><br />
              Para confirmar, digite exatamente <code className="bg-red-500/20 text-red-300 px-1 rounded">CONFIRMAR</code> no campo abaixo.
            </p>
            <input
              type="text"
              value={confirmacaoTexto}
              onChange={(e) => setConfirmacaoTexto(e.target.value)}
              placeholder="CONFIRMAR"
              className="w-full bg-[var(--bg-base)] border border-[var(--border)] rounded-lg px-3 py-2.5 text-slate-100 text-sm placeholder-slate-600 focus:outline-none focus:border-red-500/60"
              autoFocus
            />
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => { setModalDryRun(false); setConfirmacaoTexto(''); }}
                className="flex-1 text-sm px-4 py-2.5 rounded-lg border border-[var(--border)] text-slate-300 hover:bg-[var(--bg-base)] transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={ativarEnvioReal}
                disabled={confirmacaoTexto !== 'CONFIRMAR' || agindo}
                className="flex-1 text-sm px-4 py-2.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-colors inline-flex items-center justify-center gap-2"
              >
                {agindo ? <Loader2 size={14} className="animate-spin" /> : null}
                Confirmar e ativar
              </button>
            </div>
          </div>
        </div>
      )}

      {modalAdicionarLeads && (
        <AdicionarLeadsModal
          campanhaId={c.id}
          onClose={() => setModalAdicionarLeads(false)}
          onAdicionados={carregar}
        />
      )}

      {/* Edição restrita de campanha ativa: somente os próximos dias de execução. */}
      {modalAgenda && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
          <div className="w-full max-w-lg space-y-5 rounded-2xl border border-indigo-500/30 bg-[var(--bg-card)] p-7 shadow-2xl">
            <div className="flex items-start gap-3">
              <span className="rounded-lg bg-indigo-500/15 p-2 text-indigo-300"><CalendarDays size={20} /></span>
              <div>
                <h2 className="text-lg font-bold text-slate-100">Editar dias de execução</h2>
                <p className="mt-1 text-sm leading-relaxed text-slate-400">
                  A mesma campanha continuará ativa, com o mesmo público, mensagens e versão publicada. A alteração vale para os próximos ciclos do processador.
                </p>
              </div>
            </div>

            <div>
              <label className="mb-2 block text-xs font-semibold text-slate-300">Dias permitidos</label>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
                {DIAS_CAMPANHA.map((dia) => {
                  const selecionado = diasAgenda.includes(dia.id);
                  return (
                    <button
                      key={dia.id}
                      type="button"
                      onClick={() => alternarDiaAgenda(dia.id)}
                      aria-pressed={selecionado}
                      className={`rounded-lg border px-2 py-2.5 text-xs font-semibold transition-colors ${selecionado ? 'border-indigo-500 bg-indigo-500/15 text-indigo-200' : 'border-[var(--border-strong)] text-slate-500 hover:text-slate-300'}`}
                    >
                      {dia.label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-xs leading-relaxed text-amber-300/90">
                Salvar não dispara e-mails imediatamente. O processamento acontece no próximo ciclo diário configurado no servidor.
              </p>
            </div>

            {erroAgenda && (
              <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-xs text-red-300">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {erroAgenda}
              </div>
            )}

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={() => setModalAgenda(false)}
                disabled={salvandoAgenda}
                className="flex-1 rounded-lg border border-[var(--border)] px-4 py-2.5 text-sm text-slate-300 transition-colors hover:bg-[var(--bg-base)] disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={salvarAgenda}
                disabled={salvandoAgenda || !diasAgenda.length}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {salvandoAgenda ? <Loader2 size={14} className="animate-spin" /> : <CalendarDays size={14} />}
                Salvar agenda
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cabeçalho */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-xs text-slate-500 flex items-center gap-1 mb-1">
            <Link href="/campanhas?tab=campanhas" className="hover:text-slate-300">Campanhas</Link>
            <ChevronRight size={12} /> <span className="text-slate-400 truncate">{c.nome}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-100">{c.nome}</h1>
            <span className={`text-[11px] px-2 py-0.5 rounded-full ${aguardandoRespostas ? 'bg-indigo-500/15 text-indigo-300' : STATUS_BADGE[c.status] ?? STATUS_BADGE.rascunho}`}>
              {aguardandoRespostas ? 'Aguardando respostas' : STATUS_LABEL[c.status] ?? c.status}
            </span>
            {c.status === 'ativa' && c.dry_run !== false && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300">em ensaio</span>
            )}
          </div>
          <div className="mt-1 text-sm text-slate-400">
            {[labelTipoCampanha(c.tipo), resumoPublico(c.publico)].filter(Boolean).join(' · ')}
          </div>
          <div className="mt-0.5 text-xs text-slate-500">
            Criada em {fmtData(c.criado_em)}{c.iniciada_em ? ` · Iniciada em ${fmtData(c.iniciada_em)}` : ''} · Atualizada em {fmtData(c.atualizado_em)}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {c.status === 'ativa' && c.tipo !== 'renovacao' && !!c.workflow_id && (
            <button
              type="button"
              onClick={() => setModalAdicionarLeads(true)}
              disabled={agindo || emEnsaio}
              title={emEnsaio ? 'Em modo ensaio, use "Ativar envio real" para inscrever o público.' : undefined}
              className="inline-flex items-center gap-1 rounded-lg border border-indigo-500/40 px-3 py-2 text-sm font-semibold text-indigo-200 hover:bg-indigo-500/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <UserPlus size={14} /> Adicionar leads
            </button>
          )}
          {!disparoUnico && (c.status === 'ativa' || c.status === 'pausada') && (
            <button
              type="button"
              onClick={abrirAgenda}
              disabled={agindo}
              className="inline-flex items-center gap-1 rounded-lg border border-indigo-500/40 px-3 py-2 text-sm font-semibold text-indigo-200 hover:bg-indigo-500/10 disabled:opacity-40"
            >
              <CalendarDays size={14} /> Editar agenda
            </button>
          )}
          {(c.status === 'ativa' || c.status === 'pausada') && (
            <Link href={`/campanhas/${c.id}/mensagens`}
              className="inline-flex items-center gap-1 rounded-lg border border-indigo-500/40 px-3 py-2 text-sm font-semibold text-indigo-200 hover:bg-indigo-500/10">
              <PencilLine size={14} /> Editar mensagens
            </Link>
          )}
          {(ACOES[c.status] ?? []).map(({ para, label, Icon }) => (
            <button key={para} onClick={() => transicionar(para)} disabled={agindo || (para === 'concluida' && temFalhaOperacional)}
              title={para === 'concluida' && temFalhaOperacional ? 'Resolva as execuções canceladas ou com erro antes de concluir.' : undefined}
              className="text-sm px-3 py-2 rounded-lg border border-[var(--border)] text-slate-200 hover:bg-[var(--bg-base)] disabled:opacity-40 inline-flex items-center gap-1">
              <Icon size={14} /> {label}
            </button>
          ))}
          {c.status === 'rascunho' && (
            <Link href={`/campanhas/${c.id}/editar`}
              className="text-sm px-3 py-2 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-500 inline-flex items-center gap-1">
              <PencilLine size={14} /> Revisar e publicar
            </Link>
          )}
        </div>
      </div>

      {c.status !== 'rascunho' && <PainelCadencia campanhaId={c.id} resumo={resumoExecucoes} />}

      {/* Abas */}
      <div className="flex items-center gap-1 border-b border-[var(--border)] overflow-x-auto">
        {ABAS.map(({ id: aid, label, Icon }) => (
          <button key={aid} onClick={() => setAba(aid)}
            className={`px-4 py-2 text-sm font-semibold inline-flex items-center gap-2 border-b-2 -mb-px transition-colors whitespace-nowrap ${aba === aid ? 'border-indigo-400 text-indigo-300' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {aba === 'geral' && (
        <div className="space-y-5">
          <div className={card}>
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h3 className="font-semibold text-slate-200 text-sm flex items-center gap-2">
                  <Activity size={15} className="text-indigo-400" /> Resumo operacional
                </h3>
                <p className="text-xs text-slate-500 mt-1">Leitura da configuração real atualmente vinculada à campanha.</p>
              </div>
              <span className="text-[10px] uppercase tracking-wide text-slate-500 border border-[var(--border)] rounded-full px-2 py-1">Somente leitura</span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-2 text-sm">
              <Linha k="Público" v={publicoOperacional} />
              <Linha k="Remetente" v={contextoResumo.remetente ?? NAO_CONFIGURADO} />
              <Linha k="Responsável" v={contextoResumo.responsavel ?? NAO_CONFIGURADO} />
              <Linha k="Mensagens" v={mensagensOperacionais} />
              <Linha k={disparoUnico ? 'Envio' : 'Cadência'} v={cadenciaOperacional} />
              <Linha k="Regra de resposta" v={regraResposta} />
              <Linha k="Status" v={statusOperacional} />
              <Linha k="Próxima ação" v={proximaAcao} />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className={card}>
              <h3 className="font-semibold text-slate-200 text-sm mb-3">Dados</h3>
              <div className="space-y-2 text-sm">
                <Linha k="Tipo" v={c.tipo ?? '—'} />
                <Linha k="Objetivo" v={pub.objetivo ?? c.descricao ?? '—'} />
                <Linha k="Responsável" v={contextoResumo.responsavel ?? '—'} />
                <Linha k="Idioma" v={pub.idioma ?? '—'} />
                <Linha k="Meta de leads" v={c.meta_leads != null ? String(c.meta_leads) : '—'} />
                <Linha k="Prazo" v={pub.prazo ? fmtData(pub.prazo) : '—'} />
              </div>
            </div>
            <div className={card}>
              <h3 className="font-semibold text-slate-200 text-sm mb-3">Ciclo</h3>
              <div className="space-y-2 text-sm">
                <Linha k="Status" v={STATUS_LABEL[c.status] ?? c.status} />
                {resumoExecucoes && <Linha k="Mensagens enviadas" v={resumoExecucoes.emailsEnviados.toLocaleString('pt-BR')} />}
                {resumoExecucoes && <Linha k="Contatos inscritos" v={resumoExecucoes.total.toLocaleString('pt-BR')} />}
                {resumoExecucoes && <Linha k="Respostas" v={String(resumoExecucoes.respostas)} />}
                {resumoExecucoes && <Linha k="Canceladas / erros" v={`${resumoExecucoes.canceladas} / ${resumoExecucoes.erros}`} />}
                <Linha k="Público" v={resumoPublico(c.publico)} />
                <Linha k="Cadência" v={contextoResumo.workflow?.nome ?? (c.workflow_id ? 'workflow vinculado' : '— (sem workflow)')} />
                <Linha k="Criada em" v={fmtData(c.criado_em)} />
                <Linha k="Iniciada em" v={fmtData(c.iniciada_em)} />
                <Linha k="Concluída em" v={fmtData(c.concluida_em)} />
              </div>
            </div>
          </div>
        </div>
      )}

      {aba === 'empresas' && (
        <div className={card}>
          <h3 className="font-semibold text-slate-200 text-sm mb-3 flex items-center gap-2"><Building2 size={15} className="text-indigo-400" /> Critérios de empresas</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
            <Linha k="Fonte" v={emp.fonte === 'maps' ? 'Google Maps Extractor (não configurado)' : 'Base de leads existente'} />
            <Linha k="País" v={emp.pais ?? '—'} />
            <Linha k="Segmentos" v={emp.segmento ?? '—'} />
            <Linha k="Cidades / regiões" v={emp.cidades ?? '—'} />
            <Linha k="Limite" v={emp.limite != null ? String(emp.limite) : '—'} />
            <Linha k="Remover duplicados" v={emp.removerDuplicados ? 'Sim' : 'Não'} />
            <Linha k="Exigir site ativo" v={emp.exigirSite ? 'Sim' : 'Não'} />
          </div>
          <div className="flex items-start gap-2 text-xs text-slate-500 mt-4 bg-[var(--bg-base)] border border-[var(--border)] rounded-lg p-3">
            <Info size={13} className="text-indigo-400 shrink-0 mt-0.5" />
            <span>O público efetivo é recalculado no servidor ao ativar e exclui contatos bloqueados, duplicados ou incompatíveis com outra automação.</span>
          </div>
        </div>
      )}

      {aba === 'decisores' && (
        <div className={card}>
          <h3 className="font-semibold text-slate-200 text-sm mb-3 flex items-center gap-2"><Users size={15} className="text-indigo-400" /> Critérios de decisores</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
            <Linha k="Departamento" v={dec.departamento ?? '—'} />
            <Linha k="Cargos-alvo" v={dec.cargos ?? '—'} />
            <Linha k="Senioridade" v={dec.senioridade ?? '—'} />
            <Linha k="Máx. por empresa" v={dec.maxPorEmpresa != null ? String(dec.maxPorEmpresa) : '—'} />
            <Linha k="Exigir e-mail validado" v={dec.exigirEmail ? 'Sim' : 'Não'} />
            <Linha k="Exigir telefone / WhatsApp" v={dec.exigirTelefone ? 'Sim' : 'Não'} />
          </div>
        </div>
      )}

      {aba === 'mensagens' && (
        <div className={card}>
          <h3 className="font-semibold text-slate-200 text-sm mb-3 flex items-center gap-2"><Workflow size={15} className="text-indigo-400" /> {disparoUnico ? 'Mensagem do disparo' : 'Cadência de mensagens'}</h3>
          {cadencia.length > 0 ? (
            <ol className="space-y-0">
              {cadencia.map((passo) => {
                const espera = rotuloDaEspera(passo.esperaAntes);
                return (
                  <li key={passo.ordem}>
                    {espera && (
                      <div className="flex items-center gap-1.5 text-[11px] text-slate-500 pl-4 py-1.5">
                        <span className="w-px h-4 bg-[var(--border)] mr-1.5" />
                        <Clock size={11} /> {espera}
                      </div>
                    )}
                    <div className="flex items-start gap-3 p-3 rounded-lg border border-[var(--border)] bg-[var(--bg-base)]">
                      <span className="shrink-0 text-[10px] font-semibold text-indigo-300 bg-indigo-500/15 border border-indigo-500/25 rounded px-2 py-1 tabular-nums">
                        {rotuloDoDia(passo.dia)}
                      </span>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-slate-200">{passo.rotulo}</div>
                        {passo.detalhe ? (
                          <div className="text-xs text-slate-400 mt-0.5 break-words">{passo.detalhe}</div>
                        ) : (
                          <div className="text-xs text-slate-600 mt-0.5">sem assunto configurado</div>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <div className="text-sm text-slate-500 bg-[var(--bg-base)] border border-[var(--border)] rounded-lg p-4">
              {disparoUnico ? 'Nenhuma mensagem materializada para este disparo.' : 'Nenhuma cadência vinculada. Edite a campanha e configure as mensagens na etapa Cadência.'}
            </div>
          )}
          <div className="flex items-center justify-between gap-3 mt-3">
            <p className="text-xs text-slate-600">
              A sequência — quantidade de mensagens e dias — fica congelada quando a campanha é ativada.
              {(c.status === 'ativa' || c.status === 'pausada') && (
                <> O conteúdo pode ser ajustado em <Link href={`/campanhas/${c.id}/mensagens`} className="text-indigo-300 hover:text-indigo-200">Editar mensagens</Link> e vale para os próximos envios.</>
              )}
            </p>
            {c.workflow_id && (
              <Link href={`/workflows/${c.workflow_id}`} className="shrink-0 text-[11px] text-slate-600 hover:text-slate-400">
                ver estrutura →
              </Link>
            )}
          </div>
        </div>
      )}

      {aba === 'resultados' && (
        <div className="space-y-5">
          {erroLinhaDoTempo ? (
            <div className={`${card} text-center text-sm text-red-300`}>{erroLinhaDoTempo}</div>
          ) : !linhaDoTempo ? (
            <div className={`${card} text-center text-sm text-slate-500`}>
              <Loader2 size={15} className="inline animate-spin mr-2" /> Carregando o que aconteceu…
            </div>
          ) : linhaDoTempo.destinatarios.length === 0 ? (
            <div className={`${card} text-center`}>
              <p className="text-sm text-slate-400">Esta campanha ainda não inscreveu ninguém.</p>
              <p className="text-xs text-slate-600 mt-1">
                Assim que o disparo começar, cada destinatário aparece aqui com o que aconteceu com ele.
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Placar label="Público inscrito" valor={linhaDoTempo.totais.publico} />
                <Placar label="E-mails enviados" valor={linhaDoTempo.totais.enviados} cor="text-sky-300" />
                <Placar
                  label="Responderam"
                  valor={linhaDoTempo.totais.respostas}
                  cor="text-green-300"
                  rodape={linhaDoTempo.totais.enviados
                    ? `${Math.round((linhaDoTempo.totais.respostas / linhaDoTempo.totais.enviados) * 100)}% de quem recebeu`
                    : undefined}
                />
                <Placar
                  label="Não saíram"
                  valor={linhaDoTempo.totais.falhas}
                  cor={linhaDoTempo.totais.falhas ? 'text-red-300' : 'text-slate-300'}
                  rodape={linhaDoTempo.totais.pendentes ? `${linhaDoTempo.totais.pendentes} ainda na fila` : undefined}
                />
              </div>

              {linhaDoTempo.totais.publico > 0 && (
                <div className={card}>
                  <div className="flex items-center justify-between text-xs mb-2">
                    <span className="text-slate-400 font-medium">Progresso do envio</span>
                    <span className="tabular-nums text-slate-500">
                      {linhaDoTempo.totais.enviados} de {linhaDoTempo.totais.publico}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-[var(--bg-base)] border border-[var(--border)] overflow-hidden">
                    <div
                      className="h-full bg-indigo-500/70"
                      style={{ width: `${Math.round((linhaDoTempo.totais.enviados / linhaDoTempo.totais.publico) * 100)}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl overflow-hidden">
                <div className="px-5 py-3 border-b border-[var(--border)]">
                  <h3 className="font-semibold text-slate-200 text-sm">Quem recebeu</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Um bloco por destinatário, na ordem de inscrição, com o que o sistema registrou.
                  </p>
                </div>
                <ul>
                  {linhaDoTempo.destinatarios.map((d) => {
                    const situacao = situacaoDoDestinatario(d);
                    return (
                      <li key={d.execucaoId} className="px-5 py-3.5 border-b border-[var(--border)] last:border-0">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-slate-100 truncate">{d.empresa}</div>
                            <div className="text-xs text-slate-500 truncate">
                              {[d.contato, d.email].filter(Boolean).join(' · ') || 'sem contato registrado'}
                            </div>
                          </div>
                          <span className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full ${situacao.classe}`}>
                            {situacao.rotulo}
                          </span>
                        </div>
                        {d.eventos.length === 0 ? (
                          <p className="text-xs text-slate-600 mt-2">
                            Inscrito, sem evento registrado ainda.
                          </p>
                        ) : (
                          <ol className="mt-2.5 space-y-1.5">
                            {d.eventos.map((ev, i) => {
                              const e = EVENTO[ev.tipo] ?? EVENTO.desconhecido;
                              const Icon = e.Icon;
                              return (
                                <li key={`${d.execucaoId}-${i}`} className="flex items-start gap-2 text-xs">
                                  <span className="tabular-nums text-slate-600 w-24 shrink-0">{quando(ev.em)}</span>
                                  <Icon size={13} className={`shrink-0 mt-px ${e.cor}`} />
                                  <span className={`shrink-0 ${e.cor}`}>{e.rotulo}</span>
                                  {ev.detalhe && (
                                    <span className="text-slate-500 min-w-0 truncate">— {ev.detalhe}</span>
                                  )}
                                </li>
                              );
                            })}
                          </ol>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>

              <p className="text-xs text-slate-600">
                Uma resposta só é creditada aqui se chegou depois do início desta campanha para aquele lead — conversa
                anterior não é atribuída. A atribuição usa o endereço do remetente: resposta vinda de um e-mail
                diferente do cadastrado no lead não aparece nesta lista.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Linha({ k, v }: { k: string; v: string }) {
  return <div className="flex items-start gap-3 border-b border-[var(--border)] pb-2"><span className="text-slate-500 w-40 shrink-0">{k}</span><span className="text-slate-200">{v}</span></div>;
}
function Placar({ label, valor, cor, rodape }: { label: string; valor: number; cor?: string; rodape?: string }) {
  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl px-5 py-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-2xl font-bold mt-1 tabular-nums ${cor ?? 'text-slate-100'}`}>{valor}</div>
      {rodape && <div className="text-[10px] text-slate-600 mt-0.5">{rodape}</div>}
    </div>
  );
}

// Vocabulário da linha do tempo. "Enviado" é o que o sistema realmente sabe: o
// servidor aceitou a mensagem. Entrega e abertura não são rastreadas, então não
// aparecem — nem como caixa vazia.
const EVENTO: Record<string, { rotulo: string; cor: string; Icon: typeof Send }> = {
  enviado: { rotulo: 'E-mail enviado', cor: 'text-sky-300', Icon: Send },
  nao_enviado: { rotulo: 'Envio não realizado', cor: 'text-amber-300', Icon: MailX },
  resposta: { rotulo: 'Respondeu', cor: 'text-green-300', Icon: CornerUpLeft },
  closer: { rotulo: 'Closer avisado', cor: 'text-indigo-300', Icon: UserCheck },
  erro: { rotulo: 'Erro na execução', cor: 'text-red-300', Icon: AlertTriangle },
  cancelado: { rotulo: 'Execução cancelada', cor: 'text-red-300', Icon: XCircle },
  desconhecido: { rotulo: 'Evento', cor: 'text-slate-400', Icon: Activity },
};

function situacaoDoDestinatario(d: DestinatarioCampanha): { rotulo: string; classe: string } {
  if (d.respondeuEm) return { rotulo: 'Respondeu', classe: 'bg-green-500/15 text-green-300' };
  if (d.statusExecucao === 'cancelado') return { rotulo: 'Cancelado', classe: 'bg-red-500/15 text-red-300' };
  if (d.statusExecucao === 'erro') return { rotulo: 'Erro', classe: 'bg-red-500/15 text-red-300' };
  if (d.enviadoEm) return { rotulo: 'Aguardando resposta', classe: 'bg-sky-500/15 text-sky-300' };
  if (d.statusExecucao === 'aguardando' || d.statusExecucao === 'em_andamento') {
    return { rotulo: 'Na fila', classe: 'bg-amber-500/15 text-amber-300' };
  }
  return { rotulo: 'Sem envio', classe: 'bg-slate-500/15 text-slate-400' };
}

function quando(iso: string): string {
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  } catch { return '—'; }
}
