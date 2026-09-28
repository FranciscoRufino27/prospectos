'use client';

// Cartão ADITIVO e FAIL-SAFE do LeadPanel: status do ciclo ATUAL do laudo
// (calculado no servidor), ação "Marcar como renovado" e histórico de ciclos.
//
// Regra: Vigente / Próximo do vencimento / Vencido = ciclo atual, pela data.
// Renovado = ciclo histórico encerrado. Renovar pede SÓ a nova validade.
// Corrigir a data (botão "Editar" do painel) NÃO passa por aqui — é outro fluxo
// e não gera renovação.
import { Component, useCallback, useEffect, useState, type ReactNode } from 'react';
import { Loader2, RefreshCw, X } from 'lucide-react';
import { getLaudoLead, renovarLaudoLead } from '@/lib/api';
import { ROTULO_STATUS_LAUDO, type LaudoLeadView, type StatusLaudo } from '@/lib/laudos/ciclos';
import { formatarDataIsoSemFuso } from '@/lib/servicos/vencimento';

const CLASSE_STATUS: Record<StatusLaudo, string> = {
  vigente: 'bg-emerald-500/15 text-emerald-400',
  proximo_vencimento: 'bg-amber-500/15 text-amber-400',
  vencido: 'bg-rose-500/15 text-rose-400',
  renovado: 'bg-[var(--t-bg-input,#252b3b)] text-slate-400',
};

class Boundary extends Component<{ children: ReactNode }, { erro: boolean }> {
  constructor(p: { children: ReactNode }) { super(p); this.state = { erro: false }; }
  static getDerivedStateFromError() { return { erro: true }; }
  render() { return this.state.erro ? null : this.props.children; }
}

function dataHoraCurta(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
}

function CardInterno({
  leadId, validade, compacto, onRenovado,
}: {
  leadId: string;
  // data_validade do lead no painel — quando muda (edição/correção), recarrega.
  validade: string | null | undefined;
  compacto: boolean;
  onRenovado?: (novaValidade: string) => void;
}) {
  const [laudo, setLaudo] = useState<LaudoLeadView | null>(null);
  const [aberto, setAberto] = useState(false);
  const [novaValidade, setNovaValidade] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try { setLaudo(await getLaudoLead(leadId)); } catch { setLaudo(null); }
  }, [leadId]);
  useEffect(() => { carregar(); }, [carregar, validade]);
  useEffect(() => { setAberto(false); setNovaValidade(''); setErro(null); }, [leadId]);

  async function confirmar() {
    if (!novaValidade) { setErro('Informe a nova validade.'); return; }
    setSalvando(true); setErro(null);
    try {
      const atualizado = await renovarLaudoLead(leadId, novaValidade);
      setLaudo(atualizado);
      setAberto(false);
      setNovaValidade('');
      onRenovado?.(novaValidade);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível marcar como renovado.');
    } finally {
      setSalvando(false);
    }
  }

  // Sem validade e sem histórico: nada a mostrar (o bloco "Validade do laudo"
  // do painel já diz "Não configurada" e leva à edição).
  if (!laudo || (!laudo.atual && laudo.historico.length === 0)) return null;

  const atual = laudo.atual;
  const tam = compacto ? 'text-xs' : 'text-sm';

  return (
    <div className={`${compacto ? 'px-4 py-3' : 'px-4 py-3'} border-b border-[var(--t-border,#2a3147)]`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          {atual?.status ? (
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${CLASSE_STATUS[atual.status]}`}>
              {ROTULO_STATUS_LAUDO[atual.status]}
            </span>
          ) : (
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[var(--t-bg-input,#252b3b)] text-slate-500">Sem validade</span>
          )}
          {atual && atual.diasAteVencer !== null && (
            <span className="text-xs text-slate-500 truncate">
              {atual.diasAteVencer < 0
                ? `venceu há ${Math.abs(atual.diasAteVencer)} dia${Math.abs(atual.diasAteVencer) === 1 ? '' : 's'}`
                : atual.diasAteVencer === 0 ? 'vence hoje'
                : `vence em ${atual.diasAteVencer} dia${atual.diasAteVencer === 1 ? '' : 's'}`}
            </span>
          )}
        </div>
        {!aberto && (
          <button
            type="button"
            onClick={() => { setAberto(true); setErro(null); }}
            className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-300 hover:text-indigo-200 shrink-0"
          >
            <RefreshCw size={12} /> Marcar como renovado
          </button>
        )}
      </div>

      {aberto && (
        <div className="mt-2 rounded-lg border border-[var(--t-border,#2a3147)] bg-[var(--t-bg-base,#0f1117)] p-2.5">
          <div className="flex items-center justify-between mb-1.5">
            <span className={`${tam} font-medium text-slate-300`}>Nova validade</span>
            <button type="button" onClick={() => { setAberto(false); setErro(null); }} className="text-slate-500 hover:text-slate-300"><X size={13} /></button>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={novaValidade}
              onChange={(e) => setNovaValidade(e.target.value)}
              className="flex-1 text-xs bg-[var(--t-bg-card,#1a1f2e)] border border-[var(--t-border,#2a3147)] rounded px-2 py-1.5 text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
            />
            <button
              type="button"
              onClick={confirmar}
              disabled={salvando || !novaValidade}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-white px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
            >
              {salvando && <Loader2 size={12} className="animate-spin" />} Confirmar
            </button>
          </div>
          {atual && (
            <p className="text-[11px] text-slate-500 mt-1.5">
              O ciclo que vence em {formatarDataIsoSemFuso(atual.validadeEm)} fica registrado como renovado.
            </p>
          )}
          {erro && <p className="text-xs text-red-400 mt-1.5">{erro}</p>}
        </div>
      )}

      {laudo.historico.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {laudo.historico.map((c) => (
            <li key={c.id} className="flex items-center gap-2 text-[11px] text-slate-500">
              <span className={`px-1.5 py-0.5 rounded-full ${CLASSE_STATUS.renovado}`}>{ROTULO_STATUS_LAUDO.renovado}</span>
              <span>vencia {formatarDataIsoSemFuso(c.validadeEm)}</span>
              {c.renovadoEm && <span>· renovado em {dataHoraCurta(c.renovadoEm)}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function LaudoCicloCard(props: {
  leadId: string;
  validade: string | null | undefined;
  compacto?: boolean;
  onRenovado?: (novaValidade: string) => void;
}) {
  return (
    <Boundary>
      <CardInterno leadId={props.leadId} validade={props.validade} compacto={!!props.compacto} onRenovado={props.onRenovado} />
    </Boundary>
  );
}
