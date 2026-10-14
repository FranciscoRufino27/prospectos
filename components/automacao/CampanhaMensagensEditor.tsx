'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, ChevronRight, Info, Loader2, Mail, Save } from 'lucide-react';
import HtmlEmailEditor from './HtmlEmailEditor';
import type { Campanha, MensagemCampanha } from './tiposCampanha';
import { montarEmailCampanhaHtml } from '@/lib/campanhas/emailCampanha';
import {
  VARIAVEIS_AVISO_RESPOSTA,
  VARIAVEIS_MENSAGEM_CAMPANHA,
  motivoBloqueioEdicaoMensagens,
  variaveisDesconhecidas,
  type MensagemEditada,
} from '@/lib/campanhas/edicaoMensagens';

// Edição do conteúdo de uma campanha já publicada. A quantidade de mensagens e
// os dias de envio continuam os publicados; o conteúdo é lido na hora de cada
// envio, então o que for salvo aqui vale para os próximos e-mails.

const input = 'w-full rounded-lg border border-[var(--border)] bg-[var(--bg-base)] px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none';
const label = 'mb-1.5 block text-xs font-medium text-slate-400';
const card = 'rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5';

interface MensagemRascunho extends MensagemEditada { diasApos?: number }
interface AvisoRascunho { emailAssunto: string; emailCorpo: string; emailHtml?: string }
interface Rascunho {
  inicial: MensagemRascunho;
  followups: MensagemRascunho[];
  aviso: AvisoRascunho;
  notificarResponsavel: boolean;
}

function paraRascunho(m: (MensagemCampanha & { diasApos?: number }) | undefined): MensagemRascunho {
  return { assunto: m?.assunto ?? '', corpo: m?.corpo ?? '', html: m?.html, link: m?.link, diasApos: m?.diasApos };
}

const semRascunho = ({ assunto, corpo, html, link }: MensagemRascunho): MensagemEditada => ({ assunto, corpo, html, link });

function listarVariaveis(variaveis: readonly string[]) {
  return variaveis.map((v) => `{${v}}`).join(', ');
}

