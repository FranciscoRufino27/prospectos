'use client';

import { useEffect, useState } from 'react';
import { BellRing, Check, Info, Save } from 'lucide-react';
import { estilosModulo as m, TituloSecao } from '@/components/tema/Modulo';

// Número de WhatsApp em que o usuário recebe "cliente respondeu" dos leads
// dele (/api/perfil/avisos). Só vale se a organização mandar avisos ao
// responsável (Configurações > Distribuição).
export default function AvisosWhatsapp() {
  const [carregado, setCarregado] = useState(false);
  const [indisponivel, setIndisponivel] = useState<string | null>(null);
  const [whatsapp, setWhatsapp] = useState('');
  const [ativo, setAtivo] = useState(false);
  const [orgAvisa, setOrgAvisa] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [feedback, setFeedback] = useState<{ tipo: 'sucesso' | 'erro'; msg: string } | null>(null);

  useEffect(() => {
    fetch('/api/perfil/avisos')
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!r.ok) { setIndisponivel(j?.erro ?? 'Não foi possível carregar.'); return; }
        setWhatsapp(j.whatsapp ?? '');
        setAtivo(j.ativo === true);
        setOrgAvisa(j.organizacaoAvisaResponsavel === true);
      })
      .catch(() => setIndisponivel('Não foi possível carregar.'))
      .finally(() => setCarregado(true));
  }, []);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setSalvando(true); setFeedback(null);
    try {
      const r = await fetch('/api/perfil/avisos', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ whatsapp, ativo }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) { setFeedback({ tipo: 'erro', msg: j?.erro ?? 'Não foi possível salvar.' }); return; }
      setWhatsapp(j.whatsapp ?? '');
      setAtivo(j.ativo === true);
      setFeedback({ tipo: 'sucesso', msg: 'Avisos salvos.' });
    } finally { setSalvando(false); }
  }

  return (
    <section className={m.painel}>
      <div className={m.painelBarra}>
        <TituloSecao icone={BellRing} titulo="Avisos no WhatsApp" subtitulo="Receba uma mensagem quando um cliente seu responder." />
      </div>
      {!carregado ? (
        <p className="p-5 text-sm text-slate-500">Carregando…</p>
      ) : indisponivel ? (
        <p className="p-5 text-sm text-slate-400">{indisponivel}</p>
      ) : (
        <form onSubmit={salvar} className="space-y-4 p-5">
          {!orgAvisa && (
            <p className="flex items-start gap-2 rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs text-amber-300">
              <Info size={13} className="mt-0.5 shrink-0" />
              Sua organização ainda não envia avisos ao responsável. Você pode deixar o número pronto; ele passa a ser usado quando um administrador ligar em Configurações.
            </p>
          )}
          <div>
            <label htmlFor="whatsapp-avisos" className="mb-1 block text-sm font-medium text-slate-300">WhatsApp para avisos</label>
            <input
              id="whatsapp-avisos" type="tel" inputMode="tel" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)}
              placeholder="(11) 99999-8888"
              className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <p className="mt-1 text-xs text-slate-500">Com DDD. Número de outro país: comece com o código do país.</p>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} className="h-4 w-4" />
            Receber avisos neste número
          </label>
          {feedback && (
            <p className={`text-sm ${feedback.tipo === 'sucesso' ? 'text-green-400' : 'text-red-500'}`}>
              {feedback.tipo === 'sucesso' ? <Check size={13} className="mr-1 inline" /> : '✗ '}{feedback.msg}
            </p>
          )}
          <button type="submit" disabled={salvando} className={`${m.primaryButton} focus-ring`}>
            <Save size={15} /> {salvando ? 'Salvando…' : 'Salvar avisos'}
          </button>
        </form>
      )}
    </section>
  );
}
