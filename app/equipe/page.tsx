'use client';

import { useState, useEffect } from 'react';
import { UserPlus, Users, Shield, Briefcase, BarChart2, Search, CheckCircle, Clock, Pencil, MoreVertical, Trash2, X } from 'lucide-react';
import { estilosModulo, IndicadorModulo, PaginaModulo } from '@/components/tema/Modulo';
import { EsqueletoLinhas } from '@/components/ui/Esqueleto';

interface Membro {
  id: string;
  email: string;
  nome: string | null;
  role: 'admin' | 'usuario';
  nicho: string | null;
  confirmed_at: string | null;
  last_sign_in_at: string | null;
  created_at: string;
  total_leads: number;
  avatar_url: string | null;
  bloqueado?: boolean;
}

const NICHOS = [
  'Hotelaria',
  'Óticas',
  'Agronegócio',
  'Indústria',
  'Logística',
  'Saúde',
  'Varejo',
  'Tecnologia',
  'Construção Civil',
  'Educação',
  'Todos os nichos',
];

const NICHO_CORES: Record<string, string> = {
  'Hotelaria': 'bg-blue-500/20 text-blue-400',
  'Óticas': 'bg-purple-500/20 text-purple-400',
  'Agronegócio': 'bg-yellow-500/20 text-yellow-400',
  'Indústria': 'bg-green-500/20 text-green-400',
  'Logística': 'bg-pink-500/20 text-pink-400',
  'Saúde': 'bg-red-500/20 text-red-400',
  'Varejo': 'bg-orange-500/20 text-orange-400',
  'Tecnologia': 'bg-cyan-500/20 text-cyan-400',
  'Construção Civil': 'bg-amber-500/20 text-amber-400',
  'Educação': 'bg-indigo-500/20 text-indigo-400',
  'Todos os nichos': 'bg-indigo-500/20 text-indigo-400',
};

const BARRA_CORES: Record<string, string> = {
  'Hotelaria': 'bg-blue-500',
  'Óticas': 'bg-purple-500',
  'Agronegócio': 'bg-yellow-500',
  'Indústria': 'bg-green-500',
  'Logística': 'bg-pink-500',
  'Saúde': 'bg-red-500',
  'Varejo': 'bg-orange-500',
  'Tecnologia': 'bg-cyan-500',
  'Construção Civil': 'bg-amber-500',
  'Educação': 'bg-indigo-500',
  'Todos os nichos': 'bg-indigo-500',
};

function avatarUrl(nome: string | null, email: string) {
  const seed = nome || email;
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(seed)}&background=6366f1&color=fff&size=64&bold=true`;
}

function formatarAcesso(data: string | null) {
  if (!data) return '—';
  const d = new Date(data);
  const agora = new Date();
  const diff = Math.floor((agora.getTime() - d.getTime()) / 1000);
  if (diff < 120) return 'Agora há pouco';
  if (diff < 3600) return `Há ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `Hoje às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  if (diff < 172800) return `Ontem às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  return d.toLocaleDateString('pt-BR');
}

