'use client';

import { useEffect, useState } from 'react';
import { Building2, Globe2, Loader2, Mail, MailX, MapPin, SearchX, X } from 'lucide-react';
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

/**
 * Tela de "empresa não encontrada" da busca por nome/CNPJ na aba Brasil, no
 * lugar da tabela vazia. Distingue dois casos:
 *  - a empresa existe no catálogo, mas o filtro "só com e-mail" a esconde;
 *  - não há nada com esse nome/CNPJ no catálogo com os filtros atuais.
 */
export function EmpresaNaoEncontrada({
  texto, escondidasPorEmail, onMostrarSemEmail, onBuscarFora, onLimpar,
}: {
  texto: string
  /** Quantas casam com a busca mas não têm e-mail válido (0 = nenhuma). */
  escondidasPorEmail: number
  onMostrarSemEmail: () => void
  onBuscarFora: (nome: string) => void
  onLimpar: () => void
}) {
  const ehCnpj = cnpjDoTexto(texto) !== null;
  if (escondidasPorEmail > 0) {
    const n = escondidasPorEmail;
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-300"><MailX size={22} /></span>
        <p className="mt-4 text-base font-semibold text-slate-100">Empresa encontrada, mas sem e-mail válido</p>
        <p className="mt-1.5 text-sm text-slate-400">
          {n === 1 ? 'Há 1 empresa' : `Há ${n.toLocaleString('pt-BR')} empresas`} com “{texto}” no catálogo, escondida{n === 1 ? '' : 's'} porque o filtro “só com e-mail” está ligado.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <button type="button" onClick={onMostrarSemEmail} className={`${s.primaryButton} focus-ring`}>Mostrar mesmo sem e-mail</button>
          <button type="button" onClick={onLimpar} className={`${s.outlineButton} focus-ring`}><X size={15} /> Limpar busca</button>
        </div>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5 text-slate-400"><SearchX size={22} /></span>
      <p className="mt-4 text-base font-semibold text-slate-100">Empresa não encontrada</p>
      <p className="mt-1.5 text-sm text-slate-400">
        {ehCnpj
          ? <>O CNPJ “{texto}” não está no catálogo da prospecção com os filtros atuais.</>
          : <>Não achamos “{texto}” no catálogo da Receita com os filtros atuais.</>}
      </p>
      <ul className="mx-auto mt-4 max-w-sm space-y-1 text-left text-xs text-slate-500">
        {!ehCnpj && <li>• Confira a grafia ou tente só uma parte do nome.</li>}
        <li>• O catálogo só tem os ramos carregados e os estados/municípios do perfil de busca.</li>
        {ehCnpj && <li>• Os dados oficiais deste CNPJ estão logo acima, no quadro “Fora do catálogo”.</li>}
      </ul>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {!ehCnpj && (
          <button type="button" onClick={() => onBuscarFora(texto)} className={`${s.primaryButton} focus-ring`}>
            <Globe2 size={15} /> Procurar fora do catálogo
          </button>
        )}
        <button type="button" onClick={onLimpar} className={`${s.outlineButton} focus-ring`}><X size={15} /> Limpar busca</button>
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
  // Sem resultado, quem fala é a tela "Empresa não encontrada" na tabela.
  if (semResultado) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-700/60 px-4 py-3 text-sm text-slate-300">
      <span>Não achou “{texto}”? O catálogo só tem os ramos carregados.</span>
      <button type="button" onClick={() => onBuscarFora(texto)} className={`${s.outlineButton} focus-ring`}>
        <Globe2 size={15} /> Procurar fora do catálogo
      </button>
    </div>
  );
}
