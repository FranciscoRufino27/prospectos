'use client';

import { useEffect, useRef, useState } from 'react';
import { Building2, ExternalLink, Globe2, Loader2, Mail, MapPin, Radar, SearchX, SlidersHorizontal, Square, Target, UserSearch } from 'lucide-react';
import {
  PAISES_INTERNACIONAL, type CodigoPais, type EmpresaInternacional, type RespostaInternacional,
} from '@/lib/prospeccao/crustdata';
import { setoresDosNichos, type NichoInternacional } from '@/lib/prospeccao/nichosInternacional';
import { buscarComDecisor, entraNaLista, ROTULO_PULO, type MotivoPulo, type ResumoBuscaComDecisor } from '@/lib/prospeccao/buscaComDecisor';
import { META_MAXIMA_DECISOR, TETO_TENTATIVAS_DECISOR, type ResultadoDecisorInternacional } from '@/lib/prospeccao/decisorAutomatico';
import type { Decisor } from '@/lib/prospeccao/decisores';
import { iniciais } from '@/lib/prospeccao/rotulos';
import { LIMITE_BUSCA_ESPECIFICA } from '@/lib/prospeccao/filtros';
import DecisorCelula from './DecisorCelula';
import { iconeDoNicho } from './iconesNicho';
import { CabecalhoBloco, Indicador } from './Indicador';
import s from './Prospeccao.module.css';

// Busca internacional (Crustdata): pelos nichos do perfil (os mesmos da aba
// Brasil, traduzidos para setores do LinkedIn), pelos países do perfil e/ou
// pelo nome. Como no Brasil, cada empresa já vem com o decisor (pessoa de
// cargo-alvo no domínio, Crustdata) e o e-mail dele (Anymail), até a meta.
// Gasta crédito, então só roda no clique. Resultado só para consulta: ainda
// não importa para a base (empresa sem CNPJ não entra na importação).

/** Empresas por página da Crustdata na busca com decisor (cada uma custa 0,03). */
const PAGINA_COM_DECISOR = 10;
/** Resoluções simultâneas: a Anymail pode levar até 50s por pessoa. */
const CONCORRENCIA = 2;

// Completa: decisor + e-mail. Incompleta: o motivo e, se a Crustdata achou
// alguém, essa pessoa (só faltou o e-mail).
type Resolucao = { decisor: Decisor; email: string } | { motivo: MotivoPulo; decisor?: Decisor };

/**
 * Busca pedida de fora; `id` novo = nova busca. Atalho "Procurar fora do
 * catálogo" manda nome + país; o perfil de busca manda `doPerfil` (nichos e
 * países salvos no perfil).
 */
export interface PedidoBusca {
  nome: string; pais: string; id: number; doPerfil?: boolean
  /** Sede da empresa específica: estado/região e cidade (opcionais aqui). */
  estado?: string; cidade?: string
  /** Site da empresa específica (identifica sem ambiguidade). */
  site?: string | null
  /** 'receita': a empresa não estava no catálogo da Receita e a busca veio para cá. */
  origem?: 'receita'
}

const nomePais = (codigo: string) => PAISES_INTERNACIONAL.find((p) => p.codigo === codigo)?.nome ?? codigo;

interface Criterio { nome: string; paises: CodigoPais[]; setores: string[]; rotuloNicho: string | null; estado?: string; cidade?: string; site?: string | null }

