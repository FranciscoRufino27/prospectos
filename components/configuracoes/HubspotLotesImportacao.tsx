'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, Check, Upload } from 'lucide-react'

// Lotes preparados na Central de Importação HubSpot e a importação de cada
// um. "Simular" só conta (nada é gravado); "Importar" exige simular antes e
// confirmar. Leads entram com o comercial mapeado como responsável, sem nicho
// e fora da cadência automática (owner n8n).

interface Lote {
  id: string
  status: string
  nichoEsperado: string
  totalItens: number
  criadoEm: string
}

interface Resumo {
  simulado: boolean
  empresasTotal: number
  empresasComLead: number
  leads: number
  jaEramLead: number
  semContatoNovo: number
  jaImportadas: number
  cnpjJaNaBase: number
  semResponsavel: number
  clientes: number
  naoEncontradas: number
  responsaveis: Array<{ nome: string; leads: number }>
}

const ERROS: Record<string, string> = {
  lote_nao_encontrado: 'Lote não encontrado.',
  lote_ja_importado: 'Este lote já foi importado.',
  nao_conectado: 'HubSpot não conectado.',
  erro_refresh: 'Não foi possível renovar o acesso ao HubSpot. Reconecte a integração.',
  app_nao_configurado: 'A integração HubSpot não está configurada no servidor.',
  erro_hubspot: 'O HubSpot não respondeu à leitura das empresas do lote.',
  erro_banco: 'Não foi possível concluir no banco. Nada foi importado.',
}
const msgErro = (c: string) => ERROS[c] ?? `Não foi possível concluir (${c}).`

function linhasDoResumo(r: Resumo): string[] {
  const n = (v: number) => v.toLocaleString('pt-BR')
  return [
    r.jaEramLead ? `${n(r.jaEramLead)} contato(s) já eram lead e ficaram como estão` : null,
    r.semContatoNovo ? `${n(r.semContatoNovo)} empresa(s) sem contato novo com e-mail da empresa` : null,
    r.jaImportadas ? `${n(r.jaImportadas)} empresa(s) já importada(s) antes` : null,
    r.cnpjJaNaBase ? `${n(r.cnpjJaNaBase)} empresa(s) com CNPJ já cadastrado` : null,
    r.semResponsavel ? `${n(r.semResponsavel)} empresa(s) sem comercial mapeado` : null,
    r.clientes ? `${n(r.clientes)} cliente(s) ficam para a importação de novidades` : null,
    r.naoEncontradas ? `${n(r.naoEncontradas)} empresa(s) não encontrada(s) no HubSpot` : null,
  ].filter((l): l is string => !!l)
}

