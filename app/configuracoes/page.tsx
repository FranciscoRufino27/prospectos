'use client';

import { Suspense, useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Settings, Sliders, SlidersHorizontal, Palette, Target, Radar, Plug } from 'lucide-react';
import ParametrosMotorPanel from '@/components/configuracoes/ParametrosMotorPanel';
import ProcessoComercialPanel from '@/components/configuracoes/ProcessoComercialPanel';
import PersonalizacaoPanel from '@/components/configuracoes/PersonalizacaoPanel';
import ObjetivosOperacaoPanel from '@/components/configuracoes/ObjetivosOperacaoPanel';
import PerfilProspeccaoPanel from '@/components/configuracoes/PerfilProspeccaoPanel';
import IntegracoesPanel from '@/components/configuracoes/IntegracoesPanel';
import { AbasModulo, PaginaModulo } from '@/components/tema/Modulo';

// Configurações por workspace: objetivos, motor, processo e personalização.
// Deep-links por ?tab. useSearchParams exige Suspense.
export default function ConfiguracoesPage() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}

type Aba = 'objetivos' | 'prospeccao' | 'motor' | 'processo' | 'personalizacao' | 'integracoes';
const ABAS: Aba[] = ['objetivos', 'prospeccao', 'motor', 'processo', 'personalizacao', 'integracoes'];

function Inner() {
  const searchParams = useSearchParams();
  const [aba, setAba] = useState<Aba>('objetivos');
  // Esconder o item na sidebar não basta: a URL é acessível direto. `null`
  // enquanto carrega, para não piscar "sem permissão" para quem tem.
  const [podeConfigurar, setPodeConfigurar] = useState<boolean | null>(null);

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab && (ABAS as string[]).includes(tab)) setAba(tab as Aba);
  }, [searchParams]);

  useEffect(() => {
    let ativo = true;
    fetch('/api/rbac/permissoes')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!ativo) return;
        const minhas: string[] = Array.isArray(d?.minhas) ? d.minhas : [];
        setPodeConfigurar(minhas.includes('workspace.configure'));
      })
      .catch(() => { if (ativo) setPodeConfigurar(false); });
    return () => { ativo = false; };
  }, []);

  const cabecalho = {
    grupo: 'Administração',
    titulo: 'Configurações',
    subtitulo: 'Objetivos, perfil de busca, motor, processo comercial e personalização do workspace.',
  };

  if (podeConfigurar === null) {
    return (
      <PaginaModulo {...cabecalho}>
        <p className="text-sm text-slate-400">Carregando…</p>
      </PaginaModulo>
    );
  }
  if (!podeConfigurar) {
    return (
      <PaginaModulo {...cabecalho}>
        <div className="card p-10 text-center">
          <Settings size={22} className="mx-auto text-slate-400" />
          <h2 className="mt-3 text-lg font-semibold text-slate-200">Configurações do workspace</h2>
          <p className="mt-1 text-sm text-slate-400">
            Estas configurações valem para toda a operação — motor de cadência, processo comercial e
            personalização. O seu acesso não inclui alterá-las.
          </p>
          <p className="mt-3 text-xs text-slate-500">
            Requer a permissão <code className="text-indigo-300">workspace.configure</code>.
          </p>
        </div>
      </PaginaModulo>
    );
  }

  const TABS = [
    { id: 'objetivos', label: 'Objetivos da operação', Icon: Target },
    { id: 'prospeccao', label: 'Perfil de busca', Icon: Radar },
    { id: 'motor', label: 'Motor de cadência', Icon: Sliders },
    { id: 'processo', label: 'Processo comercial', Icon: SlidersHorizontal },
    { id: 'personalizacao', label: 'Personalização', Icon: Palette },
    { id: 'integracoes', label: 'Integrações', Icon: Plug },
  ] as const;

  return (
    <PaginaModulo
      {...cabecalho}
      abas={<AbasModulo rotulo="Seções das configurações" abas={TABS} ativa={aba} onChange={setAba} />}
    >
      <div className="animate-in">
        {aba === 'objetivos' && <ObjetivosOperacaoPanel />}
        {aba === 'prospeccao' && <PerfilProspeccaoPanel />}
        {aba === 'motor' && <ParametrosMotorPanel />}
        {aba === 'processo' && <ProcessoComercialPanel />}
        {aba === 'personalizacao' && <PersonalizacaoPanel />}
        {aba === 'integracoes' && <IntegracoesPanel />}
      </div>
    </PaginaModulo>
  );
}
