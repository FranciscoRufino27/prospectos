'use client';

// Cartão ADITIVO e FAIL-SAFE do LeadPanel (Fase 4.5): gerencia os serviços
// recorrentes / laudos da EMPRESA do lead — listar, cadastrar, editar, arquivar.
// vencimento_em é calculado no banco (preview local por calcularVencimento).
// Qualquer erro de render é contido (error boundary) e não afeta o painel.
import { Component, useState, useEffect, useCallback, type ReactNode } from 'react';
import { FileCheck2, Plus, Archive, Pencil, X } from 'lucide-react';
import { calcularVencimento, diasAteVencimento, type UnidadePeriodicidade } from '@/lib/servicos/vencimento';

interface Servico {
  id: string; tipo: string | null; realizado_em: string | null;
  periodicidade_valor: number | null; periodicidade_unidade: string | null;
  vencimento_em: string | null; status: string; responsavel_id: string | null;
  observacoes: string | null; arquivado: boolean;
}
interface Usuario { id: string; nome: string | null }

const UNIDADES: UnidadePeriodicidade[] = ['dias', 'meses', 'anos'];
const STATUS = ['vigente', 'vencido', 'renovado', 'cancelado'];
const vazio = { id: '', tipo: 'laudo', realizado_em: '', periodicidade_valor: '6', periodicidade_unidade: 'meses', status: 'vigente', responsavel_id: '', observacoes: '' };

class Boundary extends Component<{ children: ReactNode }, { erro: boolean }> {
  constructor(p: { children: ReactNode }) { super(p); this.state = { erro: false }; }
  static getDerivedStateFromError() { return { erro: true }; }
  render() { return this.state.erro ? null : this.props.children; }
}

