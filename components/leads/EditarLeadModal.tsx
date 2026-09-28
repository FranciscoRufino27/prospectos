'use client'

import { useState, type ChangeEvent, type FormEvent } from 'react'
import { Loader2, PencilLine, X } from 'lucide-react'
import type { Lead } from '@/lib/supabase'
import { ORIGENS } from '@/lib/leads/origens'
import { CANAIS_PREFERENCIAIS } from '@/lib/leads/edicao'

const inputCls = 'w-full rounded-lg border border-[var(--t-border,#2a3147)] bg-[var(--t-bg-base,#0f1117)] px-3 py-2 text-sm text-slate-200 focus:border-indigo-500 focus:outline-none disabled:opacity-60'
const labelCls = 'mb-1.5 block text-xs font-medium text-slate-400'

type Formulario = {
  contato_nome: string
  contato_email: string
  contato_telefone: string
  contato_cargo: string
  canal_preferencial: string
  empresa: string
  segmento: string
  site: string
  cidade: string
  estado: string
  faixa_funcionarios: string
  origem: string
  data_validade: string
}

function formularioDoLead(lead: Lead): Formulario {
  return {
    contato_nome: lead.contato_nome ?? '',
    contato_email: lead.contato_email ?? '',
    contato_telefone: lead.contato_telefone ?? '',
    contato_cargo: lead.contato_cargo ?? '',
    canal_preferencial: lead.canal_preferencial ?? 'email',
    empresa: lead.empresa ?? '',
    segmento: lead.segmento ?? '',
    site: lead.site ?? '',
    cidade: lead.cidade ?? '',
    estado: lead.estado ?? '',
    faixa_funcionarios: lead.faixa_funcionarios ?? '',
    origem: lead.origem ?? '',
    data_validade: lead.data_validade?.slice(0, 10) ?? '',
  }
}

