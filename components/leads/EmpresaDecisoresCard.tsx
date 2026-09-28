'use client';

// Cartão ADITIVO e FAIL-SAFE do LeadPanel (Fase 2e): mostra a Empresa como
// entidade (CNPJ, flag de revisão) e os DECISORES (N contatos da empresa) vindos
// da nova camada de leitura. Só aparece quando features.empresaContatoReads está
// ligado na organização (decidido no servidor: /entidades retorna
// { ativo:false } quando off). Em QUALQUER falha (fetch, flag off, vazio
// ou erro de render) renderiza NADA — nunca afeta o resto do painel. Rollback é
// instantâneo (desligar o flag).
import { Component, useEffect, useState, type ReactNode } from 'react';
import { Building2, BadgeCheck, AlertTriangle } from 'lucide-react';
import { formatarCnpj } from '@/lib/empresas/cnpj';

interface Decisor { id: string | null; nome: string | null; cargo: string | null; email: string | null; emailValidado: boolean }
interface Dados {
  ativo?: boolean;
  empresa?: { id: string | null; nome: string | null; cnpj: string | null; revisaoPendente: boolean; motivoRevisao: string | null };
  contato?: { id: string | null };
  decisores?: Decisor[];
}

// Error boundary local: um erro de render aqui NÃO derruba o LeadPanel.
class Boundary extends Component<{ children: ReactNode }, { erro: boolean }> {
  constructor(p: { children: ReactNode }) { super(p); this.state = { erro: false }; }
  static getDerivedStateFromError() { return { erro: true }; }
  render() { return this.state.erro ? null : this.props.children; }
}

function CardInterno({ leadId }: { leadId: string }) {
  const [dados, setDados] = useState<Dados | null>(null);
  useEffect(() => {
    let vivo = true;
    fetch(`/api/leads/${leadId}/entidades`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (vivo) setDados(d); })
      .catch(() => { if (vivo) setDados(null); });
    return () => { vivo = false; };
  }, [leadId]);

  if (!dados?.ativo || !dados.empresa) return null;
  const emp = dados.empresa;
  const decisores = dados.decisores ?? [];

  return (
    <div className="px-5 py-2.5 border-b border-[var(--t-border,#2a3147)] bg-[var(--t-bg-subtle,#151a27)]">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0 text-xs font-semibold text-slate-300">
          <Building2 size={13} className="text-indigo-400 shrink-0" />
          <span className="truncate">{emp.nome || '—'}</span>
          {emp.cnpj && <span className="text-slate-500 shrink-0">· {formatarCnpj(emp.cnpj)}</span>}
          {emp.revisaoPendente && (
            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 shrink-0"
              title={emp.motivoRevisao ?? 'Revisão pendente'}>
              <AlertTriangle size={10} /> revisão
            </span>
          )}
        </div>
        <span className="text-[11px] text-slate-500 shrink-0">{decisores.length} {decisores.length === 1 ? 'decisor' : 'decisores'}</span>
      </div>

      {decisores.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {decisores.map((d) => (
            <li key={d.id ?? d.email ?? d.nome} className="flex items-center gap-1.5 text-xs min-w-0">
              <span className="text-slate-300 truncate">{d.nome || '—'}</span>
              {d.cargo && <span className="text-slate-500 shrink-0">· {d.cargo}</span>}
              {d.email && <span className="text-slate-500 truncate">· {d.email}</span>}
              {d.emailValidado && <BadgeCheck size={11} className="text-green-500 shrink-0" />}
              {dados.contato?.id && d.id === dados.contato.id && (
                <span className="text-[10px] text-indigo-400 shrink-0">principal</span>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-1 text-[10px] text-slate-600">via camada de entidades</div>
    </div>
  );
}

export default function EmpresaDecisoresCard({ leadId }: { leadId: string }) {
  return (
    <Boundary>
      <CardInterno leadId={leadId} />
    </Boundary>
  );
}
