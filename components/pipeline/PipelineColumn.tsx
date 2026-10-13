'use client'

import { useRef, useState, useEffect, useCallback, useMemo } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Search, Loader2 } from 'lucide-react'
import type { Lead } from '@/lib/supabase'
import { getLeadsPorEstagioPaginado } from '@/lib/api'
import type { ChipCadencia } from '@/lib/pipeline-stages'
import type { GlobalFilterState } from './GlobalFilters'
import LeadCardCompact, { type StatusChip } from './LeadCardCompact'

const PAGE = 50

// Arrastar no Kanban: o cartão leva id, empresa, estágio e coluna de origem.
const TIPO_ARRASTE = 'application/x-prospectos-lead'
export interface LeadArrastado { id: string; empresa: string; estagio: string; coluna: string }

// Chips de status da visão Cadência.
const CHIP_MAP: Record<ChipCadencia, StatusChip> = {
  enviado: { label: 'E-mail enviado', classes: 'bg-blue-500/20 text-blue-300' },
  respondeu: { label: 'Respondeu', classes: 'bg-green-500/20 text-green-300' },
  sem_resposta: { label: 'Sem resposta', classes: 'bg-slate-500/20 text-slate-300' },
}

const OPCOES_DATA = [
  { label: 'Últimos 30 dias', dias: 30 },
  { label: 'Últimos 90 dias', dias: 90 },
  { label: 'Todo o período', dias: 0 },
]

// "Resposta a tratar": o motor grava estes sinais em proxima_acao quando um lead
// responde. Calculado POR CARD (não dependemos mais de ter a coluna inteira em
// memória), o que mantém o board leve a 10k+ leads.
const RESPOSTA_PENDENTE = new Set(['aguardando_closer', 'com_closer'])
const temRespostaPendente = (l: Lead) => !!l.proxima_acao && RESPOSTA_PENDENTE.has(l.proxima_acao)