export default function EditarLeadModal({
  lead,
  onClose,
  onSaved,
}: {
  lead: Lead
  onClose: () => void
  onSaved: (lead: Lead) => void
}) {
  const inicial = formularioDoLead(lead)
  const [form, setForm] = useState<Formulario>(inicial)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const valido = !!form.contato_nome.trim() && !!form.contato_email.trim() && !!form.empresa.trim() && !!form.origem.trim()
  const alterado = JSON.stringify(form) !== JSON.stringify(inicial)
  const campo = (chave: keyof Formulario) => ({
    value: form[chave],
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const valor = event.currentTarget.value
      setForm((atual) => ({ ...atual, [chave]: valor }))
      setErro(null)
    },
  })

  async function salvar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!valido || !alterado || salvando) return
    setSalvando(true)
    setErro(null)
    try {
      const res = await fetch(`/api/leads/${lead.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.lead) {
        setErro(data.erro || 'Não foi possível atualizar o lead.')
        return
      }
      onSaved(data.lead as Lead)
      onClose()
    } catch {
      setErro('Erro de conexão. Tente novamente.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4" onClick={() => !salvando && onClose()}>
      <form
        onSubmit={salvar}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[var(--t-border,#2a3147)] bg-[var(--t-bg-card,#1a1f2e)] shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="editar-lead-titulo"
      >
        <div className="flex items-start justify-between border-b border-[var(--t-border,#2a3147)] px-6 py-5">
          <div>
            <h2 id="editar-lead-titulo" className="flex items-center gap-2 text-lg font-bold text-slate-100">
              <PencilLine size={18} className="text-indigo-400" /> Editar informações do lead
            </h2>
            <p className="mt-1 text-xs text-slate-500">Dados cadastrais do contato e da empresa. Estágio, responsável, score e automação não são alterados.</p>
          </div>
          <button type="button" onClick={onClose} disabled={salvando} className="text-slate-500 hover:text-slate-300 disabled:opacity-50" aria-label="Fechar edição">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          <fieldset>
            <legend className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Contato</legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={labelCls}>Nome <span className="text-rose-400">*</span></label>
                <input {...campo('contato_nome')} className={inputCls} required autoFocus maxLength={200} aria-label="Nome do contato" />
              </div>
              <div>
                <label className={labelCls}>E-mail <span className="text-rose-400">*</span></label>
                <input {...campo('contato_email')} className={inputCls} required type="email" maxLength={320} aria-label="E-mail do contato" />
              </div>
              <div>
                <label className={labelCls}>Telefone</label>
                <input {...campo('contato_telefone')} className={inputCls} maxLength={32} placeholder="Opcional" aria-label="Telefone do contato" />
              </div>
              <div>
                <label className={labelCls}>Cargo</label>
                <input {...campo('contato_cargo')} className={inputCls} maxLength={160} placeholder="Opcional" aria-label="Cargo do contato" />
              </div>
              <div>
                <label className={labelCls}>Canal preferencial</label>
                <select {...campo('canal_preferencial')} className={inputCls} aria-label="Canal preferencial">
                  {CANAIS_PREFERENCIAIS.map((canal) => <option key={canal} value={canal} className="capitalize">{canal === 'whatsapp' ? 'WhatsApp' : canal[0].toUpperCase() + canal.slice(1)}</option>)}
                </select>
              </div>
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Empresa</legend>
            <p className="mb-3 text-xs text-slate-500">Informações compartilhadas da empresa também serão refletidas nos outros contatos vinculados a ela.</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className={labelCls}>Empresa <span className="text-rose-400">*</span></label>
                <input {...campo('empresa')} className={inputCls} required maxLength={240} aria-label="Empresa" />
              </div>
              <div>
                <label className={labelCls}>Nicho / segmento</label>
                <input {...campo('segmento')} className={inputCls} maxLength={160} placeholder="Opcional" aria-label="Nicho ou segmento" />
              </div>
              <div>
                <label className={labelCls}>Site</label>
                <input {...campo('site')} className={inputCls} maxLength={500} placeholder="empresa.com.br" aria-label="Site da empresa" />
              </div>
              <div>
                <label className={labelCls}>Cidade</label>
                <input {...campo('cidade')} className={inputCls} maxLength={120} placeholder="Opcional" aria-label="Cidade" />
              </div>
              <div>
                <label className={labelCls}>Estado / UF</label>
                <input {...campo('estado')} className={inputCls} maxLength={80} placeholder="Ex.: SP" aria-label="Estado ou UF" />
              </div>
              <div>
                <label className={labelCls}>Faixa de funcionários</label>
                <input {...campo('faixa_funcionarios')} className={inputCls} maxLength={80} placeholder="Ex.: 11–50" aria-label="Faixa de funcionários" />
              </div>
              <div>
                <label className={labelCls}>Origem <span className="text-rose-400">*</span></label>
                <input {...campo('origem')} className={inputCls} required maxLength={160} list="origens-edicao-lead" aria-label="Origem do lead" />
                <datalist id="origens-edicao-lead">{ORIGENS.map((origem) => <option key={origem} value={origem} />)}</datalist>
              </div>
              <div>
                <label className={labelCls}>Validade do laudo</label>
                <input
                  {...campo('data_validade')}
                  onInput={(event) => {
                    const valor = event.currentTarget.value
                    setForm((atual) => ({ ...atual, data_validade: valor }))
                    setErro(null)
                  }}
                  className={inputCls}
                  type="date"
                  aria-label="Validade do laudo"
                />
              </div>
            </div>
          </fieldset>

          {erro && <p className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-300" role="alert">{erro}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--t-border,#2a3147)] bg-[var(--t-bg-base,#0f1117)] px-6 py-4">
          {!alterado && <span className="mr-auto self-center text-xs text-slate-500">Altere ao menos um campo para salvar.</span>}
          <button type="button" onClick={onClose} disabled={salvando} className="rounded-lg px-4 py-2 text-sm text-slate-300 hover:bg-[var(--t-bg-card,#1a1f2e)] disabled:opacity-50">Cancelar</button>
          <button type="submit" disabled={!valido || !alterado || salvando} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50">
            {salvando && <Loader2 size={14} className="animate-spin" />} {salvando ? 'Salvando...' : 'Salvar alterações'}
          </button>
        </div>
      </form>
    </div>
  )
}
