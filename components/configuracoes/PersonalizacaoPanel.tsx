'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Columns3, SlidersHorizontal, Kanban, Type, PanelLeft,
  Save, Check, ToggleLeft, ToggleRight, Lock,
  Info, Plus, Trash2, ChevronUp, ChevronDown, Palette,
} from 'lucide-react';
import { CAMPOS_UI_PADRAO, camposUIEfetivos, type CampoUI } from '@/lib/config/workspaceConfig';
import MenuPersonalizacaoPanel from './MenuPersonalizacaoPanel';
import SeletorTema from '@/components/tema/SeletorTema';

// Personalização por workspace: 6 abas (Campos / Filtros e visualizações /
// Pipeline / Terminologia / Menu / Tema). A aba Campos é funcional e reflete em Base de Leads
// e Pipeline. As demais abas expõem os mesmos dados do ProcessoComercialPanel
// para que o usuário tenha tudo num lugar só.

type Aba = 'campos' | 'filtros' | 'pipeline' | 'terminologia' | 'menu' | 'tema';

interface PipelineEstagio { id: string; chave: string; nome: string; papel: string; cor: string | null; ordem: number }
interface Pipeline { id: string; nome: string; tipo: string; ativo: boolean; estagios: PipelineEstagio[] }

const TIPO_CAMPO: Record<string, string> = {
  contato_nome: 'Texto',
  empresa: 'Texto',
  contato_email: 'E-mail',
  contato_telefone: 'Telefone',
  origem: 'Texto',
  responsavel_id: 'Usuário',
  estagio: 'Status',
  data_validade: 'Data',
  proxima_acao_data: 'Data',
  score: 'Número',
}

// ---- Editor de Pipeline ---------------------------------------------------

const PAPEIS: { val: string; label: string }[] = [
  { val: 'inicial', label: 'Inicial' },
  { val: 'normal',  label: 'Normal' },
  { val: 'ganho',   label: 'Ganho' },
  { val: 'perdido', label: 'Perdido' },
]

interface EstagioEdit extends PipelineEstagio { _novo?: boolean }

