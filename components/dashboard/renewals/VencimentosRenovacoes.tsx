'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Database,
  Download,
  FileClock,
  FileText,
  History,
  MoreVertical,
  RefreshCw,
  Search,
  UserRound,
  UsersRound,
} from 'lucide-react'
import type { ClienteControleVencimento, SituacaoRenovacao } from '@/lib/operacao/dashboard'
import { diasAteVencimento, formatarDataIsoSemFuso } from '@/lib/servicos/vencimento'
import styles from './VencimentosRenovacoes.module.css'

interface ComunicacaoRenovacao {
  id: string
  leadId: string
  empresaId: string | null
  empresa: string
  enviadaEm: string
  origem: string
}

interface VencimentoRenovacao extends ClienteControleVencimento {
  ultimaMensagem: ComunicacaoRenovacao | null
  ultimaRespostaEm: string | null
  ultimoContato: string | null
  proximaAcaoEm: string | null
  situacao: SituacaoRenovacao
  responsavel: { id: string | null; nome: string } | null
  campanha: { id: string; nome: string } | null
}

interface TarefaRenovacao {
  id: string
  leadId: string | null
  titulo: string
  prazoEm: string | null
  tipo: string | null
}

interface CicloRenovado {
  id: string
  leadId: string
  empresa: string
  tipo: string
  validadeAnterior: string
  novaValidade: string | null
  renovadoEm: string
  responsavel: { id: string | null; nome: string } | null
}

interface Props {
  atualizadoEm: string
  vencimentos: VencimentoRenovacao[]
  tarefas: TarefaRenovacao[]
  ciclosRenovados: CicloRenovado[]
  historicoCiclosDisponivel: boolean
  atualizando: boolean
  onAtualizar: () => void
  onVoltarProspeccao?: () => void
}

type Periodo = 'vencidos' | 'ate_30' | 'de_31_a_90' | 'ano' | 'personalizado'
type GrupoStatus = 'todos' | 'nao_contatados' | 'contato_enviado' | 'em_negociacao' | 'renovados' | 'erros'

const ITENS_POR_PAGINA = 6

const ROTULOS_STATUS: Record<GrupoStatus, string> = {
  todos: 'Todos',
  nao_contatados: 'Não contatados',
  contato_enviado: 'Contato enviado',
  em_negociacao: 'Em negociação',
  renovados: 'Renovados',
  erros: 'Com erro',
}

function chaveDoResponsavel(responsavel: { id: string | null; nome: string } | null): string {
  if (!responsavel) return 'sem_responsavel'
  return responsavel.id ?? `nome:${responsavel.nome}`
}

function chaveResponsavel(item: VencimentoRenovacao): string {
  return chaveDoResponsavel(item.responsavel)
}

function pertenceAoGrupo(item: VencimentoRenovacao, grupo: GrupoStatus): boolean {
  if (grupo === 'todos') return true
  if (grupo === 'nao_contatados') {
    return ['nao_comunicado', 'agendado', 'encerrado'].includes(item.situacao)
  }
  if (grupo === 'contato_enviado') return item.situacao === 'enviado'
  if (grupo === 'em_negociacao') {
    return item.situacao === 'em_acompanhamento' || item.situacao === 'respondido'
  }
  if (grupo === 'erros') return item.situacao === 'erro'
  return false
}

function dataPertenceAoPeriodo(
  vencimento: string,
  diasRestantes: number,
  periodo: Periodo,
  dataInicial: string,
  dataFinal: string,
  anoReferencia: number,
): boolean {
  if (periodo === 'vencidos') return diasRestantes < 0
  // A janela de 30 dias mantém os vencidos visíveis, como no painel de referência:
  // eles continuam exigindo atenção até que a renovação seja registrada.
  if (periodo === 'ate_30') return diasRestantes <= 30
  if (periodo === 'de_31_a_90') return diasRestantes >= 31 && diasRestantes <= 90
  const dataVencimento = vencimento.slice(0, 10)
  if (periodo === 'ano') return dataVencimento.startsWith(`${anoReferencia}-`)
  if (dataInicial && dataVencimento < dataInicial) return false
  if (dataFinal && dataVencimento > dataFinal) return false
  return true
}

function pertenceAoPeriodo(
  item: VencimentoRenovacao,
  periodo: Periodo,
  dataInicial: string,
  dataFinal: string,
  anoReferencia: number,
): boolean {
  return dataPertenceAoPeriodo(
    item.vencimentoMaisProximo,
    item.diasRestantes,
    periodo,
    dataInicial,
    dataFinal,
    anoReferencia,
  )
}

