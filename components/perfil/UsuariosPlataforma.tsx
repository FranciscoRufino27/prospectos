'use client';

// Aba "Usuários da plataforma" do Meu perfil. O admin vê quem tem acesso à
// própria organização; o dono da plataforma (migration 0069) também alterna
// para "Plataforma inteira", com os usuários de todas as organizações. Ambos
// mandam link de redefinição de senha e bloqueiam/desbloqueiam o login. A
// senha nunca é exibida: o Supabase só guarda o hash. Toda regra vale no
// servidor (/api/equipe/** e /api/plataforma/**); aqui só se evita oferecer o
// que o backend recusaria (o próprio bloqueio, usuário sem organização).
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Ban, Building2, Check, Copy, Globe, KeyRound, LockOpen, Search, Shield, ShieldCheck, Users, UserX } from 'lucide-react';
import { estilosModulo as m, IndicadorModulo, TituloSecao } from '@/components/tema/Modulo';
import { EsqueletoLinhas } from '@/components/ui/Esqueleto';

interface Membro {
  id: string;
  email: string;
  nome: string | null;
  role: 'admin' | 'usuario';
  confirmed_at: string | null;
  last_sign_in_at: string | null;
  created_at: string;
  avatar_url: string | null;
  bloqueado: boolean;
  // Só na visão "Plataforma inteira".
  organizacao_id?: string | null;
  organizacao_nome?: string | null;
}

type Escopo = 'organizacao' | 'plataforma';

type Acao = 'redefinir_senha' | 'bloquear' | 'desbloquear';

type Retorno = { tipo: 'sucesso' | 'aviso' | 'erro'; msg: string; link?: string | null };