function CardInterno({ leadId }: { leadId: string }) {
  const [empresaId, setEmpresaId] = useState<string | null>(null);
  const [servicos, setServicos] = useState<Servico[]>([]);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [form, setForm] = useState({ ...vazio });
  const [aberto, setAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const [rs, ru] = await Promise.all([
        fetch(`/api/leads/${leadId}/servicos`).then((r) => (r.ok ? r.json() : null)),
        fetch('/api/usuarios').then((r) => (r.ok ? r.json() : { usuarios: [] })),
      ]);
      setEmpresaId(rs?.empresaId ?? null);
      setServicos(rs?.servicos ?? []);
      setUsuarios(ru?.usuarios ?? []);
    } catch { /* fail-safe */ }
  }, [leadId]);
  useEffect(() => { carregar(); }, [carregar]);

  async function salvar() {
    setSalvando(true);
    try {
      const body = {
        tipo: form.tipo || null,
        realizado_em: form.realizado_em || null,
        periodicidade_valor: form.periodicidade_valor ? Number(form.periodicidade_valor) : null,
        periodicidade_unidade: form.periodicidade_unidade,
        status: form.status,
        responsavel_id: form.responsavel_id || null,
        observacoes: form.observacoes || null,
      };
      if (form.id) {
        await fetch(`/api/servicos/${form.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      } else {
        await fetch(`/api/leads/${leadId}/servicos`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      }
      setForm({ ...vazio }); setAberto(false);
      await carregar();
    } finally { setSalvando(false); }
  }
  async function arquivar(id: string) {
    await fetch(`/api/servicos/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ arquivado: true }) });
    await carregar();
  }
  function editar(s: Servico) {
    setForm({
      id: s.id, tipo: s.tipo ?? '', realizado_em: s.realizado_em ?? '',
      periodicidade_valor: s.periodicidade_valor != null ? String(s.periodicidade_valor) : '',
      periodicidade_unidade: s.periodicidade_unidade ?? 'meses', status: s.status,
      responsavel_id: s.responsavel_id ?? '', observacoes: s.observacoes ?? '',
    });
    setAberto(true);
  }

  if (!empresaId) return null; // lead sem empresa vinculada: nada a gerenciar
  const ativos = servicos.filter((s) => !s.arquivado);
  const previewVenc = calcularVencimento(form.realizado_em, form.periodicidade_valor ? Number(form.periodicidade_valor) : null, form.periodicidade_unidade as UnidadePeriodicidade);

  return (
    <div className="px-5 py-2.5 border-b border-[var(--t-border,#2a3147)] bg-[var(--t-bg-subtle,#151a27)]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
          <FileCheck2 size={13} className="text-indigo-400" /> Laudos / serviços recorrentes
          <span className="text-slate-500">· {ativos.length}</span>
        </div>
        <button onClick={() => { setForm({ ...vazio }); setAberto((v) => !v); }}
          className="text-[11px] inline-flex items-center gap-1 text-indigo-300 hover:text-indigo-200">
          {aberto ? <><X size={12} /> fechar</> : <><Plus size={12} /> novo</>}
        </button>
      </div>

      {ativos.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {ativos.map((s) => {
            const dias = diasAteVencimento(s.vencimento_em);
            const cor = dias == null ? 'text-slate-500' : dias < 0 ? 'text-red-400' : dias <= 45 ? 'text-amber-400' : 'text-slate-400';
            return (
              <li key={s.id} className="flex items-center gap-2 text-xs min-w-0">
                <span className="text-slate-300 truncate">{s.tipo || 'serviço'}</span>
                <span className="text-slate-500">· {s.periodicidade_valor ?? '?'} {s.periodicidade_unidade ?? ''}</span>
                <span className={cor}>· vence {s.vencimento_em ?? '—'}{dias != null ? ` (${dias}d)` : ''}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--t-bg-input,#252b3b)] text-slate-400">{s.status}</span>
                <span className="ml-auto flex items-center gap-1 shrink-0">
                  <button onClick={() => editar(s)} title="Editar" className="text-slate-500 hover:text-slate-200"><Pencil size={12} /></button>
                  <button onClick={() => arquivar(s.id)} title="Arquivar" className="text-slate-500 hover:text-amber-400"><Archive size={12} /></button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {aberto && (
        <div className="mt-2 grid grid-cols-2 gap-2 text-xs bg-[var(--t-bg-base,#0f1117)] p-2 rounded-lg border border-[var(--t-border,#2a3147)]">
          <label className="flex flex-col gap-0.5">Tipo do laudo
            <input value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })} className="bg-[var(--t-bg-card,#1a1f2e)] border border-[var(--t-border,#2a3147)] rounded px-2 py-1" />
          </label>
          <label className="flex flex-col gap-0.5">Data do último laudo
            <input type="date" value={form.realizado_em} onChange={(e) => setForm({ ...form, realizado_em: e.target.value })} className="bg-[var(--t-bg-card,#1a1f2e)] border border-[var(--t-border,#2a3147)] rounded px-2 py-1" />
          </label>
          <label className="flex flex-col gap-0.5">Periodicidade / validade
            <div className="flex gap-1">
              <input type="number" min={1} value={form.periodicidade_valor} onChange={(e) => setForm({ ...form, periodicidade_valor: e.target.value })} className="bg-[var(--t-bg-card,#1a1f2e)] border border-[var(--t-border,#2a3147)] rounded px-2 py-1 w-16" />
              <select value={form.periodicidade_unidade} onChange={(e) => setForm({ ...form, periodicidade_unidade: e.target.value })} className="bg-[var(--t-bg-card,#1a1f2e)] border border-[var(--t-border,#2a3147)] rounded px-1 py-1 flex-1">
                {UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </label>
          <label className="flex flex-col gap-0.5">Próximo vencimento (calculado)
            <input value={previewVenc ?? '—'} readOnly className="bg-[var(--t-bg-subtle,#12151f)] border border-[var(--t-border,#2a3147)] rounded px-2 py-1 text-slate-400" />
          </label>
          <label className="flex flex-col gap-0.5">Status
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="bg-[var(--t-bg-card,#1a1f2e)] border border-[var(--t-border,#2a3147)] rounded px-2 py-1">
              {STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-0.5">Responsável
            <select value={form.responsavel_id} onChange={(e) => setForm({ ...form, responsavel_id: e.target.value })} className="bg-[var(--t-bg-card,#1a1f2e)] border border-[var(--t-border,#2a3147)] rounded px-2 py-1">
              <option value="">—</option>
              {usuarios.map((u) => <option key={u.id} value={u.id}>{u.nome ?? u.id}</option>)}
            </select>
          </label>
          <label className="col-span-2 flex flex-col gap-0.5">Observações
            <textarea value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} rows={2} className="bg-[var(--t-bg-card,#1a1f2e)] border border-[var(--t-border,#2a3147)] rounded px-2 py-1" />
          </label>
          <div className="col-span-2 flex justify-end">
            <button onClick={salvar} disabled={salvando} className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-3 py-1.5 rounded text-xs font-medium">
              {salvando ? 'Salvando…' : form.id ? 'Salvar alterações' : 'Cadastrar laudo'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ServicosLaudosCard({ leadId }: { leadId: string }) {
  return (
    <Boundary>
      <CardInterno leadId={leadId} />
    </Boundary>
  );
}
