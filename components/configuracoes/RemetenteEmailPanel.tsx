'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, Mail, Plug, Unplug } from 'lucide-react';

// E-mail de envio da organização: a própria organização conecta a conta Gmail
// (e-mail + senha de app). O servidor testa o login antes de salvar e guarda a
// senha cifrada; ela nunca volta para o navegador. Usada por campanhas,
// respostas da Central, propostas e convites — e é a caixa onde o sistema lê
// as respostas. API: /api/configuracoes/remetente-email.

interface Status {
  estado: 'conectado' | 'incompleto' | 'nao_configurado';
  fonte: 'conectada' | 'legada' | null;
  email: string | null;
  verificadoEm: string | null;
  mensagem: string | null;
  podeEditar: boolean;
}

const URL_SENHAS_APP = 'https://myaccount.google.com/apppasswords';

export default function RemetenteEmailPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [formAberto, setFormAberto] = useState(false);
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [enviando, setEnviando] = useState<'conectar' | 'desconectar' | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErroCarga(null);
    const res = await fetch('/api/configuracoes/remetente-email').catch(() => null);
    const j = res ? await res.json().catch(() => null) : null;
    if (!res?.ok || !j?.estado) { setErroCarga(j?.erro ?? 'Não foi possível carregar o e-mail de envio.'); return; }
    setStatus(j as Status);
    setFormAberto(j.estado !== 'conectado');
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  async function conectar() {
    if (enviando) return;
    setEnviando('conectar'); setErro(null);
    try {
      const res = await fetch('/api/configuracoes/remetente-email', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, senhaApp: senha }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) { setErro(j?.erro ?? 'Não foi possível conectar.'); return; }
      setStatus(j as Status);
      setSenha(''); setEmail(''); setFormAberto(false);
    } finally { setEnviando(null); }
  }

  async function desconectar() {
    if (enviando || !confirm('Remover o e-mail de envio desta organização? Até você conectar outra conta, as campanhas de prospecção ficam bloqueadas e os demais envios usam a conta padrão da plataforma.')) return;
    setEnviando('desconectar'); setErro(null);
    try {
      const res = await fetch('/api/configuracoes/remetente-email', { method: 'DELETE' });
      const j = await res.json().catch(() => null);
      if (!res.ok) { setErro(j?.erro ?? 'Não foi possível remover a conta.'); return; }
      setStatus(j as Status);
      setFormAberto(true);
    } finally { setEnviando(null); }
  }

  const podeEditar = status?.podeEditar ?? false;
  const senhaLimpa = senha.replace(/\s+/g, '');
  const podeEnviar = !!email.trim() && senhaLimpa.length > 0 && !enviando;
  const input = 'w-full bg-[var(--bg-base)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 disabled:opacity-50';

  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-6 space-y-4 max-w-2xl">
      <div>
        <div className="font-semibold text-slate-100 inline-flex items-center gap-2">
          <Mail size={16} className="text-indigo-300" /> E-mail de envio
        </div>
        <p className="text-sm text-slate-400 mt-1">
          Conta Gmail que envia as campanhas, as respostas da Central e os convites desta organização — e onde o
          sistema lê as respostas dos clientes.
        </p>
      </div>

      {erroCarga && <p className="text-sm text-red-300 inline-flex items-center gap-1.5"><AlertTriangle size={14} /> {erroCarga}</p>}
      {!status && !erroCarga && (
        <div className="text-sm text-slate-500 inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Carregando…</div>
      )}

      {status && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-base)] p-4 space-y-2">
          {status.estado === 'conectado' ? (
            <span className="text-xs px-2 py-0.5 rounded-full border border-green-500/40 bg-green-500/15 text-green-300 inline-flex items-center gap-1">
              <CheckCircle2 size={12} /> Conectado
            </span>
          ) : status.estado === 'incompleto' ? (
            <span className="text-xs px-2 py-0.5 rounded-full border border-red-500/40 bg-red-500/15 text-red-300 inline-flex items-center gap-1">
              <AlertTriangle size={12} /> Precisa reconectar
            </span>
          ) : (
            <span className="text-xs px-2 py-0.5 rounded-full border border-amber-500/40 bg-amber-500/15 text-amber-300 inline-flex items-center gap-1">
              <AlertTriangle size={12} /> Não configurado
            </span>
          )}
          {status.email && (
            <div className="text-sm text-slate-300"><span className="text-slate-500">Conta:</span> {status.email}</div>
          )}
          {status.estado === 'conectado' && status.fonte === 'conectada' && status.verificadoEm && (
            <div className="text-xs text-slate-500">Testada em {new Date(status.verificadoEm).toLocaleString('pt-BR')}</div>
          )}
          {status.estado === 'conectado' && status.fonte === 'legada' && (
            <div className="text-xs text-slate-500">Configurada pela equipe da plataforma. Conecte a conta abaixo para gerenciá-la por aqui.</div>
          )}
          {status.mensagem && <p className="text-xs text-red-400">{status.mensagem}</p>}
          {status.estado === 'nao_configurado' && (
            <p className="text-xs text-amber-400">
              Sem conta conectada, campanhas de prospecção ficam bloqueadas e os demais envios usam a conta padrão da plataforma.
            </p>
          )}
        </div>
      )}

      {status && !podeEditar && (
        <p className="text-xs text-slate-500">Somente quem configura o workspace pode conectar ou trocar a conta.</p>
      )}

      {status && podeEditar && (formAberto ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs text-slate-400">
              E-mail Gmail
              <input className={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                disabled={!!enviando} placeholder="contato@suaempresa.com" autoComplete="off" spellCheck={false} />
            </label>
            <label className="space-y-1 text-xs text-slate-400">
              Senha de app (16 letras)
              <input className={input} type="password" value={senha} onChange={(e) => setSenha(e.target.value)}
                disabled={!!enviando} placeholder="abcd efgh ijkl mnop" autoComplete="new-password" spellCheck={false} />
            </label>
          </div>
          <div className="rounded-lg border border-[var(--border)] p-3 text-xs text-slate-400 space-y-1">
            <div className="font-medium text-slate-300">Como gerar a senha de app</div>
            <div>1. Na conta Google, ative a verificação em 2 etapas.</div>
            <div>
              2. Abra{' '}
              <a href={URL_SENHAS_APP} target="_blank" rel="noopener noreferrer" className="text-indigo-300 hover:text-indigo-200 inline-flex items-center gap-0.5">
                Senhas de app <ExternalLink size={11} />
              </a>
              , crie uma (ex.: &quot;ProspectOS&quot;) e cole aqui. A senha normal da conta não funciona.
            </div>
            <div>Testamos o login antes de salvar. A senha fica cifrada e não aparece mais na tela.</div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={conectar} disabled={!podeEnviar}
              className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-500 disabled:opacity-40 inline-flex items-center gap-1.5">
              {enviando === 'conectar' ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} />}
              {enviando === 'conectar' ? 'Testando conexão com o Gmail…' : 'Conectar e testar'}
            </button>
            {status.estado === 'conectado' && (
              <button onClick={() => { setFormAberto(false); setErro(null); setSenha(''); }} disabled={!!enviando}
                className="px-3 py-2 rounded-lg border border-[var(--border)] text-slate-400 text-sm hover:text-slate-200">
                Cancelar
              </button>
            )}
            {/* Conta que precisa reconectar também pode ser removida daqui. */}
            {status.estado === 'incompleto' && (
              <BotaoRemover onClick={desconectar} removendo={enviando === 'desconectar'} desabilitado={!!enviando} />
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button onClick={() => { setFormAberto(true); setErro(null); }} disabled={!!enviando}
            className="text-xs px-3 py-1.5 rounded-lg border border-[var(--border)] text-slate-300 hover:text-slate-100 hover:border-indigo-500/50">
            Trocar conta
          </button>
          <BotaoRemover onClick={desconectar} removendo={enviando === 'desconectar'} desabilitado={!!enviando} />
        </div>
      ))}

      {erro && <div className="text-xs text-red-400">{erro}</div>}
    </div>
  );
}

function BotaoRemover({ onClick, removendo, desabilitado }: { onClick: () => void; removendo: boolean; desabilitado: boolean }) {
  return (
    <button onClick={onClick} disabled={desabilitado}
      className="text-xs px-3 py-1.5 rounded-lg border border-red-500/30 text-red-300 hover:bg-red-500/10 disabled:opacity-50 inline-flex items-center gap-1">
      {removendo ? <Loader2 size={12} className="animate-spin" /> : <Unplug size={12} />} Remover conta
    </button>
  );
}
