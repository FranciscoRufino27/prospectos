'use client';

// Novo usuário pela aba "Usuários da plataforma". É um CONVITE: cria o login
// sem senha e a pessoa define a própria pelo link do e-mail (nenhuma senha
// passa pelo admin). Admin de organização convida para a própria org
// (/api/equipe/convidar); o dono da plataforma, na visão "Plataforma inteira",
// escolhe a organização (/api/plataforma/usuarios/convidar).
import { useState } from 'react';
import { Check, Copy, UserPlus } from 'lucide-react';
import { estilosModulo as m } from '@/components/tema/Modulo';

// Mesma lista da tela Equipe e do Meu perfil.
const NICHOS = [
  'Hotelaria', 'Óticas', 'Agronegócio', 'Indústria', 'Logística',
  'Saúde', 'Varejo', 'Tecnologia', 'Construção Civil', 'Educação',
];

const CAMPO = 'w-full rounded-lg border border-[var(--border)] bg-[var(--bg-base)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';

type Resultado = { tipo: 'sucesso' | 'aviso'; msg: string; link: string | null };

export default function NovoUsuarioModal({ plataforma, organizacoes, orgInicial, onFechar, onCriado }: {
  plataforma: boolean;
  organizacoes: { id: string; nome: string }[];
  orgInicial: string;
  onFechar: () => void;
  onCriado: () => void;
}) {
  const [email, setEmail] = useState('');
  const [nome, setNome] = useState('');
  const [role, setRole] = useState<'usuario' | 'admin'>('usuario');
  const [nicho, setNicho] = useState('');
  const [org, setOrg] = useState(orgInicial);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [copiado, setCopiado] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (plataforma && !org) { setErro('Escolha a organização do usuário.'); return; }
    setEnviando(true);
    setErro(null);
    try {
      const res = await fetch(plataforma ? '/api/plataforma/usuarios/convidar' : '/api/equipe/convidar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), nome, role, nicho, ...(plataforma ? { organizacao_id: org } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) { setErro(data.erro || 'Não foi possível criar o usuário.'); return; }
      setResultado(
        data.emailEnviado
          ? { tipo: 'sucesso', msg: `Convite enviado para ${email.trim()} (por ${data.remetente}). Ele define a senha pelo link.`, link: null }
          : data.simulado
            ? { tipo: 'aviso', msg: 'Usuário criado. Modo ensaio ativo: o e-mail não foi enviado. Copie o link e repasse.', link: data.link ?? null }
            : { tipo: 'aviso', msg: 'Usuário criado, mas o e-mail não saiu (conta de envio indisponível). Copie o link e repasse.', link: data.link ?? null },
      );
      onCriado();
    } catch {
      setErro('Falha de conexão. Tente de novo.');
    } finally {
      setEnviando(false);
    }
  }

  async function copiarLink() {
    if (!resultado?.link) return;
    try {
      await navigator.clipboard.writeText(resultado.link);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    } catch { /* o link segue visível para copiar à mão */ }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => !enviando && onFechar()}>
      <div role="dialog" aria-modal="true" aria-labelledby="titulo-novo-usuario"
        className="w-full max-w-lg rounded-xl border border-[var(--border)] bg-[var(--bg-card)] shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-[var(--border)] px-5 py-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-500/15 text-indigo-400"><UserPlus size={17} /></span>
          <div>
            <h3 id="titulo-novo-usuario" className="text-base font-semibold text-slate-100">Novo usuário</h3>
            <p className="text-xs text-slate-400">A pessoa recebe um convite por e-mail e cria a própria senha.</p>
          </div>
        </div>

        {resultado ? (
          <div className="space-y-4 p-5">
            <div className={`rounded-lg px-3 py-2 text-sm ${resultado.tipo === 'sucesso' ? 'bg-green-500/10 text-green-400' : 'bg-yellow-500/10 text-yellow-400'}`}>
              <p>{resultado.tipo === 'sucesso' ? '✓' : '⚠'} {resultado.msg}</p>
              {resultado.link && (
                <div className="mt-2 flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded bg-[var(--bg-base)] px-2 py-1 text-xs text-slate-300">{resultado.link}</code>
                  <button type="button" onClick={copiarLink} className="flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-200 hover:bg-[var(--bg-input)]">
                    {copiado ? <Check size={12} /> : <Copy size={12} />}Copiar link
                  </button>
                </div>
              )}
            </div>
            <div className="flex justify-end">
              <button type="button" onClick={onFechar} className={`${m.primaryButton} focus-ring`}>Concluir</button>
            </div>
          </div>
        ) : (
          <form onSubmit={enviar} className="space-y-4 p-5">
            {plataforma && (
              <div>
                <label htmlFor="nu-org" className="mb-1 block text-xs font-medium text-slate-300">Organização *</label>
                <select id="nu-org" value={org} onChange={(e) => setOrg(e.target.value)} required className={CAMPO}>
                  <option value="">Selecione a organização</option>
                  {organizacoes.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
                </select>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="nu-email" className="mb-1 block text-xs font-medium text-slate-300">E-mail de acesso *</label>
                <input id="nu-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
                  placeholder="nome@empresa.com" className={CAMPO} autoFocus />
              </div>
              <div>
                <label htmlFor="nu-nome" className="mb-1 block text-xs font-medium text-slate-300">Nome</label>
                <input id="nu-nome" type="text" value={nome} onChange={(e) => setNome(e.target.value)}
                  placeholder="Nome completo" className={CAMPO} />
              </div>
              <div>
                <label htmlFor="nu-role" className="mb-1 block text-xs font-medium text-slate-300">Função</label>
                <select id="nu-role" value={role} onChange={(e) => setRole(e.target.value as 'usuario' | 'admin')} className={CAMPO}>
                  <option value="usuario">Usuário</option>
                  <option value="admin">Administrador</option>
                </select>
              </div>
              <div>
                <label htmlFor="nu-nicho" className="mb-1 block text-xs font-medium text-slate-300">Nicho / Segmento</label>
                <select id="nu-nicho" value={nicho} onChange={(e) => setNicho(e.target.value)} className={CAMPO}>
                  <option value="">Não definido</option>
                  {NICHOS.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            </div>

            {erro && <p className="text-sm text-red-400">✗ {erro}</p>}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button type="button" onClick={onFechar} disabled={enviando}
                className="rounded-lg px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-[var(--bg-input)] disabled:opacity-50">
                Cancelar
              </button>
              <button type="submit" disabled={enviando} className={`${m.primaryButton} focus-ring`}>
                <UserPlus size={15} />{enviando ? 'Enviando convite...' : 'Criar e enviar convite'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
