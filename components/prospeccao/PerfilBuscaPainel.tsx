'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, Check, ChevronDown, Info, Lock, MapPin, Plus, Save, SlidersHorizontal, Sparkles, X } from 'lucide-react';
import SeletorEstados from './SeletorEstados';
import SeletorMunicipios from './SeletorMunicipios';
import {
  PORTES_PROSPECCAO,
  PROSPECCAO_LIMITES,
  type PorteProspeccao,
  type ProspeccaoConfig,
} from '@/lib/config/workspaceConfig';
import { alternarNicho, NICHOS, nichoDaAtividade } from '@/lib/prospeccao/nichos';
import { formatarCnae, ROTULO_PORTE } from '@/lib/prospeccao/rotulos';
import { iconeDoNicho } from './iconesNicho';
import s from './Prospeccao.module.css';

// Perfil de busca editado na própria tela de Prospecção (painel lateral). Grava
// o mesmo organizacoes.configuracoes.prospeccao da aba de Configurações, pelo
// mesmo PUT (exige workspace.configure). O objeto é SUBSTITUÍDO no servidor,
// então o painel manda o perfil inteiro, como veio mais o que foi editado.

const LIMITE = PROSPECCAO_LIMITES.cnaes;

export default function PerfilBuscaPainel({
  catalogoCnaes, onFechar, onSalvo,
}: {
  /** CNAEs já carregados no catálogo; os demais entram na próxima carga. */
  catalogoCnaes: string[] | null;
  onFechar: () => void;
  onSalvo: () => void;
}) {
  const [perfil, setPerfil] = useState<ProspeccaoConfig>({});
  const [podeEditar, setPodeEditar] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [expandido, setExpandido] = useState<string | null>(null);
  const [cnaeDigitado, setCnaeDigitado] = useState('');

  useEffect(() => {
    fetch('/api/configuracoes/workspace')
      .then(async (res) => {
        if (!res.ok) throw new Error('Não foi possível carregar o perfil de busca.');
        return res.json();
      })
      .then(({ config, podeEditar: permitido }) => {
        setPerfil(config?.prospeccao ?? {});
        setPodeEditar(!!permitido);
      })
      .catch((e) => setErro(e instanceof Error ? e.message : 'Erro ao carregar'))
      .finally(() => setCarregando(false));
  }, []);

  useEffect(() => {
    // Esc já tratado por um campo (ex.: menu de estados aberto) não fecha o painel.
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented && !salvando) onFechar(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onFechar, salvando]);

  const cnaes = perfil.cnaes ?? [];
  const ufs = perfil.ufs ?? [];
  const municipios = perfil.municipios ?? [];
  const portes = perfil.portes ?? [];
  const outras = cnaes.filter((c) => !nichoDaAtividade(c));
  const foraDoCatalogo = catalogoCnaes ? cnaes.filter((c) => !catalogoCnaes.includes(c)) : [];

  function definirCnaes(novos: string[]) {
    setAviso(null);
    setPerfil((p) => ({ ...p, cnaes: novos }));
  }

  function clicarNicho(id: string) {
    if (!podeEditar) return;
    const r = alternarNicho(cnaes, id, LIMITE);
    if (r.ok) definirCnaes(r.cnaes);
    else setAviso(`Não cabe: o perfil aceita até ${LIMITE} atividades. Libere ${r.faltam} para marcar este nicho inteiro, ou escolha só algumas atividades dele.`);
  }

  function alternarAtividade(codigo: string) {
    if (!podeEditar) return;
    if (cnaes.includes(codigo)) return definirCnaes(cnaes.filter((c) => c !== codigo));
    if (cnaes.length >= LIMITE) return setAviso(`O perfil aceita até ${LIMITE} atividades.`);
    definirCnaes([...cnaes, codigo]);
  }

  function adicionarCodigo() {
    const codigo = cnaeDigitado.replace(/\D/g, '');
    if (!/^\d{7}$/.test(codigo)) return setAviso('O código da atividade (CNAE) tem 7 dígitos, ex.: 5510-8/01.');
    setCnaeDigitado('');
    if (!cnaes.includes(codigo)) alternarAtividade(codigo);
  }

  function alternarLista<T extends string>(chave: 'ufs' | 'portes', valor: T) {
    setPerfil((p) => {
      const atual = (p[chave] ?? []) as T[];
      return { ...p, [chave]: atual.includes(valor) ? atual.filter((v) => v !== valor) : [...atual, valor] };
    });
  }

  async function salvar() {
    if (!podeEditar || salvando) return;
    setSalvando(true);
    setErro(null);
    try {
      const res = await fetch('/api/configuracoes/workspace', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prospeccao: cnaes.length ? perfil : null }),
      });
      const corpo = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(corpo?.erro || 'Falha ao salvar o perfil');
      onSalvo();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar');
      setSalvando(false);
    }
  }

  const chip = (ativo: boolean) => `${s.chip} ${ativo ? s.chipAtivo : ''} focus-ring`;

  return (
    <div className={s.drawerBackdrop} onMouseDown={(e) => { if (e.target === e.currentTarget && !salvando) onFechar(); }}>
      <aside className={s.drawer} role="dialog" aria-modal="true" aria-labelledby="perfil-busca-titulo">
        <header className={s.drawerHeader}>
          <div className={s.sectionHeading}>
            <span className={s.sectionIcon}><SlidersHorizontal size={17} aria-hidden="true" /></span>
            <div>
              <h2 id="perfil-busca-titulo">Perfil de busca</h2>
              <p>O ponto de partida da Prospecção: o que o catálogo da Receita busca para a sua equipe.</p>
            </div>
          </div>
          <button type="button" onClick={onFechar} disabled={salvando} aria-label="Fechar" className="rounded-lg p-1.5 text-slate-400 hover:bg-white/5 hover:text-slate-100 focus-ring">
            <X size={18} />
          </button>
        </header>

        {carregando ? (
          <div className={s.drawerBody}><p className="text-sm text-slate-400">Carregando…</p></div>
        ) : (
          <div className={s.drawerBody}>
            {!podeEditar && (
              <p className="flex items-center gap-2 rounded-lg border border-[#17496e] bg-[rgba(3,24,45,0.72)] px-3 py-2 text-xs text-slate-400">
                <Lock size={13} /> Somente leitura — só quem configura o workspace altera o perfil.
              </p>
            )}

            {/* Nichos */}
            <section className={s.drawerSection}>
              <div className={s.drawerSectionTitle}>
                <h3>Nichos</h3>
                <span className={cnaes.length >= LIMITE ? 'text-amber-300' : 'text-slate-400'}>
                  {cnaes.length} de {LIMITE} atividades
                </span>
              </div>
              <div className={s.nichoGrid}>
                {NICHOS.map((n) => {
                  const Icone = iconeDoNicho(n.id);
                  const marcadas = n.atividades.filter((a) => cnaes.includes(a.codigo)).length;
                  const aberto = expandido === n.id;
                  return (
                    <div key={n.id} className={`${s.nichoCard} ${marcadas ? s.nichoCardAtivo : ''} ${aberto ? s.nichoCardAberto : ''}`}>
                      <button type="button" onClick={() => clicarNicho(n.id)} disabled={!podeEditar} aria-pressed={marcadas === n.atividades.length} className={`${s.nichoCardMain} focus-ring`}>
                        <span className={s.nichoCardIcon}><Icone size={18} aria-hidden="true" /></span>
                        <span className="min-w-0 flex-1 text-left">
                          <span className="block truncate text-sm font-semibold text-slate-100">{n.nome}</span>
                          <span className="block text-xs text-slate-400">
                            {marcadas === 0 ? `${n.atividades.length} atividades` : `${marcadas} de ${n.atividades.length} marcadas`}
                          </span>
                        </span>
                        {marcadas > 0 && <Check size={16} className="shrink-0 text-emerald-300" aria-hidden="true" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => setExpandido(aberto ? null : n.id)}
                        aria-expanded={aberto}
                        className={`${s.nichoCardToggle} focus-ring`}
                      >
                        {aberto ? 'Fechar atividades' : 'Escolher atividades'} <ChevronDown size={13} className={`transition-transform ${aberto ? 'rotate-180' : ''}`} />
                      </button>
                      {aberto && (
                        <ul className={s.atividadeList}>
                          {n.atividades.map((a) => {
                            const ativa = cnaes.includes(a.codigo);
                            return (
                              <li key={a.codigo}>
                                <button type="button" onClick={() => alternarAtividade(a.codigo)} disabled={!podeEditar} aria-pressed={ativa} className={`${s.atividadeRow} ${ativa ? s.atividadeAtiva : ''} focus-ring`}>
                                  <span className={s.atividadeCheck}>{ativa && <Check size={11} />}</span>
                                  <span className="min-w-0 flex-1">
                                    <span className="block">{a.nome}</span>
                                    <span className="mt-0.5 block font-mono text-[11px] text-slate-500">{formatarCnae(a.codigo)}</span>
                                  </span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Atividades fora dos nichos, por código */}
              <div className="mt-4 space-y-2">
                <span className="text-xs font-semibold text-slate-300">Outras atividades (por código CNAE)</span>
                {outras.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {outras.map((c) => (
                      <span key={c} className={`${s.chip} ${s.chipAtivo}`}>
                        <span className="font-mono">{formatarCnae(c)}</span>
                        {podeEditar && (
                          <button type="button" aria-label={`Remover ${formatarCnae(c)}`} onClick={() => alternarAtividade(c)} className="text-indigo-200 hover:text-white">
                            <X size={12} />
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                )}
                {podeEditar && (
                  <div className="flex gap-2">
                    <input
                      value={cnaeDigitado}
                      onChange={(e) => setCnaeDigitado(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') adicionarCodigo(); }}
                      placeholder="Ex.: 5510-8/01"
                      aria-label="Código CNAE"
                      className={`${s.field} max-w-[180px] px-3 focus-ring`}
                    />
                    <button type="button" onClick={adicionarCodigo} className={`${s.outlineButton} focus-ring`}>
                      <Plus size={14} /> Adicionar
                    </button>
                  </div>
                )}
              </div>
            </section>

            {/* Estados */}
            <section className={s.drawerSection}>
              <div className={s.drawerSectionTitle}>
                <h3>Estados</h3>
                <span className="flex items-center gap-1 text-slate-400"><MapPin size={12} /> {ufs.length === 0 ? 'Brasil inteiro' : `${ufs.length} selecionado${ufs.length === 1 ? '' : 's'}`}</span>
              </div>
              <SeletorEstados
                selecionadas={ufs}
                desabilitado={!podeEditar}
                onChange={(novas) => setPerfil((p) => ({ ...p, ufs: novas }))}
              />
            </section>

            {/* Municípios */}
            <section className={s.drawerSection}>
              <div className={s.drawerSectionTitle}>
                <h3>Municípios</h3>
                <span className="text-slate-400">
                  {municipios.length === 0
                    ? (ufs.length === 0 ? 'Todos' : 'Todos dos estados')
                    : `${municipios.length} selecionado${municipios.length === 1 ? '' : 's'}`}
                </span>
              </div>
              <SeletorMunicipios
                selecionados={municipios}
                ufs={ufs}
                desabilitado={!podeEditar}
                onChange={(novos) => setPerfil((p) => ({ ...p, municipios: novos }))}
              />
              <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-400">
                <Info size={12} /> Aparecem as cidades com empresas no catálogo. Tirar um estado tira as cidades dele.
              </p>
            </section>

            {/* Porte e opções */}
            <section className={s.drawerSection}>
              <div className={s.drawerSectionTitle}>
                <h3>Porte</h3>
                <span className="text-slate-400">{portes.length === 0 ? 'Todos' : `${portes.length} selecionado${portes.length === 1 ? '' : 's'}`}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {PORTES_PROSPECCAO.map((p: PorteProspeccao) => (
                  <button key={p} type="button" disabled={!podeEditar} onClick={() => alternarLista('portes', p)} aria-pressed={portes.includes(p)} className={chip(portes.includes(p))}>
                    {ROTULO_PORTE[p]}
                  </button>
                ))}
              </div>
              <div className="mt-4 grid gap-2">
                <button type="button" disabled={!podeEditar} onClick={() => setPerfil((p) => ({ ...p, excluirMei: !p.excluirMei }))} aria-pressed={!!perfil.excluirMei} className={`${s.optionRow} ${perfil.excluirMei ? s.optionRowAtivo : ''} focus-ring`}>
                  <span className={s.atividadeCheck}>{perfil.excluirMei && <Check size={11} />}</span>
                  <span className="text-left">
                    <span className="block text-sm text-slate-100">Excluir MEI</span>
                    <span className="block text-xs text-slate-400">Deixa de fora os microempreendedores individuais.</span>
                  </span>
                </button>
                <button type="button" disabled={!podeEditar} onClick={() => setPerfil((p) => ({ ...p, incluirCnaesSecundarios: !p.incluirCnaesSecundarios }))} aria-pressed={!!perfil.incluirCnaesSecundarios} className={`${s.optionRow} ${perfil.incluirCnaesSecundarios ? s.optionRowAtivo : ''} focus-ring`}>
                  <span className={s.atividadeCheck}>{perfil.incluirCnaesSecundarios && <Check size={11} />}</span>
                  <span className="text-left">
                    <span className="block text-sm text-slate-100">Incluir atividade secundária</span>
                    <span className="block text-xs text-slate-400">Traz também empresas de outros ramos que só listam a atividade como acessória.</span>
                  </span>
                </button>
              </div>
            </section>

            {foraDoCatalogo.length > 0 && (
              <p className="flex items-start gap-2 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2.5 text-xs text-sky-200">
                <Sparkles size={14} className="mt-0.5 shrink-0" />
                {foraDoCatalogo.length} atividade{foraDoCatalogo.length === 1 ? '' : 's'} ainda não {foraDoCatalogo.length === 1 ? 'está' : 'estão'} no catálogo.
                As empresas aparecem na busca depois da próxima carga dos dados da Receita.
              </p>
            )}
            {aviso && (
              <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-200">
                <AlertCircle size={14} className="mt-0.5 shrink-0" /> {aviso}
              </p>
            )}
            {cnaes.length === 0 && (
              <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-200">
                <AlertCircle size={14} className="mt-0.5 shrink-0" /> Sem nenhuma atividade, a busca da Prospecção fica desligada.
              </p>
            )}
            {erro && (
              <p className="flex items-center gap-2 text-sm text-red-300"><AlertCircle size={14} /> {erro}</p>
            )}
          </div>
        )}

        <footer className={s.drawerFooter}>
          <button type="button" onClick={onFechar} disabled={salvando} className="h-10 rounded-lg px-4 text-sm text-slate-300 hover:bg-white/5 focus-ring">
            {podeEditar ? 'Cancelar' : 'Fechar'}
          </button>
          {podeEditar && (
            <button type="button" onClick={salvar} disabled={salvando || carregando} className={`${s.primaryButton} disabled:opacity-60 focus-ring`}>
              <Save size={15} /> {salvando ? 'Salvando…' : 'Salvar e buscar'}
            </button>
          )}
        </footer>
      </aside>
    </div>
  );
}
