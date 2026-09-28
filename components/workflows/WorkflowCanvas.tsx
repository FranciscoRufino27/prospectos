'use client';

// Canvas visual somente-leitura de um workflow (Fase 5a).
// Renderiza gatilho → condições → ações em coluna vertical com setas SVG.
// saltar_se gera arco de desvio (bezier à direita) para o nó destino.
// Sem dependências externas — SVG + HTML absolutamente posicionados.
import { useMemo } from 'react';
import {
  Zap, Clock, Mail, CheckSquare, Phone, GitBranch, Flag, PlayCircle,
  Bell, UserPlus, Filter,
} from 'lucide-react';
import type { BlocoConfig, DefinicaoWorkflow } from '@/lib/workflows/types';
import { descreverBloco, type UsuarioRotulo } from '@/lib/workflows/catalogo';

// ─── Layout constants ────────────────────────────────────────────────────────
const NW = 280;                   // node width
const NH = 76;                    // node height
const GAP = 44;                   // vertical gap between nodes
const PL = 56;                    // left padding (x of node left edge)
const PT = 48;                    // top padding
const BYPASS_X = PL + NW + 88;   // x where bypass arcs pass through (right column)

// ─── Types ───────────────────────────────────────────────────────────────────
type Kind = 'trigger' | 'cond' | 'wait' | 'branch' | 'end' | 'action';

interface CNode {
  id: string; tipo: string; kind: Kind; label: string; x: number; y: number;
}

