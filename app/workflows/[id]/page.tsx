'use client';

import { createContext, use, useContext, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, List, GitBranch, Loader2, Plus, Trash2, ChevronUp, ChevronDown, Zap, Filter, PlayCircle,
  CheckCircle2, PauseCircle, Rocket, Save, AlertTriangle, UserPlus, Search,
  FlaskConical, Users, X, Info,
} from 'lucide-react';
import type { BlocoConfig, DefinicaoWorkflow, Workflow, WorkflowVersao, StatusWorkflow } from '@/lib/workflows/types';
import {
  ACOES, CONDICOES, GATILHOS, acharBlocoDef, blocoPadrao, configPadrao, definicaoVazia,
  garantirIdsAcoes, opcoesDeTemplate, type BlocoDef, type CampoDef, type TemplateDisponivel,
} from '@/lib/workflows/catalogo';
import { descreverProblemaTemplate, type ProblemaTemplate } from '@/lib/templates/problemas';
import ResumoFluxo from '@/components/workflows/ResumoFluxo';
import WorkflowCanvas from '@/components/workflows/WorkflowCanvas';
import { getUsuarios, getLeads, listarTemplatesBiblioteca } from '@/lib/api';
import type { Usuario, Lead } from '@/lib/supabase';

// Usuários da org (para o dropdown de responsável em campos tipo 'usuario'),
// via contexto para não threadar props por LinhaBloco/SaltarSeEditor.
const UsuariosCtx = createContext<Usuario[]>([]);

// Templates de e-mail ATIVOS da organização (GET /api/templates), para o campo
// `template` do bloco "Enviar e-mail". A lista é da org — nunca uma lista fixa.
const TemplatesCtx = createContext<TemplateDisponivel[]>([]);

const STATUS_INFO: Record<StatusWorkflow, { label: string; chip: string }> = {
  rascunho: { label: 'Rascunho', chip: 'chip chip-muted' },
  publicado: { label: 'Publicado', chip: 'chip chip-success' },
  pausado: { label: 'Pausado', chip: 'chip chip-warning' },
};

// Cores de acento das etapas do fluxo (as mesmas já usadas: gatilho âmbar,
// condições azul, ações verde) — centralizadas para o cabeçalho de etapa.
const COR_GATILHO = '#f59e0b';
const COR_CONDICAO = '#38bdf8';
const COR_ACAO = '#22c55e';

// Trava de segurança (Fase 5): acima deste nº de leads casados pelo gatilho,
// publicar exige confirmação explícita (evita disparo amplo sem aviso).
const LIMITE_TRAVA = 20;

// Resultado da simulação "Testar" (POST /api/workflows/[id]/simular).
type SimResultado = {
  alvos: number;
  amostra: { leadId: string; nome: string; status: string; passos: string[] }[];
};

const EXEC_LABEL: Record<string, string> = {
  em_andamento: 'Em andamento', aguardando: 'Aguardando', concluido: 'Concluídas',
  erro: 'Com erro', cancelado: 'Canceladas',
};

