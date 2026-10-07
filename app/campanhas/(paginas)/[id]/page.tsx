// Detalhe de campanha (abas Visão geral/Empresas/Decisores/Mensagens/Resultados).
'use client';

import { use } from 'react';
import CampanhaDetalhe from '@/components/automacao/CampanhaDetalhe';

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <CampanhaDetalhe id={id} />;
}
