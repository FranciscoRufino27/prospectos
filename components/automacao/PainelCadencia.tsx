'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, ChevronRight, Clock, Loader2, Mail, MessageSquare, Send, Users, X,
} from 'lucide-react';
import { emFollowupDaDistribuicao, type DistribuicaoCadencia, type EtapaCadencia } from '@/lib/campanhas/distribuicaoCadencia';

// Visão operacional da campanha: KPIs + distribuição REAL da cadência
// (etapas lidas da definição publicada) + contatos da etapa clicada.
// Dados: GET /api/campanhas/[id]/cadencia (somente leitura).

export interface ResumoParaPainel {
  total: number;
  emailsEnviados: number;
  respostas: number;
  jaContatados?: number;
}

interface ContatoDaEtapa {
  leadId: string | null;
  empresa: string | null;
  contato: string | null;
  email: string | null;
  estagioLead: string | null;
  ultimoEnvioEm: string | null;
  proximoEnvio: string | null;
  dataPrevista: string | null;
  statusExecucao: string;
}

const card = 'bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-5';
const num = (v: number) => v.toLocaleString('pt-BR');
const pct = (v: number) => `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
const dataHora = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');

const COR_ETAPA: Record<string, string> = {
  primeiro_contato: 'border-slate-500/40 bg-slate-500/10',
  respondeu: 'border-emerald-500/40 bg-emerald-500/10',
  concluido: 'border-emerald-500/30 bg-emerald-500/5',
  devolvido: 'border-amber-500/40 bg-amber-500/10',
  saiu: 'border-slate-500/30 bg-slate-500/5',
  erro: 'border-red-500/40 bg-red-500/10',
  indefinida: 'border-slate-500/30 bg-slate-500/5',
};
const COR_NUMERO: Record<string, string> = {
  respondeu: 'text-emerald-300',
  concluido: 'text-emerald-300',
  devolvido: 'text-amber-300',
  erro: 'text-red-300',
};
const STATUS_EXECUCAO: Record<string, string> = {
  aguardando: 'Aguardando', em_andamento: 'Em andamento', concluido: 'Concluída', cancelado: 'Encerrada', erro: 'Erro',
};

export default function PainelCadencia({ campanhaId, resumo }: { campanhaId: string; resumo: ResumoParaPainel | null }) {
  const [dist, setDist] = useState<DistribuicaoCadencia | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [etapaAberta, setEtapaAberta] = useState<EtapaCadencia | null>(null);
  const [contatos, setContatos] = useState<{ contatos: ContatoDaEtapa[]; total: number } | null>(null);
  const [carregandoContatos, setCarregandoContatos] = useState(false);
  const [erroContatos, setErroContatos] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    fetch(`/api/campanhas/${campanhaId}/cadencia`)
      .then(async (r) => ({ ok: r.ok, j: await r.json().catch(() => null) }))
      .then(({ ok, j }) => {
        if (!ativo) return;
        if (!ok || !j?.distribuicao) setErro(j?.erro ?? 'Não foi possível carregar a distribuição da cadência.');
        else setDist(j.distribuicao as DistribuicaoCadencia);
      })
      .catch(() => { if (ativo) setErro('Não foi possível carregar a distribuição da cadência.'); });
    return () => { ativo = false; };
  }, [campanhaId]);

  const abrirEtapa = useCallback(async (etapa: EtapaCadencia) => {
    if (etapaAberta?.id === etapa.id) { setEtapaAberta(null); return; }
    setEtapaAberta(etapa);
    setContatos(null);
    setErroContatos(null);
    if (etapa.quantidade === 0) { setContatos({ contatos: [], total: 0 }); return; }
    setCarregandoContatos(true);
    try {
      const r = await fetch(`/api/campanhas/${campanhaId}/cadencia?etapa=${encodeURIComponent(etapa.id)}`);
      const j = await r.json().catch(() => null);
      if (!r.ok || !Array.isArray(j?.contatos)) setErroContatos(j?.erro ?? 'Não foi possível carregar os contatos.');
      else setContatos(j);
    } finally {
      setCarregandoContatos(false);
    }
  }, [campanhaId, etapaAberta]);

  const etapa = (id: string) => dist?.etapas.find((e) => e.id === id);
  const contatados = resumo?.jaContatados ?? null;
  const taxa = (n: number | undefined) => (n === undefined || !contatados ? null : pct(n / contatados));
  const devolvidos = etapa('devolvido')?.quantidade;
  const sequencia = dist?.etapas.filter((e) => e.grupo === 'sequencia') ?? [];
  const finais = dist?.etapas.filter((e) => e.grupo === 'final') ?? [];

  return (
    <div className="space-y-5">
      {/* KPIs da campanha */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Kpi icone={Users} rotulo="Total de contatos" valor={resumo ? num(resumo.total) : '—'} detalhe="na base da campanha" />
        <Kpi icone={Send} rotulo="Contatados" valor={contatados != null ? num(contatados) : '—'}
          detalhe={resumo ? `${num(resumo.emailsEnviados)} mensagens enviadas` : '—'} />
        <Kpi icone={Clock} rotulo="Aguardando 1º contato" valor={dist ? num(etapa('primeiro_contato')?.quantidade ?? 0) : '—'}
          detalhe="ainda não receberam nada" />
        <Kpi icone={Mail} rotulo="Em follow-up" valor={dist ? num(emFollowupDaDistribuicao(dist)) : '—'}
          detalhe="já contatados, seguem na cadência" />
        <Kpi icone={MessageSquare} rotulo="Respostas" valor={resumo ? num(resumo.respostas) : '—'}
          detalhe={taxa(resumo?.respostas) ? `${taxa(resumo?.respostas)} dos contatados` : '—'} destaque="emerald" />
        <Kpi icone={AlertTriangle} rotulo="Devoluções" valor={devolvidos !== undefined ? num(devolvidos) : '—'}
          detalhe={taxa(devolvidos) ? `${taxa(devolvidos)} dos contatados` : '—'} destaque="amber" />
      </div>

      {/* Distribuição da cadência */}
      <div className={card}>
        <h3 className="font-semibold text-slate-200 text-sm">Distribuição da cadência</h3>
        <p className="text-xs text-slate-500 mt-1">
          Quantos contatos estão em cada etapa da sequência
          {dist ? ` (1º contato + ${dist.totalFollowups} follow-up${dist.totalFollowups === 1 ? '' : 's'}, conforme a cadência publicada)` : ''}.
          Clique em uma etapa para ver os contatos.
        </p>

        {erro && <p className="mt-3 text-sm text-red-300 flex items-center gap-1.5"><AlertTriangle size={14} /> {erro}</p>}
        {!dist && !erro && (
          <p className="mt-3 text-sm text-slate-500 flex items-center gap-1.5"><Loader2 size={14} className="animate-spin" /> Carregando…</p>
        )}

        {dist && (
          <div className="mt-4 space-y-4">
            <div className="flex items-stretch gap-1.5 overflow-x-auto pb-1">
              {sequencia.map((e, i) => (
                <Fragment key={e.id}>
                  {i > 0 && <ChevronRight size={16} className="shrink-0 self-center text-slate-600" aria-hidden="true" />}
                  <CaixaEtapa etapa={e} aberta={etapaAberta?.id === e.id} onClick={() => abrirEtapa(e)} />
                </Fragment>
              ))}
            </div>
            <div>
              <div className="mb-2 text-[11px] uppercase tracking-wide text-slate-500">Saíram da cadência</div>
              <div className="flex flex-wrap items-stretch gap-1.5">
                {finais.map((e) => (
                  <CaixaEtapa key={e.id} etapa={e} aberta={etapaAberta?.id === e.id} onClick={() => abrirEtapa(e)} />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Contatos da etapa */}
      {etapaAberta && (
        <div className={card}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold text-slate-200 text-sm">{etapaAberta.rotulo} — {num(etapaAberta.quantidade)}</h3>
              <p className="text-xs text-slate-500 mt-1">{etapaAberta.descricao}</p>
            </div>
            <button type="button" onClick={() => setEtapaAberta(null)} aria-label="Fechar lista de contatos"
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-[var(--bg-base)]">
              <X size={14} />
            </button>
          </div>
          {carregandoContatos && <p className="mt-3 text-sm text-slate-500 flex items-center gap-1.5"><Loader2 size={14} className="animate-spin" /> Carregando contatos…</p>}
          {erroContatos && <p className="mt-3 text-sm text-red-300">{erroContatos}</p>}
          {contatos && contatos.contatos.length === 0 && <p className="mt-3 text-sm text-slate-500">Nenhum contato nesta etapa.</p>}
          {contatos && contatos.contatos.length > 0 && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-[11px] uppercase tracking-wide text-slate-500">
                    <th className="text-left font-medium px-2 py-2">Empresa</th>
                    <th className="text-left font-medium px-2 py-2">Contato</th>
                    <th className="text-left font-medium px-2 py-2">E-mail</th>
                    <th className="text-left font-medium px-2 py-2">Estágio</th>
                    <th className="text-left font-medium px-2 py-2">Último envio</th>
                    <th className="text-left font-medium px-2 py-2">Próximo envio</th>
                    <th className="text-left font-medium px-2 py-2">Previsto para</th>
                    <th className="text-left font-medium px-2 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {contatos.contatos.map((ct, i) => (
                    <tr key={`${ct.leadId ?? 'sem-lead'}-${i}`} className="border-b border-[var(--border)] last:border-0">
                      <td className="px-2 py-2 text-slate-200">{ct.empresa ?? '—'}</td>
                      <td className="px-2 py-2 text-slate-300">{ct.contato ?? '—'}</td>
                      <td className="px-2 py-2 text-slate-400 max-w-[220px] truncate" title={ct.email ?? undefined}>{ct.email ?? '—'}</td>
                      <td className="px-2 py-2 text-slate-400">{ct.estagioLead ?? '—'}</td>
                      <td className="px-2 py-2 text-slate-400 whitespace-nowrap">{dataHora(ct.ultimoEnvioEm)}</td>
                      <td className="px-2 py-2 text-slate-300">{ct.proximoEnvio ?? '—'}</td>
                      <td className="px-2 py-2 text-slate-400 whitespace-nowrap">{dataHora(ct.dataPrevista)}</td>
                      <td className="px-2 py-2 text-slate-400">{STATUS_EXECUCAO[ct.statusExecucao] ?? ct.statusExecucao}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {contatos.total > contatos.contatos.length && (
                <p className="mt-2 text-xs text-slate-500">Mostrando {num(contatos.contatos.length)} de {num(contatos.total)} contatos.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Kpi({ icone: Icone, rotulo, valor, detalhe, destaque }: {
  icone: typeof Users; rotulo: string; valor: string; detalhe: string; destaque?: 'emerald' | 'amber';
}) {
  const cor = destaque === 'emerald' ? 'text-emerald-300' : destaque === 'amber' ? 'text-amber-300' : 'text-indigo-300';
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-3.5">
      <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
        <Icone size={13} className={cor} /> {rotulo}
      </div>
      <div className="mt-1.5 text-xl font-bold text-slate-100 tabular-nums">{valor}</div>
      <div className="mt-0.5 text-[11px] text-slate-500">{detalhe}</div>
    </div>
  );
}

function CaixaEtapa({ etapa, aberta, onClick }: { etapa: EtapaCadencia; aberta: boolean; onClick: () => void }) {
  const cor = COR_ETAPA[etapa.id] ?? 'border-indigo-500/30 bg-indigo-500/5';
  return (
    <button type="button" onClick={onClick} aria-pressed={aberta} title={etapa.descricao}
      className={`min-w-[120px] shrink-0 rounded-xl border px-3 py-2.5 text-left transition-colors hover:border-indigo-400/60 ${cor} ${aberta ? 'ring-2 ring-indigo-400/60' : ''}`}>
      <div className={`text-xl font-bold tabular-nums ${COR_NUMERO[etapa.id] ?? 'text-slate-100'}`}>{num(etapa.quantidade)}</div>
      <div className="text-xs font-semibold text-slate-200">{etapa.rotulo}</div>
      <div className="mt-0.5 text-[11px] text-slate-500">{etapa.percentual === null ? '—' : `${pct(etapa.percentual)} da base`}</div>
    </button>
  );
}
