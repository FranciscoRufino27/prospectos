'use client';

import { useState, useEffect, useRef } from 'react';
import { Camera, Save, Lock, User, Palette } from 'lucide-react';
import { estilosModulo as m, PaginaModulo, TituloSecao } from '@/components/tema/Modulo';
import SeletorTema from '@/components/tema/SeletorTema';
import AvisosWhatsapp from '@/components/perfil/AvisosWhatsapp';
// (Lock também usado no campo de nicho travado para usuário comum — item 1.)
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';

const NICHOS = [
  'Hotelaria', 'Óticas', 'Agronegócio', 'Indústria', 'Logística',
  'Saúde', 'Varejo', 'Tecnologia', 'Construção Civil', 'Educação', 'Todos os nichos',
];

function avatarUrl(nome: string | null, email: string) {
  const seed = nome || email;
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(seed)}&background=6366f1&color=fff&size=128&bold=true`;
}

export default function PerfilPage() {
  const fileRef = useRef<HTMLInputElement>(null);

  const [email, setEmail] = useState('');
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [nicho, setNicho] = useState('');
  const [role, setRole] = useState<string>('');
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [feedbackPerfil, setFeedbackPerfil] = useState<{ tipo: 'sucesso' | 'erro'; msg: string } | null>(null);

  // Senha
  const [senhaAtual, setSenhaAtual] = useState('');
  const [novaSenha, setNovaSenha] = useState('');
  const [confirmarSenha, setConfirmarSenha] = useState('');
  const [salvandoSenha, setSalvandoSenha] = useState(false);
  const [feedbackSenha, setFeedbackSenha] = useState<{ tipo: 'sucesso' | 'erro'; msg: string } | null>(null);

  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    fetch('/api/perfil')
      .then(r => r.json())
      .then(data => {
        setEmail(data.email || '');
        if (data.perfil) {
          setNome(data.perfil.nome || '');
          setTelefone(data.perfil.telefone || '');
          setNicho(data.perfil.nicho || '');
          setRole(data.perfil.role || '');
          setAvatarPreview(data.perfil.avatar_url || null);
        }
      })
      .finally(() => setCarregando(false));
  }, []);

  async function handleFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarPreview(URL.createObjectURL(file));
    setUploading(true);
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/perfil/avatar', { method: 'POST', body: form });
    const data = await res.json();
    if (data.avatar_url) setAvatarPreview(data.avatar_url);
    setUploading(false);
  }

  async function handleSalvarPerfil(e: React.FormEvent) {
    e.preventDefault();
    if (!nome.trim()) { setFeedbackPerfil({ tipo: 'erro', msg: 'Nome é obrigatório' }); return; }
    setSalvando(true);
    setFeedbackPerfil(null);
    const res = await fetch('/api/perfil', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome, telefone, nicho, avatar_url: avatarPreview }),
    });
    if (res.ok) {
      setFeedbackPerfil({ tipo: 'sucesso', msg: 'Perfil atualizado com sucesso!' });
    } else {
      const data = await res.json();
      setFeedbackPerfil({ tipo: 'erro', msg: data.erro || 'Erro ao salvar' });
    }
    setSalvando(false);
  }

  async function handleAlterarSenha(e: React.FormEvent) {
    e.preventDefault();
    setFeedbackSenha(null);
    if (novaSenha !== confirmarSenha) {
      setFeedbackSenha({ tipo: 'erro', msg: 'As senhas não coincidem' });
      return;
    }
    if (novaSenha.length < 6) {
      setFeedbackSenha({ tipo: 'erro', msg: 'A senha deve ter pelo menos 6 caracteres' });
      return;
    }
    setSalvandoSenha(true);
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.updateUser({ password: novaSenha });
    if (error) {
      setFeedbackSenha({ tipo: 'erro', msg: error.message });
    } else {
      setFeedbackSenha({ tipo: 'sucesso', msg: 'Senha alterada com sucesso!' });
      setSenhaAtual(''); setNovaSenha(''); setConfirmarSenha('');
    }
    setSalvandoSenha(false);
  }

  const fotoExibida = avatarPreview || avatarUrl(nome || null, email);

  if (carregando) {
    return <div className="p-6 text-sm text-slate-500">Carregando...</div>;
  }

  return (
    <PaginaModulo grupo="Conta" titulo="Meu perfil" subtitulo="Gerencie suas informações e credenciais de acesso.">
    <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">

      {/* Foto e dados */}
      <section className={m.painel}>
        <div className={m.painelBarra}>
          <TituloSecao icone={User} titulo="Informações pessoais" subtitulo="Nome, foto e contato que a equipe vê." />
        </div>

        <form onSubmit={handleSalvarPerfil} className="space-y-5 p-5">
          {/* Foto */}
          <div className="flex items-center gap-5">
            <div className="relative">
              <img
                src={fotoExibida}
                alt="Avatar"
                className="w-20 h-20 rounded-full object-cover border-4 border-[var(--m-border,#1b68a8)] shadow-none"
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="absolute bottom-0 right-0 w-7 h-7 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full flex items-center justify-center shadow transition-colors"
              >
                {uploading ? (
                  <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Camera size={13} />
                )}
              </button>
            </div>
            <div>
              <p className="text-sm font-medium text-slate-300">{nome || 'Sem nome'}</p>
              <p className="text-xs text-slate-500">{email}</p>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="text-xs text-indigo-400 hover:underline mt-1"
              >
                Alterar foto
              </button>
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFoto} />
          </div>

          {/* Email (readonly) */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Email</label>
            <input
              type="email" value={email} disabled
              className="w-full border border-[var(--border)] rounded-lg px-3 py-2 text-sm bg-[var(--bg-base)] text-slate-500 cursor-not-allowed"
            />
          </div>

          {/* Nome */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Nome completo</label>
            <input
              type="text" value={nome} onChange={e => setNome(e.target.value)} required
              placeholder="Seu nome"
              className="w-full border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* Telefone */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Telefone</label>
            <input
              type="tel" value={telefone} onChange={e => setTelefone(e.target.value)}
              placeholder="(11) 90000-0000"
              className="w-full border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* Nicho — editável só por admin; usuário comum vê travado (item 1) */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Nicho / Segmento</label>
            {role === 'admin' ? (
              <select
                value={nicho} onChange={e => setNicho(e.target.value)}
                className="w-full border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-[var(--bg-card)]"
              >
                <option value="">Selecione seu segmento</option>
                {NICHOS.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            ) : (
              <>
                <div className="w-full border border-[var(--border)] rounded-lg px-3 py-2 text-sm bg-[var(--bg-base)] text-slate-400 flex items-center gap-2 cursor-not-allowed">
                  <Lock size={13} className="text-slate-500 shrink-0" />
                  <span>{nicho || 'Definido pela sua organização'}</span>
                </div>
                <p className="text-xs text-slate-500 mt-1">Somente um administrador pode alterar o nicho.</p>
              </>
            )}
          </div>

          {feedbackPerfil && (
            <p className={`text-sm ${feedbackPerfil.tipo === 'sucesso' ? 'text-green-400' : 'text-red-500'}`}>
              {feedbackPerfil.tipo === 'sucesso' ? '✓' : '✗'} {feedbackPerfil.msg}
            </p>
          )}

          <button
            type="submit" disabled={salvando}
            className={`${m.primaryButton} focus-ring`}
          >
            <Save size={15} />
            {salvando ? 'Salvando...' : 'Salvar alterações'}
          </button>
        </form>
      </section>

      <div className="grid gap-4">
      {/* Avisos de resposta do cliente no WhatsApp */}
      <AvisosWhatsapp />

      {/* Aparência (por usuário, neste navegador) */}
      <section className={m.painel}>
        <div className={m.painelBarra}>
          <TituloSecao icone={Palette} titulo="Aparência" subtitulo="Tema das telas. Aplica na hora e vale para este navegador." />
        </div>
        <div className="p-5">
          <SeletorTema />
        </div>
      </section>

      {/* Alterar senha */}
      <section className={m.painel}>
        <div className={m.painelBarra}>
          <TituloSecao icone={Lock} titulo="Alterar senha" subtitulo="Mínimo de 6 caracteres." />
        </div>

        <form onSubmit={handleAlterarSenha} className="space-y-4 p-5">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Nova senha</label>
            <input
              type="password" value={novaSenha} onChange={e => setNovaSenha(e.target.value)} required
              placeholder="••••••••" minLength={6}
              className="w-full border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Confirmar nova senha</label>
            <input
              type="password" value={confirmarSenha} onChange={e => setConfirmarSenha(e.target.value)} required
              placeholder="••••••••" minLength={6}
              className="w-full border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {feedbackSenha && (
            <p className={`text-sm ${feedbackSenha.tipo === 'sucesso' ? 'text-green-400' : 'text-red-500'}`}>
              {feedbackSenha.tipo === 'sucesso' ? '✓' : '✗'} {feedbackSenha.msg}
            </p>
          )}

          <button
            type="submit" disabled={salvandoSenha}
            className={`${m.primaryButton} focus-ring`}
          >
            <Lock size={15} />
            {salvandoSenha ? 'Alterando...' : 'Alterar senha'}
          </button>
        </form>
      </section>
      </div>
    </div>
    </PaginaModulo>
  );
}
