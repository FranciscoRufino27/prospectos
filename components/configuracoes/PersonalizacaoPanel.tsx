'use client';

import { useState } from 'react';
import { PanelLeft, Palette } from 'lucide-react';
import MenuPersonalizacaoPanel from './MenuPersonalizacaoPanel';
import SeletorTema from '@/components/tema/SeletorTema';

// Personalização: 2 abas (Menu / Tema). Menu vale para o workspace; Tema é
// escolha pessoal do usuário.

type Aba = 'menu' | 'tema';

const TABS: { id: Aba; label: string; Icon: typeof PanelLeft }[] = [
  { id: 'menu', label: 'Menu', Icon: PanelLeft },
  { id: 'tema', label: 'Tema', Icon: Palette },
];

export default function PersonalizacaoPanel() {
  const [aba, setAba] = useState<Aba>('menu');

  return (
    <div className="space-y-5">
      {/* Sub-abas */}
      <div className="flex items-center gap-1 border-b border-[var(--border)]">
        {TABS.map(({ id, label, Icon }) => (
          <button key={id} onClick={() => setAba(id)}
            className={`px-4 py-2 text-sm font-semibold inline-flex items-center gap-2 border-b-2 -mb-px transition-colors ${
              aba === id ? 'border-indigo-400 text-indigo-300' : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {/* --- Aba Menu --- */}
      {aba === 'menu' && <MenuPersonalizacaoPanel />}

      {/* --- Aba Tema (escolha pessoal, não do workspace) --- */}
      {aba === 'tema' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-400">Aparência das telas. Aplica na hora, vale só para você e neste navegador — não muda o tema dos outros usuários.</p>
          <div className="max-w-3xl"><SeletorTema /></div>
        </div>
      )}
    </div>
  );
}