function formatarDataHora(valor: string | null): string {
  if (!valor) return '—'
  const data = new Date(valor)
  if (Number.isNaN(data.getTime())) return '—'
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(data)
}

function distanciaDaData(valor: string | null, referencia: Date, futuro = false): string {
  if (!valor) return futuro ? 'Não agendada' : 'Nunca contatado'
  const data = new Date(valor)
  if (Number.isNaN(data.getTime())) return futuro ? 'Não agendada' : 'Data indisponível'
  const diferenca = futuro
    ? Math.ceil((data.getTime() - referencia.getTime()) / 86_400_000)
    : Math.floor((referencia.getTime() - data.getTime()) / 86_400_000)
  if (diferenca <= 0) return futuro ? 'Hoje' : 'Hoje'
  if (diferenca === 1) return futuro ? 'Em 1 dia' : 'Há 1 dia'
  return futuro ? `Em ${diferenca} dias` : `Há ${diferenca} dias`
}

function textoRenovacao(valor: string, referencia: Date): string {
  const distancia = distanciaDaData(valor, referencia)
  if (distancia === 'Hoje') return 'Renovado hoje'
  return `Renovado ${distancia.charAt(0).toLocaleLowerCase('pt-BR')}${distancia.slice(1)}`
}

function tituloProximaAcao(titulo: string, empresa: string): string {
  const normalizado = titulo.trim()
  const empresaNormalizada = empresa.trim()
  if (!empresaNormalizada) return normalizado || 'Ação agendada'
  const tituloMinusculo = normalizado.toLocaleLowerCase('pt-BR')
  const empresaMinuscula = empresaNormalizada.toLocaleLowerCase('pt-BR')
  for (const separador of [' — ', ' – ', ' - ']) {
    const sufixo = `${separador}${empresaMinuscula}`
    if (tituloMinusculo.endsWith(sufixo)) {
      return normalizado.slice(0, normalizado.length - sufixo.length).trim() || 'Ação agendada'
    }
  }
  return normalizado || 'Ação agendada'
}

function prazoVencimento(dias: number): string {
  if (dias < 0) return dias === -1 ? 'Venceu ontem' : `Venceu há ${Math.abs(dias)} dias`
  if (dias === 0) return 'Vence hoje'
  if (dias === 1) return 'Vence amanhã'
  return `Em ${dias} dias`
}

function iniciais(nome: string): string {
  return nome
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((parte) => parte[0]?.toLocaleUpperCase('pt-BR') ?? '')
    .join('') || '—'
}

function visualStatus(item: VencimentoRenovacao): { label: string; classe: string } {
  if (item.situacao === 'erro') return { label: 'Erro', classe: styles.statusError }
  if (item.diasRestantes < 0) return { label: 'Crítico', classe: styles.statusCritical }
  if (item.situacao === 'em_acompanhamento' || item.situacao === 'respondido') {
    return { label: 'Em negociação', classe: styles.statusNegotiation }
  }
  if (item.situacao === 'enviado') return { label: 'Contato enviado', classe: styles.statusSent }
  if (item.situacao === 'agendado') return { label: 'Aguardando envio', classe: styles.statusAttention }
  if (item.situacao === 'encerrado') return { label: 'Encerrado', classe: styles.statusNeutral }
  if (item.diasRestantes <= 30) return { label: 'Atenção', classe: styles.statusAttention }
  return { label: 'Não contatado', classe: styles.statusNeutral }
}

function escaparCsv(valor: string | number | null | undefined): string {
  return `"${String(valor ?? '').replace(/"/g, '""')}"`
}

function SelectFiltro({
  label,
  Icon,
  value,
  onChange,
  children,
}: {
  label: string
  Icon: typeof CalendarDays
  value: string
  onChange: (value: string) => void
  children: React.ReactNode
}) {
  return (
    <label className={styles.filterField}>
      <span className={styles.filterLabel}>{label}</span>
      <span className={styles.selectShell}>
        <Icon aria-hidden size={16} />
        <select value={value} onChange={(evento) => onChange(evento.target.value)}>
          {children}
        </select>
        <ChevronRight aria-hidden size={14} className={styles.selectChevron} />
      </span>
    </label>
  )
}

