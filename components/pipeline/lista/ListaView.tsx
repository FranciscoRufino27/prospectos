'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUpDown,
  BarChart3,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Columns3,
  List,
  Loader2,
  MessagesSquare,
  Plus,
  Search,
  SlidersHorizontal,
  SquareKanban,
  X,
} from 'lucide-react'
import { getTodosLeads, type LeadOrdenavel } from '@/lib/api'
import { COLUNAS, corEstagio, labelEstagio, labelProximaAcao } from '@/lib/pipeline-stages'
import { dash } from '@/lib/utils'
import type { Lead } from '@/lib/supabase'
import { diasDesde } from '@/components/pipeline/prioridade'
import type { GlobalFilterState } from '@/components/pipeline/GlobalFilters'
import styles from './ListaView.module.css'

const TAMANHOS_PAGINA = [10, 25, 50, 100]

type ColunaLista = {
  key: string
  label: string
  ordenarPor?: LeadOrdenavel
  className?: string
}

// Prioridade aprovada: Empresa + decisor, Segmento, Estágio, Último contato,
// Próxima ação, Responsável. Sem score e sem logo da empresa.
const COLUNAS_LISTA: ColunaLista[] = [
  { key: 'empresa', label: 'Empresa / Contato', ordenarPor: 'empresa', className: styles.colEmpresa },
  { key: 'segmento', label: 'Segmento', ordenarPor: 'segmento' },
  { key: 'estagio', label: 'Estágio', ordenarPor: 'estagio' },
  { key: 'ultimo_contato', label: 'Último contato', ordenarPor: 'ultimo_contato' },
  { key: 'proxima_acao', label: 'Próxima ação', className: styles.colAcao },
  { key: 'responsavel', label: 'Responsável', ordenarPor: 'responsavel_nome' },
]

function formatData(valor?: string | null): string | null {
  if (!valor) return null
  const data = new Date(valor)
  if (Number.isNaN(data.getTime())) return null
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(data)
}

function formatDataHora(valor?: string | null): string | null {
  if (!valor) return null
  const data = new Date(valor)
  if (Number.isNaN(data.getTime())) return null
  const dia = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(data)
  const hora = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(data)
  return `${dia} ${hora}`
}

function rotuloDesde(valor?: string | null): string | null {
  const dias = diasDesde(valor)
  if (dias === null) return null
  if (dias === 0) return 'Hoje'
  if (dias === 1) return 'Ontem'
  return `${dias}d atrás`
}

function initials(nome?: string | null): string {
  if (!nome) return ''
  return nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase()
}

function primeiroNome(nome?: string | null): string | null {
  if (!nome) return null
  return nome.split(/\s+/).filter(Boolean)[0] ?? null
}

// Janela compacta de páginas: 1 … n-1 n n+1 … última.
function paginasVisiveis(atual: number, totalPaginas: number): (number | '…')[] {
  if (totalPaginas <= 7) return Array.from({ length: totalPaginas }, (_, i) => i + 1)
  const paginas = new Set<number>([1, totalPaginas, atual, atual - 1, atual + 1])
  if (atual <= 3) [2, 3, 4].forEach((p) => paginas.add(p))
  if (atual >= totalPaginas - 2) [totalPaginas - 3, totalPaginas - 2, totalPaginas - 1].forEach((p) => paginas.add(p))
  const ordenadas = [...paginas].filter((p) => p >= 1 && p <= totalPaginas).sort((a, b) => a - b)
  const saida: (number | '…')[] = []
  let anterior = 0
  for (const p of ordenadas) {
    if (anterior && p - anterior > 1) saida.push('…')
    saida.push(p)
    anterior = p
  }
  return saida
}

