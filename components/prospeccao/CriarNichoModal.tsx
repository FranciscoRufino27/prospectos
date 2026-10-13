'use client';

// Criar um nicho da organização só pelo nome: o servidor escolhe as atividades
// (CNAE) que correspondem a ele e devolve quais entraram. Atividade fora do
// catálogo gera o pedido de carga e a tela mostra "Buscando".
import { useEffect, useState } from 'react';
import { AlertCircle, Loader2, Plus, X } from 'lucide-react';
import { NICHOS_PERSONALIZADOS_LIMITES } from '@/lib/config/workspaceConfig';
import type { RespostaNichosOrg } from './useNichosOrg';
import s from './Prospeccao.module.css';

export interface NichoCriado extends RespostaNichosOrg {
  nichoId: string;
}

export default function CriarNichoModal({
  termoInicial = '',
  onFechar,
  onCriado,
}: {
  termoInicial?: string;
  onFechar: () => void;
  onCriado: (resposta: NichoCriado) => void;
}) {
  const [nome, setNome] = useState(termoInicial.trim().slice(0, NICHOS_PERSONALIZADOS_LIMITES.nome));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    // Captura: roda antes do Esc da gaveta do perfil, que respeita defaultPrevented.
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !salvando) { e.preventDefault(); onFechar(); } };
    document.addEventListener('keydown', esc, true);
    return () => document.removeEventListener('keydown', esc, true);
  }, [onFechar, salvando]);

  async function salvar() {
    if (salvando) return;
    if (!nome.trim()) return setErro('Dê um nome ao nicho.');
    setSalvando(true);
    setErro(null);
    try {
      const res = await fetch('/api/prospeccao/nichos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: nome.trim() }),
      });
      const corpo = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(corpo?.erro || 'Não foi possível criar o nicho.');
      onCriado(corpo as NichoCriado);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível criar o nicho.');
      setSalvando(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !salvando) onFechar(); }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="criar-nicho-titulo" className={`${s.panel} w-full max-w-md space-y-3 p-5`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="criar-nicho-titulo" className="text-base font-semibold text-[var(--m-title,#e5edf8)]">Criar nicho</h2>
            <p className="mt-0.5 text-xs text-[var(--m-muted,#8194b0)]">Ele fica disponível para toda a equipe.</p>
          </div>
          <button type="button" onClick={onFechar} disabled={salvando} aria-label="Fechar" className={`${s.profileClose} focus-ring`}><X size={17} /></button>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); void salvar(); }}>
          <label className={s.profileFieldLabel}>
            <span>Nome do nicho</span>
            <input
              value={nome}
              onChange={(e) => { setNome(e.target.value); setErro(null); }}
              maxLength={NICHOS_PERSONALIZADOS_LIMITES.nome}
              placeholder="Ex.: Academias, Dentistas, Padarias"
              autoFocus
              className={`${s.field} px-3 focus-ring`}
            />
          </label>
        </form>

        {erro && <p className={s.errorNotice}><AlertCircle size={14} /> {erro}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onFechar} disabled={salvando} className={`${s.outlineButton} focus-ring`}>Cancelar</button>
          <button type="button" onClick={salvar} disabled={salvando} className={`${s.primaryButton} disabled:opacity-50 focus-ring`}>
            {salvando ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} {salvando ? 'Criando…' : 'Criar nicho'}
          </button>
        </div>
      </div>
    </div>
  );
}
