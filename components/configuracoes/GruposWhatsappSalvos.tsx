'use client';

import { useState } from 'react';
import { Loader2, Plus, Trash2, Users } from 'lucide-react';
import { FORMATO_ID_GRUPO_WHATSAPP, LIMITE_GRUPOS_WHATSAPP, type GrupoWhatsappSalvo } from '@/lib/config/workspaceConfig';

// Grupos do WhatsApp salvos com nome (organizacoes.configuracoes.comercial.
// gruposWhatsapp). Servem para escolher o grupo pelo nome aqui e nas campanhas;
// não mudam para onde o aviso vai. A lista da Z-API só preenche o formulário.

const campo = 'bg-[var(--bg-base)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 disabled:opacity-50';

export default function GruposWhatsappSalvos({ grupos, podeEditar, onAlterado }: {
  grupos: GrupoWhatsappSalvo[];
  podeEditar: boolean;
  onAlterado: (grupos: GrupoWhatsappSalvo[]) => void;
}) {
  const [disponiveis, setDisponiveis] = useState<GrupoWhatsappSalvo[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [manual, setManual] = useState(false);
  const [id, setId] = useState('');
  const [nome, setNome] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const naoSalvos = (disponiveis ?? []).filter((g) => !grupos.some((s) => s.id === g.id));
  const idValido = FORMATO_ID_GRUPO_WHATSAPP.test(id.trim());
  const cheio = grupos.length >= LIMITE_GRUPOS_WHATSAPP;

  async function buscar() {
    setBuscando(true); setErro(null);
    try {
      const res = await fetch('/api/whatsapp/grupos');
      const j = await res.json().catch(() => null);
      if (!res.ok) { setErro(j?.erro ?? 'Não foi possível listar os grupos do WhatsApp.'); setManual(true); return; }
      setDisponiveis(Array.isArray(j?.grupos) ? j.grupos : []);
      setManual(false);
    } finally { setBuscando(false); }
  }

  async function gravar(lista: GrupoWhatsappSalvo[]) {
    setSalvando(true); setErro(null);
    try {
      const res = await fetch('/api/configuracoes/workspace', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comercialGruposWhatsapp: lista }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) { setErro(j?.erro ?? 'Não foi possível salvar.'); return false; }
      onAlterado(Array.isArray(j?.config?.comercial?.gruposWhatsapp) ? j.config.comercial.gruposWhatsapp : []);
      return true;
    } finally { setSalvando(false); }
  }

  async function adicionar() {
    if (!idValido || !nome.trim() || cheio) return;
    if (await gravar([...grupos, { id: id.trim(), nome: nome.trim() }])) { setId(''); setNome(''); }
  }

  function escolher(valor: string) {
    setId(valor);
    setNome(disponiveis?.find((g) => g.id === valor)?.nome ?? '');
  }

  return (
    <div className="pt-4 border-t border-[var(--border)] space-y-2">
      <div className="text-sm font-semibold text-slate-200 inline-flex items-center gap-2">
        <Users size={14} className="text-green-400" /> Grupos do WhatsApp
      </div>
      <p className="text-xs text-slate-500">
        Salve os grupos com nome para escolher pelo nome no grupo de avisos e nas campanhas, sem digitar o identificador.
      </p>

      {grupos.length > 0 ? (
        <ul className="space-y-1.5">
          {grupos.map((g) => (
            <li key={g.id} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border)] px-3 py-1.5">
              <span className="min-w-0">
                <span className="block truncate text-sm text-slate-200">{g.nome}</span>
                <code className="block truncate text-[11px] text-slate-500">{g.id}</code>
              </span>
              {podeEditar && (
                <button
                  onClick={() => gravar(grupos.filter((s) => s.id !== g.id))}
                  disabled={salvando}
                  aria-label={`Remover o grupo ${g.nome}`}
                  className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-white/5 hover:text-red-300 disabled:opacity-40"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-slate-500">Nenhum grupo salvo.</p>
      )}

      {podeEditar && !cheio && (
        <div className="space-y-2">
          {!disponiveis && !manual && (
            <div className="flex flex-wrap items-center gap-3">
              <button onClick={buscar} disabled={buscando}
                className="px-3 py-2 rounded-lg border border-[var(--border)] text-sm text-slate-200 hover:bg-white/5 disabled:opacity-50 inline-flex items-center gap-1.5">
                {buscando ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Adicionar grupo do WhatsApp
              </button>
              <button onClick={() => setManual(true)} className="text-xs text-slate-400 hover:text-slate-200 underline underline-offset-2">
                Informar o identificador manualmente
              </button>
            </div>
          )}

          {(disponiveis || manual) && (
            <div className="flex flex-wrap items-center gap-2">
              {disponiveis && !manual ? (
                <select className={`${campo} min-w-[220px]`} value={id} onChange={(e) => escolher(e.target.value)} disabled={salvando}>
                  <option value="">{naoSalvos.length ? 'Escolha o grupo…' : 'Todos os grupos já estão salvos'}</option>
                  {naoSalvos.map((g) => <option key={g.id} value={g.id}>{g.nome}</option>)}
                </select>
              ) : (
                <input className={`${campo} w-[260px]`} value={id} onChange={(e) => setId(e.target.value)} placeholder="120363019502650977-group" spellCheck={false} disabled={salvando} />
              )}
              <input className={`${campo} flex-1 min-w-[180px]`} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome do grupo" maxLength={80} disabled={salvando} />
              <button onClick={adicionar} disabled={salvando || !idValido || !nome.trim()}
                className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-500 disabled:opacity-40 inline-flex items-center gap-1 shrink-0">
                {salvando ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Salvar grupo
              </button>
              <button onClick={() => { setDisponiveis(null); setManual(false); setId(''); setNome(''); setErro(null); }} disabled={salvando}
                className="text-xs text-slate-400 hover:text-slate-200 underline underline-offset-2">
                Cancelar
              </button>
            </div>
          )}
          {manual && id.trim() && !idValido && (
            <p className="text-xs text-amber-300">O identificador precisa estar no formato 120363019502650977-group.</p>
          )}
        </div>
      )}
      {cheio && podeEditar && <p className="text-xs text-slate-500">Limite de {LIMITE_GRUPOS_WHATSAPP} grupos salvos.</p>}
      {erro && <div className="text-xs text-red-400">{erro}</div>}
    </div>
  );
}
