'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, CheckCircle2, Loader2, Rocket, X } from 'lucide-react'
import type { ResultadoItem, ResumoImportacao, StatusImportacao } from '@/lib/prospeccao/importacaoServidor'

export interface ItemSelecionado {
  cnpj: string
  nome: string
  email: string | null
  contato_nome: string | null
  contato_cargo: string | null
  contato_linkedin: string | null
}

const ROTULO_STATUS: Record<StatusImportacao, string> = {
  importavel: 'Vão entrar',
  importado: 'Importados',
  ja_na_base: 'Já estão na base (CNPJ)',
  email_ja_existe: 'E-mail já existe na base',
  sem_email: 'Sem e-mail do decisor',
  fora_do_catalogo: 'Fora do catálogo',
  duplicado_no_lote: 'Repetidos na seleção',
}

// Importar: prévia (a mesma função do banco, sem gravar) → confirmação
// explícita com a contagem → resultado com atalho para iniciar a prospecção
// no wizard de campanha (que mantém as travas de publicação e dry_run).
export default function ImportarProspeccaoModal({
  itens: itensRecebidos,
  onFechar,
  onImportado,
}: {
  itens: ItemSelecionado[]
  onFechar: () => void
  onImportado: (cnpjs: string[]) => void
}) {
  // A lista é fixada ao abrir: importar limpa a seleção da página, e o modal
  // não pode passar a descrever "0 empresas" no resultado.
  const [itens] = useState(itensRecebidos)
  const [segmento, setSegmento] = useState('')
  const [previa, setPrevia] = useState<ResumoImportacao | null>(null)
  const [resultado, setResultado] = useState<{ resumo: ResumoImportacao; resultados: ResultadoItem[] } | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  // Mudou o segmento: a prévia anterior deixa de valer para o que será gravado.
  useEffect(() => setPrevia(null), [segmento])

  async function chamar(modo: 'previa' | 'confirmar') {
    setCarregando(true)
    setErro(null)
    try {
      const res = await fetch('/api/prospeccao/importar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modo,
          segmento: segmento.trim() || null,
          itens: itens.map(({ cnpj, email, contato_nome, contato_cargo, contato_linkedin }) => ({ cnpj, email, contato_nome, contato_cargo, contato_linkedin })),
        }),
      })
      const corpo = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(corpo?.erro || 'Falha na importação')
      if (modo === 'previa') setPrevia(corpo.resumo)
      else {
        setResultado({ resumo: corpo.resumo, resultados: corpo.resultados ?? [] })
        onImportado((corpo.resultados ?? []).filter((r: ResultadoItem) => r.status === 'importado').map((r: ResultadoItem) => r.cnpj))
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro')
    } finally {
      setCarregando(false)
    }
  }

  const leadIds = resultado?.resultados.filter((r) => r.status === 'importado' && r.lead_id).map((r) => r.lead_id as string) ?? []
  const vaoEntrar = previa?.importavel ?? 0

  const linhasResumo = (resumo: ResumoImportacao) =>
    (Object.keys(ROTULO_STATUS) as StatusImportacao[])
      .filter((s) => resumo[s] > 0)
      .map((s) => (
        <li key={s} className="flex justify-between text-sm">
          <span className={s === 'importavel' || s === 'importado' ? 'text-emerald-300' : 'text-slate-400'}>{ROTULO_STATUS[s]}</span>
          <span className="tabular-nums text-slate-200">{resumo[s]}</span>
        </li>
      ))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Importar empresas">
      <div className="w-full max-w-lg rounded-xl border border-[var(--border)] bg-[var(--bg-base)] p-5 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">Importar {itens.length} empresa{itens.length === 1 ? '' : 's'}</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Entram em Novos Leads, fora do motor. Nenhuma mensagem é enviada ao importar.
            </p>
          </div>
          <button onClick={onFechar} aria-label="Fechar" className="text-slate-500 hover:text-slate-200 focus-ring rounded"><X size={18} /></button>
        </div>

        {!resultado && (
          <>
            <label className="block space-y-1">
              <span className="text-sm text-slate-300">Segmento (nicho)</span>
              <input
                value={segmento}
                onChange={(e) => setSegmento(e.target.value)}
                placeholder="Ex.: hotelaria"
                className="w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-slate-200 focus-ring"
              />
              {!segmento.trim() && (
                <span className="flex items-center gap-1 text-xs text-amber-400">
                  <AlertTriangle size={12} /> Sem segmento o motor não escolhe template e o lead fica parado.
                </span>
              )}
            </label>

            {previa && <ul className="space-y-1 rounded-lg border border-[var(--border)] p-3">{linhasResumo(previa)}</ul>}
            {erro && <p className="text-sm text-red-400">{erro}</p>}

            <div className="flex justify-end gap-2">
              <button
                onClick={() => chamar('previa')}
                disabled={carregando}
                className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50 focus-ring"
              >
                {carregando && !previa && <Loader2 size={14} className="animate-spin" />} {previa ? 'Refazer prévia' : 'Ver prévia'}
              </button>
              <button
                onClick={() => chamar('confirmar')}
                disabled={carregando || !previa || vaoEntrar === 0}
                title={!previa ? 'Veja a prévia antes de confirmar' : undefined}
                className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed focus-ring"
              >
                {carregando && previa && <Loader2 size={14} className="animate-spin" />}
                Confirmar importação{previa ? ` (${vaoEntrar})` : ''}
              </button>
            </div>
          </>
        )}

        {resultado && (
          <>
            <p className="flex items-center gap-2 text-sm text-emerald-300">
              <CheckCircle2 size={16} /> Importação concluída.
            </p>
            <ul className="space-y-1 rounded-lg border border-[var(--border)] p-3">{linhasResumo(resultado.resumo)}</ul>
            <div className="flex justify-end gap-2">
              <Link href="/base-leads" className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-slate-300 hover:bg-white/5 focus-ring">
                Ver na Base de Leads
              </Link>
              {leadIds.length > 0 && (
                <Link
                  href={`/campanhas/nova?tipo=prospeccao&leads=${encodeURIComponent(leadIds.join(','))}`}
                  className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 focus-ring"
                >
                  <Rocket size={14} /> Iniciar prospecção ({leadIds.length})
                </Link>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
