// Edição do conteúdo das mensagens de uma campanha publicada.
'use client';

import { use } from 'react';
import CampanhaMensagensEditor from '@/components/automacao/CampanhaMensagensEditor';

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <CampanhaMensagensEditor id={id} />;
}