// Coluna ESCALÁVEL e independente do board: contador com TOTAL REAL (COUNT no
// servidor), fetch paginado por estágio (range), scroll infinito em lotes e
// lista virtualizada. NUNCA busca todos os leads da coluna de uma vez. Os
// filtros globais aplicam server-side; `comFiltroData` liga o filtro de data
// usado só no reservatório "Novos Leads".
export default function PipelineColumn({
  stage,
  filtros,
  selectedId,
  onSelect,
  reloadKey,
  comFiltroData = false,
  chipKind,
  onSoltar,
}: {
  stage: { id: string; label: string; color: string; estagios: string[]; followups?: number | { gte: number } }
  filtros: GlobalFilterState
  selectedId: string | null
  onSelect: (id: string) => void
  reloadKey: number
  comFiltroData?: boolean
  // Visão Cadência: chip de status mostrado em cada card desta coluna.
  chipKind?: ChipCadencia
  // Kanban: presente = cartões arrastáveis e coluna que recebe lead de outra.
  onSoltar?: (lead: LeadArrastado) => void
}) {
  const [dias, setDias] = useState(30)
  const [busca, setBusca] = useState('')
  const [data, setData] = useState<Lead[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const offsetRef = useRef(0)
  const carregandoRef = useRef(false)
  const parentRef = useRef<HTMLDivElement>(null)
  const [alvo, setAlvo] = useState(false)
  const contadorAlvo = useRef(0)
  // Animação ao mover (ver .kanban-* em globals.css): card que aparece numa
  // recarga já com a coluna carregada = chegou agora (lead movido) e entra
  // animado; os vizinhos deslizam. Na primeira carga nada anima.
  const [novos, setNovos] = useState<ReadonlySet<string>>(() => new Set())
  const [animarLinhas, setAnimarLinhas] = useState(false)
  const idsAnteriores = useRef<Set<string> | null>(null)
  const [arrastandoId, setArrastandoId] = useState<string | null>(null)

  // Busca local da etapa OU busca global (a que estiver preenchida).
  const buscaEfetiva = busca.trim() || filtros.search.trim()
  // Memoizado por `dias`: senão o timestamp mudaria a cada render, recriando
  // `carregar` e disparando re-fetch em loop.
  const desde = useMemo(
    () => (comFiltroData && dias > 0 ? new Date(Date.now() - dias * 86400000).toISOString() : null),
    [comFiltroData, dias],
  )

  const carregar = useCallback(
    async (reset: boolean) => {
      if (carregandoRef.current) return
      carregandoRef.current = true
      setLoading(true)
      const offset = reset ? 0 : offsetRef.current
      const { data: page, total: t } = await getLeadsPorEstagioPaginado(
        stage.estagios,
        {
          desde,
          busca: buscaEfetiva,
          responsavel: filtros.responsavel || undefined,
          segmento: filtros.segmento || undefined,
          canal: filtros.canal || undefined,
          followups: stage.followups,
        },
        { limit: PAGE, offset, ordenarPor: comFiltroData ? 'created_at' : 'ultimo_contato' },
      )
      setTotal(t)
      setData((prev) => (reset ? page : [...prev, ...page]))
      offsetRef.current = offset + page.length
      setLoading(false)
      carregandoRef.current = false
    },
    [stage.estagios, stage.followups, comFiltroData, desde, buscaEfetiva, filtros.responsavel, filtros.segmento, filtros.canal],
  )

  // Recarrega do zero quando muda data/busca/filtros (debounce p/ a busca) ou
  // quando o board é invalidado por uma mutação (reloadKey).
  useEffect(() => {
    const t = setTimeout(() => carregar(true), 250)
    return () => clearTimeout(t)
  }, [carregar, reloadKey])

  // Só a recarga pedida por uma mudança no board (reloadKey: lead movido,
  // editado ou criado) anima quem chegou; filtro, busca e scroll trocam a
  // lista sem efeito.
  const recargaPorMudanca = useRef(false)
  const primeiroReload = useRef(true)
  useEffect(() => {
    if (primeiroReload.current) { primeiroReload.current = false; return }
    recargaPorMudanca.current = true
  }, [reloadKey])

  useEffect(() => {
    const atuais = new Set(data.map((l) => l.id))
    const anteriores = idsAnteriores.current
    idsAnteriores.current = atuais
    // As linhas só passam a deslizar depois da primeira carga medida.
    if (!animarLinhas && data.length) {
      const t = setTimeout(() => setAnimarLinhas(true), 400)
      return () => clearTimeout(t)
    }
    if (!recargaPorMudanca.current || !anteriores) return
    recargaPorMudanca.current = false
    const chegaram = data.filter((l) => !anteriores.has(l.id)).map((l) => l.id)
    // Um movimento traz um card (ou poucos); muitos de uma vez não é movimento.
    if (!chegaram.length || chegaram.length > 3) return
    setNovos(new Set(chegaram))
    const t = setTimeout(() => setNovos(new Set()), 1600)
    return () => clearTimeout(t)
  }, [data, animarLinhas])

  const virtualizer = useVirtualizer({
    count: data.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 110,
    overscan: 8,
  })

  // Scroll infinito: ao chegar perto do fim, busca a próxima página.
  const onScroll = () => {
    const el = parentRef.current
    if (!el || carregandoRef.current || data.length >= total) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 300) carregar(false)
  }

  const aoArrastarSobre = (e: React.DragEvent) => {
    if (!onSoltar || !e.dataTransfer.types.includes(TIPO_ARRASTE)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }
  const aoSoltar = (e: React.DragEvent) => {
    contadorAlvo.current = 0
    setAlvo(false)
    if (!onSoltar) return
    const bruto = e.dataTransfer.getData(TIPO_ARRASTE)
    if (!bruto) return
    e.preventDefault()
    try {
      const lead = JSON.parse(bruto) as LeadArrastado
      if (lead.coluna !== stage.id) onSoltar(lead)
    } catch { /* arraste de outra origem: ignora */ }
  }

  return (
    <div
      className={`flex flex-col h-full w-72 shrink-0 rounded-xl transition-shadow ${alvo ? 'ring-2 ring-indigo-400/60 ring-offset-2 ring-offset-[var(--bg-base)]' : ''}`}
      onDragOver={onSoltar ? aoArrastarSobre : undefined}
      onDragEnter={onSoltar ? (e) => { if (e.dataTransfer.types.includes(TIPO_ARRASTE)) { contadorAlvo.current++; setAlvo(true) } } : undefined}
      onDragLeave={onSoltar ? () => { contadorAlvo.current = Math.max(0, contadorAlvo.current - 1); if (contadorAlvo.current === 0) setAlvo(false) } : undefined}
      onDrop={onSoltar ? aoSoltar : undefined}
    >
      {/* Cabeçalho: título + TOTAL REAL (COUNT do servidor) */}
      <div className="flex items-center justify-between mb-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: stage.color }} />
          <span className="text-sm font-semibold text-slate-300 leading-tight truncate">{stage.label}</span>
        </div>
        <span className="text-xs font-bold text-slate-500 bg-[var(--bg-input)] px-2 py-0.5 rounded-full shrink-0" title="total na etapa">
          {total.toLocaleString('pt-BR')}
        </span>
      </div>

      {/* Filtro de data (só no reservatório Novos Leads) */}
      {comFiltroData && (
        <select
          value={dias}
          onChange={(e) => setDias(Number(e.target.value))}
          className="mb-1.5 shrink-0 text-xs border border-[var(--border)] rounded-lg px-2 py-1.5 bg-[var(--bg-card)] text-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500/40"
        >
          {OPCOES_DATA.map((o) => (
            <option key={o.dias} value={o.dias}>{o.label}</option>
          ))}
        </select>
      )}

      {/* Busca (server-side) só nesta etapa */}
      <div className="relative mb-2 shrink-0">
        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar nesta etapa"
          className="w-full pl-7 pr-2 py-1.5 text-xs border border-[var(--border)] rounded-lg bg-[var(--bg-card)] text-slate-300 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500/40"
        />
      </div>

      {/* Lista virtualizada + scroll infinito (altura fixa, rola só aqui) */}
      <div
        ref={parentRef}
        onScroll={onScroll}
        className="flex-1 min-h-0 overflow-y-auto rounded-lg bg-[var(--bg-base)]/40 border border-[var(--border)]/40 p-1.5"
      >
        {data.length === 0 && !loading ? (
          <div className="text-center text-xs text-slate-600 py-6">
            {buscaEfetiva ? 'Nada encontrado nesta etapa.' : 'Sem leads.'}
          </div>
        ) : (
          <>
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
              {virtualizer.getVirtualItems().map((vi) => {
                const lead = data[vi.index]
                return (
                  <div
                    key={lead.id}
                    data-index={vi.index}
                    ref={virtualizer.measureElement}
                    style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start}px)` }}
                    draggable={!!onSoltar}
                    onDragStart={onSoltar ? (e) => {
                      const payload: LeadArrastado = { id: lead.id, empresa: lead.empresa ?? 'Lead', estagio: lead.estagio, coluna: stage.id }
                      e.dataTransfer.setData(TIPO_ARRASTE, JSON.stringify(payload))
                      e.dataTransfer.effectAllowed = 'move'
                      setArrastandoId(lead.id)
                    } : undefined}
                    onDragEnd={onSoltar ? () => setArrastandoId(null) : undefined}
                    className={`${onSoltar ? 'cursor-grab active:cursor-grabbing' : ''} ${animarLinhas ? 'kanban-linha-animada' : ''}`}
                  >
                    {/* A animação fica num filho: o transform da linha é a posição dela. */}
                    <div className={`${novos.has(lead.id) ? 'kanban-entrada' : ''} ${arrastandoId === lead.id ? 'kanban-arrastando' : ''}`}>
                      <LeadCardCompact
                        lead={lead}
                        respostaPendente={!chipKind && temRespostaPendente(lead)}
                        statusChip={chipKind ? CHIP_MAP[chipKind] : undefined}
                        selected={selectedId === lead.id}
                        onClick={() => onSelect(lead.id)}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
            {data.length < total && (
              <div className="flex items-center justify-center gap-2 py-3 text-xs text-slate-500">
                {loading && <Loader2 size={12} className="animate-spin" />}
                {loading ? 'Carregando...' : `${data.length} de ${total.toLocaleString('pt-BR')}`}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