export default function HubspotLotesImportacao({ versao, onImportado }: { versao: number; onImportado: () => void }) {
  const [lotes, setLotes] = useState<Lote[] | null>(null)
  const [erroLista, setErroLista] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null) // id do lote em operação
  const [simulacao, setSimulacao] = useState<{ loteId: string; resumo: Resumo } | null>(null)
  const [confirmando, setConfirmando] = useState<string | null>(null)
  const [resultado, setResultado] = useState<{ loteId: string; resumo: Resumo } | null>(null)
  const [erro, setErro] = useState<{ loteId: string; texto: string } | null>(null)
  const [recarga, setRecarga] = useState(0)

  useEffect(() => {
    let vivo = true
    fetch('/api/integracoes/hubspot/importacoes')
      .then(async (r) => {
        const d = await r.json().catch(() => null)
        if (!vivo) return
        if (!r.ok) { setErroLista(msgErro(d?.erro ?? `HTTP ${r.status}`)); return }
        setErroLista(null)
        setLotes(d.lotes)
      })
      .catch(() => { if (vivo) setErroLista('Falha ao carregar os lotes.') })
    return () => { vivo = false }
  }, [versao, recarga])

  async function executar(loteId: string, simular: boolean) {
    setOcupado(loteId)
    setErro(null)
    if (simular) { setSimulacao(null); setResultado(null) }
    try {
      const r = await fetch(`/api/integracoes/hubspot/importacoes/${loteId}/importar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ simular }),
      })
      const d = await r.json().catch(() => null)
      if (!r.ok) throw new Error(msgErro(d?.erro ?? `HTTP ${r.status}`))
      if (simular) {
        setSimulacao({ loteId, resumo: d.resumo })
      } else {
        setSimulacao(null)
        setConfirmando(null)
        setResultado({ loteId, resumo: d.resumo })
        setRecarga((v) => v + 1)
        onImportado()
      }
    } catch (e) {
      setErro({ loteId, texto: e instanceof Error ? e.message : 'Falha na importação.' })
    } finally {
      setOcupado(null)
    }
  }

  if (erroLista) {
    return <p className="text-xs text-red-300 flex items-center gap-1.5"><AlertCircle size={12} /> {erroLista}</p>
  }
  if (!lotes || lotes.length === 0) return null

  return (
    <div className="rounded-lg border border-[var(--border)] p-4 space-y-3">
      <div>
        <p className="text-sm font-medium text-slate-200 flex items-center gap-1.5"><Upload size={14} /> Lotes preparados</p>
        <p className="text-xs text-slate-500">
          Importar cria a empresa e um lead por contato com e-mail da empresa, com o comercial mapeado como responsável e sem nicho.
          Os leads não entram na cadência automática; contatos que já são lead ficam como estão. Simule antes para ver os números.
        </p>
      </div>

      <ul className="space-y-2">
        {lotes.map((l) => {
          const sim = simulacao?.loteId === l.id ? simulacao.resumo : null
          const feito = resultado?.loteId === l.id ? resultado.resumo : null
          const importado = l.status === 'importado'
          return (
            <li key={l.id} className="rounded-lg border border-[var(--border)]/70 px-3 py-2 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm text-slate-200">
                  {l.totalItens.toLocaleString('pt-BR')} empresa(s)
                  <span className="text-xs text-slate-500"> · preparado em {new Date(l.criadoEm).toLocaleString('pt-BR')}</span>
                  <span className={`ml-2 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${importado ? 'bg-emerald-500/15 text-emerald-300' : 'bg-indigo-500/15 text-indigo-300'}`}>
                    {importado ? 'Importado' : 'Preparado'}
                  </span>
                </div>
                {!importado && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => executar(l.id, true)}
                      disabled={ocupado !== null}
                      className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-slate-200 hover:bg-white/5 disabled:opacity-50 focus-ring"
                    >
                      {ocupado === l.id && !confirmando ? 'Simulando…' : 'Simular importação'}
                    </button>
                    <button
                      onClick={() => setConfirmando(l.id)}
                      disabled={ocupado !== null || !sim || sim.leads === 0}
                      title={!sim ? 'Simule antes de importar' : undefined}
                      className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50 focus-ring"
                    >
                      {sim ? `Importar ${sim.leads.toLocaleString('pt-BR')} lead(s)` : 'Importar'}
                    </button>
                  </div>
                )}
              </div>

              {sim && !feito && (
                <div className="text-xs text-slate-300 space-y-1">
                  <p>
                    Simulação (nada foi gravado): {sim.leads.toLocaleString('pt-BR')} lead(s) em {sim.empresasComLead.toLocaleString('pt-BR')} empresa(s)
                    {sim.responsaveis.length ? ` — ${sim.responsaveis.map((r) => `${r.nome}: ${r.leads}`).join(' · ')}` : ''}.
                  </p>
                  {linhasDoResumo(sim).map((t) => <p key={t} className="text-slate-500">• {t}</p>)}
                </div>
              )}

              {confirmando === l.id && sim && (
                <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-3 space-y-2">
                  <p className="text-sm text-slate-200">
                    Criar {sim.leads.toLocaleString('pt-BR')} lead(s) em {sim.empresasComLead.toLocaleString('pt-BR')} empresa(s)?
                  </p>
                  <p className="text-xs text-slate-400">Os leads entram em “Novos leads”, sem nicho e sem disparar cadência. Esta ação não altera nada no HubSpot.</p>
                  <div className="flex gap-2">
                    <button onClick={() => executar(l.id, false)} disabled={ocupado !== null} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50 focus-ring">
                      {ocupado === l.id ? 'Importando…' : 'Confirmar importação'}
                    </button>
                    <button onClick={() => setConfirmando(null)} disabled={ocupado !== null} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-slate-300 hover:bg-white/5 focus-ring">
                      Cancelar
                    </button>
                  </div>
                </div>
              )}

              {feito && (
                <div className="text-xs text-emerald-300 space-y-1">
                  <p className="flex items-center gap-1.5">
                    <Check size={12} /> {feito.leads.toLocaleString('pt-BR')} lead(s) criados em {feito.empresasComLead.toLocaleString('pt-BR')} empresa(s)
                    {feito.responsaveis.length ? ` — ${feito.responsaveis.map((r) => `${r.nome}: ${r.leads}`).join(' · ')}` : ''}.
                  </p>
                  {linhasDoResumo(feito).map((t) => <p key={t} className="text-slate-500">• {t}</p>)}
                </div>
              )}

              {erro?.loteId === l.id && (
                <p className="text-xs text-red-300 flex items-center gap-1.5"><AlertCircle size={12} /> {erro.texto}</p>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
