'use client';

import { ChevronRight, type LucideIcon } from 'lucide-react';
import s from './TemaModulo.module.css';
import { NumeroAnimado } from '@/components/ui/NumeroAnimado';

// Peças do tema dos módulos: a página (wrapper que aplica a paleta), o
// cabeçalho com trilha, as abas segmentadas, os indicadores e o título de
// seção. Visual alinhado à Prospecção e ao Dashboard.

export const estilosModulo = s;

/** Só a paleta do tema, para telas que já têm cabeçalho e espaçamento próprios. */
export function CoresModulo({ children }: { children: React.ReactNode }) {
  return <div className={s.cores}>{children}</div>;
}

export function PaginaModulo({
  grupo, titulo, subtitulo, acoes, abas, children,
}: {
  grupo: string; // trilha: "Execução", "Gestão", "Administração"…
  titulo: string;
  subtitulo: string;
  acoes?: React.ReactNode;
  abas?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className={`${s.cores} ${s.tema}`}>
      <header className={s.pageHeader}>
        <nav className={s.breadcrumb} aria-label="Navegação estrutural">
          <span>{grupo}</span><ChevronRight size={13} aria-hidden="true" /><strong>{titulo}</strong>
        </nav>
        <div className={s.titleRow}>
          <div>
            <h1>{titulo}</h1>
            <p>{subtitulo}</p>
          </div>
          {acoes && <div className={s.actions}>{acoes}</div>}
        </div>
        {abas}
      </header>
      {/* surgir-cascata (globals.css): os blocos da página entram em sequência. */}
      <div className={`${s.content} surgir-cascata`}>{children}</div>
    </div>
  );
}

export function AbasModulo<T extends string>({ abas, ativa, onChange, rotulo }: {
  abas: readonly { id: T; label: string; Icon: LucideIcon }[];
  ativa: T;
  onChange: (id: T) => void;
  rotulo: string;
}) {
  return (
    <div className={s.tabs} role="tablist" aria-label={rotulo}>
      {abas.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={ativa === t.id}
          onClick={() => onChange(t.id)}
          className={`${ativa === t.id ? s.tabAtiva : ''} focus-ring`}
        >
          <t.Icon size={15} aria-hidden="true" /> {t.label}
        </button>
      ))}
    </div>
  );
}

const TOM = { cyan: s.kpiCyan, violet: s.kpiViolet, emerald: s.kpiEmerald, amber: s.kpiAmber, blue: s.kpiBlue };

export function IndicadorModulo({ icone: Icone, rotulo, valor, detalhe, tom }: {
  icone: LucideIcon; rotulo: string; valor: string | number; detalhe: string; tom: keyof typeof TOM;
}) {
  return (
    <article className={`${s.kpiCard} ${TOM[tom]}`}>
      <div className={s.kpiTop}>
        <span className={s.kpiIcon}><Icone size={19} strokeWidth={1.8} aria-hidden="true" /></span>
        <div className={s.kpiIdentity}>
          <span className={s.kpiLabel}>{rotulo}</span>
          <strong>{typeof valor === 'number' ? <NumeroAnimado valor={valor} /> : valor}</strong>
        </div>
      </div>
      <span className={s.kpiSubtitle}>{detalhe}</span>
    </article>
  );
}

export function TituloSecao({ icone: Icone, titulo, subtitulo }: { icone: LucideIcon; titulo: string; subtitulo: string }) {
  return (
    <div className={s.sectionHeading}>
      <span className={s.sectionIcon}><Icone size={17} aria-hidden="true" /></span>
      <div><h2>{titulo}</h2><p>{subtitulo}</p></div>
    </div>
  );
}