export default function CampanhaMensagensEditor({ id }: { id: string }) {
  const [campanha, setCampanha] = useState<Campanha | null>(null);
  const [responsavel, setResponsavel] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [estado, setEstado] = useState<'carregando' | 'ok' | 'erro'>('carregando');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvoEm, setSalvoEm] = useState<Date | null>(null);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const r = await fetch(`/api/campanhas/${id}`);
        if (!r.ok) { if (!cancelado) setEstado('erro'); return; }
        const d = await r.json();
        if (cancelado) return;
        const c: Campanha = d.campanha;
        const op = c.publico?.operacao;
        setCampanha(c);
        setResponsavel(d.resumoOperacional?.responsavel ?? null);
        setRascunho({
          inicial: paraRascunho(op?.mensagemInicial),
          followups: (op?.followups ?? []).map((f) => paraRascunho(f)),
          aviso: {
            emailAssunto: op?.resposta?.emailAssunto ?? '',
            emailCorpo: op?.resposta?.emailCorpo ?? '',
            emailHtml: op?.resposta?.emailHtml,
          },
          notificarResponsavel: op?.resposta?.notificarResponsavel !== false,
        });
        setEstado('ok');
      } catch {
        if (!cancelado) setEstado('erro');
      }
    })();
    return () => { cancelado = true; };
  }, [id]);

  function atualizar(indice: number | null, patch: Partial<MensagemEditada>) {
    setSalvoEm(null);
    setRascunho((atual) => {
      if (!atual) return atual;
      if (indice == null) return { ...atual, inicial: { ...atual.inicial, ...patch } };
      const followups = [...atual.followups];
      followups[indice] = { ...followups[indice], ...patch };
      return { ...atual, followups };
    });
  }

  function atualizarAviso(patch: Partial<AvisoRascunho>) {
    setSalvoEm(null);
    setRascunho((atual) => atual ? { ...atual, aviso: { ...atual.aviso, ...patch } } : atual);
  }

  async function salvar() {
    if (!rascunho) return;
    setSalvando(true);
    setErro(null);
    try {
      const res = await fetch(`/api/campanhas/${id}/mensagens`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mensagemInicial: semRascunho(rascunho.inicial),
          followups: rascunho.followups.map(semRascunho),
          ...(rascunho.notificarResponsavel ? { resposta: rascunho.aviso } : {}),
        }),
      });
      const dados = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(dados.erro || 'Não foi possível salvar as mensagens.');
      setSalvoEm(new Date());
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar as mensagens.');
    } finally {
      setSalvando(false);
    }
  }

  if (estado === 'carregando') {
    return <div className="flex items-center justify-center gap-2 py-24 text-slate-500"><Loader2 size={18} className="animate-spin" /> Carregando mensagens…</div>;
  }
  if (estado === 'erro' || !campanha || !rascunho) {
    return (
      <div className="p-6">
        <Link href="/campanhas?tab=campanhas" className="text-sm text-indigo-300 hover:text-indigo-200">← Campanhas</Link>
        <div className="py-20 text-center text-sm text-slate-400">Campanha não encontrada.</div>
      </div>
    );
  }

  const bloqueio = motivoBloqueioEdicaoMensagens(campanha.status);
  if (bloqueio) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <Link href={`/campanhas/${campanha.id}`} className="text-sm text-indigo-300 hover:text-indigo-200">← Voltar para a campanha</Link>
        <div className="mt-5 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-6">
          <h1 className="text-lg font-bold text-slate-100">Mensagens não editáveis</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">{bloqueio}</p>
          {campanha.status === 'rascunho' && (
            <Link href={`/campanhas/${campanha.id}/editar`} className="mt-5 inline-flex rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500">
              Abrir assistente
            </Link>
          )}
        </div>
      </div>
    );
  }

  const mensagens = [
    { indice: null, titulo: 'Mensagem inicial', quando: 'Sai quando o contato entra na campanha.', m: rascunho.inicial },
    ...rascunho.followups.map((m, i) => ({
      indice: i as number | null,
      titulo: `Follow-up ${i + 1}`,
      quando: m.diasApos
        ? `Sai no dia ${m.diasApos} da cadência, se o contato não tiver respondido.`
        : 'Sai no intervalo definido na publicação.',
      m,
    })),
  ];
  const avisoDesconhecidas = variaveisDesconhecidas(
    [rascunho.aviso.emailAssunto, rascunho.aviso.emailCorpo, rascunho.aviso.emailHtml].join('\n'),
    VARIAVEIS_AVISO_RESPOSTA,
  );

  return (
    <div className="mx-auto max-w-[100rem] space-y-5 p-6">
      <div>
        <div className="mb-1 flex items-center gap-1 text-xs text-slate-500">
          <Link href="/campanhas?tab=campanhas" className="hover:text-slate-300">Campanhas</Link>
          <ChevronRight size={12} />
          <Link href={`/campanhas/${campanha.id}`} className="truncate hover:text-slate-300">{campanha.nome}</Link>
          <ChevronRight size={12} /> <span className="text-slate-400">Editar mensagens</span>
        </div>
        <h1 className="text-2xl font-bold text-slate-100">Editar mensagens</h1>
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-indigo-500/25 bg-indigo-500/10 px-4 py-3 text-sm text-indigo-200">
        <Info size={16} className="mt-0.5 shrink-0" />
        <div className="space-y-1">
          <p><b>Vale para os próximos envios</b>, inclusive para quem já está na cadência. E-mails que já saíram não mudam.</p>
          <p className="text-xs text-indigo-300/80">
            A quantidade de mensagens e os dias de envio continuam os da publicação. Variáveis: {listarVariaveis(VARIAVEIS_MENSAGEM_CAMPANHA)} — com uma ou duas chaves.
          </p>
        </div>
      </div>

      {mensagens.map(({ indice, titulo, quando, m }) => (
        <section key={titulo} className={card}>
          <div className="mb-4">
            <h2 className="font-semibold text-slate-100">{titulo}</h2>
            <p className="text-xs text-slate-500">{quando}</p>
          </div>
          <div className="space-y-4">
            <div>
              <label className={label}>Assunto</label>
              <input className={input} value={m.assunto} onChange={(e) => atualizar(indice, { assunto: e.target.value })} />
            </div>
            <div>
              <label className={label}>Texto simples</label>
              <textarea className={`${input} min-h-40 resize-y font-mono text-[13px] leading-6`} value={m.corpo} onChange={(e) => atualizar(indice, { corpo: e.target.value })} />
              <p className="mt-1.5 text-xs text-slate-600">Versão para quem não abre HTML. Sem HTML, é o próprio e-mail.</p>
            </div>
            <div>
              <label className={label}>Link complementar (opcional)</label>
              <input type="url" className={input} value={m.link ?? ''} onChange={(e) => atualizar(indice, { link: e.target.value || undefined })} placeholder="https://..." />
            </div>
            <HtmlEmailEditor
              html={m.html}
              previewHtml={montarEmailCampanhaHtml(m.corpo.trim() || 'Não configurado', { responsavelNome: responsavel }, m.html)}
              titulo="HTML do e-mail"
              descricao="É o que o cliente vê. Edite o código, cole outro ou carregue um arquivo."
              onChange={(html, textoAlternativo) => atualizar(indice, {
                html,
                ...(!m.corpo.trim() && textoAlternativo ? { corpo: textoAlternativo } : {}),
              })}
              onErro={setErro}
            />
            <AvisoVariaveis desconhecidas={variaveisDesconhecidas([m.assunto, m.corpo, m.html].join('\n'), VARIAVEIS_MENSAGEM_CAMPANHA)} />
          </div>
        </section>
      ))}

      {rascunho.notificarResponsavel && (
        <section className={card}>
          <div className="mb-4 flex items-start gap-2">
            <Mail size={16} className="mt-0.5 shrink-0 text-indigo-400" />
            <div>
              <h2 className="font-semibold text-slate-100">Aviso ao responsável</h2>
              <p className="text-xs text-slate-500">
                Enviado {responsavel ? `a ${responsavel}` : 'ao responsável'} quando um contato responde. Variáveis: {listarVariaveis(VARIAVEIS_AVISO_RESPOSTA)}.
              </p>
            </div>
          </div>
          <div className="space-y-4">
            <div>
              <label className={label}>Assunto</label>
              <input className={input} value={rascunho.aviso.emailAssunto} onChange={(e) => atualizarAviso({ emailAssunto: e.target.value })} />
            </div>
            <div>
              <label className={label}>Texto simples</label>
              <textarea className={`${input} min-h-32 resize-y font-mono text-[13px] leading-6`} value={rascunho.aviso.emailCorpo} onChange={(e) => atualizarAviso({ emailCorpo: e.target.value })} />
            </div>
            <HtmlEmailEditor
              html={rascunho.aviso.emailHtml}
              previewHtml={montarEmailCampanhaHtml(rascunho.aviso.emailCorpo, {}, rascunho.aviso.emailHtml)}
              titulo="HTML do aviso"
              descricao="Usado no e-mail que avisa o responsável sobre a resposta do contato."
              onChange={(emailHtml, textoAlternativo) => atualizarAviso({
                emailHtml,
                ...(!rascunho.aviso.emailCorpo.trim() && textoAlternativo ? { emailCorpo: textoAlternativo } : {}),
              })}
              onErro={setErro}
            />
            <AvisoVariaveis desconhecidas={avisoDesconhecidas} />
          </div>
        </section>
      )}

      {erro && (
        <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {erro}
        </div>
      )}

      <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-subtle)]/95 px-4 py-3 backdrop-blur">
        <Link href={`/campanhas/${campanha.id}`} className="text-sm text-slate-400 hover:text-slate-200">← Voltar para a campanha</Link>
        <div className="flex items-center gap-3">
          {salvoEm && (
            <span className="inline-flex items-center gap-1.5 text-xs text-emerald-300">
              <CheckCircle2 size={14} /> Salvo às {salvoEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <button type="button" onClick={salvar} disabled={salvando}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40">
            {salvando ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Salvar mensagens
          </button>
        </div>
      </div>
    </div>
  );
}

function AvisoVariaveis({ desconhecidas }: { desconhecidas: string[] }) {
  if (!desconhecidas.length) return null;
  const uma = desconhecidas.length === 1;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs leading-relaxed text-amber-200">
      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
      <span>
        O envio não conhece {listarVariaveis(desconhecidas)} — {uma ? 'ela aparece' : 'elas aparecem'} no e-mail exatamente como {uma ? 'está escrita' : 'estão escritas'}.
      </span>
    </div>
  );
}
