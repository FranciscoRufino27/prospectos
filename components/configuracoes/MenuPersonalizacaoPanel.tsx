'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, Eye, EyeOff, Info, Loader2, Lock, PanelLeft, RotateCcw, Save, Settings } from 'lucide-react';
import { agruparMenu, EVENTO_MENU_ATUALIZADO, ITENS_MENU, itemVisivel, modulosComMenu } from '@/lib/navegacao/menu';
import { ICONE_MENU } from '@/components/layout/iconesMenu';
import { estilosModulo as m, TituloSecao } from '@/components/tema/Modulo';

// Personalização > Menu: o que aparece no menu lateral da organização. Grava
// organizacoes.configuracoes.modulos pelo PUT do workspace (workspace.configure).
// Esconder é só visual: a rota segue acessível e o RBAC continua no servidor.

const iguais = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

export default function MenuPersonalizacaoPanel() {
  const [modulosServidor, setModulosServidor] = useState<Record<string, boolean>>({});
  const [ocultos, setOcultos] = useState<string[]>([]);
  const [podeEditar, setPodeEditar] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const ocultosServidor = useMemo(
    () => ITENS_MENU.filter((i) => !itemVisivel(modulosServidor, i.id)).map((i) => i.id),
    [modulosServidor],
  );

  useEffect(() => {
    fetch('/api/configuracoes/workspace')
      .then(async (r) => {
        if (!r.ok) throw new Error('Não foi possível carregar o menu.');
        return r.json();
      })
      .then((d) => {
        const mods: Record<string, boolean> = d?.config?.modulos ?? {};
        setModulosServidor(mods);
        setOcultos(ITENS_MENU.filter((i) => !itemVisivel(mods, i.id)).map((i) => i.id));
        setPodeEditar(!!d?.podeEditar);
      })
      .catch((e) => setErro(e instanceof Error ? e.message : 'Erro ao carregar'))
      .finally(() => setCarregando(false));
  }, []);

  const alterado = !iguais(ocultos, ocultosServidor);
  const visiveis = ITENS_MENU.filter((i) => !ocultos.includes(i.id));

  function alternar(id: string) {
    if (!podeEditar) return;
    setSalvo(false);
    setOcultos((atual) => (atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id]));
  }

  async function salvar() {
    if (!podeEditar || salvando || !alterado || visiveis.length === 0) return;
    setSalvando(true);
    setErro(null);
    try {
      const modulos = modulosComMenu(modulosServidor, ocultos);
      const r = await fetch('/api/configuracoes/workspace', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modulos }),
      });
      const corpo = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(corpo?.erro || 'Falha ao salvar o menu');
      const gravado: Record<string, boolean> = corpo?.config?.modulos ?? modulos;
      setModulosServidor(gravado);
      window.dispatchEvent(new CustomEvent(EVENTO_MENU_ATUALIZADO, { detail: gravado }));
      setSalvo(true);
      setTimeout(() => setSalvo(false), 2500);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSalvando(false);
    }
  }

  if (carregando) return <p className="text-sm text-slate-400">Carregando…</p>;

  return (
    <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
      <section className={m.painel}>
        <div className={m.painelBarra}>
          <TituloSecao
            icone={PanelLeft}
            titulo="Itens do menu lateral"
            subtitulo="Escolha o que aparece no menu para toda a equipe desta conta."
          />
          <span className="shrink-0 text-xs text-slate-400">{visiveis.length} de {ITENS_MENU.length} visíveis</span>
        </div>

        <div className="grid gap-2 p-4">
          {!podeEditar && (
            <p className="flex items-center gap-2 rounded-lg border border-[var(--m-border-subtle,#17496e)] bg-[var(--m-surface-inset,rgba(3,24,45,0.72))] px-3 py-2 text-xs text-slate-400">
              <Lock size={13} /> Somente leitura — requer a permissão <code className="text-indigo-300">workspace.configure</code>.
            </p>
          )}

          {agruparMenu(ITENS_MENU).map((grupo) => (
            <div key={grupo.id} className="grid gap-2">
              <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">{grupo.label}</p>
              {grupo.itens.map((item) => {
                const Icone = ICONE_MENU[item.id];
                const visivel = !ocultos.includes(item.id);
                return (
                  <div
                    key={item.id}
                    className={`flex items-center gap-3 rounded-[11px] border px-3 py-2.5 transition-colors ${
                      visivel ? 'border-[var(--m-border,#155987)] bg-[var(--m-surface-inset,rgba(3,24,45,0.6))]' : 'border-dashed border-[var(--m-border,#1f4a70)] bg-transparent opacity-70'
                    }`}
                  >
                    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-[9px] ${visivel ? 'bg-indigo-500/20 text-indigo-200' : 'bg-slate-500/10 text-slate-500'}`}>
                      {Icone && <Icone size={17} aria-hidden="true" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-slate-100">{item.label}</div>
                      <div className="truncate text-xs text-slate-400">{item.descricao} <span className="font-mono text-slate-500">{item.href}</span></div>
                    </div>
                    <span className={`hidden items-center gap-1 text-xs sm:inline-flex ${visivel ? 'text-emerald-300' : 'text-slate-500'}`}>
                      {visivel ? <><Eye size={13} /> Visível</> : <><EyeOff size={13} /> Oculto</>}
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={visivel}
                      aria-label={`${visivel ? 'Esconder' : 'Mostrar'} ${item.label} no menu`}
                      disabled={!podeEditar}
                      onClick={() => alternar(item.id)}
                      className="relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors focus-ring disabled:cursor-not-allowed disabled:opacity-50"
                      style={{ background: visivel ? 'var(--accent)' : '#334155', boxShadow: visivel ? '0 0 10px rgba(99,102,241,0.5)' : undefined }}
                    >
                      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${visivel ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </button>
                  </div>
                );
              })}
            </div>
          ))}

          <p className="mt-2 flex items-start gap-2 text-xs text-slate-400">
            <Info size={13} className="mt-0.5 shrink-0 text-sky-300" />
            Esconder só tira o item do menu — quem tiver o link ainda abre a página, e as permissões de cada pessoa continuam valendo.
            Configurações sempre aparece, em Administração, para quem administra a conta.
          </p>
        </div>
      </section>

      {/* Prévia + salvar */}
      <aside className={`${m.painel} xl:sticky xl:top-4`}>
        <div className={m.painelBarra}>
          <TituloSecao icone={Eye} titulo="Prévia do menu" subtitulo={alterado ? 'Alterações ainda não salvas.' : 'É o que a equipe vê agora.'} />
        </div>
        <div className="p-4">
          <nav aria-label="Prévia do menu" className="grid gap-1 rounded-xl bg-[var(--sb-bg)] p-2.5">
            {agruparMenu(visiveis, ['administracao']).map((grupo) => (
              <div key={grupo.id} className="grid gap-0.5 [&+&]:mt-2">
                <span className="px-2.5 pb-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-indigo-300/60">{grupo.label}</span>
                {grupo.itens.map((item) => {
                  const Icone = ICONE_MENU[item.id];
                  return (
                    <span key={item.id} className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium text-indigo-200">
                      {Icone && <Icone size={16} strokeWidth={1.8} aria-hidden="true" />} {item.label}
                    </span>
                  );
                })}
                {grupo.id === 'administracao' && (
                  <span className="flex items-center gap-2.5 px-2.5 py-2 text-[13px] font-medium text-indigo-300/70">
                    <Settings size={16} strokeWidth={1.8} aria-hidden="true" /> Configurações
                  </span>
                )}
              </div>
            ))}
          </nav>
        </div>

        <div className="grid gap-2 border-t border-[var(--m-border-subtle,#17496e)] p-4">
          {visiveis.length === 0 && (
            <p className="flex items-center gap-2 text-xs text-amber-300"><AlertCircle size={13} /> Deixe pelo menos um item visível.</p>
          )}
          {erro && <p className="flex items-center gap-2 text-sm text-red-300"><AlertCircle size={14} /> {erro}</p>}
          {podeEditar && (
            <>
              <button
                type="button"
                onClick={salvar}
                disabled={salvando || !alterado || visiveis.length === 0}
                className={`${m.primaryButton} w-full justify-center focus-ring`}
              >
                {salvando ? <Loader2 size={15} className="animate-spin" /> : salvo ? <Check size={15} /> : <Save size={15} />}
                {salvando ? 'Salvando…' : salvo ? 'Menu salvo' : 'Salvar menu'}
              </button>
              {alterado && !salvando && (
                <button type="button" onClick={() => setOcultos(ocultosServidor)} className={`${m.outlineButton} w-full justify-center focus-ring`}>
                  <RotateCcw size={14} /> Descartar alterações
                </button>
              )}
              {ocultos.length > 0 && !alterado && (
                <button type="button" onClick={() => setOcultos([])} className="text-xs text-indigo-300 hover:text-indigo-200">
                  Mostrar todos os itens
                </button>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
