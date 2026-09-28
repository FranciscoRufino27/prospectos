'use client';

// Resumo VISUAL read-only do fluxo de um workflow (Fase 4.5, entrega 4).
// Timeline vertical: gatilho → público/condições → ações em ordem, com esperas,
// ramificação (saltar_se: verdadeiro salta / falso continua) e encerramento.
// Puro: lê a definição em edição; não altera nada. Sem canvas.
import { Zap, Filter, Clock, GitBranch, Flag, PlayCircle, CornerDownRight, ArrowDown } from 'lucide-react';
import type { BlocoConfig, DefinicaoWorkflow } from '@/lib/workflows/types';
import { acharBlocoDef, descreverBloco, type UsuarioRotulo } from '@/lib/workflows/catalogo';

// --- Frase em linguagem natural do fluxo ------------------------------------

function nomeUsuario(uid: string, usuarios?: UsuarioRotulo[]): string {
  return uid ? (usuarios?.find(u => u.id === uid)?.nome ?? uid) : '';
}

function fraseGatilho(g: BlocoConfig): string {
  const cfg = g.config ?? {};
  switch (g.tipo) {
    case 'lead_respondeu_gatilho': {
      const dias = Number(cfg.dentro_de_dias ?? 3);
      return `um lead responder nos últimos ${dias} dias`;
    }
    case 'manual':
      return 'um lead for inscrito manualmente';
    case 'nao_respondeu_em_dias': {
      const dias = Number(cfg.dias ?? 30);
      return `um lead não responder em ${dias} dias`;
    }
    case 'validade_laudo_venceu': {
      const dias = Number(cfg.dias_apos ?? 0);
      return dias === 0 ? 'a validade do laudo vencer' : `a validade do laudo vencer há ${dias} dias`;
    }
    case 'campo_data_vence': {
      const campo = String(cfg.campo ?? 'data');
      const dias = Number(cfg.dias ?? 0);
      return `o campo "${campo}" vencer em ${dias} dias`;
    }
    case 'status_mudou':
      return `o status mudar para "${String(cfg.estagio ?? '')}"`;
    case 'sem_resposta_ha_dias': {
      const dias = Number(cfg.dias ?? 30);
      return `um lead ficar sem resposta por ${dias} dias`;
    }
    default:
      return descreverBloco(g).toLowerCase();
  }
}

function fraseCondicoes(condicoes: BlocoConfig[], usuarios?: UsuarioRotulo[]): string {
  if (condicoes.length === 0) return 'para qualquer lead, não filtrado por responsável';
  return condicoes.map(c => {
    if (c.tipo === 'responsavel_lead_igual') {
      const uid = String(c.config?.responsavel_id ?? '');
      const nome = nomeUsuario(uid, usuarios);
      return nome ? `responsável do lead é ${nome}` : 'com responsável definido';
    }
    return descreverBloco(c, usuarios).toLowerCase();
  }).join(' e ');
}

function fraseAcoes(acoes: BlocoConfig[], usuarios?: UsuarioRotulo[]): string {
  if (acoes.length === 0) return 'sem ações';
  const partes: string[] = [];
  for (const a of acoes) {
    if (a.tipo === 'esperar') {
      const dias = Number(a.config?.dias ?? 0);
      const horas = Number(a.config?.horas ?? 0);
      const t: string[] = [];
      if (dias) t.push(`${dias} dia${dias === 1 ? '' : 's'}`);
      if (horas) t.push(`${horas}h`);
      partes.push(`espera ${t.join(' e ') || '0'}`);
    } else if (a.tipo === 'encerrar') {
      partes.push('encerra o fluxo');
      break;
    } else if (a.tipo === 'criar_tarefa' || a.tipo === 'criar_tarefa_ligacao') {
      const titulo = String(a.config?.titulo ?? '');
      const uid = String(a.config?.responsavel_id ?? '');
      const nome = nomeUsuario(uid, usuarios);
      const tipo = a.tipo === 'criar_tarefa_ligacao' ? 'tarefa de ligação' : 'tarefa';
      partes.push(nome ? `cria ${tipo} "${titulo}" para ${nome}` : `cria ${tipo} "${titulo}"`);
    } else if (a.tipo === 'atribuir_responsavel') {
      const uid = String(a.config?.responsavel_id ?? '');
      const nome = nomeUsuario(uid, usuarios);
      partes.push(nome ? `atribui o lead a ${nome}` : 'atribui responsável');
    } else if (a.tipo === 'notificar') {
      const uid = String(a.config?.responsavel_id ?? '');
      const nome = nomeUsuario(uid, usuarios);
      partes.push(nome ? `notifica ${nome}` : 'envia notificação');
    } else {
      partes.push(descreverBloco(a, usuarios).toLowerCase());
    }
    if (partes.length >= 4) { partes.push('…'); break; }
  }
  return partes.join(' e depois ');
}

function montarFraseFluxo(def: DefinicaoWorkflow, usuarios?: UsuarioRotulo[]): string | null {
  if (!def.gatilho?.tipo) return null;
  const g = fraseGatilho(def.gatilho);
  const c = fraseCondicoes(def.condicoes ?? [], usuarios);
  const a = fraseAcoes(def.acoes ?? [], usuarios);
  return `Quando ${g} — ${c} — ${a}.`;
}

function rotuloPasso(acoes: BlocoConfig[], indice: number): string {
  const b = acoes[indice];
  if (!b) return `passo ${indice + 1} (inexistente)`;
  return `passo ${indice + 1} · ${acharBlocoDef(b.tipo)?.label ?? b.tipo}`;
}

