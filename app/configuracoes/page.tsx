'use client';

import { Suspense, useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Settings, Users, Palette, Target, Plug } from 'lucide-react';
import DistribuicaoComercialPanel from '@/components/configuracoes/DistribuicaoComercialPanel';
import PersonalizacaoPanel from '@/components/configuracoes/PersonalizacaoPanel';
import ObjetivosOperacaoPanel from '@/components/configuracoes/ObjetivosOperacaoPanel';
import IntegracoesPanel from '@/components/configuracoes/IntegracoesPanel';
import { AbasModulo, PaginaModulo } from '@/components/tema/Modulo';

// Configurações por workspace: objetivos, distribuição comercial e personalização.
// Deep-links por ?tab. useSearchParams exige Suspense.
export default function ConfiguracoesPage() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}

type Aba = 'objetivos' | 'distribuicao' | 'personalizacao' | 'integracoes';
const ABAS: Aba[] = ['objetivos', 'distribuicao', 'personalizacao', 'integracoes'];
// Abas removidas: o link antigo do processo comercial (/processo-comercial
// redireciona para ?tab=processo) cai na Distribuição, única seção que ficou.
const ABAS_LEGADAS: Record<string, Aba> = { processo: 'distribuicao' };

function Inner() {
  const searchParams = useSearchParams();
  const [aba, setAba] = useState<Aba>('objetivos');
  // Esconder o item na sidebar não basta: a URL é acessível direto. `null`
  // enquanto carrega, para não piscar "sem permissão" para quem tem.
  const [podeConfigurar, setPodeConfigurar] = useState<boolean | null>(null);

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab && (ABAS as string[]).includes(tab)) setAba(tab as Aba);
    else if (tab && ABAS_LEGADAS[tab]) setAba(ABAS_LEGADAS[tab]);
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
    subtitulo: 'Objetivos, distribuição comercial e personalização do workspace.',
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
            Estas configurações valem para toda a operação — objetivos, distribuição comercial e
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
    { id: 'distribuicao', label: 'Distribuição', Icon: Users },
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
        {aba === 'distribuicao' && <DistribuicaoComercialPanel />}
        {aba === 'personalizacao' && <PersonalizacaoPanel />}
        {aba === 'integracoes' && <IntegracoesPanel />}
      </div>
    </PaginaModulo>
  );
}
