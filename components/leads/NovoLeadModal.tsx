'use client'

import { useEffect, useState } from 'react'
import { X, Loader2, UserPlus, AlertTriangle } from 'lucide-react'
import { ORIGENS, ORIGEM_OUTRO } from '@/lib/leads/origens'
import { normalizarNicho } from '@/lib/nichos/normalizar'
import { getSegmentosConhecidos, type SegmentoConhecido } from '@/lib/api'

// Modal de cadastro MANUAL de 1 lead (2.3). Os 5 obrigatórios (nome, e-mail,
// empresa, origem, segmento) + opcionais. O responsável é definido no server
// (usuário logado) — aqui não há seletor. Ao salvar, chama onCreated e fecha.
//
// Segmento é obrigatório porque é ele que escolhe o template do primeiro
// contato: a importação por planilha já recusa linha sem segmento, e um lead
// manual sem ele nasceria sem conseguir ser abordado pelo motor. As opções são
// os segmentos que a organização já usa; "Outro" aceita um novo. Quando o
// segmento escolhido não tem mensagem de primeiro contato, o formulário avisa —
// o lead é criado, mas o motor não vai abordá-lo até o template existir.

const SEGMENTO_OUTRO = '__outro__'

function rotuloSegmento(nicho: string): string {
  const texto = nicho.replace(/_/g, ' ')
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}
const inputCls =
  'w-full bg-[var(--t-bg-base,#0f1117)] border border-[var(--t-border,#2a3147)] rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500/50'
const labelCls = 'block text-sm text-slate-400 mb-1.5'

