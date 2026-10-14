'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, Check, Coins, Loader2, Save } from 'lucide-react'

// Prospecção e enriquecimento: travas de custo da organização da sessão —
// liga/desliga do enriquecimento pago e orçamento mensal (créditos) por fonte,
// com o uso do mês. Leitura em /api/configuracoes/enriquecimento; gravação na
// rota de configurações (workspace.configure). Chaves das APIs não aparecem.

type Fonte = 'crustdata' | 'anymail'

interface ConsumoFonte {
  fonte: Fonte
  orcamento: number | null
  usado: number | null
}

interface Resposta {
  ativo: boolean
  mes: string
  fontes: ConsumoFonte[]
  podeEditar: boolean
}

const FONTES: Fonte[] = ['crustdata', 'anymail']
const DESCRICAO: Record<Fonte, { nome: string; uso: string }> = {
  crustdata: { nome: 'Crustdata', uso: 'Procura o decisor quando a Receita não resolve. Cobra por pessoa encontrada.' },
  anymail: { nome: 'AnymailFinder', uso: 'Procura o e-mail do decisor. Cobra por e-mail encontrado.' },
}
const MAXIMO = 100_000

const fmt = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
const mesLegivel = (mes: string) =>
  new Date(`${mes}-15T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const paraTexto = (n: number | null) => (n === null ? '' : String(n).replace('.', ','))

// Vazio = sem orçamento (fonte bloqueada). Aceita vírgula decimal.
function lerOrcamento(texto: string): { ok: true; valor: number | null } | { ok: false } {
  const t = texto.trim().replace(',', '.')
  if (!t) return { ok: true, valor: null }
  const n = Number(t)
  if (!Number.isFinite(n) || n < 0 || n > MAXIMO) return { ok: false }
  return { ok: true, valor: Math.round(n * 100) / 100 }
}

function BarraUso({ usado, orcamento }: { usado: number; orcamento: number }) {
  const pct = orcamento > 0 ? Math.min(100, (usado / orcamento) * 100) : 100
  const cor = pct >= 100 ? 'bg-red-400' : pct >= 80 ? 'bg-amber-400' : 'bg-emerald-400'
  return (
    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/5" aria-hidden="true">
      <div className={`h-full ${cor}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

export default function EnriquecimentoPagoPanel() {
  const [dados, setDados] = useState<Resposta | null>(null)
  const [erroCarga, setErroCarga] = useState<string | null>(null)
  const [ativo, setAtivo] = useState(false)
  const [orcamento, setOrcamento] = useState<Record<Fonte, string>>({ crustdata: '', anymail: '' })
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [salvo, setSalvo] = useState(false)

  const carregar = useCallback(async () => {
    setErroCarga(null)
    const res = await fetch('/api/configuracoes/enriquecimento').catch(() => null)
    const j = res ? await res.json().catch(() => null) : null
    if (!res?.ok || !j?.fontes) {
      setErroCarga(j?.erro ?? 'Não foi possível carregar o enriquecimento pago.')
      return
    }
    const r = j as Resposta
    setDados(r)
    setAtivo(r.ativo)
    setOrcamento({
      crustdata: paraTexto(r.fontes.find((f) => f.fonte === 'crustdata')?.orcamento ?? null),
      anymail: paraTexto(r.fontes.find((f) => f.fonte === 'anymail')?.orcamento ?? null),
    })
  }, [])

  useEffect(() => { carregar() }, [carregar])

  const podeEditar = dados?.podeEditar ?? false
  const invalidas = FONTES.filter((f) => !lerOrcamento(orcamento[f]).ok)
  const mudou = !!dados && (
    ativo !== dados.ativo
    || FONTES.some((f) => {
      const lido = lerOrcamento(orcamento[f])
      return !lido.ok || lido.valor !== (dados.fontes.find((x) => x.fonte === f)?.orcamento ?? null)
    })
  )

  async function salvar() {
    if (!podeEditar || salvando || invalidas.length) return
    setSalvando(true); setErro(null); setSalvo(false)
    try {
      const orcamentoMensal: Partial<Record<Fonte, number>> = {}
      for (const f of FONTES) {
        const lido = lerOrcamento(orcamento[f])
        if (lido.ok && lido.valor !== null) orcamentoMensal[f] = lido.valor
      }
      const res = await fetch('/api/configuracoes/workspace', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enriquecimentoPago: { ativo, orcamentoMensal } }),
      })
      const j = await res.json().catch(() => null)
      if (!res.ok) { setErro(j?.erro ?? 'Não foi possível salvar.'); return }
      await carregar()
      setSalvo(true)
      setTimeout(() => setSalvo(false), 2500)
    } finally { setSalvando(false) }
  }

  return (
    <div className="max-w-2xl rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Coins size={18} className="text-amber-300" />
            <h3 className="text-base font-semibold text-slate-100">Prospecção e enriquecimento</h3>
          </div>
          <p className="mt-1 text-sm text-slate-400">
            Fontes pagas que completam o decisor e o e-mail das empresas da Prospecção. Aqui você define se esta
            organização pode usá-las e quanto pode gastar por mês.
          </p>
        </div>
        {dados && (
          <button
            type="button"
            role="switch"
            aria-checked={ativo}
            aria-label="Enriquecimento pago"
            onClick={() => setAtivo((v) => !v)}
            disabled={!podeEditar || salvando}
            className={`text-xs px-2.5 py-1 rounded-full border inline-flex items-center gap-1.5 shrink-0 transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              ativo ? 'border-green-500/40 bg-green-500/15 text-green-300' : 'border-[var(--border)] text-slate-400 hover:text-slate-200'
            }`}
          >
            {ativo ? <Check size={12} /> : null}
            {ativo ? 'Ligado' : 'Desligado'}
          </button>
        )}
      </div>

      {erroCarga && (
        <p className="text-sm text-red-300 flex items-center gap-1.5"><AlertCircle size={14} /> {erroCarga}</p>
      )}
      {!dados && !erroCarga && (
        <p className="text-sm text-slate-500 flex items-center gap-1.5"><Loader2 size={14} className="animate-spin" /> Carregando…</p>
      )}

      {dados && (
        <>
          {!ativo && (
            <p className="rounded-lg border border-[var(--border)] bg-[var(--bg-base)] px-3 py-2 text-xs text-slate-400">
              Desligado: nenhuma consulta paga é feita. A busca usa só o que já está no cache e as fontes gratuitas.
            </p>
          )}

          <div className="space-y-3">
            {FONTES.map((f) => {
              const info = dados.fontes.find((x) => x.fonte === f)
              const salvoOrc = info?.orcamento ?? null
              const usado = info?.usado ?? null
              const invalido = invalidas.includes(f)
              return (
                <div key={f} className="rounded-lg border border-[var(--border)] bg-[var(--bg-base)] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-200">{DESCRICAO[f].nome}</div>
                      <p className="text-xs text-slate-500 mt-0.5">{DESCRICAO[f].uso}</p>
                    </div>
                    <label className="flex items-center gap-2 text-xs text-slate-400 shrink-0">
                      Orçamento mensal
                      <input
                        value={orcamento[f]}
                        onChange={(e) => setOrcamento((o) => ({ ...o, [f]: e.target.value }))}
                        disabled={!podeEditar || salvando}
                        inputMode="decimal"
                        placeholder="sem orçamento"
                        aria-label={`Orçamento mensal de ${DESCRICAO[f].nome} em créditos`}
                        aria-invalid={invalido}
                        className={`w-28 bg-[var(--bg-base)] border rounded-lg px-2 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none disabled:opacity-50 ${
                          invalido ? 'border-red-500/60 focus:border-red-400' : 'border-[var(--border)] focus:border-indigo-500'
                        }`}
                      />
                      créditos
                    </label>
                  </div>

                  <div className="mt-3 text-xs">
                    {invalido ? (
                      <span className="text-red-300">Use um número de 0 a {fmt(MAXIMO)}.</span>
                    ) : usado === null ? (
                      <span className="text-amber-300">Não foi possível ler o uso deste mês agora.</span>
                    ) : salvoOrc === null || salvoOrc <= 0 ? (
                      <span className="text-slate-500">
                        Uso em {mesLegivel(dados.mes)}: {fmt(usado)} crédito{usado === 1 ? '' : 's'} · sem orçamento, a fonte fica bloqueada.
                      </span>
                    ) : (
                      <>
                        <span className="text-slate-300">
                          Uso em {mesLegivel(dados.mes)}: <strong className="font-semibold">{fmt(usado)} / {fmt(salvoOrc)}</strong> créditos
                        </span>
                        <BarraUso usado={usado} orcamento={salvoOrc} />
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          <p className="text-xs text-slate-500">
            Consultas atendidas pelo cache não consomem orçamento. Fonte sem orçamento fica bloqueada: a empresa segue na
            busca sem esse dado. As chaves de acesso ficam só no servidor.
          </p>

          {podeEditar ? (
            <div className="flex items-center gap-3">
              <button
                onClick={salvar}
                disabled={!mudou || salvando || invalidas.length > 0}
                className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-500 disabled:opacity-40 inline-flex items-center gap-1"
              >
                {salvando ? <Loader2 size={14} className="animate-spin" /> : salvo ? <Check size={14} /> : <Save size={14} />}
                {salvo ? 'Salvo' : 'Salvar'}
              </button>
              {erro && <span className="text-xs text-red-400">{erro}</span>}
            </div>
          ) : (
            <p className="text-xs text-slate-500">Somente quem configura o workspace pode alterar.</p>
          )}
        </>
      )}
    </div>
  )
}