interface CEdge {
  id: string; fx: number; fy: number; tx: number; ty: number;
  bypass?: boolean; label?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function kindOf(tipo: string): Kind {
  if (tipo === 'trigger')   return 'trigger';
  if (tipo === 'conditions') return 'cond';
  if (tipo === 'esperar')   return 'wait';
  if (tipo === 'saltar_se' || tipo === 'ramificar') return 'branch';
  if (tipo === 'encerrar'  || tipo === 'parar_cadencia') return 'end';
  return 'action';
}

function labelFor(bloco: BlocoConfig, usuarios: UsuarioRotulo[]): string {
  if (bloco.tipo === 'esperar') {
    const d = Number(bloco.config?.dias ?? 0), h = Number(bloco.config?.horas ?? 0);
    const p: string[] = [];
    if (d) p.push(`${d} dia${d === 1 ? '' : 's'}`);
    if (h) p.push(`${h}h`);
    return `Esperar ${p.join(' e ') || '0'}`;
  }
  if (bloco.tipo === 'saltar_se') {
    const cond = bloco.config?.condicao as BlocoConfig | undefined;
    return cond ? `Se: ${descreverBloco(cond, usuarios)}` : 'Ramificar (condição não definida)';
  }
  return descreverBloco(bloco, usuarios);
}

// ─── Layout ──────────────────────────────────────────────────────────────────
function computeLayout(def: DefinicaoWorkflow, usuarios: UsuarioRotulo[]) {
  const nodes: CNode[] = [];
  let y = PT;

  function push(id: string, tipo: string, label: string): CNode {
    const n: CNode = { id, tipo, kind: kindOf(tipo), label, x: PL, y };
    nodes.push(n);
    y += NH + GAP;
    return n;
  }

  // Trigger
  push('trigger', 'trigger', labelFor(def.gatilho, usuarios));

  // Conditions summary (merged into one node)
  const condicoes = def.condicoes ?? [];
  if (condicoes.length > 0) {
    push('conditions', 'conditions', 'Público: ' + condicoes.map(c => descreverBloco(c, usuarios)).join(' E '));
  }

  // Actions
  const acoes = def.acoes ?? [];
  const acaoById = new Map<string, BlocoConfig>();
  for (let i = 0; i < acoes.length; i++) {
    const a = acoes[i];
    const id = a.id ?? `action-${i}`;
    acaoById.set(id, a);
    push(id, a.tipo, labelFor(a, usuarios));
  }

  // Terminal node (if last action is not already an end)
  const lastA = acoes[acoes.length - 1];
  if (!lastA || (lastA.tipo !== 'encerrar' && lastA.tipo !== 'parar_cadencia')) {
    push('__end', 'encerrar', 'Fim do fluxo');
  }

  // ─── Edges ─────────────────────────────────────────────────────────────────
  const edges: CEdge[] = [];
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const hasIncoming = new Set<string>();
  const allIds = nodes.map(n => n.id);

  for (let i = 0; i < allIds.length - 1; i++) {
    const cur = nodeMap.get(allIds[i])!;
    const nxt = nodeMap.get(allIds[i + 1])!;
    const acao = acaoById.get(cur.id);

    if (acao?.tipo === 'saltar_se') {
      // "Não / continua" edge straight down
      if (!hasIncoming.has(nxt.id)) {
        edges.push({ id: `${cur.id}-nao`, fx: cur.x + NW / 2, fy: cur.y + NH, tx: nxt.x + NW / 2, ty: nxt.y, label: 'Não' });
        hasIncoming.add(nxt.id);
      }
      // "Sim / pula" bypass arc to destino
      const destId = String(acao.config?.destino ?? '');
      if (destId) {
        const dest = nodeMap.get(destId);
        if (dest) {
          edges.push({ id: `${cur.id}-sim`, fx: cur.x + NW, fy: cur.y + NH / 2, tx: dest.x + NW, ty: dest.y + NH / 2, bypass: true, label: 'Sim' });
        }
      }
    } else if (!hasIncoming.has(nxt.id) && cur.kind !== 'end') {
      // encerrar/parar_cadencia terminam o fluxo — não conectam ao próximo nó
      edges.push({ id: `${cur.id}-${nxt.id}`, fx: cur.x + NW / 2, fy: cur.y + NH, tx: nxt.x + NW / 2, ty: nxt.y });
      hasIncoming.add(nxt.id);
    }
  }

  return { nodes, edges, totalH: y + PT, totalW: BYPASS_X + 56 };
}

// ─── Node style ──────────────────────────────────────────────────────────────
type IconType = React.ComponentType<{ size?: number; className?: string }>;
interface NS { border: string; bg: string; Icon: IconType; iconCls: string; textCls: string }

function getStyle(n: CNode): NS {
  switch (n.kind) {
    case 'trigger': return { border: 'border-amber-500/40',  bg: 'bg-amber-500/10',  Icon: Zap,        iconCls: 'text-amber-400',  textCls: 'text-amber-200'  };
    case 'cond':    return { border: 'border-sky-500/40',    bg: 'bg-sky-500/10',    Icon: Filter,     iconCls: 'text-sky-400',    textCls: 'text-sky-200'    };
    case 'wait':    return { border: 'border-slate-600/60',  bg: 'bg-slate-700/20',  Icon: Clock,      iconCls: 'text-slate-400',  textCls: 'text-slate-300'  };
    case 'branch':  return { border: 'border-violet-500/40', bg: 'bg-violet-500/10', Icon: GitBranch,  iconCls: 'text-violet-400', textCls: 'text-violet-200' };
    case 'end':     return { border: 'border-red-500/30',    bg: 'bg-red-500/10',    Icon: Flag,       iconCls: 'text-red-400',    textCls: 'text-red-300'    };
    default: {
      const t = n.tipo;
      if (t === 'enviar_email')
        return { border: 'border-indigo-500/40',  bg: 'bg-indigo-500/10',  Icon: Mail,        iconCls: 'text-indigo-400',  textCls: 'text-indigo-200'  };
      if (t === 'criar_tarefa_ligacao')
        return { border: 'border-emerald-500/40', bg: 'bg-emerald-500/10', Icon: Phone,       iconCls: 'text-emerald-400', textCls: 'text-emerald-200' };
      if (t === 'criar_tarefa')
        return { border: 'border-emerald-500/40', bg: 'bg-emerald-500/10', Icon: CheckSquare, iconCls: 'text-emerald-400', textCls: 'text-emerald-200' };
      if (t === 'atribuir_responsavel')
        return { border: 'border-purple-500/40',  bg: 'bg-purple-500/10',  Icon: UserPlus,    iconCls: 'text-purple-400',  textCls: 'text-purple-200'  };
      if (t === 'notificar')
        return { border: 'border-amber-500/40',   bg: 'bg-amber-500/10',   Icon: Bell,        iconCls: 'text-amber-400',   textCls: 'text-amber-200'   };
      return   { border: 'border-[var(--t-border,#2a3147)]',      bg: 'bg-[var(--t-bg-base,#0f1117)]/60',   Icon: PlayCircle,  iconCls: 'text-slate-400',   textCls: 'text-slate-300'   };
    }
  }
}

function NodeCard({ n }: { n: CNode }) {
  const { border, bg, Icon, iconCls, textCls } = getStyle(n);
  return (
    <div
      style={{ position: 'absolute', left: n.x, top: n.y, width: NW, height: NH }}
      className={`rounded-xl border ${border} ${bg} px-4 flex items-center gap-3`}
    >
      <span className="flex items-center justify-center w-7 h-7 rounded-lg shrink-0 bg-black/20">
        <Icon size={15} className={iconCls} />
      </span>
      <p className={`text-[13px] font-medium leading-snug ${textCls} line-clamp-2 min-w-0`}>{n.label}</p>
    </div>
  );
}

// ─── Edge path ────────────────────────────────────────────────────────────────
function EdgePath({ e }: { e: CEdge }) {
  if (e.bypass) {
    const d = `M ${e.fx} ${e.fy} C ${BYPASS_X} ${e.fy} ${BYPASS_X} ${e.ty} ${e.tx} ${e.ty}`;
    return (
      <g>
        <path d={d} fill="none" stroke="#5b21b6" strokeWidth={1.5} strokeDasharray="5 3" markerEnd="url(#wc-arr-bypass)" />
        {e.label && (
          <text x={BYPASS_X + 4} y={(e.fy + e.ty) / 2} fontSize={10} fill="#8b5cf6" dominantBaseline="middle" textAnchor="start">
            {e.label}
          </text>
        )}
      </g>
    );
  }
  const d = `M ${e.fx} ${e.fy} L ${e.tx} ${e.ty}`;
  const lx = e.fx + 5;
  const ly = e.fy + (e.ty - e.fy) * 0.2;
  return (
    <g>
      <path d={d} fill="none" stroke="#334155" strokeWidth={1.5} markerEnd="url(#wc-arr-down)" />
      {e.label && (
        <text x={lx} y={ly} fontSize={10} fill="#64748b" dominantBaseline="middle" textAnchor="start">
          {e.label}
        </text>
      )}
    </g>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function WorkflowCanvas({
  def,
  usuarios = [],
}: {
  def: DefinicaoWorkflow;
  usuarios?: UsuarioRotulo[];
}) {
  const { nodes, edges, totalH, totalW } = useMemo(
    () => computeLayout(def, usuarios),
    [def, usuarios],
  );

  return (
    <div className="bg-[var(--t-bg-subtle,#0d1117)] border border-[var(--t-border,#2a3147)] rounded-xl overflow-auto">
      <div style={{ position: 'relative', width: totalW, minHeight: totalH }}>
        {/* SVG overlay: arrows + edge paths (pointer-events off — não bloqueia interação) */}
        <svg
          style={{ position: 'absolute', top: 0, left: 0, width: totalW, height: totalH, overflow: 'visible', pointerEvents: 'none' }}
          aria-hidden="true"
        >
          <defs>
            {/* Seta para baixo (arestas regulares) */}
            <marker id="wc-arr-down" markerWidth="7" markerHeight="5" refX="7" refY="2.5" orient="auto">
              <polygon points="0 0, 7 2.5, 0 5" fill="#334155" />
            </marker>
            {/* Seta apontando à esquerda (arcos de desvio saltar_se) */}
            <marker id="wc-arr-bypass" markerWidth="7" markerHeight="5" refX="7" refY="2.5" orient="auto">
              <polygon points="0 0, 7 2.5, 0 5" fill="#5b21b6" />
            </marker>
          </defs>
          {edges.map(e => <EdgePath key={e.id} e={e} />)}
        </svg>

        {/* Node cards */}
        {nodes.map(n => <NodeCard key={n.id} n={n} />)}
      </div>
    </div>
  );
}