export default function EquipePage() {
  const [membros, setMembros] = useState<Membro[]>([]);
  const [buscando, setBuscando] = useState(true);
  const [filtroNicho, setFiltroNicho] = useState('Todos os nichos');
  const [busca, setBusca] = useState('');
  const [mostrarConvite, setMostrarConvite] = useState(false);

  // Form
  const [email, setEmail] = useState('');
  const [nome, setNome] = useState('');
  const [role, setRole] = useState<'admin' | 'usuario'>('usuario');
  const [nicho, setNicho] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [feedback, setFeedback] = useState<{ tipo: 'sucesso' | 'aviso' | 'erro'; msg: string } | null>(null);

  // Ações por membro
  const [menuAberto, setMenuAberto] = useState<string | null>(null);
  const [editando, setEditando] = useState<Membro | null>(null);
  const [editNome, setEditNome] = useState('');
  const [editRole, setEditRole] = useState<'admin' | 'usuario'>('usuario');
  const [editNicho, setEditNicho] = useState('');
  const [salvandoEdicao, setSalvandoEdicao] = useState(false);
  const [erroEdicao, setErroEdicao] = useState<string | null>(null);
  const [removendo, setRemovendo] = useState<Membro | null>(null);
  const [removendoLoading, setRemovendoLoading] = useState(false);
  const [erroRemocao, setErroRemocao] = useState<string | null>(null);

  function abrirEdicao(m: Membro) {
    setMenuAberto(null);
    setEditando(m);
    setEditNome(m.nome || '');
    setEditRole(m.role);
    setEditNicho(m.nicho || '');
    setErroEdicao(null);
  }

  async function salvarEdicao(e: React.FormEvent) {
    e.preventDefault();
    if (!editando) return;
    setSalvandoEdicao(true);
    setErroEdicao(null);
    try {
      const res = await fetch(`/api/equipe/${editando.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: editNome, role: editRole, nicho: editNicho }),
      });
      const data = await res.json();
      if (!res.ok) { setErroEdicao(data.erro || 'Erro ao salvar'); return; }
      setEditando(null);
      await carregarMembros();
    } catch {
      setErroEdicao('Erro ao salvar');
    } finally {
      setSalvandoEdicao(false);
    }
  }

  async function confirmarRemocao() {
    if (!removendo) return;
    setRemovendoLoading(true);
    setErroRemocao(null);
    try {
      const res = await fetch(`/api/equipe/${removendo.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) { setErroRemocao(data.erro || 'Erro ao remover'); return; }
      const nome = removendo.nome || removendo.email;
      const n = Number(data.leadsSemResponsavel ?? 0);
      // Os leads da pessoa não são apagados — ficam sem responsável. Dizer isso
      // aqui, para ninguém procurar depois por que sumiu "o dono" desses leads.
      setFeedback({
        tipo: 'sucesso',
        msg: n > 0
          ? `${nome} removido(a). ${n} lead${n === 1 ? '' : 's'} ficou${n === 1 ? '' : 'aram'} sem responsável — reatribua na Base de Leads.`
          : `${nome} removido(a) da equipe.`,
      });
      setRemovendo(null);
      await carregarMembros();
    } catch {
      setErroRemocao('Erro ao remover');
    } finally {
      setRemovendoLoading(false);
    }
  }

  async function carregarMembros() {
    setBuscando(true);
    try {
      const res = await fetch('/api/equipe/listar');
      const data = await res.json();
      setMembros(data.membros || []);
    } finally {
      setBuscando(false);
    }
  }

  useEffect(() => { carregarMembros(); }, []);

  // Fecha o menu de três pontos ao clicar fora ou apertar Esc.
  useEffect(() => {
    if (!menuAberto) return;
    const fechar = () => setMenuAberto(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuAberto(null); };
    window.addEventListener('click', fechar);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('click', fechar); window.removeEventListener('keydown', onKey); };
  }, [menuAberto]);

  async function handleConvidar(e: React.FormEvent) {
    e.preventDefault();
    setCarregando(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/equipe/convidar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, nome, role, nicho }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ tipo: 'erro', msg: data.erro || 'Erro ao enviar convite' });
      } else {
        // A API só confirma envio de fato quando saiu pela conta Gmail do
        // workspace (emailEnviado) e diz qual conta foi (remetente). Em ensaio
        // ou sem credencial, o usuário já foi criado, mas ninguém recebeu nada —
        // não afirmar um envio que não ocorreu (link fica p/ repasse manual).
        if (data.emailEnviado) {
          setFeedback({
            tipo: 'sucesso',
            msg: data.remetente ? `Convite enviado para ${email} (de ${data.remetente})` : `Convite enviado para ${email}`,
          });
        } else if (data.simulado) {
          setFeedback({ tipo: 'aviso', msg: `Usuário criado, mas o e-mail NÃO foi enviado (MODO_ENSAIO ativo).` });
        } else {
          const causa = data.motivo === 'credencial_ausente'
            ? 'a conta de e-mail deste workspace não está configurada'
            : 'o e-mail não pôde ser enviado';
          setFeedback({
            tipo: 'aviso',
            msg: data.link
              ? `Usuário criado, mas ${causa}. Copie o link e envie manualmente: ${data.link}`
              : `Usuário criado, mas ${causa}.`,
          });
        }
        setEmail(''); setNome(''); setNicho(''); setRole('usuario');
        setMostrarConvite(false);
        await carregarMembros();
      }
    } catch {
      setFeedback({ tipo: 'erro', msg: 'Erro ao enviar convite' });
    } finally {
      setCarregando(false);
    }
  }

  const admins = membros.filter(m => m.role === 'admin');
  const usuarios = membros.filter(m => m.role === 'usuario');
  const nichosAtivos = [...new Set(membros.map(m => m.nicho).filter(Boolean))].length;
  const totalLeads = membros.reduce((acc, m) => acc + m.total_leads, 0);
  const maxLeads = Math.max(...membros.map(m => m.total_leads), 1);

  const membrosFiltrados = membros.filter(m => {
    const matchNicho = filtroNicho === 'Todos os nichos' || m.nicho === filtroNicho;
    const matchBusca = !busca || (m.nome?.toLowerCase().includes(busca.toLowerCase()) || m.email.toLowerCase().includes(busca.toLowerCase()));
    return matchNicho && matchBusca;
  });

  return (
    <PaginaModulo
      grupo="Administração"
      titulo="Equipe"
      subtitulo="Gerencie sua equipe, nichos e permissões de acesso."
      acoes={
        <>
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-sky-300" />
            <input
              value={busca} onChange={e => setBusca(e.target.value)}
              placeholder="Buscar membro"
              aria-label="Buscar membro"
              className="h-9 pl-9 pr-4 border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 w-52"
            />
          </div>
          <button onClick={() => setMostrarConvite(!mostrarConvite)} className={`${estilosModulo.primaryButton} focus-ring`}>
            <UserPlus size={16} />
            Convidar membro
          </button>
        </>
      }
    >
      <section className={estilosModulo.kpiGrid}>
        <IndicadorModulo tom="violet" icone={Shield} rotulo="Administradores" valor={admins.length} detalhe="Acesso total à plataforma" />
        <IndicadorModulo tom="emerald" icone={Users} rotulo="Usuários" valor={usuarios.length} detalhe="Acesso ao nicho definido" />
        <IndicadorModulo tom="amber" icone={Briefcase} rotulo="Nichos ativos" valor={nichosAtivos} detalhe="Segmentos de atuação" />
        <IndicadorModulo tom="cyan" icone={BarChart2} rotulo="Leads distribuídos" valor={totalLeads} detalhe="Entre toda a equipe" />
      </section>

      {/* Formulário de convite (colapsável) */}
      {mostrarConvite && (
        <div className="card p-5">
          <h2 className="text-base font-semibold text-slate-100 mb-1 flex items-center gap-2">
            <UserPlus size={17} />
            Convidar novo membro
          </h2>
          <p className="text-xs text-slate-400 mb-4">Convide pessoas para sua equipe e defina o nicho que cada uma irá cuidar.</p>
          <form onSubmit={handleConvidar}>
            <div className="grid grid-cols-4 gap-3 mb-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">E-mail</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="email@empresa.com"
                  className="w-full border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Nome (opcional)</label>
                <input type="text" value={nome} onChange={e => setNome(e.target.value)} placeholder="Nome completo"
                  className="w-full border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Tipo de acesso</label>
                <select value={role} onChange={e => setRole(e.target.value as 'admin' | 'usuario')}
                  className="w-full border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-[var(--bg-card)]">
                  <option value="usuario">Usuário — Acesso limitado ao nicho</option>
                  <option value="admin">Administrador — Acesso total</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Nicho / Segmento</label>
                <select value={nicho} onChange={e => setNicho(e.target.value)}
                  className="w-full border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-[var(--bg-card)]">
                  <option value="">Selecione o nicho</option>
                  {NICHOS.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-xs text-indigo-400 bg-indigo-500/10 px-3 py-1.5 rounded-lg">
                👑 <strong>Administradores</strong> têm acesso total à plataforma e podem gerenciar leads de todos os nichos.
              </p>
              <button type="submit" disabled={carregando}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors">
                <UserPlus size={15} />
                {carregando ? 'Enviando...' : 'Enviar convite'}
              </button>
            </div>
            {feedback && (
              <p className={`text-sm mt-2 break-all ${
                feedback.tipo === 'sucesso' ? 'text-green-400'
                : feedback.tipo === 'aviso' ? 'text-yellow-400'
                : 'text-red-500'
              }`}>
                {feedback.tipo === 'sucesso' ? '✓' : feedback.tipo === 'aviso' ? '⚠' : '✗'} {feedback.msg}
              </p>
            )}
          </form>
        </div>
      )}

      {/* Tabela de membros */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-100">Membros da equipe</h2>
            <p className="text-xs text-slate-400">Visualize e gerencie todos os membros da sua equipe.</p>
          </div>
          <select value={filtroNicho} onChange={e => setFiltroNicho(e.target.value)}
            className="border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-[var(--bg-card)]">
            <option>Todos os nichos</option>
            {NICHOS.filter(n => n !== 'Todos os nichos').map(n => <option key={n}>{n}</option>)}
          </select>
        </div>

        {buscando ? (
          <EsqueletoLinhas linhas={5} className="p-6" />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[var(--bg-base)] border-b border-[var(--border)]">
              <tr>
                <th className="text-left px-5 py-3 text-xs font-medium text-slate-400 uppercase tracking-wide">Pessoa</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-slate-400 uppercase tracking-wide">Função na plataforma</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-slate-400 uppercase tracking-wide">Nicho / Segmento</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-slate-400 uppercase tracking-wide">Leads atribuídos</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-slate-400 uppercase tracking-wide">Status</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-slate-400 uppercase tracking-wide">Último acesso</th>
                <th className="px-5 py-3 text-xs font-medium text-slate-400 uppercase tracking-wide">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {membrosFiltrados.map(m => {
                const barraLargura = maxLeads > 0 ? Math.round((m.total_leads / maxLeads) * 100) : 0;
                const corBarra = BARRA_CORES[m.nicho || ''] || 'bg-indigo-500';
                const corNicho = NICHO_CORES[m.nicho || ''] || 'bg-[var(--bg-input)] text-slate-300';
                return (
                  <tr key={m.id} className="hover:bg-[var(--bg-base)] transition-colors">
                    {/* Pessoa */}
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <img
                          src={m.avatar_url || avatarUrl(m.nome, m.email)}
                          alt={m.nome || m.email}
                          className="w-9 h-9 rounded-full object-cover flex-shrink-0"
                        />
                        <div>
                          <p className="font-medium text-slate-100">{m.nome || '—'}</p>
                          <p className="text-xs text-slate-400">{m.email}</p>
                        </div>
                      </div>
                    </td>
                    {/* Função */}
                    <td className="px-5 py-3">
                      {m.role === 'admin' ? (
                        <div>
                          <div className="flex items-center gap-1.5 text-indigo-400 font-medium text-xs">
                            <Shield size={13} />
                            Administrador
                          </div>
                          <p className="text-xs text-slate-500">Acesso total</p>
                        </div>
                      ) : (
                        <div>
                          <div className="flex items-center gap-1.5 text-slate-300 font-medium text-xs">
                            <Users size={13} />
                            Usuário
                          </div>
                          <p className="text-xs text-slate-500">Acesso ao nicho</p>
                        </div>
                      )}
                    </td>
                    {/* Nicho */}
                    <td className="px-5 py-3">
                      {m.nicho ? (
                        <div>
                          <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${corNicho}`}>
                            {m.nicho}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-500 italic">não definido</span>
                      )}
                    </td>
                    {/* Leads */}
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-200 w-10 text-right">{m.total_leads}</span>
                        <span className="text-xs text-slate-500">leads</span>
                      </div>
                      <div className="mt-1 w-24 h-1.5 bg-[var(--bg-input)] rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${corBarra}`} style={{ width: `${barraLargura}%` }} />
                      </div>
                    </td>
                    {/* Status */}
                    <td className="px-5 py-3">
                      {m.bloqueado ? (
                        <span className="flex items-center gap-1.5 text-xs text-red-400">
                          <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
                          Bloqueado
                        </span>
                      ) : m.confirmed_at ? (
                        <span className="flex items-center gap-1.5 text-xs text-green-400">
                          <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
                          Ativo
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 text-xs text-yellow-400">
                          <span className="w-2 h-2 rounded-full bg-yellow-400 inline-block" />
                          Pendente
                        </span>
                      )}
                    </td>
                    {/* Último acesso */}
                    <td className="px-5 py-3 text-xs text-slate-400">
                      <p>{formatarAcesso(m.last_sign_in_at)}</p>
                      {m.last_sign_in_at && (
                        <p className="text-slate-500">{new Date(m.last_sign_in_at).toLocaleDateString('pt-BR')}</p>
                      )}
                    </td>
                    {/* Ações */}
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2 justify-center">
                        <button
                          onClick={() => abrirEdicao(m)}
                          title="Editar membro"
                          className="p-1.5 hover:bg-[var(--bg-input)] rounded-lg transition-colors text-slate-500 hover:text-slate-300"
                        >
                          <Pencil size={14} />
                        </button>
                        <div className="relative">
                          <button
                            onClick={(e) => { e.stopPropagation(); setMenuAberto(menuAberto === m.id ? null : m.id); }}
                            title="Mais ações"
                            className="p-1.5 hover:bg-[var(--bg-input)] rounded-lg transition-colors text-slate-500 hover:text-slate-300"
                          >
                            <MoreVertical size={14} />
                          </button>
                          {menuAberto === m.id && (
                            <div
                              onClick={(e) => e.stopPropagation()}
                              className="absolute right-0 top-full mt-1 w-44 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg shadow-lg py-1 z-20"
                            >
                              <button
                                onClick={() => abrirEdicao(m)}
                                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-300 hover:bg-[var(--bg-input)] transition-colors"
                              >
                                <Pencil size={14} />
                                Editar
                              </button>
                              <button
                                onClick={() => { setMenuAberto(null); setErroRemocao(null); setRemovendo(m); }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                              >
                                <Trash2 size={14} />
                                Remover da equipe
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {!buscando && membrosFiltrados.length === 0 && (
          <div className="p-8 text-center text-slate-500 text-sm">Nenhum membro encontrado.</div>
        )}

        <div className="px-5 py-3 border-t border-[var(--border)] bg-[var(--bg-base)]">
          <p className="text-xs text-slate-500">Use a caneta ou o menu de cada membro para editar informações, alterar nicho ou permissões de acesso.</p>
        </div>
      </div>

      {/* Modal de edição */}
      {editando && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => !salvandoEdicao && setEditando(null)}>
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
              <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                <Pencil size={16} /> Editar membro
              </h3>
              <button onClick={() => setEditando(null)} className="p-1 text-slate-500 hover:text-slate-300 rounded-lg hover:bg-[var(--bg-input)] transition-colors">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={salvarEdicao} className="p-5 space-y-4">
              <div className="flex items-center gap-3">
                <img src={editando.avatar_url || avatarUrl(editando.nome, editando.email)} alt="" className="w-9 h-9 rounded-full object-cover" />
                <p className="text-xs text-slate-400">{editando.email}</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Nome</label>
                <input value={editNome} onChange={e => setEditNome(e.target.value)} placeholder="Nome completo"
                  className="w-full border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-[var(--bg-base)]" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Tipo de acesso</label>
                <select value={editRole} onChange={e => setEditRole(e.target.value as 'admin' | 'usuario')}
                  className="w-full border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-[var(--bg-base)]">
                  <option value="usuario">Usuário — Acesso limitado ao nicho</option>
                  <option value="admin">Administrador — Acesso total</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Nicho / Segmento</label>
                <select value={editNicho} onChange={e => setEditNicho(e.target.value)}
                  className="w-full border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-[var(--bg-base)]">
                  <option value="">Não definido</option>
                  {NICHOS.filter(n => n !== 'Todos os nichos').map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              {erroEdicao && <p className="text-sm text-red-500">✗ {erroEdicao}</p>}
              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={() => setEditando(null)} disabled={salvandoEdicao}
                  className="px-4 py-2 rounded-lg text-sm text-slate-300 hover:bg-[var(--bg-input)] transition-colors disabled:opacity-50">
                  Cancelar
                </button>
                <button type="submit" disabled={salvandoEdicao}
                  className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors">
                  {salvandoEdicao ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de confirmação de remoção */}
      {removendo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => !removendoLoading && setRemovendo(null)}>
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="p-5">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center flex-shrink-0">
                  <Trash2 size={18} className="text-red-400" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-slate-100">Remover da equipe</h3>
                  <p className="text-sm text-slate-400 mt-1">
                    Remover <strong className="text-slate-200">{removendo.nome || removendo.email}</strong> exclui o acesso de login e o cadastro da plataforma. Esta ação não pode ser desfeita.
                  </p>
                </div>
              </div>
              {erroRemocao && <p className="text-sm text-red-500 mt-3">✗ {erroRemocao}</p>}
              <div className="flex items-center justify-end gap-2 mt-5">
                <button onClick={() => setRemovendo(null)} disabled={removendoLoading}
                  className="px-4 py-2 rounded-lg text-sm text-slate-300 hover:bg-[var(--bg-input)] transition-colors disabled:opacity-50">
                  Cancelar
                </button>
                <button onClick={confirmarRemocao} disabled={removendoLoading}
                  className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors">
                  {removendoLoading ? 'Removendo...' : 'Remover'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </PaginaModulo>
  );
}
