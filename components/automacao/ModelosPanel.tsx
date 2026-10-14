'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Workflow as WorkflowIcon, FileText, Loader2, ArrowRight } from 'lucide-react';
import TemplatesPanel from '@/components/templates/TemplatesPanel';

// Painel de Modelos — dentro de Automação. Centraliza modelos reutilizáveis SEM
// tabela nova: modelos de workflow (lib/workflows/modelos via /api/workflows/modelos)
// e templates de mensagem (tabela `templates`, reusa o TemplatesPanel já existente).

interface ModeloWorkflow {
  chave: string;
  nome: string;
  descricao: string;
  definicao: { blocos?: unknown[] } | null;
}

type SubAba = 'workflows' | 'mensagens';

function ModelosWorkflow() {
  const [modelos, setModelos] = useState<ModeloWorkflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [negado, setNegado] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/workflows/modelos');
        if (r.status === 403) { setNegado(true); return; }
        const data = r.ok ? await r.json() : { modelos: [] };
        setModelos(data.modelos ?? []);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (negado) {
    return (
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-10 text-center text-slate-400 text-sm">
        Sem permissão para ver modelos de workflow (requer <code className="text-indigo-300">workflows.view</code>).
      </div>
    );
  }
  if (loading) return <div className="p-10 text-center text-slate-500 text-sm"><Loader2 size={16} className="inline animate-spin" /> Carregando modelos…</div>;
  if (modelos.length === 0) return <div className="p-10 text-center text-slate-500 text-sm">Nenhum modelo de workflow disponível.</div>;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {modelos.map((m) => {
        const etapas = Array.isArray(m.definicao?.blocos) ? m.definicao!.blocos!.length : 0;
        return (
          <div key={m.chave} className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4 flex flex-col">
            <div className="flex items-start gap-3">
              <span className="flex items-center justify-center w-9 h-9 rounded-lg shrink-0 bg-indigo-500/10 text-indigo-300">
                <WorkflowIcon size={17} />
              </span>
              <div className="min-w-0">
                <h3 className="font-semibold text-slate-100 leading-snug">{m.nome}</h3>
                <p className="text-xs text-slate-500 mt-0.5">{m.descricao}</p>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-[11px] text-slate-500">{etapas} bloco{etapas === 1 ? '' : 's'}</span>
              <Link href="/campanhas?tab=workflows" className="text-xs text-indigo-300 hover:text-indigo-200 inline-flex items-center gap-1">
                Usar no builder <ArrowRight size={12} />
              </Link>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function ModelosPanel() {
  const [sub, setSub] = useState<SubAba>('workflows');
  const TABS: { id: SubAba; label: string; Icon: typeof WorkflowIcon }[] = [
    { id: 'workflows', label: 'Workflows', Icon: WorkflowIcon },
    { id: 'mensagens', label: 'Mensagens', Icon: FileText },
  ];
  return (
    <div className="space-y-5">
      <div className="flex items-center rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-0.5 w-fit">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setSub(t.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors focus-ring ${sub === t.id ? 'bg-indigo-500/20 text-indigo-300' : 'text-slate-400 hover:text-slate-200'}`}>
            <t.Icon size={14} /> {t.label}
          </button>
        ))}
      </div>
      {sub === 'workflows' ? <ModelosWorkflow /> : <TemplatesPanel />}
    </div>
  );
}