export default function BuscaInternacional({ pedido, nichos = [], paisesPerfil = [], meta = META_MAXIMA_DECISOR, decisorObrigatorio = true, onAbrirPerfil, embutido = false }: {
  pedido?: PedidoBusca | null;
  /** Dentro da aba Brasil (empresa fora da Receita): só o aviso e a tabela. */
  embutido?: boolean;
  /** Abre o Perfil de busca (onde a busca é decidida e disparada). */
  onAbrirPerfil?: () => void;
  /** Nichos do perfil com setor equivalente lá fora. */
  nichos?: NichoInternacional[];
  /** Países-alvo salvos no perfil de busca. */
  paisesPerfil?: CodigoPais[];
  /** Quantas empresas a busca entrega (a mesma meta da aba Brasil). */
  meta?: number;
  /** Critério do perfil: ligado = só empresas com decisor e e-mail dele. */
  decisorObrigatorio?: boolean;
}) {
  const [itens, setItens] = useState<EmpresaInternacional[]>([]);
  // Decisor e e-mail (ou o motivo de não ter) de cada empresa da lista.
  const [resolucoes, setResolucoes] = useState<Record<number, Resolucao>>({});
  const [pulados, setPulados] = useState<{ empresa: EmpresaInternacional; motivo: MotivoPulo; erro?: string }[]>([]);
  const [progresso, setProgresso] = useState<{ completos: number; tentativas: number } | null>(null);
  const [resumo, setResumo] = useState<ResumoBuscaComDecisor | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Busca que gerou a lista (texto do estado vazio e "buscar em qualquer país").
  const [buscaFeita, setBuscaFeita] = useState<Criterio | null>(null);
  const buscaAtual = useRef(0);

  // Percorre a Crustdata e resolve o decisor empresa a empresa até a meta
  // (mesmo orquestrador da aba Brasil: teto de análises, para em falha fatal).
  // Pelo nome (empresa específica): ignora nicho/país do perfil, poucos
  // resultados e mostra mesmo sem decisor.
  async function buscar(criterio: Criterio) {
    const id = ++buscaAtual.current;
    const ativo = () => id === buscaAtual.current;
    const especifica = criterio.nome !== '' || !!criterio.site;
    const aceitaIncompletas = especifica || !decisorObrigatorio;
    const metaBusca = especifica ? LIMITE_BUSCA_ESPECIFICA : meta;
    // Pessoa achada pela Crustdata quando só faltou o e-mail, até o desfecho chegar.
    const semEmail = new Map<number, Decisor>();
    let cursorAtual: string | null = null;
    let primeira = true;
    setCarregando(true);
    setErro(null);
    setItens([]);
    setResolucoes({});
    setPulados([]);
    setResumo(null);
    setTotal(null);
    setBuscaFeita(criterio);
    setProgresso({ completos: 0, tentativas: 0 });
    try {
      const r = await buscarComDecisor<EmpresaInternacional, { decisor: Decisor; email: string }>({
        meta: metaBusca,
        teto: especifica ? LIMITE_BUSCA_ESPECIFICA : TETO_TENTATIVAS_DECISOR,
        concorrencia: CONCORRENCIA,
        aceitaIncompletas,
        cancelado: () => !ativo(),
        proximaPagina: async () => {
          const res = await fetch('/api/prospeccao/internacional', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nome: criterio.nome, paises: criterio.paises, setores: criterio.setores, estado: criterio.estado, cidade: criterio.cidade, site: criterio.site, cursor: cursorAtual, limite: PAGINA_COM_DECISOR, especifica }),
          });
          const corpo = (await res.json().catch(() => ({}))) as Partial<RespostaInternacional> & { erro?: string };
          if (!res.ok) throw new Error(corpo.erro || 'Falha na busca');
          if (primeira && ativo()) setTotal(corpo.total ?? null);
          primeira = false;
          cursorAtual = corpo.proximoCursor ?? null;
          return { itens: corpo.itens ?? [], fim: !cursorAtual };
        },
        resolver: async (empresa) => {
          const res = await fetch('/api/prospeccao/decisor-internacional', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dominio: empresa.dominio, nome: empresa.nome }),
          });
          const corpo = (await res.json().catch(() => ({}))) as ResultadoDecisorInternacional & { erro?: string };
          // Sem crédito, sem chave ou limite: parar já, senão as próximas falham igual.
          if (!res.ok) return { tipo: 'falha', erro: corpo.erro || 'Falha ao buscar o decisor.', fatal: [402, 429, 503].includes(res.status) };
          if (corpo.status === 'completo') return { tipo: 'completo', dados: { decisor: corpo.decisor, email: corpo.email } };
          if (corpo.status === 'incompleto') {
            const pessoa = corpo.candidatos?.[0];
            if (pessoa) semEmail.set(empresa.id, { nome: pessoa.nome, cargo: pessoa.cargo, ...(pessoa.linkedin ? { linkedin: pessoa.linkedin } : {}) });
            // Fonte paga bloqueada: só esta empresa fica de fora; a busca segue.
            return { tipo: 'pulado', motivo: corpo.motivo, erro: corpo.bloqueio?.mensagem };
          }
          return { tipo: 'pulado', motivo: 'erro' };
        },
        aoDesfecho: (empresa, d) => {
          if (!ativo()) return;
          if (!entraNaLista(d, aceitaIncompletas)) {
            if (d.tipo === 'pulado') setPulados((l) => [...l, { empresa, motivo: d.motivo, erro: d.erro }]);
            return;
          }
          setItens((l) => [...l, empresa]);
          setResolucoes((m) => ({ ...m, [empresa.id]: d.tipo === 'completo' ? d.dados : { motivo: d.motivo, decisor: semEmail.get(empresa.id) } }));
        },
        aoProgresso: (p) => { if (ativo()) setProgresso(p); },
      });
      if (!ativo()) return;
      setResumo(r);
      if (r.erro) setErro(r.erro);
    } catch (e) {
      if (ativo()) setErro(e instanceof Error ? e.message : 'Erro na busca');
    } finally {
      if (ativo()) { setCarregando(false); setProgresso(null); }
    }
  }

  // Interrompe a busca: o que já entrou na lista fica.
  function parar() {
    buscaAtual.current++;
    setCarregando(false);
    setResumo({ completos: itens.length, tentativas: progresso?.tentativas ?? 0, parada: 'cancelado', erro: null });
    setProgresso(null);
  }

  // O pedido já é o clique do usuário: busca direto com o que veio.
  useEffect(() => {
    if (!pedido) return;
    if (pedido.doPerfil) {
      // "Salvar e buscar internacional" do perfil: nichos e países do perfil.
      const criterio = { nome: '', paises: paisesPerfil, setores: setoresDosNichos(nichos), rotuloNicho: nichos.length ? 'nos nichos do perfil' : null };
      if (criterio.paises.length || criterio.setores.length) buscar(criterio);
      return;
    }
    buscar({ nome: pedido.nome, paises: pedido.pais ? [pedido.pais as CodigoPais] : [], setores: [], rotuloNicho: null, estado: pedido.estado, cidade: pedido.cidade, site: pedido.site });
  }, [pedido?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const rotuloPaises = (lista: CodigoPais[]) => (lista.length === 1 ? nomePais(lista[0]) : `${lista.length} países`);

  const buscou = !!buscaFeita;
  const metaAtual = buscaFeita?.nome ? LIMITE_BUSCA_ESPECIFICA : meta;
  const comDecisor = itens.filter((e) => { const r = resolucoes[e.id]; return !!r && 'email' in r; }).length;
  const analisadas = progresso?.tentativas ?? resumo?.tentativas ?? null;

  return (
    <>
      {!embutido && (<>
      {/* O que buscar é decidido só no Perfil de busca (nichos, países e
          critérios); aqui fica o resumo do que ele vai usar. */}
      <section className={`${s.panel} ${s.panelBody}`}>
        <div className={s.panelHeader}>
          <CabecalhoBloco icone={Globe2} titulo="Busca internacional" subtitulo="Empresas fora do Brasil pelos nichos e países do seu perfil, já com o decisor e o e-mail dele." />
          {onAbrirPerfil && (
            <button type="button" onClick={onAbrirPerfil} className={`${s.linkAction} focus-ring rounded`}>
              <SlidersHorizontal size={12} /> Ajustar no Perfil de busca
            </button>
          )}
        </div>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Criterio rotulo="Nichos">
            {nichos.length
              ? nichos.map((n) => {
                const Icone = iconeDoNicho(n.id);
                return <span key={n.id} className={s.activityTag} title={`Setores no LinkedIn: ${n.setores.join(', ')}`}><Icone size={12} aria-hidden="true" /> {n.nome}</span>;
              })
              : <span className="text-sm text-slate-400">Qualquer setor</span>}
          </Criterio>
          <Criterio rotulo="Países">
            {paisesPerfil.length
              ? paisesPerfil.map((p) => <span key={p} className={s.activityTag}><MapPin size={12} aria-hidden="true" /> {nomePais(p)}</span>)
              : <span className="text-sm text-slate-400">Qualquer país</span>}
          </Criterio>
          <Criterio rotulo="Decisor">
            <span className={s.activityTag}>
              <UserSearch size={12} aria-hidden="true" /> {decisorObrigatorio ? 'Obrigatório' : 'Opcional'}
            </span>
          </Criterio>
          <Criterio rotulo="Quantidade">
            <span className={s.activityTag}><Target size={12} aria-hidden="true" /> Até {meta} empresa{meta === 1 ? '' : 's'}</span>
          </Criterio>
        </dl>
      </section>
      </>)}

      <section className={s.kpiGrid}>
        <Indicador tom="cyan" icone={Target} rotulo="Meta" valor={buscou ? metaAtual.toLocaleString('pt-BR') : '—'}
          detalhe={!buscou ? 'aparece ao buscar' : buscaFeita?.nome ? 'resultados da busca pelo nome' : decisorObrigatorio ? 'empresas com decisor e e-mail dele' : 'empresas (decisor não obrigatório)'} />
        <Indicador tom="violet" icone={Building2} rotulo="Empresas na Crustdata" valor={total === null ? '—' : total.toLocaleString('pt-BR')}
          detalhe={total === null ? 'aparece ao buscar' : buscaFeita?.nome ? 'com esse nome e local' : 'com os nichos e países do perfil'} />
        <Indicador tom="emerald" icone={Mail} rotulo="Com decisor e e-mail" valor={buscou ? comDecisor.toLocaleString('pt-BR') : '—'}
          proporcao={buscou ? comDecisor / Math.max(1, metaAtual) : null}
          detalhe={buscou ? `${comDecisor} de ${metaAtual} da meta` : 'aparece ao buscar'} />
        <Indicador tom="amber" icone={Radar} rotulo="Analisadas" valor={analisadas === null ? '—' : analisadas.toLocaleString('pt-BR')}
          detalhe={!buscou ? 'aparece ao buscar' : `limite de ${buscaFeita?.nome ? LIMITE_BUSCA_ESPECIFICA : TETO_TENTATIVAS_DECISOR} por busca${pulados.length ? ` · ${pulados.length} fora da lista` : ''}`} />
      </section>

      {erro && <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{erro}</p>}

      <section className={`${s.panel} overflow-hidden`}>
        <div className={`${s.panelHeader} ${s.panelHeaderBar}`}>
          <CabecalhoBloco icone={Radar} titulo="Resultados" subtitulo={`${buscaFeita?.nome ? `Resultados para “${buscaFeita.nome}” em ${[buscaFeita.cidade, buscaFeita.estado, buscaFeita.paises.length ? rotuloPaises(buscaFeita.paises) : 'qualquer país'].filter(Boolean).join(', ')} (ignora o perfil). ` : ''}Só consulta: importar empresas internacionais para a base ainda não está disponível.`} />
          {carregando && (
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-2 text-xs text-slate-300" role="status">
                <Loader2 size={14} className="animate-spin" />
                {progresso?.completos ?? 0} de {meta} encontradas · {progresso?.tentativas ?? 0} analisada{progresso?.tentativas === 1 ? '' : 's'}
              </span>
              <button type="button" onClick={parar} className={`${s.outlineButton} focus-ring`}>
                <Square size={13} /> Parar
              </button>
            </div>
          )}
        </div>
        <table className={s.table}>
          <thead>
            <tr>
              <th className="w-[24%]">Empresa</th>
              <th className="w-[15%]">Localização</th>
              <th className="w-[10%]">Funcionários</th>
              <th className="w-[20%]">Decisor</th>
              <th className="w-[20%]">E-mail</th>
              <th className="w-[11%]">Links</th>
            </tr>
          </thead>
          <tbody>
            {carregando && itens.length === 0 ? (
              <LinhasEsqueleto />
            ) : !buscou ? (
              <tr>
                <td colSpan={6}>
                  <div className="mx-auto max-w-2xl py-14 text-center">
                    <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-500/15 text-sky-300 shadow-[0_0_24px_rgba(14,165,233,0.25)]"><Globe2 size={24} /></span>
                    <p className="mt-5 text-base font-semibold text-slate-100">Pronto para buscar fora do Brasil</p>
                    <p className="mx-auto mt-1.5 max-w-md text-sm text-slate-400">
                      No Perfil de busca, escolha os países e clique em “Salvar e buscar internacional”. Cada empresa chega assim:
                    </p>
                    <ol className="mt-6 grid gap-3 text-left sm:grid-cols-3">
                      {PASSOS.map((p, i) => (
                        <li key={p.titulo} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-4">
                          <div className="flex items-center gap-2 text-sm font-medium text-slate-100">
                            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/5 text-xs text-slate-300">{i + 1}</span>
                            <p.icone size={15} className="text-sky-300" aria-hidden="true" /> {p.titulo}
                          </div>
                          <p className="mt-2 text-xs leading-relaxed text-slate-400">{p.texto}</p>
                          <p className="mt-2 text-[11px] uppercase tracking-wide text-slate-500">{p.fonte}</p>
                        </li>
                      ))}
                    </ol>
                    {onAbrirPerfil && (
                      <button type="button" onClick={onAbrirPerfil} className={`${s.primaryButton} mx-auto mt-6 focus-ring`}>
                        <SlidersHorizontal size={15} /> Abrir Perfil de busca
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ) : itens.length === 0 && pulados.length > 0 ? (
              <tr>
                <td colSpan={6} className="py-16 text-center">
                  <UserSearch size={30} className="mx-auto text-slate-600" />
                  <p className="mt-4 text-sm font-medium text-slate-300">Nenhuma empresa com decisor e e-mail encontrado</p>
                  <p className="mt-1 text-sm text-slate-500">Veja abaixo por que as empresas analisadas ficaram de fora.</p>
                </td>
              </tr>
            ) : itens.length === 0 ? (
              <tr>
                <td colSpan={6}>
                  <div className="mx-auto max-w-md py-16 text-center">
                    <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5 text-slate-400"><SearchX size={22} /></span>
                    <p className="mt-4 text-base font-semibold text-slate-100">Nenhuma empresa encontrada</p>
                    <p className="mt-1.5 text-sm text-slate-400">
                      {buscaFeita!.nome ? <>Não achamos “{buscaFeita!.nome}”</> : <>Não achamos empresas</>}
                      {buscaFeita!.rotuloNicho ? <> {buscaFeita!.rotuloNicho}</> : null}
                      {buscaFeita!.paises.length ? <> em {rotuloPaises(buscaFeita!.paises)}</> : null} na base da Crustdata.
                    </p>
                    <ul className="mx-auto mt-4 max-w-sm space-y-1 text-left text-xs text-slate-500">
                      {buscaFeita!.nome && <li>• Confira a grafia ou tente só a parte principal do nome.</li>}
                      {buscaFeita!.paises.length > 0 && <li>• A sede pode estar cadastrada em outro país.</li>}
                      {buscaFeita!.setores.length > 0 && <li>• A empresa pode estar em outro setor no LinkedIn.</li>}
                      <li>• Empresas muito pequenas ou sem página no LinkedIn costumam não estar na base.</li>
                    </ul>
                    {buscaFeita!.paises.length > 0 && buscaFeita!.nome && (
                      <button type="button" onClick={() => buscar({ ...buscaFeita!, paises: [] })} className={`${s.outlineButton} mt-5 focus-ring`}>
                        <Globe2 size={15} /> Buscar em qualquer país
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ) : itens.map((e) => {
              const r = resolucoes[e.id];
              const achado = r && 'email' in r ? r : null;
              const motivo = r && 'motivo' in r ? r.motivo : null;
              const decisor = r?.decisor ?? null;
              return (
                <tr key={e.id}>
                  <td className="px-5 py-2.5">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold ${CORES_AVATAR[e.id % CORES_AVATAR.length]}`}>{iniciais(e.nome)}</div>
                      <div className="min-w-0">
                        <div className="truncate font-medium text-slate-100" title={e.nome}>{e.nome}</div>
                        <div className="mt-0.5 truncate font-mono text-xs text-slate-500">{e.dominio ?? e.tipo ?? '—'}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="truncate text-slate-200" title={e.sede ?? undefined}>{e.cidade ?? '—'}</div>
                    <div className="mt-0.5 text-xs text-slate-500">{e.pais ?? ''}</div>
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap text-slate-300">
                    {e.funcionarios ?? '—'}
                    {e.fundacao && <div className="mt-0.5 text-xs text-slate-500">desde {e.fundacao}</div>}
                  </td>
                  <td className="px-4 py-2.5">
                    {decisor ? <DecisorCelula decisor={decisor} avaliacao={null} /> : <span className="text-xs text-slate-500">Sem decisor</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    {achado ? (
                      <>
                        <div className="flex min-w-0 items-center gap-2">
                          <Mail size={13} className="shrink-0 text-slate-500" />
                          <span className="min-w-0 truncate text-slate-200" title={achado.email}>{achado.email}</span>
                        </div>
                        <div className="mt-1 flex items-center gap-1.5 pl-5 text-xs text-emerald-400">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> do decisor · verificado
                        </div>
                      </>
                    ) : (
                      <span className="text-sm text-slate-500">
                        Sem e-mail do decisor
                        {motivo && <span className="mt-0.5 block text-xs text-slate-600">{ROTULO_PULO[motivo]}</span>}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-3 text-xs">
                      {e.site && <a href={e.site} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sky-300 hover:underline"><ExternalLink size={12} /> Site</a>}
                      {e.linkedin && <a href={e.linkedin} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sky-300 hover:underline"><ExternalLink size={12} /> LinkedIn</a>}
                      {!e.site && !e.linkedin && <span className="text-slate-500">—</span>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {resumo && !carregando && (
          <div className="border-t border-[var(--border-subtle)] px-5 py-4 text-sm text-slate-400">
            <p>
              <span className="font-semibold text-slate-200">{itens.length} de {buscaFeita?.nome ? LIMITE_BUSCA_ESPECIFICA : meta}</span>
              {decisorObrigatorio && !buscaFeita?.nome ? ' com decisor e e-mail' : ` empresas · ${comDecisor} com decisor e e-mail`}
              {' · '}{resumo.tentativas} analisada{resumo.tentativas === 1 ? '' : 's'}
              {resumo.parada === 'teto' && ` · parou no limite de ${TETO_TENTATIVAS_DECISOR} análises por busca`}
              {resumo.parada === 'fim' && itens.length < meta && ' · não há mais empresas para estes filtros'}
              {resumo.parada === 'cancelado' && ' · busca interrompida'}
            </p>
            {pulados.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-slate-300">{pulados.length} empresa{pulados.length === 1 ? '' : 's'} fora da lista</summary>
                <ul className="mt-2 space-y-1 text-xs">
                  {pulados.map((p) => (
                    <li key={p.empresa.id}>
                      <span className="text-slate-300">{p.empresa.nome}</span>
                      <span className="text-slate-500"> · {ROTULO_PULO[p.motivo]}{p.erro ? ` (${p.erro})` : ''}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </section>
    </>
  );
}

// Como cada empresa chega na lista (estado vazio da aba).
const PASSOS = [
  { icone: Building2, titulo: 'Empresas', texto: 'Empresas dos nichos do perfil nos países escolhidos.', fonte: 'Crustdata' },
  { icone: UserSearch, titulo: 'Decisor', texto: 'Quem trabalha lá hoje com o cargo-alvo do perfil (CEO, diretor…).', fonte: 'Crustdata' },
  { icone: Mail, titulo: 'E-mail', texto: 'O e-mail dessa pessoa, verificado no servidor da empresa.', fonte: 'Anymail' },
];

// Paleta discreta para o avatar, estável por empresa (a mesma da aba Brasil).
const CORES_AVATAR = [
  'bg-indigo-500/15 text-indigo-300',
  'bg-sky-500/15 text-sky-300',
  'bg-emerald-500/15 text-emerald-300',
  'bg-amber-500/15 text-amber-300',
  'bg-rose-500/15 text-rose-300',
  'bg-violet-500/15 text-violet-300',
];

function Criterio({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-500">{rotulo}</dt>
      <dd className="mt-1.5 flex flex-wrap gap-1.5">{children}</dd>
    </div>
  );
}

function LinhasEsqueleto() {
  return (
    <>
      {Array.from({ length: 5 }, (_, i) => (
        <tr key={i} className="skeleton-pulse">
          <td className="px-5 py-3.5">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-lg bg-slate-700/60" />
              <div className="space-y-2"><div className="h-3 w-40 rounded bg-slate-700/60" /><div className="h-2.5 w-24 rounded bg-slate-700/40" /></div>
            </div>
          </td>
          <td className="px-4 py-3.5"><div className="h-3 w-24 rounded bg-slate-700/50" /></td>
          <td className="px-4 py-3.5"><div className="h-3 w-14 rounded bg-slate-700/50" /></td>
          <td className="px-4 py-3.5"><div className="h-3 w-32 rounded bg-slate-700/50" /></td>
          <td className="px-4 py-3.5"><div className="h-3 w-36 rounded bg-slate-700/50" /></td>
          <td className="px-4 py-3.5"><div className="h-3 w-16 rounded bg-slate-700/50" /></td>
        </tr>
      ))}
    </>
  );
}
