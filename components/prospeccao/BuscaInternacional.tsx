'use client';

import { useEffect, useRef, useState } from 'react';
import { Building2, ChevronDown, ExternalLink, Globe2, Loader2, Search, SearchX } from 'lucide-react';
import {
  PAISES_INTERNACIONAL, type EmpresaInternacional, type RespostaInternacional,
} from '@/lib/prospeccao/crustdata';
import { iniciais } from '@/lib/prospeccao/rotulos';
import s from './Prospeccao.module.css';

// Busca internacional (Crustdata): nome e/ou país. Cada busca gasta crédito,
// então só roda no clique — nada de busca automática ao digitar. Resultado só
// para consulta: ainda não importa para a base (empresa sem CNPJ não entra no
// fluxo de importação do catálogo da Receita).

/** Busca pedida de fora (atalho "Procurar fora do catálogo"); `id` novo = nova busca. */
export interface PedidoBusca { nome: string; pais: string; id: number }

const nomePais = (codigo: string) => PAISES_INTERNACIONAL.find((p) => p.codigo === codigo)?.nome ?? codigo;

export default function BuscaInternacional({ pedido }: { pedido?: PedidoBusca | null }) {
  const [nome, setNome] = useState(pedido?.nome ?? '');
  const [pais, setPais] = useState(pedido?.pais ?? '');
  const [itens, setItens] = useState<EmpresaInternacional[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Busca que gerou a lista: "Carregar mais" repete exatamente ela.
  const [buscaFeita, setBuscaFeita] = useState<{ nome: string; pais: string } | null>(null);
  const buscaAtual = useRef(0);

  const podeBuscar = nome.trim().length >= 2 || pais !== '';

  async function buscar(criterio: { nome: string; pais: string }, apos: string | null) {
    const id = ++buscaAtual.current;
    setCarregando(true);
    setErro(null);
    try {
      const res = await fetch('/api/prospeccao/internacional', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...criterio, cursor: apos }),
      });
      const corpo = (await res.json().catch(() => ({}))) as Partial<RespostaInternacional> & { erro?: string };
      if (id !== buscaAtual.current) return;
      if (!res.ok) throw new Error(corpo.erro || 'Falha na busca');
      setItens((atual) => (apos ? [...atual, ...(corpo.itens ?? [])] : corpo.itens ?? []));
      setCursor(corpo.proximoCursor ?? null);
      if (!apos) { setTotal(corpo.total ?? null); setBuscaFeita(criterio); }
    } catch (e) {
      if (id === buscaAtual.current) setErro(e instanceof Error ? e.message : 'Erro na busca');
    } finally {
      if (id === buscaAtual.current) setCarregando(false);
    }
  }

  // O atalho já é o clique do usuário: busca direto com o que veio.
  useEffect(() => {
    if (!pedido) return;
    setNome(pedido.nome);
    setPais(pedido.pais);
    buscar({ nome: pedido.nome, pais: pedido.pais }, null);
  }, [pedido?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!podeBuscar || carregando) return;
    buscar({ nome: nome.trim(), pais }, null);
  }

  return (
    <>
      <section className={`${s.panel} ${s.panelBody}`}>
        <div className={s.sectionHeading}>
          <span className={s.sectionIcon}><Globe2 size={17} aria-hidden="true" /></span>
          <div>
            <h2>Busca internacional</h2>
            <p>Empresas fora do catálogo da Receita, pelo nome e pelo país. Fonte: Crustdata.</p>
          </div>
        </div>
        <form onSubmit={enviar} className="mt-4 flex flex-wrap items-end gap-3">
          <label className={`${s.fieldLabel} min-w-[240px] flex-1`}>
            <span>Nome da empresa</span>
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              maxLength={80}
              placeholder="Ex.: Hilton, Marriott…"
              className={`${s.field} px-3 focus-ring`}
            />
          </label>
          <label className={`${s.fieldLabel} min-w-[220px]`}>
            <span>País</span>
            <div className="relative">
              <select value={pais} onChange={(e) => setPais(e.target.value)} className={`${s.field} appearance-none pl-3 pr-9 cursor-pointer focus-ring`}>
                <option value="">Qualquer país</option>
                {PAISES_INTERNACIONAL.map((p) => <option key={p.codigo} value={p.codigo}>{p.nome}</option>)}
              </select>
              <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
            </div>
          </label>
          <button type="submit" disabled={!podeBuscar || carregando} className={`${s.primaryButton} disabled:opacity-50 focus-ring`}>
            {carregando && itens.length === 0 ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />} Buscar
          </button>
        </form>
        <p className="mt-2 text-xs text-slate-500">
          Informe o nome (2+ letras), o país ou os dois.
        </p>
      </section>

      {erro && <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{erro}</p>}

      {buscaFeita && (
        <section className={`${s.panel} overflow-hidden`}>
          <div className={`${s.panelHeader} ${s.panelHeaderBar}`}>
            <div className={s.sectionHeading}>
              <span className={s.sectionIcon}><Building2 size={17} aria-hidden="true" /></span>
              <div>
                <h2>Resultados</h2>
                <p>
                  {total !== null ? `${total.toLocaleString('pt-BR')} empresa${total === 1 ? '' : 's'} encontrada${total === 1 ? '' : 's'}` : `${itens.length} carregada${itens.length === 1 ? '' : 's'}`}
                  {' · só consulta: importar para a base ainda não está disponível para empresas internacionais.'}
                </p>
              </div>
            </div>
          </div>
          <table className={s.table}>
            <thead>
              <tr>
                <th className="w-[30%]">Empresa</th>
                <th className="w-[22%]">Localização</th>
                <th className="w-[14%]">Funcionários</th>
                <th className="w-[10%]">Fundação</th>
                <th className="w-[24%]">Links</th>
              </tr>
            </thead>
            <tbody>
              {itens.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <div className="mx-auto max-w-md py-16 text-center">
                      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5 text-slate-400"><SearchX size={22} /></span>
                      <p className="mt-4 text-base font-semibold text-slate-100">Empresa não encontrada</p>
                      <p className="mt-1.5 text-sm text-slate-400">
                        {buscaFeita.nome ? <>Não achamos “{buscaFeita.nome}”</> : <>Não achamos empresas</>}
                        {buscaFeita.pais ? <> em {nomePais(buscaFeita.pais)}</> : null} na base da Crustdata.
                      </p>
                      <ul className="mx-auto mt-4 max-w-sm space-y-1 text-left text-xs text-slate-500">
                        <li>• Confira a grafia ou tente só a parte principal do nome.</li>
                        {buscaFeita.pais && <li>• A sede pode estar cadastrada em outro país.</li>}
                        <li>• Empresas muito pequenas ou sem página no LinkedIn costumam não estar na base.</li>
                      </ul>
                      {buscaFeita.pais && buscaFeita.nome && (
                        <button type="button" disabled={carregando}
                          onClick={() => { setPais(''); buscar({ nome: buscaFeita.nome, pais: '' }, null); }}
                          className={`${s.outlineButton} mt-5 disabled:opacity-50 focus-ring`}>
                          <Globe2 size={15} /> Buscar em qualquer país
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : itens.map((e) => (
                <tr key={e.id}>
                  <td className="px-5 py-2.5">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-500/15 text-xs font-semibold text-sky-300">{iniciais(e.nome)}</div>
                      <div className="min-w-0">
                        <div className="truncate font-medium text-slate-100" title={e.nome}>{e.nome}</div>
                        <div className="mt-0.5 truncate text-xs text-slate-500">{e.dominio ?? e.tipo ?? '—'}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="truncate text-slate-200" title={e.sede ?? undefined}>{e.cidade ?? '—'}</div>
                    <div className="mt-0.5 text-xs text-slate-500">{e.pais ?? ''}</div>
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap text-slate-300">{e.funcionarios ?? '—'}</td>
                  <td className="px-4 py-2.5 tabular-nums text-slate-300">{e.fundacao ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-3 text-xs">
                      {e.site && <a href={e.site} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sky-300 hover:underline"><ExternalLink size={12} /> Site</a>}
                      {e.linkedin && <a href={e.linkedin} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sky-300 hover:underline"><ExternalLink size={12} /> LinkedIn</a>}
                      {!e.site && !e.linkedin && <span className="text-slate-500">—</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {cursor && (
            <div className={s.loadMore}>
              <button type="button" onClick={() => buscar(buscaFeita, cursor)} disabled={carregando} className={`${s.outlineButton} focus-ring`}>
                {carregando ? 'Carregando…' : 'Carregar mais empresas'}
              </button>
            </div>
          )}
        </section>
      )}
    </>
  );
}