export default function NovoLeadModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: () => void
}) {
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [empresa, setEmpresa] = useState('')
  const [origem, setOrigem] = useState<string>('')
  const [origemOutro, setOrigemOutro] = useState('')
  const [segmento, setSegmento] = useState('')
  const [segmentoOutro, setSegmentoOutro] = useState('')
  const [segmentos, setSegmentos] = useState<SegmentoConhecido[]>([])
  // Só avaliamos "não tem template" depois de uma leitura bem-sucedida: falhar
  // na busca não pode virar um aviso falso de que falta template.
  const [segmentosCarregados, setSegmentosCarregados] = useState(false)
  const [telefone, setTelefone] = useState('')
  const [cargo, setCargo] = useState('')
  const [cidade, setCidade] = useState('')
  const [estado, setEstado] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  // Falha em silêncio de propósito: sem a lista resta a opção "Outro", que é
  // texto livre, e o cadastro continua possível — não vale travar o formulário
  // por causa da sugestão.
  useEffect(() => {
    let ativo = true
    getSegmentosConhecidos()
      .then((lista) => { if (!ativo) return; setSegmentos(lista); setSegmentosCarregados(true) })
      .catch(() => {})
    return () => { ativo = false }
  }, [])

  const origemFinal = origem === ORIGEM_OUTRO ? origemOutro.trim() || ORIGEM_OUTRO : origem
  const segmentoFinal = normalizarNicho(segmento === SEGMENTO_OUTRO ? segmentoOutro : segmento)
  const semTemplate = !!segmentoFinal
    && segmentosCarregados
    && !segmentos.some((s) => s.nicho === segmentoFinal && s.temTemplate)
  const valido = nome.trim() && email.trim() && empresa.trim() && origem && !!segmentoFinal

  async function salvar() {
    if (!valido || salvando) return
    setSalvando(true)
    setErro(null)
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: nome.trim(),
          email: email.trim(),
          empresa: empresa.trim(),
          origem: origemFinal,
          segmento: segmentoFinal,
          telefone: telefone.trim() || undefined,
          cargo: cargo.trim() || undefined,
          cidade: cidade.trim() || undefined,
          estado: estado.trim() || undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErro([data.erro, data.detalhe].filter(Boolean).join(' — ') || 'Não foi possível criar o lead.')
        return
      }
      onCreated()
      onClose()
    } catch {
      setErro('Erro de conexão. Tente novamente.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={() => !salvando && onClose()}
    >
      <div
        className="bg-[var(--t-bg-card,#1a1f2e)] rounded-2xl shadow-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Novo lead"
      >
        <div className="flex items-start justify-between mb-4">
          <h3 className="font-bold text-lg text-slate-100 flex items-center gap-2">
            <UserPlus size={18} className="text-indigo-400" /> Novo lead
          </h3>
          <button onClick={() => !salvando && onClose()} className="text-slate-500 hover:text-slate-300">
            <X size={20} />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className={labelCls}>Nome <span className="text-rose-400">*</span></label>
            <input autoFocus value={nome} onChange={(e) => setNome(e.target.value)} className={inputCls} placeholder="Nome do contato" />
          </div>
          <div>
            <label className={labelCls}>E-mail <span className="text-rose-400">*</span></label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} placeholder="contato@empresa.com" type="email" />
          </div>
          <div>
            <label className={labelCls}>Empresa <span className="text-rose-400">*</span></label>
            <input value={empresa} onChange={(e) => setEmpresa(e.target.value)} className={inputCls} placeholder="Nome da empresa" />
          </div>
          <div>
            <label className={labelCls}>Origem <span className="text-rose-400">*</span></label>
            <select value={origem} onChange={(e) => setOrigem(e.target.value)} className={inputCls}>
              <option value="">Selecione…</option>
              {ORIGENS.map((o) => (<option key={o} value={o}>{o}</option>))}
            </select>
          </div>
          {origem === ORIGEM_OUTRO && (
            <div>
              <label className={labelCls}>Qual origem?</label>
              <input value={origemOutro} onChange={(e) => setOrigemOutro(e.target.value)} className={inputCls} placeholder="Descreva a origem" />
            </div>
          )}
          <div>
            <label className={labelCls}>Segmento <span className="text-rose-400">*</span></label>
            <select value={segmento} onChange={(e) => setSegmento(e.target.value)} className={inputCls}>
              <option value="">Selecione…</option>
              {segmentos.map((s) => (
                <option key={s.nicho} value={s.nicho}>
                  {rotuloSegmento(s.nicho)}{s.temTemplate ? '' : ' — sem mensagem'}
                </option>
              ))}
              <option value={SEGMENTO_OUTRO}>Outro…</option>
            </select>
          </div>
          {segmento === SEGMENTO_OUTRO && (
            <div>
              <label className={labelCls}>Qual segmento?</label>
              <input value={segmentoOutro} onChange={(e) => setSegmentoOutro(e.target.value)} className={inputCls} placeholder="Ex.: buffet infantil" />
            </div>
          )}
          {semTemplate && (
            <div className="sm:col-span-2 flex items-start gap-2 text-xs text-amber-300/90 bg-amber-500/10 border border-amber-500/25 rounded-lg p-2.5">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" />
              <span>
                Ainda não existe mensagem de primeiro contato para <b>{rotuloSegmento(segmentoFinal!)}</b>. O lead é criado
                normalmente, mas o motor não vai abordá-lo até você criar esse template.
              </span>
            </div>
          )}
          <div>
            <label className={labelCls}>Telefone</label>
            <input value={telefone} onChange={(e) => setTelefone(e.target.value)} className={inputCls} placeholder="(opcional)" />
          </div>
          <div>
            <label className={labelCls}>Cargo</label>
            <input value={cargo} onChange={(e) => setCargo(e.target.value)} className={inputCls} placeholder="(opcional)" />
          </div>
          <div>
            <label className={labelCls}>Cidade</label>
            <input value={cidade} onChange={(e) => setCidade(e.target.value)} className={inputCls} placeholder="(opcional)" />
          </div>
          <div>
            <label className={labelCls}>Estado (UF)</label>
            <input value={estado} onChange={(e) => setEstado(e.target.value)} className={inputCls} placeholder="(opcional)" maxLength={2} />
          </div>
        </div>

        {erro && <p className="text-sm text-rose-400 mt-4">{erro}</p>}

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} disabled={salvando} className="text-sm px-4 py-2 rounded-lg text-slate-300 hover:bg-[var(--t-bg-base,#0f1117)]">Cancelar</button>
          <button
            onClick={salvar}
            disabled={!valido || salvando}
            className="text-sm px-4 py-2 rounded-lg text-white font-medium flex items-center gap-2 disabled:opacity-50"
            style={{ backgroundColor: '#1e3a5f' }}
          >
            {salvando && <Loader2 size={14} className="animate-spin" />} Criar lead
          </button>
        </div>
      </div>
    </div>
  )
}
