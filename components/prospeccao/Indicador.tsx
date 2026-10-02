'use client';

import type { Building2 } from 'lucide-react';
import s from './Prospeccao.module.css';

// Peças visuais comuns às abas Brasil e Internacional da Prospecção.

const TOM_KPI = { cyan: s.kpiCyan, violet: s.kpiViolet, emerald: s.kpiEmerald, amber: s.kpiAmber };

// Indicador no padrão do Dashboard. `proporcao` (0–1) desenha a barra; sem ela,
// o card fica só com o número — nada de barra decorativa sem dado por trás.
export function Indicador({ icone: Icone, rotulo, valor, detalhe, tom, proporcao }: {
  icone: typeof Building2; rotulo: string; valor: string; detalhe: string;
  tom: keyof typeof TOM_KPI; proporcao?: number | null;
}) {
  return (
    <article className={`${s.kpiCard} ${TOM_KPI[tom]}`}>
      <div className={s.kpiTop}>
        <span className={s.kpiIcon}><Icone size={19} strokeWidth={1.8} aria-hidden="true" /></span>
        <div className={s.kpiIdentity}>
          <span className={s.kpiLabel}>{rotulo}</span>
          <strong>{valor}</strong>
        </div>
      </div>
      {proporcao != null && (
        <div className={s.kpiMeter} aria-hidden="true">
          <span style={{ width: `${Math.round(Math.min(1, Math.max(0, proporcao)) * 100)}%` }} />
        </div>
      )}
      <span className={s.kpiSubtitle}>{detalhe}</span>
    </article>
  );
}

export function CabecalhoBloco({ icone: Icone, titulo, subtitulo }: { icone: typeof Building2; titulo: string; subtitulo: string }) {
  return (
    <div className={s.sectionHeading}>
      <span className={s.sectionIcon}><Icone size={17} aria-hidden="true" /></span>
      <div><h2>{titulo}</h2><p>{subtitulo}</p></div>
    </div>
  );
}
