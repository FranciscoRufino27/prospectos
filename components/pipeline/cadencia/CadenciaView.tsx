'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Columns3,
  List,
  Loader2,
  Mail,
  MessagesSquare,
  Plus,
  Search,
  Send,
  SlidersHorizontal,
  SquareKanban,
  X,
} from 'lucide-react'
import { getLeadsCadencia, type EtapaCadencia, type LeadCadencia } from '@/lib/api'
import { labelProximaAcao } from '@/lib/pipeline-stages'
import type { GlobalFilterState } from '@/components/pipeline/GlobalFilters'
import styles from './CadenciaView.module.css'

type CadenciaStage = {
  id: EtapaCadencia
  label: string
  description: string
  color: string
  kind: 'contato' | 'followup' | 'respondeu'
}

// Colunas EXIBIDAS. A etapa é decidida em lib/api.ts (getLeadsCadencia) a partir
// da inscrição em `workflow_execucoes` + contagem de envios em `interacoes` —
// não de leads.estagio/followups_enviados. A etapa 'a_iniciar' (inscrito, nenhum
// envio ainda) já é classificada lá, mas ainda NÃO tem coluna aqui.
const CADENCIA_STAGES: CadenciaStage[] = [
  { id: 'contato1', label: '1º contato', description: 'Primeiro contato enviado', color: '#4f7cff', kind: 'contato' },
  { id: 'followup1', label: '1º Follow-up', description: 'Aguardando retorno', color: '#7c3aed', kind: 'followup' },
  { id: 'followup2', label: '2º Follow-up', description: 'Segundo contato enviado', color: '#4f7cff', kind: 'followup' },
  { id: 'followup3', label: '3º Follow-up', description: 'Terceiro contato enviado', color: '#9333ea', kind: 'followup' },
  { id: 'followup4', label: '4º Follow-up', description: 'Última tentativa', color: '#7c3aed', kind: 'followup' },
  { id: 'respondeu', label: 'Respondeu', description: 'Teve uma resposta', color: '#22c55e', kind: 'respondeu' },
]

function formatLastContact(value?: string | null): string {
  if (!value) return 'Nenhum envio registrado'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Nenhum envio registrado'

  const today = new Date()
  const isToday = date.getFullYear() === today.getFullYear()
    && date.getMonth() === today.getMonth()
    && date.getDate() === today.getDate()
  const time = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(date)
  if (isToday) return `Hoje, ${time}`

  const day = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(date)
  return `${day}, ${time}`
}

function formatDate(value?: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date)
}

function initials(name?: string | null): string {
  if (!name) return ''
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
}

// --- Prioridade operacional -------------------------------------------------
// Ordem dentro da coluna: ação vencida → para hoje → futura mais próxima → sem
// próxima ação. A comparação é por DIA LOCAL, igual ao que o card exibe
// (formatDate usa o fuso do navegador) — não é filtro de cadastro, então aqui
// não se aplica a janela UTC meio-aberta usada na Base de Leads.
type Urgencia = 'atraso' | 'hoje' | 'aguardando' | 'nenhuma'

const PESO_URGENCIA: Record<Urgencia, number> = { atraso: 0, hoje: 1, aguardando: 2, nenhuma: 3 }
const ROTULO_URGENCIA: Record<Exclude<Urgencia, 'nenhuma'>, string> = {
  atraso: 'Em atraso',
  hoje: 'Hoje',
  aguardando: 'Aguardando',
}
const CLASSE_URGENCIA: Record<Exclude<Urgencia, 'nenhuma'>, string> = {
  atraso: styles.urgenciaAtraso,
  hoje: styles.urgenciaHoje,
  aguardando: styles.urgenciaAguardando,
}

