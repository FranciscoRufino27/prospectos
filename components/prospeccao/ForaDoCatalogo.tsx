'use client';

import { useEffect, useState } from 'react';
import { Building2, Globe2, Loader2, Mail, MapPin } from 'lucide-react';
import type { DadosCnpj } from '@/lib/integracoes/hubspot/enriquecimento/opencnpj';
import { formatarCnpj } from '@/lib/empresas/cnpj';
import { formatarCnae, nomeLegivel } from '@/lib/prospeccao/rotulos';
import { cnpjDoTexto } from '@/lib/prospeccao/filtros';
import s from './Prospeccao.module.css';

// Busca por nome/CNPJ na aba Brasil quando a empresa pode não estar no
// catálogo RF (que só tem os ramos carregados):
//  - CNPJ sem resultado no catálogo → dados oficiais via OpenCNPJ (grátis);
//  - nome → atalho para procurar na Crustdata com país Brasil (só no clique,
//    porque gasta crédito).

type EstadoCnpj =
  | { fase: 'carregando' }
  | { fase: 'ok'; dados: DadosCnpj }
  | { fase: 'erro'; mensagem: string };

function EmpresaPorCnpj({ cnpj }: { cnpj: string }) {
  const [estado, setEstado] = useState<EstadoCnpj>({ fase: 'carregando' });

  useEffect(() => {
    let ativo = true;
    setEstado({ fase: 'carregando' });
    fetch(`/api/prospeccao/cnpj?cnpj=${cnpj}`)
      .then(async (res) => {
        const corpo = await res.json().catch(() => ({}));
        if (!ativo) return;
        setEstado(res.ok ? { fase: 'ok', dados: corpo as DadosCnpj } : { fase: 'erro', mensagem: corpo?.erro || 'Não foi possível consultar.' });
      })
      .catch(() => { if (ativo) setEstado({ fase: 'erro', mensagem: 'Sem conexão. Tente de novo.' }); });
    return () => { ativo = false; };
  }, [cnpj]);

  if (estado.fase === 'carregando') {
    return <p className="flex items-center gap-2 text-sm text-slate-400"><Loader2 size={14} className="animate-spin" /> Consultando o CNPJ na Receita (OpenCNPJ)…</p>;
  }
  if (estado.fase === 'erro') return <p className="text-sm text-slate-400">{estado.mensagem}</p>;

  const d = estado.dados;
  const nome = nomeLegivel(d.nome_fantasia ?? d.razao_social) || formatarCnpj(d.cnpj);
  return (
    <div className="flex flex-wrap items-start gap-x-8 gap-y-3">
      <div className="min-w-[220px]">
        <div className="font-medium text-slate-100">{nome}</div>
        {d.nome_fantasia && d.razao_social && <div className="mt-0.5 text-xs text-slate-400">{nomeLegivel(d.razao_social)}</div>}
        <div className="mt-1 font-mono text-xs text-slate-500">{formatarCnpj(d.cnpj)}</div>
      </div>
      <div className="text-sm text-slate-300">
        <div className="flex items-center gap-1.5"><MapPin size={13} className="text-slate-500" /> {[nomeLegivel(d.municipio), d.uf].filter(Boolean).join(' · ') || '—'}</div>
        <div className="mt-1 flex items-center gap-1.5"><Mail size={13} className="text-slate-500" /> {d.email ?? 'Sem e-mail'}</div>
      </div>
      <div className="text-sm text-slate-300">
        <div>{d.atividade_principal ?? '—'}</div>
        <div className="mt-1 text-xs text-slate-500">
          {d.cnae_principal ? formatarCnae(d.cnae_principal) : ''}{d.situacao_cadastral ? ` · ${d.situacao_cadastral}` : ''}
        </div>
      </div>
    </div>
  );
}

export default function ForaDoCatalogo({
  texto, semResultado, onBuscarFora,
}: { texto: string; semResultado: boolean; onBuscarFora: (nome: string) => void }) {
  const cnpj = cnpjDoTexto(texto);
  if (cnpj) {
    if (!semResultado) return null;
    return (
      <section className={`${s.panel} ${s.panelBody}`}>
        <div className={s.sectionHeading}>
          <span className={s.sectionIcon}><Building2 size={17} aria-hidden="true" /></span>
          <div>
            <h2>Fora do catálogo</h2>
            <p>Este CNPJ não está no catálogo da prospecção. Dados oficiais da Receita, só para consulta.</p>
          </div>
        </div>
        <div className="mt-4"><EmpresaPorCnpj cnpj={cnpj} /></div>
      </section>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-700/60 px-4 py-3 text-sm text-slate-300">
      <span>
        {semResultado ? <>Nenhuma empresa com “{texto}” no catálogo da Receita.</> : <>Não achou “{texto}”?</>}
        {' '}O catálogo só tem os ramos carregados.
      </span>
      <button type="button" onClick={() => onBuscarFora(texto)} className={`${s.outlineButton} focus-ring`}>
        <Globe2 size={15} /> Procurar fora do catálogo
      </button>
    </div>
  );
}