function KpiCard({
  label,
  valor,
  detalhe,
  Icon,
  tone,
}: {
  label: string
  valor: number | string
  detalhe: string
  Icon: typeof AlertTriangle
  tone: 'danger' | 'warning' | 'info' | 'success'
}) {
  return (
    <article className={`${styles.kpiCard} ${styles[`kpi${tone[0].toUpperCase()}${tone.slice(1)}`]}`}>
      <span className={styles.kpiIcon}><Icon aria-hidden size={23} /></span>
      <div className={styles.kpiCopy}>
        <span>{label}</span>
        <strong>{typeof valor === 'number' ? valor.toLocaleString('pt-BR') : valor}</strong>
        <small>{detalhe}</small>
      </div>
      <ChevronRight aria-hidden size={18} className={styles.kpiArrow} />
    </article>
  )
}

export default function VencimentosRenovacoes({
  atualizadoEm,
  vencimentos,
  tarefas,
  ciclosRenovados,
  historicoCiclosDisponivel,
  atualizando,
  onAtualizar,
  onVoltarProspeccao,
}: Props) {
  const [periodo, setPeriodo] = useState<Periodo>('ate_30')
  const [grupoStatus, setGrupoStatus] = useState<GrupoStatus>('todos')
  const [responsavel, setResponsavel] = useState('todos')
  const [tipoLaudo, setTipoLaudo] = useState('todos')
  const [busca, setBusca] = useState('')
  const [dataInicial, setDataInicial] = useState('')
  const [dataFinal, setDataFinal] = useState('')
  const [pagina, setPagina] = useState(1)
  const [selecionados, setSelecionados] = useState<Set<string>>(() => new Set())
  const [historicoAberto, setHistoricoAberto] = useState(false)
  const buscaRef = useRef<HTMLInputElement>(null)
  const referencia = useMemo(() => {
    const data = new Date(atualizadoEm)
    return Number.isNaN(data.getTime()) ? new Date() : data
  }, [atualizadoEm])
  const anoReferencia = referencia.getUTCFullYear()

  useEffect(() => {
    function focarBusca(evento: KeyboardEvent) {
      if ((evento.ctrlKey || evento.metaKey) && evento.key.toLocaleLowerCase('pt-BR') === 'k') {
        evento.preventDefault()
        buscaRef.current?.focus()
      }
    }
    window.addEventListener('keydown', focarBusca)
    return () => window.removeEventListener('keydown', focarBusca)
  }, [])

  useEffect(() => {
    if (!historicoAberto) return
    function fecharComEscape(evento: KeyboardEvent) {
      if (evento.key === 'Escape') setHistoricoAberto(false)
    }
    window.addEventListener('keydown', fecharComEscape)
    return () => window.removeEventListener('keydown', fecharComEscape)
  }, [historicoAberto])

  const responsaveis = useMemo(() => {
    const unicos = new Map<string, string>()
    for (const item of vencimentos) {
      if (item.responsavel) unicos.set(chaveResponsavel(item), item.responsavel.nome)
    }
    for (const ciclo of ciclosRenovados) {
      if (ciclo.responsavel) unicos.set(chaveDoResponsavel(ciclo.responsavel), ciclo.responsavel.nome)
    }
    return [...unicos.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'))
  }, [ciclosRenovados, vencimentos])

  const tiposLaudo = useMemo(() => {
    const unicos = new Set([
      ...vencimentos.flatMap((item) => item.motivos.map((motivo) => motivo.tipo.trim())),
      ...ciclosRenovados.map((ciclo) => ciclo.tipo.trim()),
    ].filter(Boolean))
    return [...unicos].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [ciclosRenovados, vencimentos])

  const tarefasPorLead = useMemo(() => {
    const mapa = new Map<string, TarefaRenovacao>()
    for (const tarefa of tarefas) {
      if (!tarefa.leadId || tarefa.tipo !== 'renovacao') continue
      const atual = mapa.get(tarefa.leadId)
      if (!atual || String(tarefa.prazoEm ?? '') < String(atual.prazoEm ?? '')) mapa.set(tarefa.leadId, tarefa)
    }
    return mapa
  }, [tarefas])

  const baseFiltrada = useMemo(() => {
    const termo = busca.trim().toLocaleLowerCase('pt-BR')
    return vencimentos
      .filter((item) => pertenceAoPeriodo(item, periodo, dataInicial, dataFinal, anoReferencia))
      .filter((item) => responsavel === 'todos' || chaveResponsavel(item) === responsavel)
      .filter((item) => tipoLaudo === 'todos' || item.motivos.some((motivo) => motivo.tipo === tipoLaudo))
      .filter((item) => {
        if (!termo) return true
        return [item.empresa, item.responsavel?.nome, item.campanha?.nome, ...item.motivos.map((motivo) => motivo.tipo)]
          .filter(Boolean)
          .some((valor) => valor!.toLocaleLowerCase('pt-BR').includes(termo))
      })
      .sort((a, b) => a.diasRestantes - b.diasRestantes || a.empresa.localeCompare(b.empresa, 'pt-BR'))
  }, [anoReferencia, busca, dataFinal, dataInicial, periodo, responsavel, tipoLaudo, vencimentos])

  const ciclosFiltrados = useMemo(() => {
    const termo = busca.trim().toLocaleLowerCase('pt-BR')
    return ciclosRenovados.filter((ciclo) => {
      const dias = diasAteVencimento(ciclo.validadeAnterior, referencia)
      if (dias === null || !dataPertenceAoPeriodo(ciclo.validadeAnterior, dias, periodo, dataInicial, dataFinal, anoReferencia)) return false
      if (responsavel !== 'todos' && chaveDoResponsavel(ciclo.responsavel) !== responsavel) return false
      if (tipoLaudo !== 'todos' && ciclo.tipo !== tipoLaudo) return false
      if (!termo) return true
      return [ciclo.empresa, ciclo.tipo, ciclo.responsavel?.nome]
        .filter(Boolean)
        .some((valor) => valor!.toLocaleLowerCase('pt-BR').includes(termo))
    })
  }, [anoReferencia, busca, ciclosRenovados, dataFinal, dataInicial, periodo, referencia, responsavel, tipoLaudo])

  const ciclosPendentesFiltrados = useMemo(() => {
    if (grupoStatus === 'renovados') return []
    const termo = busca.trim().toLocaleLowerCase('pt-BR')
    return vencimentos.flatMap((item) => {
      if (responsavel !== 'todos' && chaveResponsavel(item) !== responsavel) return []
      if (grupoStatus !== 'todos' && !pertenceAoGrupo(item, grupoStatus)) return []
      if (termo && ![item.empresa, item.responsavel?.nome, item.campanha?.nome, ...item.motivos.map((motivo) => motivo.tipo)]
        .filter(Boolean)
        .some((valor) => valor!.toLocaleLowerCase('pt-BR').includes(termo))) return []
      return item.motivos.filter((motivo) =>
        (tipoLaudo === 'todos' || motivo.tipo === tipoLaudo)
        && dataPertenceAoPeriodo(motivo.vencimentoEm, motivo.diasRestantes, periodo, dataInicial, dataFinal, anoReferencia),
      )
    })
  }, [anoReferencia, busca, dataFinal, dataInicial, grupoStatus, periodo, responsavel, tipoLaudo, vencimentos])

  const contagens = useMemo(() => ({
    todos: baseFiltrada.length,
    nao_contatados: baseFiltrada.filter((item) => pertenceAoGrupo(item, 'nao_contatados')).length,
    contato_enviado: baseFiltrada.filter((item) => pertenceAoGrupo(item, 'contato_enviado')).length,
    em_negociacao: baseFiltrada.filter((item) => pertenceAoGrupo(item, 'em_negociacao')).length,
    renovados: ciclosFiltrados.length,
    erros: baseFiltrada.filter((item) => pertenceAoGrupo(item, 'erros')).length,
  }), [baseFiltrada, ciclosFiltrados.length])

  const itensFiltrados = useMemo(() => {
    if (grupoStatus === 'renovados') return []
    return baseFiltrada.filter((item) => pertenceAoGrupo(item, grupoStatus))
  }, [baseFiltrada, grupoStatus])

  const totalPaginas = Math.max(1, Math.ceil(itensFiltrados.length / ITENS_POR_PAGINA))
  const paginaSegura = Math.min(pagina, totalPaginas)
  const itensDaPagina = itensFiltrados.slice((paginaSegura - 1) * ITENS_POR_PAGINA, paginaSegura * ITENS_POR_PAGINA)

  useEffect(() => {
    setPagina(1)
    setSelecionados(new Set())
  }, [busca, dataFinal, dataInicial, grupoStatus, periodo, responsavel, tipoLaudo])

  const vencidos = baseFiltrada.filter((item) => item.diasRestantes < 0).length
  const proximos30 = baseFiltrada.filter((item) => item.diasRestantes >= 0 && item.diasRestantes <= 30).length
  const emAcompanhamento = baseFiltrada.filter((item) =>
    ['agendado', 'em_acompanhamento', 'enviado', 'respondido'].includes(item.situacao),
  ).length
  const renovadosSelecao = grupoStatus === 'todos' || grupoStatus === 'renovados' ? ciclosFiltrados.length : 0
  const pendentesSelecao = ciclosPendentesFiltrados.length
  const totalSelecao = pendentesSelecao + renovadosSelecao
  const taxaRenovacao = totalSelecao > 0 ? Math.round((renovadosSelecao / totalSelecao) * 100) : 0
  const atualizado = referencia.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

  function exportar() {
    if (!itensFiltrados.length) return
    const itensParaExportar = selecionados.size
      ? itensFiltrados.filter((item) => selecionados.has(item.chave))
      : itensFiltrados
    const cabecalho = ['Cliente', 'Tipo de laudo', 'Vencimento', 'Status', 'Último contato', 'Próxima ação', 'Responsável']
    const linhas = itensParaExportar.map((item) => {
      const tarefa = item.leadId ? tarefasPorLead.get(item.leadId) : undefined
      return [
        item.empresa,
        item.motivos.map((motivo) => motivo.tipo).join(', '),
        item.vencimentoMaisProximo,
        visualStatus(item).label,
        item.ultimoContato,
        tarefa?.prazoEm ?? item.proximaAcaoEm,
        item.responsavel?.nome ?? 'Sem responsável',
      ].map(escaparCsv).join(';')
    })
    const csv = `\uFEFF${cabecalho.map(escaparCsv).join(';')}\r\n${linhas.join('\r\n')}`
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `vencimentos-renovacoes-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  function selecionarPagina(selecionar: boolean) {
    setSelecionados((atuais) => {
      const proximos = new Set(atuais)
      for (const item of itensDaPagina) {
        if (selecionar) proximos.add(item.chave)
        else proximos.delete(item.chave)
      }
      return proximos
    })
  }

  function selecionarItem(chave: string, selecionar: boolean) {
    setSelecionados((atuais) => {
      const proximos = new Set(atuais)
      if (selecionar) proximos.add(chave)
      else proximos.delete(chave)
      return proximos
    })
  }

  const paginaTodaSelecionada = itensDaPagina.length > 0 && itensDaPagina.every((item) => selecionados.has(item.chave))

  const gruposVisiveis: GrupoStatus[] = [
    'todos',
    'nao_contatados',
    'contato_enviado',
    'em_negociacao',
    ...(contagens.erros ? ['erros' as const] : []),
    'renovados',
  ]

  return (
    <section className={styles.screen}>
      <header className={styles.pageHeader}>
        <div>
          <nav className={styles.viewTabs} aria-label="Visão do Dashboard">
            {onVoltarProspeccao ? (
              <button type="button" onClick={onVoltarProspeccao}>Prospecção</button>
            ) : null}
            <span className={styles.viewTabActive} aria-current="page">Vencimentos e renovações</span>
          </nav>
          <h1>Vencimentos e renovações</h1>
          <p>Acompanhe vencimentos, contatos e histórico de renovações dos seus clientes.</p>
        </div>
        <div className={styles.headerActions}>
          <button type="button" className={styles.updatedButton} onClick={onAtualizar} disabled={atualizando}>
            <RefreshCw aria-hidden size={13} className={atualizando ? styles.spinning : undefined} />
            Atualizado às {atualizado}
          </button>
          <Link href="/campanhas/nova?tipo=renovacao" className={styles.primaryButton}>
            <span aria-hidden>+</span> Criar campanha de renovação
          </Link>
        </div>
      </header>

      <section className={styles.filtersPanel} aria-label="Filtros de vencimentos e renovações">
        <div className={styles.filterGrid}>
          <SelectFiltro label="Período" Icon={CalendarDays} value={periodo} onChange={(valor) => setPeriodo(valor as Periodo)}>
            <option value="vencidos">Vencidos</option>
            <option value="ate_30">Próximos 30 dias</option>
            <option value="de_31_a_90">Próximos 30 a 90 dias</option>
            <option value="ano">Este ano</option>
            <option value="personalizado">Personalizado</option>
          </SelectFiltro>
          <SelectFiltro label="Status" Icon={FileClock} value={grupoStatus} onChange={(valor) => setGrupoStatus(valor as GrupoStatus)}>
            {gruposVisiveis.map((grupo) => <option key={grupo} value={grupo}>{ROTULOS_STATUS[grupo]}</option>)}
          </SelectFiltro>
          <SelectFiltro label="Responsável" Icon={UserRound} value={responsavel} onChange={setResponsavel}>
            <option value="todos">Todos os responsáveis</option>
            {responsaveis.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
            <option value="sem_responsavel">Sem responsável</option>
          </SelectFiltro>
          <SelectFiltro label="Tipo de laudo" Icon={FileText} value={tipoLaudo} onChange={setTipoLaudo}>
            <option value="todos">Todos os tipos</option>
            {tiposLaudo.map((tipo) => <option key={tipo} value={tipo}>{tipo}</option>)}
          </SelectFiltro>
        </div>

        {periodo === 'personalizado' && (
          <div className={styles.customPeriod}>
            <label>
              <span>Data inicial</span>
              <input type="date" value={dataInicial} max={dataFinal || undefined} onChange={(evento) => setDataInicial(evento.target.value)} />
            </label>
            <label>
              <span>Data final</span>
              <input type="date" value={dataFinal} min={dataInicial || undefined} onChange={(evento) => setDataFinal(evento.target.value)} />
            </label>
          </div>
        )}

        <label className={styles.searchField}>
          <Search aria-hidden size={17} />
          <span className="sr-only">Buscar cliente ou empresa</span>
          <input ref={buscaRef} value={busca} onChange={(evento) => setBusca(evento.target.value)} placeholder="Buscar cliente, empresa, responsável ou laudo..." />
          <kbd>Ctrl</kbd><kbd>K</kbd>
        </label>
      </section>

      <section className={styles.kpiGrid} aria-label="Resumo de vencimentos e renovações">
        <KpiCard label="Vencidos no período" valor={vencidos} detalhe="Exigem ação imediata" Icon={AlertTriangle} tone="danger" />
        <KpiCard label="Vencem em até 30 dias" valor={proximos30} detalhe="Dentro da seleção atual" Icon={Clock3} tone="warning" />
        <KpiCard label="Em acompanhamento" valor={emAcompanhamento} detalhe="Com tratativa em andamento" Icon={UsersRound} tone="info" />
        <KpiCard label="Renovados no período" valor={historicoCiclosDisponivel ? renovadosSelecao : '—'} detalhe="Concluídos no período selecionado" Icon={CheckCircle2} tone="success" />
      </section>

      <nav className={styles.statusTabs} aria-label="Situação dos clientes">
        {gruposVisiveis.map((grupo) => (
          <button
            key={grupo}
            type="button"
            onClick={() => setGrupoStatus(grupo)}
            aria-pressed={grupoStatus === grupo}
            className={grupoStatus === grupo ? styles.statusTabActive : undefined}
          >
            {ROTULOS_STATUS[grupo]}
            <span>{contagens[grupo].toLocaleString('pt-BR')}</span>
          </button>
        ))}
      </nav>

      <section className={styles.queuePanel}>
        <header className={styles.queueHeader}>
          <div>
            <h2><span aria-hidden className={styles.queueIcon}>≡</span> Fila de vencimentos e renovações</h2>
            <p>Clientes com laudos a vencer no período selecionado.</p>
          </div>
          <button type="button" className={styles.exportButton} onClick={exportar} disabled={!itensFiltrados.length}>
            <Download aria-hidden size={15} /> Exportar{selecionados.size ? ` (${selecionados.size})` : ''}
          </button>
        </header>

        {grupoStatus === 'renovados' ? (
          <div className={styles.emptyState}>
            <History aria-hidden size={24} />
            <strong>{historicoCiclosDisponivel ? `${renovadosSelecao.toLocaleString('pt-BR')} renovações no período` : 'Histórico de ciclos indisponível'}</strong>
            <p>{historicoCiclosDisponivel ? 'As renovações detalhadas aparecem no card de histórico abaixo.' : 'A fila aberta continua disponível, mas este ambiente ainda não oferece a consulta de laudo_ciclos.'}</p>
          </div>
        ) : itensFiltrados.length === 0 ? (
          <div className={styles.emptyState}>
            <Search aria-hidden size={24} />
            <strong>Nenhum cliente encontrado</strong>
            <p>Altere os filtros para consultar outra parte da fila de renovação.</p>
          </div>
        ) : (
          <div className={styles.tableScroller}>
            <table>
              <thead>
                <tr>
                  <th className={styles.checkboxCell}>
                    <input
                      type="checkbox"
                      aria-label="Selecionar clientes desta página"
                      checked={paginaTodaSelecionada}
                      onChange={(evento) => selecionarPagina(evento.target.checked)}
                    />
                  </th>
                  <th>Cliente</th>
                  <th>Vencimento</th>
                  <th>Status</th>
                  <th>Último contato</th>
                  <th>Próxima ação</th>
                  <th>Responsável</th>
                  <th className={styles.actionCell}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {itensDaPagina.map((item) => {
                  const status = visualStatus(item)
                  const tarefa = item.leadId ? tarefasPorLead.get(item.leadId) : undefined
                  const proximaData = tarefa?.prazoEm ?? item.proximaAcaoEm
                  const nomeResponsavel = item.responsavel?.nome ?? 'Sem responsável'
                  return (
                    <tr key={item.chave}>
                      <td className={styles.checkboxCell}>
                        <input
                          type="checkbox"
                          aria-label={`Selecionar ${item.empresa}`}
                          checked={selecionados.has(item.chave)}
                          onChange={(evento) => selecionarItem(item.chave, evento.target.checked)}
                        />
                      </td>
                      <td>
                        <strong className={styles.clientName} title={item.empresa}>{item.empresa}</strong>
                        <span className={styles.clientDetail} title={item.motivos.map((motivo) => motivo.tipo).join(', ')}>
                          {item.motivos.map((motivo) => motivo.tipo).join(' · ')}
                        </span>
                      </td>
                      <td>
                        <strong className={item.diasRestantes < 0 ? styles.dangerText : item.diasRestantes <= 30 ? styles.warningText : undefined}>
                          {formatarDataIsoSemFuso(item.vencimentoMaisProximo)}
                        </strong>
                        <span className={item.diasRestantes < 0 ? styles.dangerText : item.diasRestantes <= 30 ? styles.warningText : styles.secondaryText}>
                          {prazoVencimento(item.diasRestantes)}
                        </span>
                      </td>
                      <td><span className={`${styles.statusBadge} ${status.classe}`}>{status.label}</span></td>
                      <td>
                        <strong>{formatarDataHora(item.ultimoContato)}</strong>
                        <span className={styles.secondaryText}>{distanciaDaData(item.ultimoContato, referencia)}</span>
                      </td>
                      <td>
                        {proximaData ? (
                          <>
                            <strong className={styles.nextAction}>{tarefa ? tituloProximaAcao(tarefa.titulo, item.empresa) : 'Ação agendada'}</strong>
                            <span className={styles.secondaryText}>{distanciaDaData(proximaData, referencia, true)}</span>
                          </>
                        ) : <span className={styles.noNextAction}>Sem próxima ação</span>}
                      </td>
                      <td>
                        <span className={styles.owner}>
                          <span className={styles.avatar}>{iniciais(nomeResponsavel)}</span>
                          <span title={nomeResponsavel}>{nomeResponsavel}</span>
                        </span>
                      </td>
                      <td className={styles.actionCell}>
                        {item.leadId ? (
                          <Link href={`/leads/${item.leadId}`} aria-label={`Abrir ${item.empresa}`} title="Abrir cliente">
                            <MoreVertical aria-hidden size={17} />
                          </Link>
                        ) : (
                          <span className={styles.disabledAction} title="Cliente sem lead associado"><MoreVertical aria-hidden size={17} /></span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <footer className={styles.queueFooter}>
          <span>
            Mostrando {itensFiltrados.length ? (paginaSegura - 1) * ITENS_POR_PAGINA + 1 : 0}–{Math.min(paginaSegura * ITENS_POR_PAGINA, itensFiltrados.length)} de {itensFiltrados.length} clientes
          </span>
          <div className={styles.pagination}>
            <button type="button" onClick={() => setPagina((atual) => Math.max(1, atual - 1))} disabled={paginaSegura === 1} aria-label="Página anterior"><ChevronLeft size={15} /></button>
            {Array.from({ length: Math.min(totalPaginas, 3) }, (_, indice) => indice + 1).map((numero) => (
              <button key={numero} type="button" onClick={() => setPagina(numero)} className={paginaSegura === numero ? styles.currentPage : undefined}>{numero}</button>
            ))}
            {totalPaginas > 3 && <span>…</span>}
            {totalPaginas > 3 && <button type="button" onClick={() => setPagina(totalPaginas)} className={paginaSegura === totalPaginas ? styles.currentPage : undefined}>{totalPaginas}</button>}
            <button type="button" onClick={() => setPagina((atual) => Math.min(totalPaginas, atual + 1))} disabled={paginaSegura === totalPaginas} aria-label="Próxima página"><ChevronRight size={15} /></button>
          </div>
        </footer>
      </section>

      <section className={styles.bottomGrid}>
        <article className={styles.analysisPanel}>
          <header>
            <span className={styles.analysisIcon} aria-hidden>▥</span>
            <div>
              <h2>Resumo do período</h2>
              <p>Indicadores calculados a partir do período e dos filtros selecionados.</p>
            </div>
          </header>
          <div className={styles.analysisMetrics}>
            <div><Database size={17} /><strong>{historicoCiclosDisponivel ? totalSelecao : '—'}</strong><span>Total na seleção</span></div>
            <div><CheckCircle2 size={17} /><strong>{historicoCiclosDisponivel ? renovadosSelecao : '—'}</strong><span>Renovados</span></div>
            <div><AlertTriangle size={17} /><strong>{pendentesSelecao}</strong><span>Pendentes</span></div>
            <div><History size={17} /><strong>{historicoCiclosDisponivel ? `${taxaRenovacao}%` : '—'}</strong><span>Taxa de renovação</span></div>
          </div>
        </article>

        <article className={styles.latestPanel}>
          <header>
            <h2><History aria-hidden size={17} /> Últimas renovações</h2>
            <button type="button" onClick={() => setHistoricoAberto(true)} disabled={!ciclosRenovados.length}>
              Ver histórico completo <ChevronRight aria-hidden size={13} />
            </button>
          </header>
          {!historicoCiclosDisponivel ? (
            <p className={styles.historyEmpty}>O histórico de ciclos não está disponível neste ambiente.</p>
          ) : ciclosRenovados.length === 0 ? (
            <p className={styles.historyEmpty}>Nenhuma renovação registrada ainda.</p>
          ) : (
            <div className={styles.latestList}>
              {ciclosRenovados.slice(0, 4).map((ciclo) => (
                <div key={ciclo.id} className={styles.latestItem}>
                  <div>
                    <strong title={ciclo.empresa}>{ciclo.empresa}</strong>
                    <span>
                      {formatarDataIsoSemFuso(ciclo.validadeAnterior)} <ChevronRight aria-hidden size={11} /> {ciclo.novaValidade ? formatarDataIsoSemFuso(ciclo.novaValidade) : 'Nova validade não registrada'}
                    </span>
                  </div>
                  <time dateTime={ciclo.renovadoEm}>{textoRenovacao(ciclo.renovadoEm, referencia)}</time>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>

      {historicoAberto && (
        <div className={styles.historyBackdrop} role="presentation" onMouseDown={(evento) => {
          if (evento.target === evento.currentTarget) setHistoricoAberto(false)
        }}>
          <section className={styles.historyDialog} role="dialog" aria-modal="true" aria-labelledby="titulo-historico-renovacoes">
            <header>
              <div>
                <h2 id="titulo-historico-renovacoes">Histórico completo de renovações</h2>
                <p>Ciclos encerrados e respectivas novas validades.</p>
              </div>
              <button type="button" onClick={() => setHistoricoAberto(false)} aria-label="Fechar histórico">×</button>
            </header>
            <div className={styles.historyDialogList}>
              {ciclosRenovados.map((ciclo) => (
                <div key={ciclo.id} className={styles.historyDialogItem}>
                  <div>
                    <strong>{ciclo.empresa}</strong>
                    <span>{ciclo.responsavel?.nome ?? 'Sem responsável'}</span>
                  </div>
                  <div>
                    <strong>{formatarDataIsoSemFuso(ciclo.validadeAnterior)} <ChevronRight aria-hidden size={12} /> {ciclo.novaValidade ? formatarDataIsoSemFuso(ciclo.novaValidade) : 'Não registrada'}</strong>
                    <time dateTime={ciclo.renovadoEm}>{textoRenovacao(ciclo.renovadoEm, referencia)}</time>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </section>
  )
}