export default function ListaView({
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
  onOpenCadencia,
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
  onOpenCadencia: () => void
  onOpenKanban: () => void
  onOpenRespostas: () => void
  onNovoContato: () => void
}) {
  const [grupoEstagio, setGrupoEstagio] = useState('')
  const [moreFilters, setMoreFilters] = useState(false)
  const [sort, setSort] = useState<{ campo: LeadOrdenavel; asc: boolean }>({ campo: 'ultimo_contato', asc: false })
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(10)
  const [data, setData] = useState<Lead[]>([])
  const [total, setTotal] = useState(0)
  const [carregando, setCarregando] = useState(true)
  // Sequência do fetch: resposta antiga em voo não sobrescreve a mais nova.
  const seqRef = useRef(0)

  // O select de estágio agrupa os mesmos conjuntos do Kanban (COLUNAS) — não
  // renomeia nem inventa estágio do motor.
  const estagios = useMemo(
    () => (grupoEstagio ? COLUNAS.find((c) => c.id === grupoEstagio)?.estagios : undefined),
    [grupoEstagio],
  )

  // Só a busca digitada precisa de debounce; selects e cliques disparam já.
  const [buscaDebounced, setBuscaDebounced] = useState(filtros.search)
  useEffect(() => {
    const t = setTimeout(() => setBuscaDebounced(filtros.search), 250)
    return () => clearTimeout(t)
  }, [filtros.search])

  // Trocar filtro, ordenação ou tamanho de página volta para a primeira.
  useEffect(() => { setPage(0) }, [buscaDebounced, filtros.responsavel, filtros.segmento, filtros.canal, grupoEstagio, sort, pageSize])

  const carregar = useCallback(async () => {
    const seq = ++seqRef.current
    setCarregando(true)
    const resultado = await getTodosLeads(
      {
        busca: buscaDebounced || undefined,
        responsavel: filtros.responsavel || undefined,
        segmento: filtros.segmento || undefined,
        canal: filtros.canal || undefined,
        estagios,
        ordenarPor: sort,
      },
      { limit: pageSize, offset: page * pageSize },
    )
    if (seq !== seqRef.current) return
    setData(resultado.data)
    setTotal(resultado.total)
    setCarregando(false)
    // Mutação pode encolher o total e deixar a página atual além do fim.
    const ultima = Math.max(0, Math.ceil(resultado.total / pageSize) - 1)
    if (page > ultima) setPage(ultima)
  }, [buscaDebounced, filtros.responsavel, filtros.segmento, filtros.canal, estagios, sort, page, pageSize])

  useEffect(() => { carregar() }, [carregar, reloadKey])

  const alternarOrdem = (campo?: LeadOrdenavel) => {
    if (!campo) return
    setSort((atual) => (atual.campo === campo ? { campo, asc: !atual.asc } : { campo, asc: true }))
  }

  const totalPaginas = Math.max(1, Math.ceil(total / pageSize))
  const inicio = total === 0 ? 0 : page * pageSize + 1
  const fim = Math.min((page + 1) * pageSize, total)
  const temFiltros = Boolean(filtros.search || filtros.responsavel || filtros.segmento || filtros.canal || grupoEstagio)

  const setFilters = (patch: Partial<GlobalFilterState>) => onFiltrosChange({ ...filtros, ...patch })
  const limparFiltros = () => {
    onFiltrosChange({ search: '', responsavel: '', segmento: '', canal: '' })
    setGrupoEstagio('')
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
            <button type="button" onClick={onOpenCadencia} aria-pressed="false">
              <Columns3 size={15} /> Cadência
            </button>
            <button type="button" className={styles.tabActive} aria-pressed="true">
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

          <select value={grupoEstagio} onChange={(event) => setGrupoEstagio(event.target.value)} aria-label="Filtrar por estágio">
            <option value="">Todos os estágios</option>
            {COLUNAS.map((coluna) => <option key={coluna.id} value={coluna.id}>{coluna.label}</option>)}
          </select>

          <select value={filtros.responsavel} onChange={(event) => setFilters({ responsavel: event.target.value })} aria-label="Filtrar por responsável">
            <option value="">Todos os responsáveis</option>
            {responsaveis.map((responsavel) => <option key={responsavel} value={responsavel}>{responsavel}</option>)}
          </select>

          <select value={filtros.segmento} onChange={(event) => setFilters({ segmento: event.target.value })} aria-label="Filtrar por segmento">
            <option value="">Todos os segmentos</option>
            {segmentos.map((segmento) => <option key={segmento} value={segmento}>{segmento}</option>)}
          </select>

          <button
            type="button"
            className={`${styles.moreButton} ${moreFilters || filtros.canal ? styles.moreButtonActive : ''}`}
            onClick={() => setMoreFilters((aberto) => !aberto)}
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

          {temFiltros ? (
            <button type="button" className={styles.clearButton} onClick={limparFiltros}>
              <X size={14} /> Limpar
            </button>
          ) : null}
        </div>
      </div>

      <div className={styles.tableViewport}>
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                {COLUNAS_LISTA.map((coluna) => (
                  <th key={coluna.key} className={coluna.className}>
                    {coluna.ordenarPor ? (
                      <button type="button" className={styles.sortButton} onClick={() => alternarOrdem(coluna.ordenarPor)}>
                        {coluna.label}
                        {sort.campo === coluna.ordenarPor
                          ? (sort.asc ? <ChevronUp size={12} /> : <ChevronDown size={12} />)
                          : <ArrowUpDown size={11} className={styles.sortInativo} />}
                      </button>
                    ) : coluna.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="surgir-cascata">
              {!usingSupabase ? (
                <tr>
                  <td colSpan={COLUNAS_LISTA.length} className={styles.estadoLinha}>
                    Não foi possível carregar os dados da Pipeline.
                  </td>
                </tr>
              ) : data.length === 0 ? (
                <tr>
                  <td colSpan={COLUNAS_LISTA.length} className={styles.estadoLinha}>
                    {loading || carregando
                      ? <span><Loader2 size={15} className={styles.spinner} /> Carregando contatos...</span>
                      : 'Nenhum lead encontrado com esses filtros.'}
                  </td>
                </tr>
              ) : (
                data.map((lead) => {
                  const responsavel = lead.usuarios?.nome ?? lead.responsavel_nome ?? null
                  const cor = corEstagio(lead.estagio)
                  const ultimo = formatData(lead.ultimo_contato)
                  const desde = rotuloDesde(lead.ultimo_contato)
                  const quandoAcao = formatDataHora(lead.proxima_acao_data)
                  const acao = labelProximaAcao(lead.proxima_acao)

                  return (
                    <tr
                      key={lead.id}
                      onClick={() => onSelect(lead.id)}
                      className={`${styles.row} ${selectedId === lead.id ? styles.rowSelected : ''}`}
                    >
                      <td className={styles.colEmpresa}>
                        <span className={styles.empresa}>{dash(lead.empresa)}</span>
                        <span className={styles.contato}>{lead.contato_nome || 'Contato não informado'}</span>
                      </td>
                      <td>{dash(lead.segmento)}</td>
                      <td>
                        <span
                          className={styles.estagio}
                          style={{ color: cor, backgroundColor: `${cor}1f`, borderColor: `${cor}3d` }}
                        >
                          <span className={styles.estagioDot} style={{ backgroundColor: cor }} />
                          {labelEstagio(lead.estagio)}
                        </span>
                      </td>
                      <td>
                        <span className={styles.principal}>{ultimo ?? '—'}</span>
                        {desde ? <span className={styles.apoio}>{desde}</span> : null}
                      </td>
                      <td className={styles.colAcao}>
                        <span className={styles.principal}>{quandoAcao ?? '—'}</span>
                        <span className={styles.apoio}>{acao === '—' ? 'Sem próxima ação' : acao}</span>
                      </td>
                      <td>
                        {responsavel ? (
                          <span className={styles.responsavel}>
                            <span className={styles.avatar} aria-hidden="true">{initials(responsavel)}</span>
                            {primeiroNome(responsavel)}
                          </span>
                        ) : '—'}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        <div className={styles.footer}>
          <span>
            {total > 0
              ? `Mostrando ${inicio.toLocaleString('pt-BR')}–${fim.toLocaleString('pt-BR')} de ${total.toLocaleString('pt-BR')} resultados`
              : 'Nenhum resultado'}
          </span>

          <label className={styles.porPagina}>
            Itens por página
            <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
              {TAMANHOS_PAGINA.map((tamanho) => <option key={tamanho} value={tamanho}>{tamanho}</option>)}
            </select>
          </label>

          <div className={styles.paginas}>
            <button
              type="button"
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0 || carregando}
              aria-label="Página anterior"
            >
              <ChevronLeft size={14} />
            </button>

            {paginasVisiveis(page + 1, totalPaginas).map((item, indice) => (
              item === '…'
                ? <span key={`gap-${indice}`} className={styles.reticencias}>…</span>
                : (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setPage(item - 1)}
                    className={item === page + 1 ? styles.paginaAtiva : ''}
                    aria-current={item === page + 1 ? 'page' : undefined}
                  >
                    {item}
                  </button>
                )
            ))}

            <button
              type="button"
              onClick={() => setPage(page + 1 < totalPaginas ? page + 1 : page)}
              disabled={page + 1 >= totalPaginas || carregando}
              aria-label="Próxima página"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