// --- Editor dos campos de config de um bloco (a partir do catálogo) ----------
function CamposEditor({ def, config, onChange, blocoTipo, condicoes }: {
  def: BlocoDef;
  config: Record<string, unknown>;
  onChange: (nome: string, valor: unknown) => void;
  blocoTipo?: string;
  condicoes?: BlocoConfig[];
}) {
  const usuarios = useContext(UsuariosCtx);
  const templates = useContext(TemplatesCtx);
  if (def.campos.length === 0) return null;

  const campoRespId = def.campos.find(c => c.tipo === 'usuario' && c.nome === 'responsavel_id');
  const uidSel = campoRespId ? String(config[campoRespId.nome] ?? '') : '';
  const nomeUsuario = uidSel ? (usuarios.find(u => u.id === uidSel)?.nome ?? uidSel) : '';
  const temCondicaoResp = condicoes?.some(c => c.tipo === 'responsavel_lead_igual') ?? false;
  const prefixo = blocoTipo === 'criar_tarefa' ? 'Esta tarefa'
    : blocoTipo === 'criar_tarefa_ligacao' ? 'Esta tarefa de ligação'
    : blocoTipo === 'notificar' ? 'Esta notificação'
    : blocoTipo === 'atribuir_responsavel' ? 'O lead'
    : 'O resultado';

  return (
    <div className="flex flex-wrap gap-3 mt-2">
      {def.campos.map((campo: CampoDef) => {
        const valor = config[campo.nome];
        return (
          <label key={campo.nome} className="text-xs text-slate-400 flex flex-col gap-1">
            <span>{campo.label}</span>
            {campo.tipo === 'usuario' ? (
              <select
                value={String(valor ?? '')}
                onChange={e => onChange(campo.nome, e.target.value)}
                className="bg-[var(--t-bg-base,#0f1117)] border border-[var(--t-border,#2a3147)] rounded-lg px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-blue-500/50 min-w-[12rem]"
              >
                <option value="">— selecione —</option>
                {usuarios.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
              </select>
            ) : campo.tipo === 'select' || campo.tipo === 'booleano' ? (
              <select
                value={String(valor ?? campo.padrao)}
                onChange={e => onChange(campo.nome, campo.tipo === 'booleano' ? e.target.value === 'true' : e.target.value)}
                className="bg-[var(--t-bg-base,#0f1117)] border border-[var(--t-border,#2a3147)] rounded-lg px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-blue-500/50 min-w-[10rem]"
              >
                {opcoesDeTemplate(campo, templates, String(valor ?? campo.padrao)).map(o => <option key={o.valor} value={o.valor}>{o.label}</option>)}
              </select>
            ) : campo.tipo === 'numero' ? (
              <input
                type="number"
                value={Number(valor ?? campo.padrao)}
                min={0}
                onChange={e => onChange(campo.nome, e.target.value === '' ? 0 : Number(e.target.value))}
                className="bg-[var(--t-bg-base,#0f1117)] border border-[var(--t-border,#2a3147)] rounded-lg px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-blue-500/50 w-24"
              />
            ) : (
              <input
                type="text"
                value={String(valor ?? campo.padrao)}
                onChange={e => onChange(campo.nome, e.target.value)}
                className="bg-[var(--t-bg-base,#0f1117)] border border-[var(--t-border,#2a3147)] rounded-lg px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-blue-500/50 min-w-[14rem]"
              />
            )}
            {campo.dica && <span className="text-[11px] text-slate-600">{campo.dica}</span>}
          </label>
        );
      })}

      {campoRespId && (
        <div className="w-full mt-0.5 space-y-1">
          <p className="flex items-start gap-1.5 text-[11px] text-slate-400 leading-snug">
            <Info size={12} className="shrink-0 mt-0.5 text-slate-500" />
            {!uidSel
              ? `${prefixo} vai para o responsável do próprio lead que ativou o fluxo.`
              : `${prefixo} vai sempre para ${nomeUsuario}, para qualquer lead que passar pelas condições acima — não filtra por dono do lead.`
            }
          </p>
          {uidSel && !temCondicaoResp && (
            <p className="ml-[18px] text-[11px] text-sky-400/80 leading-snug">
              Quer que isso valha só para leads de <span className="text-sky-300">{nomeUsuario}</span>? Adicione a condição &quot;Responsável do lead&quot; na seção Condições acima.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// --- Linha de bloco: seletor de tipo + campos + controles --------------------
function LinhaBloco({ opcoes, bloco, onChange, onRemover, controles, extra, condicoes }: {
  opcoes: BlocoDef[];
  bloco: BlocoConfig;
  onChange: (novo: BlocoConfig) => void;
  onRemover?: () => void;
  controles?: React.ReactNode;
  // Editor dedicado para blocos com config aninhado (ex.: saltar_se), renderizado
  // no lugar do CamposEditor genérico.
  extra?: React.ReactNode;
  condicoes?: BlocoConfig[];
}) {
  const def = acharBlocoDef(bloco.tipo) ?? opcoes[0];
  return (
    <div className="bg-[var(--t-bg-base,#0f1117)]/60 rounded-lg border border-[var(--t-border,#2a3147)] p-3">
      <div className="flex items-center gap-2">
        <select
          value={bloco.tipo}
          onChange={e => {
            const novoDef = acharBlocoDef(e.target.value)!;
            // Preserva o id estável do passo ao trocar o tipo (saltar_se aponta p/ ele).
            onChange({ id: bloco.id, tipo: novoDef.tipo, config: configPadrao(novoDef) });
          }}
          className="bg-[var(--t-bg-card,#1a1f2e)] border border-[var(--t-border,#2a3147)] rounded-lg px-2.5 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-blue-500/50"
        >
          {opcoes.map(o => <option key={o.tipo} value={o.tipo}>{o.label}</option>)}
        </select>
        <span className="text-xs text-slate-500 flex-1 min-w-0 truncate">{def.descricao}</span>
        {controles}
        {onRemover && (
          <button onClick={onRemover} className="text-slate-500 hover:text-red-400 shrink-0" title="Remover">
            <Trash2 size={15} />
          </button>
        )}
      </div>
      {extra ?? (
        <CamposEditor
          def={def}
          config={bloco.config}
          onChange={(nome, valor) => onChange({ ...bloco, config: { ...bloco.config, [nome]: valor } })}
          blocoTipo={bloco.tipo}
          condicoes={condicoes}
        />
      )}
    </div>
  );
}

// --- Editor dedicado do bloco 'saltar_se' (condição aninhada + destino) -------
function SaltarSeEditor({ bloco, acoes, onChange }: {
  bloco: BlocoConfig;
  acoes: BlocoConfig[];
  onChange: (novo: BlocoConfig) => void;
}) {
  const cond = (bloco.config.condicao as BlocoConfig | undefined) ?? blocoPadrao(CONDICOES[0]);
  const condDef = acharBlocoDef(cond.tipo) ?? CONDICOES[0];
  const destino = String(bloco.config.destino ?? '');
  const setCond = (novo: BlocoConfig) => onChange({ ...bloco, config: { ...bloco.config, condicao: novo } });
  return (
    <div className="mt-2 space-y-2 border-l-2 border-sky-500/30 pl-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-slate-400">Se</span>
        <select
          value={cond.tipo}
          onChange={e => { const d = acharBlocoDef(e.target.value)!; setCond({ tipo: d.tipo, config: configPadrao(d) }); }}
          className="bg-[var(--t-bg-base,#0f1117)] border border-[var(--t-border,#2a3147)] rounded-lg px-2.5 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-blue-500/50"
        >
          {CONDICOES.map(c => <option key={c.tipo} value={c.tipo}>{c.label}</option>)}
        </select>
      </div>
      <CamposEditor
        def={condDef}
        config={cond.config}
        onChange={(nome, valor) => setCond({ ...cond, config: { ...cond.config, [nome]: valor } })}
      />
      <label className="text-xs text-slate-400 flex items-center gap-2 flex-wrap">
        <span>então pular para</span>
        <select
          value={destino}
          onChange={e => onChange({ ...bloco, config: { ...bloco.config, destino: e.target.value } })}
          className="bg-[var(--t-bg-base,#0f1117)] border border-[var(--t-border,#2a3147)] rounded-lg px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-blue-500/50 min-w-[16rem]"
        >
          <option value="">— escolha um passo —</option>
          {acoes.map((a, idx) => (
            a.id && a.id !== bloco.id
              ? <option key={a.id} value={a.id}>{idx + 1}. {acharBlocoDef(a.tipo)?.label ?? a.tipo}</option>
              : null
          ))}
        </select>
        <span className="text-slate-600">(senão continua no próximo passo)</span>
      </label>
    </div>
  );
}

// Cabeçalho de uma ETAPA do fluxo (Gatilho / Condições / Ações): número + ícone
// colorido + título/hint. Dá hierarquia e senso de sequência ao editor.
function CabecalhoEtapa({ n, Icon, cor, titulo, hint, children }: {
  n: number; Icon: typeof Zap; cor: string; titulo: string; hint: string; children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5 mb-3">
      <span className="flex items-center justify-center w-8 h-8 rounded-lg shrink-0 relative" style={{ backgroundColor: `${cor}22`, color: cor }}>
        <Icon size={16} />
        <span className="absolute -top-1.5 -left-1.5 w-4 h-4 rounded-full bg-[var(--bg-base)] border border-[var(--border)] text-[10px] font-bold text-slate-400 flex items-center justify-center">{n}</span>
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-sm text-slate-100 leading-tight">{titulo}</div>
        <div className="text-xs text-slate-500 leading-tight mt-0.5">{hint}</div>
      </div>
      {children}
    </div>
  );
}

// Conector vertical entre as etapas — transforma 3 cards soltos numa "espinha"
// que se lê como um fluxo de cima para baixo.
function ConectorEtapa() {
  return (
    <div className="flex justify-center" aria-hidden="true">
      <div className="w-px h-5 bg-[var(--border-strong)]" />
    </div>
  );
}

export default function WorkflowEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [versoes, setVersoes] = useState<WorkflowVersao[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [nome, setNome] = useState('');
  const [def, setDef] = useState<DefinicaoWorkflow>(definicaoVazia());
  const [salvoSnapshot, setSalvoSnapshot] = useState('');

  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  // Usuários (dropdown de responsável) e leads (inscrição manual).
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [templates, setTemplates] = useState<TemplateDisponivel[]>([]);
  // Avisos do rascunho: template ausente/desativado não impede salvar, mas a
  // publicação vai recusar — melhor dizer agora.
  const [avisosTemplates, setAvisosTemplates] = useState<ProblemaTemplate[]>([]);

  // Fase 5 — trava de segurança (confirmação antes de publicar gatilho amplo) e
  // simulação ("Testar" sem efeito real).
  const [confirmPub, setConfirmPub] = useState<{ alvos: number } | null>(null);
  const [simulando, setSimulando] = useState(false);
  const [simResult, setSimResult] = useState<SimResultado | null>(null);
  const [vista, setVista] = useState<'lista' | 'fluxo'>('lista');

  useEffect(() => {
    getUsuarios().then(setUsuarios).catch(() => {});
    getLeads().then(setLeads).catch(() => {});
    listarTemplatesBiblioteca({ canal: 'email', ativo: 'ativos' })
      .then((lista) => setTemplates(lista.map((t) => ({ nome: t.nome, tipo: t.tipo }))))
      .catch(() => {});
  }, []);

  async function carregar() {
    setLoading(true);
    try {
      const r = await fetch(`/api/workflows/${id}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data?.erro || 'Falha ao carregar');
      const wf = data.workflow as Workflow;
      const vs = (data.versoes ?? []) as WorkflowVersao[];
      const versaoAtual = vs.find(v => v.id === wf.versao_atual_id);
      // Base de edição: rascunho pendente, senão a versão publicada, senão vazio.
      // garantirIdsAcoes: backfill de ids em defs antigas (alvos de saltar_se).
      const base = garantirIdsAcoes(wf.rascunho_definicao ?? versaoAtual?.definicao ?? definicaoVazia());
      setWorkflow(wf);
      setVersoes(vs);
      setStats(data.execucoesPorStatus ?? {});
      setNome(wf.nome);
      setDef(base);
      setSalvoSnapshot(JSON.stringify({ nome: wf.nome, def: base }));
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar workflow');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { carregar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  const sujo = useMemo(() => JSON.stringify({ nome, def }) !== salvoSnapshot, [nome, def, salvoSnapshot]);

  // Validação client-side espelhando validarDefinicao (feedback antes de publicar).
  const problemas = useMemo(() => {
    const p: string[] = [];
    if (!nome.trim()) p.push('Dê um nome ao workflow.');
    if (!def.gatilho?.tipo) p.push('Escolha um gatilho.');
    if (def.acoes.length === 0) p.push('Adicione ao menos uma ação.');
    return p;
  }, [nome, def]);

  async function salvarRascunho(): Promise<boolean> {
    setOcupado(true); setMsg(null); setErro(null);
    try {
      const r = await fetch(`/api/workflows/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: nome.trim(), definicao: def }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.erro || 'Falha ao salvar');
      setSalvoSnapshot(JSON.stringify({ nome: nome.trim(), def }));
      setAvisosTemplates(Array.isArray(data?.avisosTemplates) ? data.avisosTemplates as ProblemaTemplate[] : []);
      setMsg('Rascunho salvo.');
      return true;
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar');
      return false;
    } finally {
      setOcupado(false);
    }
  }

  async function acaoCiclo(acao: 'publicar' | 'pausar' | 'retomar') {
    // Publicar sempre persiste o formulário atual como rascunho antes de congelar.
    if (acao === 'publicar') {
      if (problemas.length) { setErro(problemas[0]); return; }
      const ok = await salvarRascunho();
      if (!ok) return;
    }
    setOcupado(true); setMsg(null); setErro(null);
    try {
      const r = await fetch(`/api/workflows/${id}/acao`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.erro || 'Falha na ação');
      await carregar();
      setMsg(acao === 'publicar' ? 'Workflow publicado.' : acao === 'pausar' ? 'Workflow pausado.' : 'Workflow retomado.');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro na ação');
    } finally {
      setOcupado(false);
    }
  }

  // Publicação com TRAVA (Fase 5): salva o rascunho, consulta a prévia de quantos
  // leads o gatilho casaria AGORA e, se passar do limite, pede confirmação antes
  // de congelar a versão. Abaixo do limite, publica direto.
  async function iniciarPublicacao() {
    if (problemas.length) { setErro(problemas[0]); return; }
    const ok = await salvarRascunho();
    if (!ok) return;
    setOcupado(true); setErro(null); setMsg(null);
    try {
      const r = await fetch(`/api/workflows/${id}/previa`);
      const data = await r.json();
      if (!r.ok) throw new Error(data?.erro || 'Falha na prévia');
      const alvos = Number(data?.alvos ?? 0);
      if (alvos > LIMITE_TRAVA) { setConfirmPub({ alvos }); return; }
      await executarPublicacao();
    } catch {
      setErro('Não consegui calcular quantos leads seriam inscritos. Tente publicar de novo.');
    } finally {
      setOcupado(false);
    }
  }

  async function executarPublicacao() {
    setConfirmPub(null); setOcupado(true); setMsg(null); setErro(null);
    try {
      const r = await fetch(`/api/workflows/${id}/acao`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'publicar' }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.erro || 'Falha ao publicar');
      await carregar();
      setMsg('Workflow publicado.');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao publicar');
    } finally {
      setOcupado(false);
    }
  }

  // Simulação "Testar" (Fase 5): roda o fluxo em modo simulação (sem efeito real)
  // sobre a definição ATUAL do formulário e mostra o que aconteceria.
  async function testar() {
    setSimulando(true); setSimResult(null); setErro(null); setMsg(null);
    try {
      const r = await fetch(`/api/workflows/${id}/simular`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ definicao: def }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.erro || 'Falha ao simular');
      setSimResult(data as SimResultado);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao simular');
    } finally {
      setSimulando(false);
    }
  }

  async function excluir() {
    if (!confirm('Excluir este rascunho? Esta ação não pode ser desfeita.')) return;
    setOcupado(true); setErro(null);
    try {
      const r = await fetch(`/api/workflows/${id}`, { method: 'DELETE' });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.erro || 'Falha ao excluir');
      router.push('/automacao?tab=workflows');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao excluir');
      setOcupado(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-slate-500">
        <Loader2 size={18} className="animate-spin" /> <span className="text-sm">Carregando workflow...</span>
      </div>
    );
  }
  if (erro && !workflow) {
    return (
      <div className="p-6">
        <Link href="/automacao?tab=workflows" className="text-sm text-blue-400 hover:text-blue-300 flex items-center gap-1"><ArrowLeft size={14} /> Voltar</Link>
        <div className="text-center py-20 text-slate-400 text-sm">{erro}</div>
      </div>
    );
  }
  if (!workflow) return null;

  const info = STATUS_INFO[workflow.status];
  const versaoAtual = versoes.find(v => v.id === workflow.versao_atual_id);
  const podeExcluir = workflow.status === 'rascunho' && !workflow.versao_atual_id;

  return (
    <UsuariosCtx.Provider value={usuarios}>
    <TemplatesCtx.Provider value={templates}>
    {/* Largura ampla (não centralizada): em telas largas usa o espaço de verdade,
        em vez de deixar um vão à direita. A coluna do editor cresce; o resumo fica
        fixo em 360px. */}
    <div className="p-6 max-w-[110rem]">
      {/* Cabeçalho */}
      <Link href="/automacao?tab=workflows" className="text-sm text-slate-400 hover:text-slate-200 inline-flex items-center gap-1 mb-3 focus-ring rounded">
        <ArrowLeft size={14} /> Workflows
      </Link>
      <div className="min-w-0">
        <input
          value={nome}
          onChange={e => setNome(e.target.value)}
          aria-label="Nome do workflow"
          className="text-2xl font-bold text-slate-100 bg-transparent border-b border-transparent hover:border-[var(--border)] focus:border-[var(--accent)] focus:outline-none w-full"
        />
        <div className="flex items-center gap-2 mt-2 text-xs">
          <span className={info.chip}>{info.label}</span>
          {versaoAtual && <span className="text-slate-500">versão {versaoAtual.numero} vigente</span>}
          {sujo && <span className="chip chip-warning"><AlertTriangle size={11} /> não salvo</span>}
        </div>
      </div>

      {avisosTemplates.length > 0 && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>
            Rascunho salvo, mas publicar vai ser recusado enquanto houver pendência:{' '}
            {avisosTemplates.map(descreverProblemaTemplate).join('; ')}.
          </span>
        </div>
      )}

      {/* Barra de ações */}
      <div className="flex flex-wrap items-center gap-2 card p-3 mt-4">
        <button
          onClick={salvarRascunho}
          disabled={ocupado || !sujo}
          className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg text-slate-200 border border-[var(--border)] hover:bg-[var(--bg-base)] disabled:opacity-50 focus-ring"
        >
          <Save size={14} /> Salvar rascunho
        </button>
        <button
          onClick={testar}
          disabled={ocupado || simulando || problemas.length > 0}
          aria-label="Testar (simulação)"
          className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg text-indigo-300 border border-indigo-500/30 hover:bg-indigo-500/10 disabled:opacity-50 focus-ring"
          title={problemas[0] ?? 'Roda o fluxo em simulação, sem enviar e-mail nem criar tarefa'}
        >
          {simulando ? <Loader2 size={14} className="animate-spin" /> : <FlaskConical size={14} />} Testar
        </button>
        {workflow.status !== 'pausado' && (
          <button
            onClick={iniciarPublicacao}
            disabled={ocupado || problemas.length > 0}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg text-white font-medium disabled:opacity-50 focus-ring"
            style={{ backgroundColor: '#1e6f3a' }}
            title={problemas[0]}
          >
            <Rocket size={14} /> {workflow.status === 'publicado' ? 'Republicar' : 'Publicar'}
          </button>
        )}
        {workflow.status === 'publicado' && (
          <button onClick={() => acaoCiclo('pausar')} disabled={ocupado}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg text-amber-300 border border-amber-500/30 hover:bg-amber-500/10 disabled:opacity-50 focus-ring">
            <PauseCircle size={14} /> Pausar
          </button>
        )}
        {workflow.status === 'pausado' && (
          <button onClick={() => acaoCiclo('retomar')} disabled={ocupado}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg text-green-300 border border-green-500/30 hover:bg-green-500/10 disabled:opacity-50 focus-ring">
            <CheckCircle2 size={14} /> Retomar
          </button>
        )}
        <div className="flex-1" />
        {ocupado && <Loader2 size={16} className="animate-spin text-slate-500" />}
        {podeExcluir && (
          <button onClick={excluir} disabled={ocupado} className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg text-red-400 hover:bg-red-500/10 disabled:opacity-50 focus-ring">
            <Trash2 size={14} /> Excluir
          </button>
        )}
      </div>

      {(msg || erro) && (
        <div className={`text-sm px-3 py-2 rounded-lg mt-3 ${erro ? 'bg-red-500/10 text-red-300 border border-red-500/20' : 'bg-green-500/10 text-green-300 border border-green-500/20'}`}>
          {erro || msg}
        </div>
      )}

      {workflow.status === 'publicado' && sujo && (
        <div className="text-xs text-amber-300/90 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 mt-3 flex items-start gap-1.5">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          Editar não altera a versão publicada nem as execuções em andamento. Suas mudanças só valem para novas execuções após “Republicar”.
        </div>
      )}

      {/* Toggle lista / fluxo */}
      <div className="flex items-center gap-1 mt-5">
        {(['lista', 'fluxo'] as const).map(v => (
          <button key={v} onClick={() => setVista(v)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium inline-flex items-center gap-1.5 transition-colors ${vista === v ? 'bg-[var(--t-bg-card,#1a1f2e)] text-slate-100 border border-[var(--t-border-strong,#3f4d6b)]' : 'text-slate-500 hover:text-slate-300'}`}>
            {v === 'lista' ? <><List size={13} /> Ver como lista</> : <><GitBranch size={13} /> Ver como fluxo</>}
          </button>
        ))}
      </div>

      {/* Layout de duas colunas: editor (esquerda) + resumo VIVO do fluxo (direita,
          fixo ao rolar) — edita de um lado e vê o fluxo tomar forma do outro. */}
      <div className="grid lg:grid-cols-[minmax(0,1fr)_360px] gap-5 mt-4 items-start">
        {/* Coluna esquerda: editor em lista ou canvas de fluxo */}
        {vista === 'fluxo' ? (
          <WorkflowCanvas def={def} usuarios={usuarios} />
        ) : (
        <div>
          <section className="card p-4 animate-in stagger-1">
            <CabecalhoEtapa n={1} Icon={Zap} cor={COR_GATILHO} titulo="Gatilho" hint="quando o lead entra no workflow" />
            <LinhaBloco opcoes={GATILHOS} bloco={def.gatilho} onChange={g => setDef({ ...def, gatilho: g })} />
          </section>

          <ConectorEtapa />

          <section className="card p-4 animate-in stagger-2">
            <CabecalhoEtapa n={2} Icon={Filter} cor={COR_CONDICAO} titulo="Condições" hint="todas precisam passar (opcional)" />
            {def.condicoes.length === 0 && <p className="text-xs text-slate-500 mb-2">Sem condições — o gatilho basta.</p>}
            <div className="space-y-2">
              {def.condicoes.map((c, i) => (
                <LinhaBloco
                  key={i}
                  opcoes={CONDICOES}
                  bloco={c}
                  onChange={novo => setDef({ ...def, condicoes: def.condicoes.map((x, j) => (j === i ? novo : x)) })}
                  onRemover={() => setDef({ ...def, condicoes: def.condicoes.filter((_, j) => j !== i) })}
                />
              ))}
            </div>
            <button
              onClick={() => setDef({ ...def, condicoes: [...def.condicoes, blocoPadrao(CONDICOES[0])] })}
              className="flex items-center gap-1.5 text-xs text-sky-400 hover:text-sky-300 mt-2.5 focus-ring rounded"
            >
              <Plus size={13} /> Adicionar condição
            </button>
          </section>

          <ConectorEtapa />

          <section className="card p-4 animate-in stagger-3">
            <CabecalhoEtapa n={3} Icon={PlayCircle} cor={COR_ACAO} titulo="Ações" hint="executadas em ordem, de cima para baixo" />
            {def.acoes.length === 0 && <p className="text-xs text-amber-400/80 mb-2">Adicione ao menos uma ação para publicar.</p>}
            <div className="space-y-2">
              {def.acoes.map((a, i) => (
                <div key={i} className="flex gap-2 items-stretch">
                  <div className="flex flex-col items-center justify-center text-[11px] text-slate-600 w-5 shrink-0 font-mono">{i + 1}</div>
                  <div className="flex-1 min-w-0">
                    <LinhaBloco
                      opcoes={ACOES}
                      bloco={a}
                      onChange={novo => setDef({ ...def, acoes: def.acoes.map((x, j) => (j === i ? novo : x)) })}
                      onRemover={() => setDef({ ...def, acoes: def.acoes.filter((_, j) => j !== i) })}
                      condicoes={def.condicoes}
                      extra={a.tipo === 'saltar_se' ? (
                        <SaltarSeEditor
                          bloco={a}
                          acoes={def.acoes}
                          onChange={novo => setDef({ ...def, acoes: def.acoes.map((x, j) => (j === i ? novo : x)) })}
                        />
                      ) : undefined}
                      controles={
                        <div className="flex flex-col shrink-0">
                          <button
                            disabled={i === 0}
                            onClick={() => setDef({ ...def, acoes: mover(def.acoes, i, -1) })}
                            className="text-slate-500 hover:text-slate-300 disabled:opacity-30"
                            title="Subir"
                            aria-label="Subir ação"
                          ><ChevronUp size={14} /></button>
                          <button
                            disabled={i === def.acoes.length - 1}
                            onClick={() => setDef({ ...def, acoes: mover(def.acoes, i, 1) })}
                            className="text-slate-500 hover:text-slate-300 disabled:opacity-30"
                            title="Descer"
                            aria-label="Descer ação"
                          ><ChevronDown size={14} /></button>
                        </div>
                      }
                    />
                  </div>
                </div>
              ))}
            </div>
            <button
              onClick={() => setDef({ ...def, acoes: [...def.acoes, blocoPadrao(ACOES[0])] })}
              className="flex items-center gap-1.5 text-xs text-green-400 hover:text-green-300 mt-2.5 focus-ring rounded"
            >
              <Plus size={13} /> Adicionar ação
            </button>
          </section>
        </div>
        )}

        {/* Coluna do resumo — fixa ao rolar (segue o editor) */}
        <aside className="lg:sticky lg:top-6 space-y-4">
          {Object.keys(stats).length > 0 && (
            <div className="card p-4">
              <div className="text-xs font-semibold text-slate-300 mb-2.5 flex items-center gap-1.5">
                <PlayCircle size={13} className="text-slate-500" /> Execuções
              </div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(stats).map(([s, n]) => (
                  <span key={s} className="chip chip-muted">
                    {EXEC_LABEL[s] ?? s}: <span className="font-bold text-slate-100">{n}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Resultado da simulação "Testar" (Fase 5) — sem efeito real */}
          {simResult && (
            <div className="card p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <FlaskConical size={13} className="text-indigo-400" /> Simulação
                </div>
                <button onClick={() => setSimResult(null)} className="text-slate-500 hover:text-slate-300 focus-ring rounded" aria-label="Fechar simulação">
                  <X size={14} />
                </button>
              </div>
              <p className="text-[11px] text-slate-500 mb-2.5 leading-snug">
                Sem envios reais. O gatilho casa <span className="font-semibold text-slate-300">{simResult.alvos}</span> lead{simResult.alvos === 1 ? '' : 's'} agora.
                {simResult.amostra.length > 0 && ` Amostra de ${simResult.amostra.length}:`}
              </p>
              {simResult.amostra.length === 0 ? (
                <p className="text-xs text-slate-500">Nenhum lead casa o gatilho agora — nada a simular.</p>
              ) : (
                <ul className="space-y-2.5">
                  {simResult.amostra.map((a) => (
                    <li key={a.leadId} className="text-xs">
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="font-medium text-slate-200 truncate">{a.nome}</span>
                        <span className={`chip ${a.status === 'concluido' ? 'chip-success' : a.status === 'erro' ? 'chip-danger' : 'chip-muted'}`}>{a.status}</span>
                      </div>
                      <ol className="ml-1 border-l border-[var(--border)] pl-2.5 space-y-0.5 text-slate-400">
                        {a.passos.map((p, i) => <li key={i}>{p}</li>)}
                      </ol>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <ResumoFluxo def={def} usuarios={usuarios} />
        </aside>
      </div>

      {/* Inscrição manual (Fase 4.6): só faz sentido com o workflow publicado. */}
      {workflow.status === 'publicado' && (
        <div className="mt-5">
          <InscricaoManual workflowId={workflow.id} leads={leads} />
        </div>
      )}

      {/* Trava de segurança (Fase 5): confirmação de disparo amplo antes de publicar. */}
      {confirmPub && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => !ocupado && setConfirmPub(null)}>
          <div className="bg-[var(--t-bg-card,#1a1f2e)] rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2.5 mb-3">
              <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-amber-500/15 text-amber-400 shrink-0"><AlertTriangle size={18} /></span>
              <h3 className="font-bold text-lg text-slate-100">Confirmar publicação</h3>
            </div>
            <p className="text-sm text-slate-300 leading-relaxed">
              Este gatilho casa <span className="font-bold text-amber-300 inline-flex items-center gap-1"><Users size={13} /> {confirmPub.alvos} leads</span> agora. Ao publicar, o próximo tick do cron inscreve todos de uma vez — uma execução por lead.
            </p>
            <p className="text-xs text-slate-500 mt-2">
              Acima do limite de segurança de {LIMITE_TRAVA}. Se não era essa a intenção, revise o gatilho/condições antes de publicar.
            </p>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setConfirmPub(null)} disabled={ocupado} className="text-sm px-4 py-2 rounded-lg text-slate-300 hover:bg-[var(--t-bg-base,#0f1117)] disabled:opacity-50 focus-ring">Cancelar</button>
              <button
                onClick={executarPublicacao}
                disabled={ocupado}
                className="text-sm px-4 py-2 rounded-lg text-white font-medium flex items-center gap-2 disabled:opacity-50 focus-ring"
                style={{ backgroundColor: '#b45309' }}
              >
                {ocupado && <Loader2 size={14} className="animate-spin" />} Publicar mesmo assim
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </TemplatesCtx.Provider>
    </UsuariosCtx.Provider>
  );
}

// Painel de inscrição manual de UM lead (gatilho 'manual' ou teste sob demanda).
function InscricaoManual({ workflowId, leads }: { workflowId: string; leads: Lead[] }) {
  const [busca, setBusca] = useState('');
  const [selecionado, setSelecionado] = useState<Lead | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; texto: string } | null>(null);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return [];
    return leads
      .filter(l => `${l.empresa} ${l.contato_nome ?? ''}`.toLowerCase().includes(q))
      .slice(0, 8);
  }, [busca, leads]);

  async function inscrever() {
    if (!selecionado || ocupado) return;
    setOcupado(true); setFeedback(null);
    try {
      const r = await fetch(`/api/workflows/${workflowId}/inscrever`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: selecionado.id }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.erro || 'Falha ao inscrever');
      setFeedback({ ok: true, texto: data.jaInscrito ? 'Este lead já estava inscrito.' : `Lead inscrito — execução criada (será processada no próximo tick).` });
    } catch (e) {
      setFeedback({ ok: false, texto: e instanceof Error ? e.message : 'Erro ao inscrever' });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="bg-[var(--t-bg-card,#1a1f2e)] rounded-xl border border-[var(--t-border,#2a3147)] p-4 space-y-2">
      <div className="flex items-center gap-2 text-slate-200 font-semibold text-sm">
        <UserPlus size={15} className="text-indigo-400" /> Inscrever um lead manualmente
        <span className="text-xs font-normal text-slate-500">— sem esperar o cron</span>
      </div>
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          value={selecionado ? `${selecionado.empresa}${selecionado.contato_nome ? ' · ' + selecionado.contato_nome : ''}` : busca}
          onChange={e => { setSelecionado(null); setBusca(e.target.value); setFeedback(null); }}
          placeholder="Buscar lead por empresa ou contato..."
          className="w-full bg-[var(--t-bg-base,#0f1117)] border border-[var(--t-border,#2a3147)] rounded-lg pl-8 pr-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500/50"
        />
        {filtrados.length > 0 && !selecionado && (
          <div className="absolute z-10 mt-1 w-full bg-[var(--t-bg-card,#1a1f2e)] border border-[var(--t-border,#2a3147)] rounded-lg shadow-xl max-h-56 overflow-y-auto">
            {filtrados.map(l => (
              <button
                key={l.id}
                onClick={() => { setSelecionado(l); setBusca(''); }}
                className="block w-full text-left px-3 py-2 text-sm text-slate-300 hover:bg-[var(--t-bg-base,#0f1117)]"
              >
                {l.empresa}
                {l.contato_nome && <span className="text-slate-500"> · {l.contato_nome}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={inscrever}
          disabled={!selecionado || ocupado}
          className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg text-white font-medium disabled:opacity-50"
          style={{ backgroundColor: '#1e3a5f' }}
        >
          {ocupado ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />} Inscrever agora
        </button>
        {feedback && (
          <span className={`text-xs ${feedback.ok ? 'text-green-300' : 'text-red-300'}`}>{feedback.texto}</span>
        )}
      </div>
    </section>
  );
}

// Move o item `i` em `delta` posições (imutável).
function mover<T>(lista: T[], i: number, delta: number): T[] {
  const j = i + delta;
  if (j < 0 || j >= lista.length) return lista;
  const copia = [...lista];
  [copia[i], copia[j]] = [copia[j], copia[i]];
  return copia;
}