function PipelineEditor({ pipelines, podeEditar, onSalvo }: {
  pipelines: Pipeline[]; podeEditar: boolean; onSalvo: () => void
}) {
  const [estagios, setEstagios] = useState<Record<string, EstagioEdit[]>>({})
  const [salvando, setSalvando] = useState<string | null>(null)
  const [salvo, setSalvo]       = useState<string | null>(null)
  const [erro, setErro]         = useState<string | null>(null)

  // Inicializa estado local quando pipelines chegam do pai
  useEffect(() => {
    const m: Record<string, EstagioEdit[]> = {}
    for (const p of pipelines) m[p.id] = p.estagios.map((e) => ({ ...e }))
    setEstagios(m)
  }, [pipelines])

  function set(pid: string, idx: number, patch: Partial<EstagioEdit>) {
    setEstagios((prev) => ({
      ...prev,
      [pid]: prev[pid].map((e, i) => (i === idx ? { ...e, ...patch } : e)),
    }))
  }

  function mover(pid: string, idx: number, dir: -1 | 1) {
    setEstagios((prev) => {
      const arr = [...prev[pid]]
      const outro = idx + dir
      if (outro < 0 || outro >= arr.length) return prev
      ;[arr[idx], arr[outro]] = [arr[outro], arr[idx]]
      return { ...prev, [pid]: arr.map((e, i) => ({ ...e, ordem: i })) }
    })
  }

  function remover(pid: string, idx: number) {
    setEstagios((prev) => ({
      ...prev,
      [pid]: prev[pid].filter((_, i) => i !== idx).map((e, i) => ({ ...e, ordem: i })),
    }))
  }

  function adicionar(pid: string) {
    setEstagios((prev) => {
      const arr = prev[pid] ?? []
      const novo: EstagioEdit = {
        id: '', chave: `estagio_${Date.now()}`, nome: 'Novo estágio',
        papel: 'normal', cor: '#6366f1', ordem: arr.length, _novo: true,
      }
      return { ...prev, [pid]: [...arr, novo] }
    })
  }

  async function salvar(pid: string) {
    setSalvando(pid); setErro(null); setSalvo(null)
    try {
      const r = await fetch(`/api/pipelines/${pid}/estagios`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estagios: estagios[pid] }),
      })
      if (!r.ok) throw new Error((await r.json())?.erro || 'Falha ao salvar')
      setSalvo(pid)
      setTimeout(() => setSalvo(null), 2500)
      onSalvo()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro')
    } finally {
      setSalvando(null)
    }
  }

  const inp = 'bg-[var(--bg-base)] border border-[var(--border)] rounded px-2 py-1 text-sm text-slate-200 focus:outline-none focus:border-indigo-500'

  if (pipelines.length === 0) {
    return <p className="text-sm text-slate-500">Nenhum pipeline encontrado.</p>
  }

  return (
    <div className="space-y-6">
      {pipelines.map((p) => {
        const es = estagios[p.id] ?? []
        const emSalvamento = salvando === p.id
        const foiSalvo = salvo === p.id
        return (
          <div key={p.id} className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-[var(--border)] flex items-center justify-between">
              <div>
                <span className="font-semibold text-slate-100">{p.nome}</span>
                <span className="ml-2 text-xs text-slate-500">({p.tipo})</span>
              </div>
              {podeEditar && (
                <div className="flex items-center gap-2">
                  <button onClick={() => adicionar(p.id)}
                    className="text-xs px-2.5 py-1.5 rounded-lg border border-[var(--border)] text-slate-300 hover:bg-[var(--bg-input)] inline-flex items-center gap-1">
                    <Plus size={12} /> Estágio
                  </button>
                  <button onClick={() => salvar(p.id)} disabled={emSalvamento}
                    className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-500 disabled:opacity-40 inline-flex items-center gap-1">
                    {foiSalvo ? <><Check size={12} /> Salvo</> : <><Save size={12} /> Salvar</>}
                  </button>
                </div>
              )}
            </div>

            {erro && <p className="px-5 py-2 text-xs text-red-400">{erro}</p>}

            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="text-left font-medium px-5 py-2.5 w-8"></th>
                  <th className="text-left font-medium px-3 py-2.5">Nome</th>
                  <th className="text-left font-medium px-3 py-2.5">Chave</th>
                  <th className="text-left font-medium px-3 py-2.5">Papel</th>
                  <th className="text-center font-medium px-3 py-2.5">Cor</th>
                  {podeEditar && <th className="px-3 py-2.5 w-16"></th>}
                </tr>
              </thead>
              <tbody>
                {es.map((e, idx) => (
                  <tr key={e.id || e.chave} className="border-b border-[var(--border)]/60 last:border-0 hover:bg-[var(--bg-base)]/50 transition-colors">
                    <td className="px-5 py-2">
                      {podeEditar && (
                        <div className="flex flex-col gap-0.5">
                          <button onClick={() => mover(p.id, idx, -1)} disabled={idx === 0}
                            className="text-slate-600 hover:text-slate-300 disabled:opacity-20"><ChevronUp size={13} /></button>
                          <button onClick={() => mover(p.id, idx, 1)} disabled={idx === es.length - 1}
                            className="text-slate-600 hover:text-slate-300 disabled:opacity-20"><ChevronDown size={13} /></button>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {podeEditar
                        ? <input className={inp} value={e.nome} onChange={(ev) => set(p.id, idx, { nome: ev.target.value })} />
                        : <span className="text-slate-200">{e.nome}</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500 font-mono">{e.chave}</td>
                    <td className="px-3 py-2">
                      {podeEditar
                        ? (
                          <select className={inp} value={e.papel} onChange={(ev) => set(p.id, idx, { papel: ev.target.value })}>
                            {PAPEIS.map((pp) => <option key={pp.val} value={pp.val}>{pp.label}</option>)}
                          </select>
                        ) : (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                            e.papel === 'ganho' ? 'bg-green-500/15 text-green-400' :
                            e.papel === 'perdido' ? 'bg-red-500/15 text-red-400' :
                            e.papel === 'inicial' ? 'bg-indigo-500/15 text-indigo-400' :
                            'bg-slate-500/15 text-slate-400'
                          }`}>{e.papel}</span>
                        )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {podeEditar
                        ? <input type="color" value={e.cor ?? '#6366f1'}
                            onChange={(ev) => set(p.id, idx, { cor: ev.target.value })}
                            className="w-7 h-7 rounded cursor-pointer border border-[var(--border)] bg-transparent" />
                        : <span className="inline-block w-4 h-4 rounded-full border border-[var(--border)]"
                            style={{ background: e.cor ?? '#475569' }} />
                      }
                    </td>
                    {podeEditar && (
                      <td className="px-3 py-2 text-right">
                        {e.papel !== 'inicial' && (
                          <button onClick={() => remover(p.id, idx)} title="Remover estágio"
                            className="text-slate-600 hover:text-red-400 transition-colors">
                            <Trash2 size={13} />
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      })}
      <p className="text-xs text-slate-600">
        Estágios com papel <strong className="text-slate-400">ganho</strong> ou <strong className="text-slate-400">perdido</strong> encerram a execução do lead.
        O estágio <strong className="text-slate-400">inicial</strong> não pode ser removido.
      </p>
    </div>
  )
}

// ---- Toggle ---------------------------------------------------------------

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!on)}
      className={`transition-colors ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
      aria-label={on ? 'Desativar' : 'Ativar'}
    >
      {on
        ? <ToggleRight size={22} className="text-indigo-400" />
        : <ToggleLeft size={22} className="text-slate-600" />
      }
    </button>
  );
}

export default function PersonalizacaoPanel() {
  const [aba, setAba] = useState<Aba>('campos');
  const [campos, setCampos] = useState<CampoUI[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [nomeLead, setNomeLead] = useState('');
  const [podeEditar, setPodeEditar] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const [wRes, pRes] = await Promise.all([
      fetch('/api/configuracoes/workspace').then((r) => (r.ok ? r.json() : null)),
      fetch('/api/pipelines').then((r) => (r.ok ? r.json() : { pipelines: [] })),
    ]);
    if (wRes) {
      setPodeEditar(!!wRes.podeEditar);
      setCampos(camposUIEfetivos(wRes.config?.camposUI));
      setNomeLead(wRes.config?.nomenclaturas?.lead ?? '');
    } else {
      setCampos(camposUIEfetivos([]));
    }
    setPipelines(pRes.pipelines ?? []);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  function setCampo(chave: string, patch: Partial<CampoUI>) {
    setCampos((prev) => prev.map((c) => (c.chave === chave ? { ...c, ...patch } : c)));
  }

  async function salvarCampos() {
    if (salvando) return;
    setSalvando(true); setErro(null); setSalvo(false);
    try {
      const body: Record<string, unknown> = { camposUI: campos };
      if (nomeLead.trim()) body.nomenclaturas = { lead: nomeLead.trim() };
      const r = await fetch('/api/configuracoes/workspace', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json())?.erro || 'Falha ao salvar');
      setSalvo(true);
      setTimeout(() => setSalvo(false), 2500);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSalvando(false);
    }
  }

  const TABS: { id: Aba; label: string; Icon: typeof Columns3 }[] = [
    { id: 'campos', label: 'Campos', Icon: Columns3 },
    { id: 'filtros', label: 'Filtros e visualizações', Icon: SlidersHorizontal },
    { id: 'pipeline', label: 'Pipeline', Icon: Kanban },
    { id: 'terminologia', label: 'Terminologia', Icon: Type },
    { id: 'menu', label: 'Menu', Icon: PanelLeft },
    { id: 'tema', label: 'Tema', Icon: Palette },
  ];

  const input = 'w-full bg-[var(--bg-base)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 disabled:opacity-50';

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

      {/* --- Aba Campos --- */}
      {aba === 'campos' && (
        <div className="space-y-4">
          {!podeEditar && (
            <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg px-4 py-2.5">
              <Lock size={13} /> Somente leitura — requer a permissão <code>workspace.configure</code> para editar.
            </div>
          )}

          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-400">Configure quais campos aparecem nas listas e nos filtros, por workspace.</p>
            <div className="flex items-center gap-2">
              <button
                disabled
                title="Campos customizados entram numa iteração seguinte"
                className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-[var(--border)] text-slate-500 opacity-50 cursor-not-allowed">
                <Plus size={13} /> Novo campo
              </button>
              {podeEditar && (
                <button onClick={salvarCampos} disabled={salvando}
                  className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-500 disabled:opacity-40">
                  {salvo ? <><Check size={14} /> Salvo</> : <><Save size={14} /> Salvar alterações</>}
                </button>
              )}
            </div>
          </div>

          {erro && <p className="text-sm text-red-400">{erro}</p>}

          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="text-left font-medium px-5 py-3">Campo</th>
                  <th className="text-left font-medium px-4 py-3">Tipo</th>
                  <th className="text-center font-medium px-4 py-3">Obrigatório</th>
                  <th className="text-center font-medium px-4 py-3">Visível</th>
                  <th className="text-center font-medium px-4 py-3">Usar como filtro</th>
                </tr>
              </thead>
              <tbody>
                {campos.map((c) => {
                  const obrigatorioFixo = CAMPOS_UI_PADRAO.find((p) => p.chave === c.chave)?.obrigatorio;
                  return (
                    <tr key={c.chave} className="border-b border-[var(--border)]/60 last:border-0 hover:bg-[var(--bg-base)]/60 transition-colors">
                      <td className="px-5 py-3 font-medium text-slate-100">{c.label}</td>
                      <td className="px-4 py-3 text-xs text-slate-400">{TIPO_CAMPO[c.chave] ?? 'Texto'}</td>
                      <td className="px-4 py-3 text-center">
                        <Toggle on={c.obrigatorio} onChange={(v) => setCampo(c.chave, { obrigatorio: v })}
                          disabled={!podeEditar || !!obrigatorioFixo} />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Toggle on={c.visivel} onChange={(v) => setCampo(c.chave, { visivel: v })}
                          disabled={!podeEditar} />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Toggle on={c.filtro} onChange={(v) => setCampo(c.chave, { filtro: v })}
                          disabled={!podeEditar} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-start gap-2 text-xs text-slate-500 bg-[var(--bg-base)] border border-[var(--border)]/60 rounded-lg px-4 py-3">
            <Info size={13} className="text-indigo-400 shrink-0 mt-0.5" />
            A personalização altera campos e visualizações <strong className="text-slate-300">sem misturar conceitos do CRM</strong>. Campos obrigatórios do sistema não podem ser ocultados.
          </div>
        </div>
      )}

      {/* --- Aba Filtros e visualizações --- */}
      {aba === 'filtros' && (
        <div className="space-y-4">
          <div className="flex items-start gap-2 text-xs text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 rounded-lg px-4 py-3">
            <Info size={13} className="shrink-0 mt-0.5" />
            <span>Isto reflete os campos marcados como &quot;Usar como filtro&quot; na aba <strong>Campos</strong>. Para adicionar ou remover um filtro, edite lá.</span>
          </div>
          <p className="text-sm text-slate-400">Os filtros disponíveis em Base de Leads e Pipeline são definidos pelo toggle <strong className="text-slate-300">Usar como filtro</strong> na aba Campos.</p>
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-5">
            <h3 className="font-semibold text-slate-200 text-sm mb-3">Filtros ativos neste workspace</h3>
            <div className="flex flex-wrap gap-2">
              {campos.filter((c) => c.filtro).map((c) => (
                <span key={c.chave} className="text-xs px-3 py-1.5 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                  {c.label}
                </span>
              ))}
              {campos.filter((c) => c.filtro).length === 0 && (
                <p className="text-xs text-slate-500">Nenhum filtro adicional habilitado. Ative o toggle "Usar como filtro" na aba Campos.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* --- Aba Pipeline --- */}
      {aba === 'pipeline' && (
        <PipelineEditor pipelines={pipelines} podeEditar={podeEditar} onSalvo={carregar} />
      )}

      {/* --- Aba Menu --- */}
      {aba === 'menu' && <MenuPersonalizacaoPanel />}

      {/* --- Aba Tema (escolha pessoal, não do workspace) --- */}
      {aba === 'tema' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-400">Aparência das telas. Aplica na hora, vale só para você e neste navegador — não muda o tema dos outros usuários.</p>
          <div className="max-w-3xl"><SeletorTema /></div>
        </div>
      )}

      {/* --- Aba Terminologia --- */}
      {aba === 'terminologia' && (
        <div className="space-y-4">
          <div className="flex items-start gap-2 text-xs text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 rounded-lg px-4 py-3">
            <Info size={13} className="shrink-0 mt-0.5" />
            <span>Isto muda só como o termo aparece na tela (cosmético) — não altera comportamento, filtros ou dados. Para controlar o que a plataforma processa de verdade, use a aba <strong>Campos</strong>.</span>
          </div>
          <p className="text-sm text-slate-400">
            Renomeie termos comerciais do seu workspace. Termos estruturais (Campanha, Workflow, Empresa, Contato, Tarefa, Configurações) não podem ser renomeados.
          </p>
          {!podeEditar && (
            <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg px-4 py-2.5">
              <Lock size={13} /> Somente leitura — requer <code>workspace.configure</code>.
            </div>
          )}
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-6 max-w-2xl space-y-4">
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Como chamar &quot;Lead&quot; neste workspace</label>
              <input className={input} value={nomeLead} onChange={(e) => setNomeLead(e.target.value)}
                disabled={!podeEditar} placeholder="Lead" />
              <p className="text-xs text-slate-600 mt-1">Exemplo: Prospecto, Contato, Cliente potencial</p>
            </div>
            {podeEditar && (
              <button onClick={salvarCampos} disabled={salvando}
                className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-500 disabled:opacity-40">
                {salvo ? <><Check size={14} /> Salvo</> : <><Save size={14} /> Salvar</>}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