function textoEsperar(cfg: Record<string, unknown>): string {
  const dias = Number(cfg.dias ?? 0);
  const horas = Number(cfg.horas ?? 0);
  const partes: string[] = [];
  if (dias) partes.push(`${dias} dia${dias === 1 ? '' : 's'}`);
  if (horas) partes.push(`${horas} h`);
  return `Esperar ${partes.join(' e ') || '0'}`;
}

const Bolha = ({ Icon, cor }: { Icon: typeof Zap; cor: string }) => (
  <span className={`flex items-center justify-center w-6 h-6 rounded-md shrink-0 ${cor}`}>
    <Icon size={13} />
  </span>
);

function FluxoPasso({ bloco, indice, acoes, usuarios }: { bloco: BlocoConfig; indice: number; acoes: BlocoConfig[]; usuarios?: UsuarioRotulo[] }) {
  const n = <span className="text-[11px] font-mono text-slate-600 w-5 shrink-0 text-right">{indice + 1}</span>;

  if (bloco.tipo === 'esperar') {
    return (
      <li className="flex items-center gap-2">
        {n}
        <Bolha Icon={Clock} cor="bg-slate-500/20 text-slate-300" />
        <span className="text-sm text-slate-300">{textoEsperar(bloco.config ?? {})}</span>
      </li>
    );
  }

  if (bloco.tipo === 'encerrar') {
    return (
      <li className="flex items-center gap-2">
        {n}
        <Bolha Icon={Flag} cor="bg-red-500/20 text-red-300" />
        <span className="text-sm text-red-300/90">Encerrar o fluxo</span>
      </li>
    );
  }

  if (bloco.tipo === 'saltar_se') {
    const cfg = bloco.config ?? {};
    const cond = cfg.condicao as BlocoConfig | undefined;
    const destinoId = String(cfg.destino ?? '');
    const destino = acoes.findIndex((a) => a.id === destinoId); // id → índice atual
    const destinoValido = destino >= 0;
    return (
      <li>
        <div className="flex items-center gap-2">
          {n}
          <Bolha Icon={GitBranch} cor="bg-sky-500/20 text-sky-300" />
          <span className="text-sm text-slate-200">
            Ramificar — se <span className="text-sky-300">{cond ? descreverBloco(cond, usuarios) : 'condição'}</span>
          </span>
        </div>
        <div className="ml-7 mt-1 space-y-0.5 text-xs">
          <div className="flex items-center gap-1.5 text-emerald-300">
            <CornerDownRight size={12} /> verdadeiro → vai para{' '}
            <span className={destinoValido ? 'font-medium' : 'text-red-400'}>
              {destinoValido ? rotuloPasso(acoes, destino) : destinoId ? 'passo removido' : 'destino não escolhido'}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-slate-400">
            <ArrowDown size={12} /> falso → continua para o próximo passo
          </div>
        </div>
      </li>
    );
  }

  // Ação comum.
  return (
    <li className="flex items-center gap-2">
      {n}
      <Bolha Icon={PlayCircle} cor="bg-green-500/20 text-green-300" />
      <span className="text-sm text-slate-300">{descreverBloco(bloco, usuarios)}</span>
    </li>
  );
}

export default function ResumoFluxo({ def, usuarios }: { def: DefinicaoWorkflow; usuarios?: UsuarioRotulo[] }) {
  const acoes = def.acoes ?? [];
  const condicoes = def.condicoes ?? [];
  const frase = montarFraseFluxo(def, usuarios);
  return (
    <div className="bg-[var(--t-bg-card,#1a1f2e)] rounded-xl border border-[var(--t-border,#2a3147)] p-4">
      <div className="text-sm font-semibold text-slate-200 mb-3">Resumo do fluxo</div>
      {frase && (
        <p className="text-xs text-slate-300 leading-relaxed bg-[var(--t-bg-base,#0f1117)]/60 rounded-lg px-3 py-2.5 mb-3 border border-[var(--t-border,#2a3147)]">
          {frase}
        </p>
      )}
      <ol className="space-y-2">
        <li className="flex items-center gap-2">
          <span className="w-5 shrink-0" />
          <Bolha Icon={Zap} cor="bg-amber-500/20 text-amber-300" />
          <span className="text-sm text-slate-200">
            Gatilho — <span className="text-amber-200/90">{descreverBloco(def.gatilho, usuarios)}</span>
          </span>
        </li>

        {condicoes.length > 0 && (
          <li className="flex items-start gap-2">
            <span className="w-5 shrink-0" />
            <Bolha Icon={Filter} cor="bg-sky-500/20 text-sky-300" />
            <span className="text-sm text-slate-300">
              Público — {condicoes.map((c) => descreverBloco(c, usuarios)).join(' E ')}
            </span>
          </li>
        )}

        {acoes.length === 0 ? (
          <li className="ml-7 text-xs text-amber-400/80">Sem ações ainda.</li>
        ) : (
          acoes.map((a, i) => <FluxoPasso key={i} bloco={a} indice={i} acoes={acoes} usuarios={usuarios} />)
        )}

        <li className="flex items-center gap-2 pt-1">
          <span className="w-5 shrink-0" />
          <Bolha Icon={Flag} cor="bg-slate-600/30 text-slate-400" />
          <span className="text-xs text-slate-500">Fim do fluxo</span>
        </li>
      </ol>
    </div>
  );
}
