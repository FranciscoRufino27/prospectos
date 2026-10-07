'use client';

import { Suspense, useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Megaphone, Workflow, Layers, Activity } from 'lucide-react';
import { AbasModulo, PaginaModulo } from '@/components/tema/Modulo';
import CampanhasPanel from '@/components/automacao/CampanhasPanel';
import WorkflowsPanel from '@/components/automacao/WorkflowsPanel';
import ModelosPanel from '@/components/automacao/ModelosPanel';
import ExecucoesPanel from '@/components/automacao/ExecucoesPanel';

// Módulo Campanhas (/campanhas): Campanhas, Workflows, Modelos e Execuções são
// abas internas (?tab=). As rotas antigas (/automacao, /workflows, /tarefas)
// redirecionam para cá — /automacao via next.config.ts.
// useSearchParams() exige limite de Suspense (Next) — conteúdo real em Inner.
export default function CampanhasModuloPage() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}

type Aba = 'campanhas' | 'workflows' | 'modelos' | 'execucoes';
const ABAS: Aba[] = ['campanhas', 'workflows', 'modelos', 'execucoes'];

function Inner() {
  const searchParams = useSearchParams();
  const [aba, setAba] = useState<Aba>('campanhas');

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab && (ABAS as string[]).includes(tab)) setAba(tab as Aba);
  }, [searchParams]);

  const TABS: { id: Aba; label: string; Icon: typeof Megaphone }[] = [
    { id: 'campanhas', label: 'Campanhas', Icon: Megaphone },
    { id: 'workflows', label: 'Workflows', Icon: Workflow },
    { id: 'modelos', label: 'Modelos', Icon: Layers },
    { id: 'execucoes', label: 'Execuções', Icon: Activity },
  ];

  return (
    <PaginaModulo
      grupo="Execução"
      titulo="Campanhas"
      subtitulo="Campanhas, workflows, modelos reutilizáveis e execuções — um só lugar."
      abas={<AbasModulo rotulo="Seções de Campanhas" ativa={aba} onChange={setAba} abas={TABS} />}
    >
      <div className="animate-in">
        {aba === 'campanhas' && <CampanhasPanel />}
        {aba === 'workflows' && <WorkflowsPanel />}
        {aba === 'modelos' && <ModelosPanel />}
        {aba === 'execucoes' && <ExecucoesPanel />}
      </div>
    </PaginaModulo>
  );
}
