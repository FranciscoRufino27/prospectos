'use client';

import { useState, useEffect, useCallback } from 'react';
import { Users, Check, Loader2, MessageCircle, Save, BellRing } from 'lucide-react';

// Distribuição comercial (handoff): quem participa do round-robin, o grupo do
// WhatsApp que recebe o aviso e para onde vai o aviso de "cliente respondeu".
// Dado real de /api/configuracoes/distribuicao-comercial (participantes) e
// /api/configuracoes/workspace (grupo, aviso). Só liga/desliga a participação
// — não mexe em leads já atribuídos.

interface Participante { usuarioId: string; nome: string; email: string | null; participa: boolean }

// '' = desligado (a config não guarda a chave).
type ModoAviso = '' | 'responsavel' | 'grupo' | 'ambos'
const lerModoAviso = (v: unknown): ModoAviso => (v === 'responsavel' || v === 'grupo' || v === 'ambos' ? v : '')

export default function DistribuicaoComercialPanel() {
  const [participantes, setParticipantes] = useState<Participante[] | null>(null);
  const [podeEditar, setPodeEditar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvandoId, setSalvandoId] = useState<string | null>(null);
  const [salvoId, setSalvoId] = useState<string | null>(null);
  // Chave-mestra do rodízio. Desligada por padrão: a distribuição passou a ser
  // pela carteira do lead. Enquanto estiver off, nenhum handoff nasce.
  const [rodizio, setRodizio] = useState(false);
  const [salvandoRodizio, setSalvandoRodizio] = useState(false);
  const [grupo, setGrupo] = useState('');
  const [grupoSalvo, setGrupoSalvo] = useState('');
  const [salvandoGrupo, setSalvandoGrupo] = useState(false);
  const [grupoOk, setGrupoOk] = useState(false);
  const [erroGrupo, setErroGrupo] = useState<string | null>(null);
  // Janela do check-in (minutos). Vazio = padrão do produto (7 dias).
  const [janela, setJanela] = useState('');
  const [janelaSalva, setJanelaSalva] = useState('');
  // Campanha de follow-up de retorno (Fase 4). Vazio = única ativa da org.
  const [campanhaRetorno, setCampanhaRetorno] = useState('');
  const [campanhaRetornoSalva, setCampanhaRetornoSalva] = useState('');
  const [avisoResposta, setAvisoResposta] = useState<ModoAviso>('');
  const [salvandoAviso, setSalvandoAviso] = useState(false);
  const [erroAviso, setErroAviso] = useState<string | null>(null);
  const [campanhasFollowup, setCampanhasFollowup] = useState<{ id: string; nome: string; status: string; dry_run: boolean }[]>([]);

  const carregar = useCallback(async () => {
    setErro(null);
    const [res, cfg, camps] = await Promise.all([
      fetch('/api/configuracoes/distribuicao-comercial'),
      fetch('/api/configuracoes/workspace').then((x) => (x.ok ? x.json() : null)).catch(() => null),
      fetch('/api/campanhas').then((x) => (x.ok ? x.json() : null)).catch(() => null),
    ]);
    const lista = Array.isArray(camps?.campanhas) ? camps.campanhas : [];
    setCampanhasFollowup(lista.filter((c: { tipo?: string }) => c.tipo === 'followup').map((c: { id: string; nome: string; status: string; dry_run: boolean }) => ({ id: c.id, nome: c.nome, status: c.status, dry_run: c.dry_run })));
    if (!res.ok) { setParticipantes([]); setErro('Não foi possível carregar a distribuição comercial.'); return; }
    const j = await res.json();
    setParticipantes(Array.isArray(j.participantes) ? j.participantes : []);
    setPodeEditar(!!j.podeEditar);
    setRodizio(cfg?.config?.comercial?.rodizioHandoff === true);
    const g = typeof cfg?.config?.comercial?.grupoWhatsappId === 'string' ? cfg.config.comercial.grupoWhatsappId : '';
    setGrupo(g); setGrupoSalvo(g);
    const jm = typeof cfg?.config?.comercial?.handoffRevisaoMinutos === 'number' ? String(cfg.config.comercial.handoffRevisaoMinutos) : '';
    setJanela(jm); setJanelaSalva(jm);
    const cr = typeof cfg?.config?.comercial?.campanhaRetornoId === 'string' ? cfg.config.comercial.campanhaRetornoId : '';
    setCampanhaRetorno(cr); setCampanhaRetornoSalva(cr);
    setAvisoResposta(lerModoAviso(cfg?.config?.comercial?.avisoResposta));
  }, []);

  async function salvarAvisoResposta(modo: ModoAviso) {
    if (salvandoAviso || !podeEditar || modo === avisoResposta) return;
    setSalvandoAviso(true); setErroAviso(null);
    try {
      const res = await fetch('/api/configuracoes/workspace', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comercialAvisoResposta: modo || null }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) { setErroAviso(j?.erro ?? 'Não foi possível salvar.'); return; }
      setAvisoResposta(lerModoAviso(j?.config?.comercial?.avisoResposta));
    } finally { setSalvandoAviso(false); }
  }

  useEffect(() => { carregar(); }, [carregar]);

  async function salvarGrupo() {
    if (salvandoGrupo || !podeEditar) return;
    setSalvandoGrupo(true); setErroGrupo(null); setGrupoOk(false);
    try {
      const res = await fetch('/api/configuracoes/workspace', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          comercialGrupoWhatsappId: grupo.trim(),
          comercialHandoffRevisaoMinutos: janela.trim() ? Number(janela) : null,
          comercialCampanhaRetornoId: campanhaRetorno || null,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        setErroGrupo(j?.erro ?? 'Não foi possível salvar.');
        return;
      }
      const j = await res.json();
      const g = typeof j?.config?.comercial?.grupoWhatsappId === 'string' ? j.config.comercial.grupoWhatsappId : '';
      setGrupo(g); setGrupoSalvo(g); setGrupoOk(true);
      const jm = typeof j?.config?.comercial?.handoffRevisaoMinutos === 'number' ? String(j.config.comercial.handoffRevisaoMinutos) : '';
      setJanela(jm); setJanelaSalva(jm);
      const cr = typeof j?.config?.comercial?.campanhaRetornoId === 'string' ? j.config.comercial.campanhaRetornoId : '';
      setCampanhaRetorno(cr); setCampanhaRetornoSalva(cr);
      setTimeout(() => setGrupoOk(false), 2500);
    } finally { setSalvandoGrupo(false); }
  }

  async function alternarRodizio() {
    if (salvandoRodizio || !podeEditar) return;
    setSalvandoRodizio(true); setErro(null);
    try {
      const res = await fetch('/api/configuracoes/workspace', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comercialRodizioHandoff: !rodizio }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        setErro(j?.erro ?? 'Não foi possível salvar.');
        return;
      }
      const j = await res.json();
      setRodizio(j?.config?.comercial?.rodizioHandoff === true);
    } finally { setSalvandoRodizio(false); }
  }

  async function alternar(p: Participante) {
    if (salvandoId || !podeEditar) return;
    setSalvandoId(p.usuarioId); setErro(null);
    try {
      const res = await fetch('/api/configuracoes/distribuicao-comercial', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuarioId: p.usuarioId, participa: !p.participa }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        setErro(j?.erro ?? 'Não foi possível salvar.');
        return;
      }
      const j = await res.json();
      setParticipantes(Array.isArray(j.participantes) ? j.participantes : null);
      setSalvoId(p.usuarioId);
      setTimeout(() => setSalvoId(null), 2000);
    } finally { setSalvandoId(null); }
  }

  const ativos = (participantes ?? []).filter((p) => p.participa).length;

  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-6 space-y-4 max-w-2xl">
      <div>
        <div className="font-semibold text-slate-100 inline-flex items-center gap-2">
          <Users size={16} className="text-indigo-300" /> Distribuição comercial
        </div>
        <p className="text-sm text-slate-400 mt-1">
          Quem participa do rodízio (round-robin) quando um lead vira oportunidade. Desmarcar alguém
          (férias, por exemplo) tira a pessoa dos próximos ciclos sem mexer nos leads que ela já tem.
        </p>
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-base)] p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-200">Rodízio automático</div>
            <p className="text-xs text-slate-500 mt-1">
              {rodizio
                ? 'Ligado: resposta positiva de prospecção é sorteada entre os participantes abaixo e avisada no grupo.'
                : 'Desligado: o retorno vai para o responsável do lead ou para o responsável da campanha. Nenhum handoff é criado e o grupo não é avisado.'}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={rodizio}
            onClick={alternarRodizio}
            disabled={!podeEditar || salvandoRodizio}
            className={`text-xs px-2.5 py-1 rounded-full border inline-flex items-center gap-1.5 shrink-0 transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              rodizio
                ? 'border-green-500/40 bg-green-500/15 text-green-300'
                : 'border-[var(--border)] text-slate-400 hover:text-slate-200'
            }`}
          >
            {salvandoRodizio ? <Loader2 size={12} className="animate-spin" /> : rodizio ? <Check size={12} /> : null}
            {rodizio ? 'Ligado' : 'Desligado'}
          </button>
        </div>
      </div>

      {!podeEditar && participantes && (
        <div className="text-xs text-amber-400">Somente leitura — requer a permissão workspace.configure para editar.</div>
      )}
      {erro && <div className="text-xs text-red-400">{erro}</div>}

      {participantes === null ? (
        <div className="text-sm text-slate-500 inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Carregando…</div>
      ) : participantes.length === 0 ? (
        <p className="text-sm text-slate-500">Nenhum comercial ativo nesta organização. Convide membros em Equipe.</p>
      ) : (
        <ul className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-lg">
          {participantes.map((p) => {
            const salvando = salvandoId === p.usuarioId;
            return (
              <li key={p.usuarioId} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <div className="text-sm text-slate-200 truncate">{p.nome || p.email || p.usuarioId}</div>
                  {p.email && <div className="text-xs text-slate-500 truncate">{p.email}</div>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {salvoId === p.usuarioId && !salvando && (
                    <span className="text-xs text-green-400 inline-flex items-center gap-1"><Check size={12} /> Salvo</span>
                  )}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={p.participa}
                    onClick={() => alternar(p)}
                    disabled={!podeEditar || !!salvandoId}
                    className={`text-xs px-2.5 py-1 rounded-full border inline-flex items-center gap-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                      p.participa
                        ? 'border-green-500/40 bg-green-500/15 text-green-300'
                        : 'border-[var(--border)] text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {salvando ? <Loader2 size={12} className="animate-spin" /> : p.participa ? <Check size={12} /> : null}
                    {p.participa ? 'Participa' : 'Não participa'}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {participantes && participantes.length > 0 && (
        <p className="text-xs text-slate-500">
          {!rodizio
            ? 'Rodízio desligado: esta lista fica guardada e só volta a valer se você religar acima.'
            : ativos === 0
              ? 'Ninguém participa: novos handoffs ficam "aguardando distribuição" até alguém ser marcado.'
              : `${ativos} de ${participantes.length} no rodízio. Ordem: alfabética por nome.`}
        </p>
      )}

      <div className="pt-4 border-t border-[var(--border)] space-y-2">
        <div className="text-sm font-semibold text-slate-200 inline-flex items-center gap-2">
          <MessageCircle size={14} className="text-green-400" /> Grupo de avisos comercial
        </div>
        <p className="text-xs text-slate-500">
          Grupo do WhatsApp (Z-API) que recebe o aviso quando um lead interessado é entregue a um comercial.
          Formato: <code className="text-slate-400">120363019502650977-group</code>. Sem grupo, o aviso fica pendente
          — o handoff não é afetado.
        </p>
        <div className="flex gap-2">
          <input
            className="flex-1 bg-[var(--bg-base)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
            value={grupo}
            onChange={(e) => setGrupo(e.target.value)}
            disabled={!podeEditar || salvandoGrupo}
            placeholder="identificador do grupo"
            spellCheck={false}
          />
          {podeEditar && (
            <button onClick={salvarGrupo} disabled={salvandoGrupo || (grupo.trim() === grupoSalvo && janela.trim() === janelaSalva && campanhaRetorno === campanhaRetornoSalva)}
              className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-500 disabled:opacity-40 inline-flex items-center gap-1 shrink-0">
              {salvandoGrupo ? <Loader2 size={14} className="animate-spin" /> : grupoOk ? <Check size={14} /> : <Save size={14} />}
              {grupoOk ? 'Salvo' : 'Salvar'}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 pt-1">
          <label className="text-xs text-slate-400 shrink-0">Check-in de acompanhamento após</label>
          <input
            className="w-24 bg-[var(--bg-base)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
            value={janela}
            onChange={(e) => setJanela(e.target.value.replace(/[^0-9]/g, ''))}
            disabled={!podeEditar || salvandoGrupo}
            inputMode="numeric"
            placeholder="10080"
          />
          <span className="text-xs text-slate-500">minutos (vazio = 7 dias). A ProspectOS pergunta o status no grupo uma vez por handoff.</span>
        </div>
        <div className="flex items-center gap-2 pt-1">
          <label className="text-xs text-slate-400 shrink-0">Voltar para follow-up usa a campanha</label>
          <select
            className="flex-1 bg-[var(--bg-base)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
            value={campanhaRetorno}
            onChange={(e) => setCampanhaRetorno(e.target.value)}
            disabled={!podeEditar || salvandoGrupo}
          >
            <option value="">(única campanha de follow-up ativa)</option>
            {campanhasFollowup.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome} · {c.status}{c.dry_run ? ' · ensaio' : ''}
              </option>
            ))}
          </select>
        </div>
        <p className="text-xs text-slate-500">
          Quando o grupo responde &quot;#CODIGO 2&quot;, o lead volta para o follow-up 1 desta campanha (precisa estar ativa e em envio real).
        </p>
        {erroGrupo && <div className="text-xs text-red-400">{erroGrupo}</div>}
      </div>

      <div className="pt-4 border-t border-[var(--border)] space-y-2">
        <div className="text-sm font-semibold text-slate-200 inline-flex items-center gap-2">
          <BellRing size={14} className="text-green-400" /> Aviso quando o cliente responde
        </div>
        <p className="text-xs text-slate-500">
          Qualquer resposta de cliente (e-mail ou WhatsApp) gera uma mensagem no WhatsApp da equipe, com o trecho da
          resposta e a leitura automática quando houver. No máximo um aviso por lead por minuto (mensagens seguidas viram um aviso só). Envio pela Z-API.
        </p>
        <div role="radiogroup" aria-label="Destino do aviso de resposta" className="flex flex-wrap gap-1.5">
          {OPCOES_AVISO.map((o) => (
            <button
              key={o.id || 'desligado'}
              type="button"
              role="radio"
              aria-checked={avisoResposta === o.id}
              onClick={() => salvarAvisoResposta(o.id)}
              disabled={!podeEditar || salvandoAviso}
              className={`text-xs px-2.5 py-1.5 rounded-lg border inline-flex items-center gap-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                avisoResposta === o.id
                  ? 'border-indigo-400 bg-indigo-500/15 text-indigo-200'
                  : 'border-[var(--border)] text-slate-400 hover:text-slate-200'
              }`}
            >
              {avisoResposta === o.id && <Check size={12} />}
              {o.label}
            </button>
          ))}
          {salvandoAviso && <Loader2 size={14} className="animate-spin text-slate-500 self-center" />}
        </div>
        <p className="text-xs text-slate-500">
          {avisoResposta === ''
            ? 'Desligado: ninguém é avisado no WhatsApp.'
            : [
                avisoResposta !== 'grupo' && 'O responsável recebe no número que cadastrou em Meu perfil > Avisos no WhatsApp (quem não cadastrou fica sem aviso).',
                avisoResposta !== 'responsavel' && (grupoSalvo
                  ? 'O grupo acima recebe, com menção ao responsável.'
                  : 'Configure o grupo acima para o aviso ao grupo sair.'),
                avisoResposta !== 'responsavel' && rodizio && 'Resposta positiva com rodízio já avisa o grupo pelo handoff — não duplica.',
              ].filter(Boolean).join(' ')}
        </p>
        {erroAviso && <div className="text-xs text-red-400">{erroAviso}</div>}
      </div>
    </div>
  );
}

const OPCOES_AVISO: { id: '' | 'responsavel' | 'grupo' | 'ambos'; label: string }[] = [
  { id: '', label: 'Desligado' },
  { id: 'responsavel', label: 'WhatsApp do responsável' },
  { id: 'grupo', label: 'Grupo comercial' },
  { id: 'ambos', label: 'Responsável e grupo' },
];