function inicioDoDia(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function urgenciaDoLead(lead: LeadCadencia, hoje: number): Urgencia {
  if (!lead.proxima_acao_data) return 'nenhuma'
  const data = new Date(lead.proxima_acao_data)
  if (Number.isNaN(data.getTime())) return 'nenhuma'
  const dia = inicioDoDia(data)
  if (dia < hoje) return 'atraso'
  if (dia === hoje) return 'hoje'
  return 'aguardando'
}

function instante(valor?: string | null): number | null {
  if (!valor) return null
  const t = new Date(valor).getTime()
  return Number.isNaN(t) ? null : t
}

// Ordena por prioridade e, dentro dela, do mais antigo para o mais novo.
// Datas ausentes vão para o fim (mesma convenção do `nullsFirst: false` que a
// consulta usava antes).
function ordenarPorPrioridade(leads: LeadCadencia[], hoje: number): LeadCadencia[] {
  return [...leads].sort((a, b) => {
    const pesoA = PESO_URGENCIA[urgenciaDoLead(a, hoje)]
    const pesoB = PESO_URGENCIA[urgenciaDoLead(b, hoje)]
    if (pesoA !== pesoB) return pesoA - pesoB

    const acaoA = instante(a.proxima_acao_data)
    const acaoB = instante(b.proxima_acao_data)
    if (acaoA !== null && acaoB !== null && acaoA !== acaoB) return acaoA - acaoB

    const contatoA = instante(a.ultimo_contato)
    const contatoB = instante(b.ultimo_contato)
    if (contatoA === null && contatoB !== null) return 1
    if (contatoB === null && contatoA !== null) return -1
    if (contatoA !== null && contatoB !== null && contatoA !== contatoB) return contatoA - contatoB

    // Desempate estável: sem ele a ordem pode oscilar entre renders.
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

function CadenciaLeadCard({ lead, stage, urgencia, selected, onSelect }: {
  lead: LeadCadencia
  stage: CadenciaStage
  urgencia: Urgencia
  selected: boolean
  onSelect: () => void
}) {
  const owner = lead.usuarios?.nome ?? lead.responsavel_nome ?? null
  const nextDate = formatDate(lead.proxima_acao_data)
  const nextAction = labelProximaAcao(lead.proxima_acao)

  return (
    <button
      type="button"
      className={`${styles.card} ${selected ? styles.cardSelected : ''} ${urgencia === 'atraso' ? styles.cardAtraso : ''}`}
      onClick={onSelect}
    >
      <strong className={styles.company}>{lead.empresa}</strong>
      <span className={styles.contact}>{lead.contato_nome || 'Contato não informado'}</span>

      <span className={styles.badgeRow}>
        <span
          className={styles.stageBadge}
          style={{ color: stage.color, backgroundColor: `${stage.color}22`, borderColor: `${stage.color}38` }}
        >
          {stage.label}
        </span>
        {urgencia !== 'nenhuma' ? (
          <span className={`${styles.urgencia} ${CLASSE_URGENCIA[urgencia]}`}>{ROTULO_URGENCIA[urgencia]}</span>
        ) : null}
      </span>

      <span className={styles.cardMeta}>
        <Mail size={13} aria-hidden="true" />
        <span>{formatLastContact(lead.ultimo_contato)}</span>
      </span>
      <span className={styles.cardMeta}>
        <CalendarDays size={13} aria-hidden="true" />
        <span className={styles.nextAction}>
          {nextAction === '—' ? 'Sem próxima ação' : nextAction}
          {nextDate ? <small>{nextDate}</small> : null}
        </span>
        {owner ? <span className={styles.owner} title={owner}>{initials(owner)}</span> : null}
      </span>
    </button>
  )
}

// Quantos cards a coluna mostra por vez. Cada "Ver mais" soma outro lote — o
// board inteiro já está em memória, então isso limita só o que vai ao DOM.
const LOTE_COLUNA = 20

// Coluna de apresentação: recebe os leads já classificados e ORDENADOS pela
// etapa. A classificação e os filtros globais vivem em CadenciaView (uma
// consulta para o board inteiro), porque a etapa não é um filtro que o banco
// saiba aplicar. A busca desta caixa é local: não refaz consulta e não afeta as
// outras colunas.
function CadenciaColumn({ stage, leads, hoje, buscaGlobal, selectedId, onSelect }: {
  stage: CadenciaStage
  leads: LeadCadencia[]
  hoje: number
  buscaGlobal: boolean
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const [busca, setBusca] = useState('')
  const [limite, setLimite] = useState(LOTE_COLUNA)

  // Trocar a busca ou receber dados novos volta a coluna ao primeiro lote.
  useEffect(() => { setLimite(LOTE_COLUNA) }, [busca, leads])

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    if (!termo) return leads
    return leads.filter((lead) =>
      (lead.empresa ?? '').toLowerCase().includes(termo)
      || (lead.contato_nome ?? '').toLowerCase().includes(termo))
  }, [busca, leads])

  const visiveis = filtrados.slice(0, limite)
  const restantes = filtrados.length - visiveis.length
  const buscandoAqui = busca.trim().length > 0

  const StageIcon = stage.kind === 'respondeu' ? CheckCircle2 : stage.kind === 'contato' ? Send : Mail

  return (
    <section className={styles.column} aria-labelledby={`cadencia-${stage.id}`}>
      <header className={styles.columnHeader}>
        <div className={styles.columnTitleRow}>
          <div className={styles.columnTitle}>
            <StageIcon size={16} style={{ color: stage.color }} aria-hidden="true" />
            <h2 id={`cadencia-${stage.id}`}>{stage.label}</h2>
          </div>
          <span className={styles.count}>
            {buscandoAqui
              ? `${filtrados.length.toLocaleString('pt-BR')} de ${leads.length.toLocaleString('pt-BR')}`
              : leads.length.toLocaleString('pt-BR')}
          </span>
        </div>
        <p>{stage.description}</p>

        <div className={styles.columnSearch}>
          <Search size={12} aria-hidden="true" />
          <input
            value={busca}
            onChange={(event) => setBusca(event.target.value)}
            placeholder="Buscar nesta etapa..."
            aria-label={`Buscar em ${stage.label} por empresa ou contato`}
          />
          {buscandoAqui ? (
            <button type="button" onClick={() => setBusca('')} aria-label="Limpar busca desta etapa">
              <X size={11} />
            </button>
          ) : null}
        </div>
      </header>

      <div className={styles.columnBody}>
        {filtrados.length === 0 ? (
          <div className={styles.empty}>
            {buscandoAqui || buscaGlobal ? 'Nenhum contato encontrado.' : 'Nenhum contato nesta etapa.'}
          </div>
        ) : (
          <div className={`${styles.cardList} surgir-cascata`}>
            {visiveis.map((lead) => (
              <CadenciaLeadCard
                key={lead.id}
                lead={lead}
                stage={stage}
                urgencia={urgenciaDoLead(lead, hoje)}
                selected={selectedId === lead.id}
                onSelect={() => onSelect(lead.id)}
              />
            ))}
            {restantes > 0 ? (
              <button
                type="button"
                className={styles.verMais}
                onClick={() => setLimite((atual) => atual + LOTE_COLUNA)}
              >
                Ver mais ({restantes.toLocaleString('pt-BR')})
              </button>
            ) : null}
          </div>
        )}
      </div>
    </section>
  )
}

export default function CadenciaView({
  filtros,
  onFiltrosChange,
  responsaveis,
  segmentos,
  canais,
  selectedId,
  onSelect,
  reloadKey,
  loading,
  usingSupabase,
  onOpenList,
  onOpenKanban,
  onOpenRespostas,
  onNovoContato,
}: {
  filtros: GlobalFilterState
  onFiltrosChange: (filters: GlobalFilterState) => void
  responsaveis: string[]
  segmentos: string[]
  canais: string[]
  selectedId: string | null
  onSelect: (id: string) => void
  reloadKey: number
  loading: boolean
  usingSupabase: boolean
  onOpenList: () => void
  onOpenKanban: () => void
  onOpenRespostas: () => void
  onNovoContato: () => void
}) {
  const [stageFilter, setStageFilter] = useState('')
  const [moreFilters, setMoreFilters] = useState(false)
  const [leads, setLeads] = useState<LeadCadencia[]>([])
  const [carregando, setCarregando] = useState(true)

  // Uma consulta para o board inteiro: a etapa depende de `workflow_execucoes` +
  // contagem em `interacoes`, então o banco não sabe filtrar por coluna. O
  // contador de requisição impede que uma resposta antiga (busca sendo digitada)
  // sobrescreva a mais recente.
  const requisicaoRef = useRef(0)
  useEffect(() => {
    const requisicao = ++requisicaoRef.current
    setCarregando(true)
    const timeout = setTimeout(async () => {
      try {
        const dados = await getLeadsCadencia({
          busca: filtros.search.trim(),
          responsavel: filtros.responsavel || undefined,
          segmento: filtros.segmento || undefined,
          canal: filtros.canal || undefined,
        })
        if (requisicao !== requisicaoRef.current) return
        setLeads(dados)
      } finally {
        if (requisicao === requisicaoRef.current) setCarregando(false)
      }
    }, 250)
    return () => clearTimeout(timeout)
  }, [filtros.search, filtros.responsavel, filtros.segmento, filtros.canal, reloadKey])

  // Referência de "hoje" para urgência/ordenação. Recalculada junto com os
  // dados; não precisa acompanhar a virada do dia com o board aberto.
  const hoje = useMemo(() => inicioDoDia(new Date()), [leads])

  const porEtapa = useMemo(() => {
    const grupos = new Map<EtapaCadencia, LeadCadencia[]>()
    for (const stage of CADENCIA_STAGES) grupos.set(stage.id, [])
    // Leads em etapa sem coluna (hoje só 'a_iniciar') simplesmente não entram —
    // ficam de fora até existir a coluna correspondente.
    for (const lead of leads) grupos.get(lead.etapa)?.push(lead)
    // Ordem operacional dentro de cada coluna, feita uma vez por carga.
    for (const [etapa, doGrupo] of grupos) grupos.set(etapa, ordenarPorPrioridade(doGrupo, hoje))
    return grupos
  }, [leads, hoje])

  const visibleStages = useMemo(
    () => stageFilter ? CADENCIA_STAGES.filter((stage) => stage.id === stageFilter) : CADENCIA_STAGES,
    [stageFilter],
  )
  const total = visibleStages.reduce((sum, stage) => sum + (porEtapa.get(stage.id)?.length ?? 0), 0)
  const hasFilters = Boolean(filtros.search || filtros.responsavel || filtros.segmento || filtros.canal || stageFilter)

  const setFilters = (patch: Partial<GlobalFilterState>) => onFiltrosChange({ ...filtros, ...patch })
  const clearFilters = () => {
    onFiltrosChange({ search: '', responsavel: '', segmento: '', canal: '' })
    setStageFilter('')
  }

  return (
    <div className={styles.root}>
      <header className={styles.pageHeader}>
        <div className={styles.headingBlock}>
          <span className={styles.headingIcon}><BarChart3 size={20} /></span>
          <div>
            <h1>Pipeline de Contato</h1>
            <p>Acompanhe e gerencie o seu processo comercial.</p>
          </div>
        </div>
        <button type="button" className={styles.primaryButton} onClick={onNovoContato}>
          <Plus size={16} /> Novo contato
        </button>
      </header>

      <div className={styles.toolbar}>
        <div className={styles.viewRow}>
          <div className={styles.tabs} aria-label="Visualização da Pipeline">
            <button type="button" className={styles.tabActive} aria-pressed="true">
              <Columns3 size={15} /> Cadência
            </button>
            <button type="button" onClick={onOpenList} aria-pressed="false">
              <List size={15} /> Lista
            </button>
            <button type="button" onClick={onOpenKanban} aria-pressed="false">
              <SquareKanban size={15} /> Kanban
            </button>
            <button type="button" onClick={onOpenRespostas} aria-pressed="false">
              <MessagesSquare size={15} /> Central de Respostas
            </button>
          </div>
          <span className={styles.total}><strong>{total.toLocaleString('pt-BR')}</strong> oportunidades</span>
        </div>

        <div className={styles.filters}>
          <label className={styles.search}>
            <Search size={15} aria-hidden="true" />
            <span className={styles.srOnly}>Buscar no pipeline</span>
            <input
              value={filtros.search}
              onChange={(event) => setFilters({ search: event.target.value })}
              placeholder="Buscar no pipeline..."
            />
          </label>

          <select value={filtros.responsavel} onChange={(event) => setFilters({ responsavel: event.target.value })} aria-label="Filtrar por responsável">
            <option value="">Todos os responsáveis</option>
            {responsaveis.map((responsavel) => <option key={responsavel} value={responsavel}>{responsavel}</option>)}
          </select>

          <select value={stageFilter} onChange={(event) => setStageFilter(event.target.value)} aria-label="Filtrar por etapa da cadência">
            <option value="">Todos os status</option>
            {CADENCIA_STAGES.map((stage) => <option key={stage.id} value={stage.id}>{stage.label}</option>)}
          </select>

          <select value={filtros.segmento} onChange={(event) => setFilters({ segmento: event.target.value })} aria-label="Filtrar por segmento">
            <option value="">Todos os segmentos</option>
            {segmentos.map((segmento) => <option key={segmento} value={segmento}>{segmento}</option>)}
          </select>

          <button
            type="button"
            className={`${styles.moreButton} ${moreFilters || filtros.canal ? styles.moreButtonActive : ''}`}
            onClick={() => setMoreFilters((open) => !open)}
            aria-expanded={moreFilters}
          >
            <SlidersHorizontal size={15} /> Mais filtros
          </button>

          {moreFilters ? (
            <select value={filtros.canal} onChange={(event) => setFilters({ canal: event.target.value })} aria-label="Filtrar por canal">
              <option value="">Todos os canais</option>
              {canais.map((canal) => <option key={canal} value={canal}>{canal}</option>)}
            </select>
          ) : null}

          {hasFilters ? (
            <button type="button" className={styles.clearButton} onClick={clearFilters}>
              <X size={14} /> Limpar
            </button>
          ) : null}
        </div>
      </div>

      <main className={styles.boardViewport}>
        {loading || carregando ? (
          <div className={styles.pageState}><Loader2 size={18} className={styles.spinner} /> Carregando contatos...</div>
        ) : !usingSupabase ? (
          <div className={styles.pageState}>Não foi possível carregar os dados da Pipeline.</div>
        ) : (
          // surgir-cascata (globals.css): as colunas entram da esquerda para a
          // direita e, em cada uma, os cards descem em sequência.
          <div className={`surgir-cascata ${styles.board} ${visibleStages.length === 1 ? styles.boardSingle : ''}`}>
            {visibleStages.map((stage) => (
              <CadenciaColumn
                key={stage.id}
                stage={stage}
                leads={porEtapa.get(stage.id) ?? []}
                hoje={hoje}
                buscaGlobal={Boolean(filtros.search)}
                selectedId={selectedId}
                onSelect={onSelect}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