function avatarUrl(nome: string | null, email: string) {
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(nome || email)}&background=6366f1&color=fff&size=64&bold=true`;
}

function formatarData(data: string | null) {
  if (!data) return 'Nunca acessou';
  return new Date(data).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function mensagemRedefinicao(
  r: { emailEnviado?: boolean; simulado?: boolean; remetente?: string | null },
  email: string,
): { tipo: 'sucesso' | 'aviso'; msg: string } {
  if (r.emailEnviado) return { tipo: 'sucesso', msg: `Link de redefinição enviado para ${email} (por ${r.remetente}).` };
  if (r.simulado) return { tipo: 'aviso', msg: 'Modo ensaio ativo: o e-mail não foi enviado. Copie o link abaixo e repasse ao usuário.' };
  return { tipo: 'aviso', msg: 'O link foi gerado, mas o e-mail não saiu (conta de envio do workspace indisponível). Copie e repasse ao usuário.' };
}

function StatusAcesso({ membro }: { membro: Membro }) {
  if (membro.bloqueado) {
    return <span className="flex items-center gap-1.5 text-xs text-red-400"><span className="h-2 w-2 rounded-full bg-red-500" />Bloqueado</span>;
  }
  if (!membro.confirmed_at) {
    return <span className="flex items-center gap-1.5 text-xs text-yellow-400"><span className="h-2 w-2 rounded-full bg-yellow-400" />Convite pendente</span>;
  }
  return <span className="flex items-center gap-1.5 text-xs text-green-400"><span className="h-2 w-2 rounded-full bg-green-500" />Ativo</span>;
}

export default function UsuariosPlataforma({ emailProprio, donoPlataforma, ehAdminOrg }: {
  emailProprio: string;
  donoPlataforma: boolean;
  ehAdminOrg: boolean;
}) {
  const [escopo, setEscopo] = useState<Escopo>(donoPlataforma ? 'plataforma' : 'organizacao');
  const plataforma = escopo === 'plataforma';
  const [membros, setMembros] = useState<Membro[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erroLista, setErroLista] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [filtroOrg, setFiltroOrg] = useState('');
  const [confirmando, setConfirmando] = useState<{ membro: Membro; acao: Acao } | null>(null);
  const [executando, setExecutando] = useState(false);
  const [retorno, setRetorno] = useState<(Retorno & { membroId: string }) | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);

  // `ignorar` evita que a resposta de um escopo antigo sobrescreva a do atual.
  async function carregar(alvo: Escopo, ignorar: () => boolean = () => false) {
    setErroLista(null);
    try {
      const res = await fetch(alvo === 'plataforma' ? '/api/plataforma/usuarios' : '/api/equipe/listar');
      const data = await res.json();
      if (ignorar()) return;
      if (!res.ok) throw new Error(data.erro || 'Não foi possível carregar os usuários.');
      setMembros((alvo === 'plataforma' ? data.usuarios : data.membros) ?? []);
    } catch (e) {
      if (ignorar()) return;
      setErroLista(e instanceof Error ? e.message : 'Não foi possível carregar os usuários.');
    } finally {
      if (!ignorar()) setCarregando(false);
    }
  }

  useEffect(() => {
    let cancelado = false;
    setCarregando(true);
    setMembros([]);
    setRetorno(null);
    setFiltroOrg('');
    carregar(escopo, () => cancelado);
    return () => { cancelado = true; };
  }, [escopo]);

  const organizacoes = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const x of membros) if (x.organizacao_id) mapa.set(x.organizacao_id, x.organizacao_nome || 'Sem nome');
    return [...mapa.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
  }, [membros]);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    let lista = q
      ? membros.filter((x) =>
          (x.nome ?? '').toLowerCase().includes(q)
          || x.email.toLowerCase().includes(q)
          || (x.organizacao_nome ?? '').toLowerCase().includes(q))
      : membros;
    if (plataforma && filtroOrg) {
      lista = lista.filter((x) => (filtroOrg === 'sem' ? !x.organizacao_id : x.organizacao_id === filtroOrg));
    }
    // Na visão da plataforma, agrupa por organização (sem organização por último).
    const porNome = (a: Membro, b: Membro) => (a.nome || a.email).localeCompare(b.nome || b.email, 'pt-BR');
    const porOrg = (a: Membro, b: Membro) => {
      if (!a.organizacao_nome !== !b.organizacao_nome) return a.organizacao_nome ? -1 : 1;
      return (a.organizacao_nome ?? '').localeCompare(b.organizacao_nome ?? '', 'pt-BR');
    };
    return [...lista].sort((a, b) => (plataforma ? porOrg(a, b) : 0) || porNome(a, b));
  }, [membros, busca, filtroOrg, plataforma]);

  // Totais seguem o filtro de organização (sem a busca de texto).
  const totais = useMemo(() => {
    const base = plataforma && filtroOrg
      ? membros.filter((x) => (filtroOrg === 'sem' ? !x.organizacao_id : x.organizacao_id === filtroOrg))
      : membros;
    return {
      total: base.length,
      admins: base.filter((x) => x.role === 'admin').length,
      pendentes: base.filter((x) => !x.confirmed_at && !x.bloqueado).length,
      bloqueados: base.filter((x) => x.bloqueado).length,
    };
  }, [membros, plataforma, filtroOrg]);

  async function copiar(texto: string, chave: string) {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(chave);
      setTimeout(() => setCopiado((c) => (c === chave ? null : c)), 1500);
    } catch { /* sem permissão de área de transferência: o texto segue visível */ }
  }

  async function executar() {
    if (!confirmando) return;
    const { membro, acao } = confirmando;
    setExecutando(true);
    try {
      const res = await fetch(plataforma ? `/api/plataforma/usuarios/${membro.id}/acesso` : `/api/equipe/${membro.id}/acesso`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRetorno({ membroId: membro.id, tipo: 'erro', msg: data.erro || 'Não foi possível concluir.' });
      } else if (acao === 'redefinir_senha') {
        setRetorno({ membroId: membro.id, ...mensagemRedefinicao(data, membro.email), link: data.emailEnviado ? null : data.link });
      } else {
        setMembros((lista) => lista.map((x) => (x.id === membro.id ? { ...x, bloqueado: acao === 'bloquear' } : x)));
        setRetorno({
          membroId: membro.id,
          tipo: 'sucesso',
          msg: acao === 'bloquear' ? `Acesso de ${membro.nome || membro.email} bloqueado.` : `Acesso de ${membro.nome || membro.email} liberado.`,
        });
      }
    } catch {
      setRetorno({ membroId: membro.id, tipo: 'erro', msg: 'Falha de conexão. Tente de novo.' });
    } finally {
      setExecutando(false);
      setConfirmando(null);
    }
  }

  const textoConfirmacao: Record<Acao, { titulo: string; corpo: string; botao: string; perigo: boolean }> = {
    redefinir_senha: {
      titulo: 'Redefinir senha',
      corpo: 'Enviamos ao usuário um link para criar uma senha nova. A senha atual continua valendo até ele usar o link.',
      botao: 'Enviar link',
      perigo: false,
    },
    bloquear: {
      titulo: 'Bloquear acesso',
      corpo: 'O usuário não consegue mais entrar. A conta, os leads e o histórico ficam intactos. Uma sessão já aberta pode durar até o token expirar (cerca de 1 hora).',
      botao: 'Bloquear',
      perigo: true,
    },
    desbloquear: {
      titulo: 'Desbloquear acesso',
      corpo: 'O usuário volta a conseguir entrar com a senha que já tinha.',
      botao: 'Desbloquear',
      perigo: false,
    },
  };

  const colunas = ['Usuário', ...(plataforma ? ['Organização'] : []), 'E-mail de acesso', 'Função', 'Status', 'Último acesso', 'Senha', 'Acesso'];

  return (
    <div className="grid gap-4">
      {donoPlataforma && ehAdminOrg && (
        <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Quais usuários mostrar">
          {([
            { id: 'plataforma', label: 'Plataforma inteira', Icon: Globe },
            { id: 'organizacao', label: 'Minha organização', Icon: Building2 },
          ] as const).map((o) => (
            <button
              key={o.id} type="button" role="radio" aria-checked={escopo === o.id}
              onClick={() => setEscopo(o.id)}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors focus-ring ${escopo === o.id
                ? 'border-indigo-500 bg-indigo-500/15 text-indigo-300'
                : 'border-[var(--border)] text-slate-400 hover:text-slate-200'}`}
            >
              <o.Icon size={14} aria-hidden="true" />{o.label}
            </button>
          ))}
          {plataforma && <span className="text-xs text-slate-500">Visível só para donos da plataforma.</span>}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <IndicadorModulo icone={Users} rotulo="Usuários" valor={totais.total} detalhe={plataforma ? (filtroOrg ? 'Na organização filtrada' : 'Em todas as organizações') : 'Com acesso à organização'} tom="cyan" />
        <IndicadorModulo icone={Shield} rotulo="Administradores" valor={totais.admins} detalhe="Acesso total" tom="violet" />
        <IndicadorModulo icone={KeyRound} rotulo="Convites pendentes" valor={totais.pendentes} detalhe="Ainda não definiram senha" tom="amber" />
        <IndicadorModulo icone={UserX} rotulo="Bloqueados" valor={totais.bloqueados} detalhe="Sem login liberado" tom="blue" />
      </div>

      <section className={m.painel}>
        <div className={`${m.painelBarra} flex flex-wrap items-center justify-between gap-3`}>
          <TituloSecao
            icone={ShieldCheck}
            titulo="Usuários da plataforma"
            subtitulo={plataforma
              ? 'Todos os logins, de todas as organizações. Senhas não são visíveis: use a redefinição.'
              : 'Quem acessa esta organização. Senhas não são visíveis: use a redefinição.'}
          />
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          {plataforma && (
            <select
              value={filtroOrg} onChange={(e) => setFiltroOrg(e.target.value)}
              aria-label="Filtrar por organização"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 sm:w-56"
            >
              <option value="">Todas as organizações ({organizacoes.length})</option>
              {organizacoes.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
              {membros.some((x) => !x.organizacao_id) && <option value="sem">Sem organização</option>}
            </select>
          )}
          <label className="relative block w-full sm:w-64">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden="true" />
            <input
              type="search" value={busca} onChange={(e) => setBusca(e.target.value)}
              placeholder={plataforma ? 'Buscar por nome, e-mail ou organização' : 'Buscar por nome ou e-mail'}
              aria-label="Buscar usuário"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-card)] py-2 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </label>
          </div>
        </div>

        {carregando ? (
          <EsqueletoLinhas linhas={5} className="p-6" />
        ) : erroLista ? (
          <div className="p-6 text-sm text-red-400">
            ✗ {erroLista}{' '}
            <button type="button" onClick={() => { setCarregando(true); carregar(escopo); }} className="text-indigo-400 hover:underline">Tentar de novo</button>
          </div>
        ) : filtrados.length === 0 ? (
          <p className="p-6 text-sm text-slate-400">{busca || filtroOrg ? 'Nenhum usuário encontrado para esse filtro.' : plataforma ? 'Nenhum usuário na plataforma.' : 'Nenhum usuário na organização.'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-[var(--border)] bg-[var(--bg-base)]">
                <tr>
                  {colunas.map((h) => (
                    <th key={h} className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {filtrados.map((x) => {
                  const ehVoce = x.email.toLowerCase() === emailProprio.toLowerCase();
                  const ret = retorno?.membroId === x.id ? retorno : null;
                  // As ações exigem o perfil numa organização (o servidor recusa sem ela).
                  const semOrg = plataforma && !x.organizacao_id;
                  return (
                    <Fragment key={x.id}>
                    <tr className="align-top transition-colors hover:bg-[var(--bg-base)]">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <img src={x.avatar_url || avatarUrl(x.nome, x.email)} alt="" className="h-9 w-9 flex-shrink-0 rounded-full object-cover" />
                          <div>
                            <p className="font-medium text-slate-100">{x.nome || '—'}{ehVoce && <span className="ml-1.5 text-xs font-normal text-slate-500">(você)</span>}</p>
                            <p className="text-xs text-slate-500">Desde {new Date(x.created_at).toLocaleDateString('pt-BR')}</p>
                          </div>
                        </div>
                      </td>
                      {plataforma && (
                        <td className="px-5 py-3 text-xs">
                          {x.organizacao_id
                            ? <span className="flex items-center gap-1.5 text-slate-200"><Building2 size={13} className="text-slate-500" />{x.organizacao_nome || 'Sem nome'}</span>
                            : <span className="italic text-slate-500">Sem organização</span>}
                        </td>
                      )}
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className="text-slate-200">{x.email}</span>
                          <button
                            type="button" onClick={() => copiar(x.email, `email-${x.id}`)}
                            title="Copiar e-mail" aria-label={`Copiar e-mail de ${x.nome || x.email}`}
                            className="rounded p-1 text-slate-500 transition-colors hover:bg-[var(--bg-input)] hover:text-slate-300"
                          >
                            {copiado === `email-${x.id}` ? <Check size={13} /> : <Copy size={13} />}
                          </button>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-xs">
                        {x.role === 'admin'
                          ? <span className="flex items-center gap-1.5 font-medium text-indigo-400"><Shield size={13} />Administrador</span>
                          : <span className="flex items-center gap-1.5 font-medium text-slate-300"><Users size={13} />Usuário</span>}
                      </td>
                      <td className="px-5 py-3"><StatusAcesso membro={x} /></td>
                      <td className="px-5 py-3 text-xs text-slate-400">{formatarData(x.last_sign_in_at)}</td>
                      <td className="px-5 py-3">
                        <span className="mb-1 block font-mono text-xs tracking-widest text-slate-500" aria-label="Senha protegida">••••••••</span>
                        <button
                          type="button"
                          onClick={() => { setRetorno(null); setConfirmando({ membro: x, acao: 'redefinir_senha' }); }}
                          disabled={x.bloqueado || semOrg}
                          title={semOrg ? 'Usuário sem organização: conclua o cadastro antes'
                            : x.bloqueado ? 'Desbloqueie o acesso antes de redefinir a senha' : undefined}
                          className="flex items-center gap-1 whitespace-nowrap text-xs text-indigo-400 hover:underline disabled:cursor-not-allowed disabled:text-slate-600 disabled:no-underline"
                        >
                          <KeyRound size={12} />Redefinir senha
                        </button>
                      </td>
                      <td className="px-5 py-3">
                        {ehVoce || semOrg ? (
                          <span className="text-xs text-slate-500">—</span>
                        ) : x.bloqueado ? (
                          <button type="button" onClick={() => { setRetorno(null); setConfirmando({ membro: x, acao: 'desbloquear' }); }}
                            className="flex items-center gap-1 text-xs text-green-400 hover:underline">
                            <LockOpen size={12} />Desbloquear
                          </button>
                        ) : (
                          <button type="button" onClick={() => { setRetorno(null); setConfirmando({ membro: x, acao: 'bloquear' }); }}
                            className="flex items-center gap-1 text-xs text-red-400 hover:underline">
                            <Ban size={12} />Bloquear
                          </button>
                        )}
                      </td>
                    </tr>
                    {ret && (
                    <tr>
                      <td colSpan={colunas.length} className="px-5 pb-3">
                        <div className={`rounded-lg px-3 py-2 text-sm ${ret.tipo === 'sucesso' ? 'bg-green-500/10 text-green-400' : ret.tipo === 'aviso' ? 'bg-yellow-500/10 text-yellow-400' : 'bg-red-500/10 text-red-400'}`}>
                          <p>{ret.tipo === 'sucesso' ? '✓' : ret.tipo === 'aviso' ? '⚠' : '✗'} {ret.msg}</p>
                          {ret.link && (
                            <div className="mt-2 flex items-center gap-2">
                              <code className="min-w-0 flex-1 truncate rounded bg-[var(--bg-base)] px-2 py-1 text-xs text-slate-300">{ret.link}</code>
                              <button type="button" onClick={() => copiar(ret.link!, `link-${x.id}`)}
                                className="flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-200 hover:bg-[var(--bg-input)]">
                                {copiado === `link-${x.id}` ? <Check size={12} /> : <Copy size={12} />}Copiar link
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                    )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {confirmando && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => !executando && setConfirmando(null)}>
          <div role="dialog" aria-modal="true" aria-labelledby="titulo-acesso"
            className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 id="titulo-acesso" className="text-base font-semibold text-slate-100">{textoConfirmacao[confirmando.acao].titulo}</h3>
            <p className="mt-1 text-sm text-slate-300">
              <strong className="text-slate-100">{confirmando.membro.nome || confirmando.membro.email}</strong>
              {confirmando.membro.nome && <span className="text-slate-400"> · {confirmando.membro.email}</span>}
            </p>
            <p className="mt-3 text-sm text-slate-400">{textoConfirmacao[confirmando.acao].corpo}</p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setConfirmando(null)} disabled={executando}
                className="rounded-lg px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-[var(--bg-input)] disabled:opacity-50">
                Cancelar
              </button>
              <button type="button" onClick={executar} disabled={executando}
                className={textoConfirmacao[confirmando.acao].perigo
                  ? 'rounded-lg bg-red-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50'
                  : `${m.primaryButton} focus-ring`}>
                {executando ? 'Aguarde...' : textoConfirmacao[confirmando.acao].botao}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
