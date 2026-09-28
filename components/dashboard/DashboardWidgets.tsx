'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  BriefcaseBusiness,
  CalendarCheck,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  ListTodo,
  Mail,
  MailCheck,
  MapPin,
  MessageSquare,
  Minus,
  MoreVertical,
  RefreshCw,
  Search,
  Send,
  ShoppingCart,
  Store,
  Target,
  TrendingDown,
  TrendingUp,
  UserRound,
  Users,
  Utensils,
} from 'lucide-react'
import { formatarDataIsoSemFuso } from '@/lib/servicos/vencimento'
import type { ClienteControleVencimento, SituacaoRenovacao } from '@/lib/operacao/dashboard'
import type { ObjetivoOperacional } from '@/lib/config/workspaceConfig'
import VencimentosRenovacoes from '@/components/dashboard/renewals/VencimentosRenovacoes'
import styles from './ProspeccaoDashboard.module.css'

interface ComunicacaoRenovacao {
  id: string
  leadId: string
  empresaId: string | null
  empresa: string
  enviadaEm: string
  origem: string
}

interface ClienteVencimentoDashboard extends ClienteControleVencimento {
  ultimaMensagem: ComunicacaoRenovacao | null
  ultimaRespostaEm: string | null
  ultimoContato: string | null
  proximaAcaoEm: string | null
  situacao: SituacaoRenovacao
  responsavel: { id: string | null; nome: string } | null
  campanha: { id: string; nome: string } | null
  execucao: {
    id: string
    status: string
    iniciadaEm: string
    atualizadaEm: string
    proximaVerificacaoEm: string | null
  } | null
}

interface TarefaDashboard {
  id: string
  leadId: string | null
  cliente: string | null
  titulo: string
  prioridade: string
  prazoEm: string | null
  tipo: string | null
}

interface AtividadeProspeccaoDashboard {
  id: string
  leadId: string
  empresa: string
  tipo: string
  canal: string | null
  descricao: string | null
  realizadaEm: string
}

interface IndicadorProspeccaoDashboard {
  atual: number
  anterior: number
  variacao: number
  serie: number[]
}

interface DistribuicaoProspeccaoDashboard {
  nome: string
  quantidade: number
  percentual: number
}

interface ResumoDashboard {
  atualizadoEm: string
  antecedenciaDias: number
  visaoProspeccao: {
    modo: 'equipe' | 'individual'
    podeVerEquipe: boolean
    responsavel: { authId: string; id: string; nome: string } | null
    responsaveis: { authId: string; nome: string }[]
  }
  operacao: {
    objetivoPrincipal: ObjetivoOperacional
    objetivosAtivos: ObjetivoOperacional[]
    relatorioSemanal: boolean
    metasMensais: { contatos?: number; reunioes?: number; renovacoes?: number }
  }
  resumo: {
    leads: number
    tarefasAbertas: number
    oportAbertas: number
    pipeline: number
    campanhasAtivas: number
    renovacoesJanela: number
    validade: {
      vencidos: number
      proximos30: number
      entre31e60: number
      proximos60: number
      totalComData: number
      servicos: number
      legados: number
    }
  }
  prospeccao: {
    novos: number
    clientesContatados: number
    mensagensEnviadas: number
    respostas: number
    reunioes: number
    atividades: AtividadeProspeccaoDashboard[]
    indicadores: {
      novos: IndicadorProspeccaoDashboard
      mensagens: IndicadorProspeccaoDashboard
      respostas: IndicadorProspeccaoDashboard
      oportunidades: IndicadorProspeccaoDashboard
    }
    followUps: {
      clientes: number
      clientesAnteriores: number
      retornos: number
      retornosAnteriores: number
      serie: number[]
    }
    nichos: DistribuicaoProspeccaoDashboard[]
    respostasPorNichoRegiao: DistribuicaoProspeccaoDashboard[]
  }
  renovacoes: {
    renovadosMes: number
    empresas: {
      vencidas: number
      proximos30: number
      entre31e60: number
      proximos60: number
      totalMonitoradas: number
    }
    comunicacoes: ComunicacaoRenovacao[]
    situacoes: Record<SituacaoRenovacao, number>
    ciclosRenovados: {
      id: string
      leadId: string
      empresa: string
      tipo: string
      validadeAnterior: string
      novaValidade: string | null
      renovadoEm: string
      responsavel: { id: string | null; nome: string } | null
    }[]
    historicoCiclosDisponivel: boolean
  }
  metasAtuais: { contatos: number; reunioes: number; renovacoes: number }
  vencimentos: ClienteVencimentoDashboard[]
  tarefas: TarefaDashboard[]
}

const ROTULO_OBJETIVO: Record<ObjetivoOperacional, string> = {
  prospeccao: 'Prospecção',
  vencimentos_laudos: 'Vencimentos e renovações',
}

function CabecalhoDashboard() {
  return (
    <header>
      <h1 className="text-2xl font-bold text-slate-100">Dashboard</h1>
      <p className="mt-0.5 text-sm text-slate-400">
        Acompanhe cada área da operação em seu próprio painel.
      </p>
    </header>
  )
}

type JanelaRenovacao = 'todas' | 'vencidas' | 'ate_30' | 'de_31_a_60'
type FiltroSituacaoRenovacao = 'todas' | 'pendentes' | 'agendadas' | 'comunicadas' | 'respondidas' | 'erros'

const ROTULO_SITUACAO: Record<SituacaoRenovacao, { label: string; cls: string }> = {
  nao_comunicado: { label: 'Não comunicado', cls: 'bg-slate-500/15 text-slate-400' },
  agendado: { label: 'Aguardando envio', cls: 'bg-amber-500/15 text-amber-400' },
  em_acompanhamento: { label: 'Follow-up agendado', cls: 'bg-cyan-500/15 text-cyan-400' },
  enviado: { label: 'Comunicado', cls: 'bg-emerald-500/15 text-emerald-400' },
  respondido: { label: 'Cliente respondeu', cls: 'bg-violet-500/15 text-violet-400' },
  erro: { label: 'Erro no fluxo', cls: 'bg-rose-500/15 text-rose-400' },
  encerrado: { label: 'Encerrado sem envio', cls: 'bg-slate-500/15 text-slate-500' },
}

function Kpi({ label, valor, Icon, cor, detalhe }: {
  label: string
  valor: number
  Icon: typeof Users
  cor: string
  detalhe?: string
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
      <div className="flex items-center gap-2 text-xs text-slate-500"><Icon size={14} className={cor} /> {label}</div>
      <div className={`mt-2 text-2xl font-bold tabular-nums ${cor}`}>{valor.toLocaleString('pt-BR')}</div>
      {detalhe && <p className="mt-1 text-xs text-slate-600">{detalhe}</p>}
    </div>
  )
}

function MetaCard({ label, atual, meta, cor }: { label: string; atual: number; meta?: number; cor: string }) {
  const percentual = meta ? Math.min(100, Math.round((atual / meta) * 100)) : 0
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-base)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs text-slate-500">{label}</p>
          <p className="mt-1 text-lg font-bold text-slate-100">
            {atual.toLocaleString('pt-BR')}{meta ? <span className="text-sm font-normal text-slate-500"> / {meta.toLocaleString('pt-BR')}</span> : null}
          </p>
        </div>
        <span className={`text-xs font-semibold ${meta ? cor : 'text-slate-600'}`}>{meta ? `${percentual}%` : 'Sem meta'}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--bg-input)]">
        <div className={`h-full rounded-full ${cor.replace('text-', 'bg-')}`} style={{ width: `${percentual}%` }} />
      </div>
    </div>
  )
}

function statusVisual(status: ClienteControleVencimento['status']) {
  if (status === 'vencido') return { label: 'Vencido', cls: 'bg-rose-500/15 text-rose-400' }
  if (status === 'critico') return { label: 'Crítico', cls: 'bg-red-500/15 text-red-400' }
  if (status === 'atencao') return { label: 'Atenção', cls: 'bg-amber-500/15 text-amber-400' }
  return { label: 'No prazo', cls: 'bg-emerald-500/15 text-emerald-400' }
}

function prazoHumano(dias: number) {
  if (dias < 0) return `${Math.abs(dias)} dia${Math.abs(dias) === 1 ? '' : 's'} vencido`
  if (dias === 0) return 'Vence hoje'
  return `${dias} dia${dias === 1 ? '' : 's'}`
}

function formatarPrazoTarefa(valor: string | null) {
  if (!valor) return 'Sem prazo'
  const data = new Date(valor)
  if (Number.isNaN(data.getTime())) return 'Sem prazo'
  return data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

function formatarDataHora(valor: string) {
  const data = new Date(valor)
  if (Number.isNaN(data.getTime())) return 'Data indisponível'
  return data.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const ROTULO_ATIVIDADE: Record<string, { label: string; cls: string }> = {
  novo_lead: { label: 'Novo lead', cls: styles.activityBadgeLead },
  abordagem: { label: 'Prospecção enviada', cls: 'bg-indigo-500/15 text-indigo-300' },
  nota: { label: 'Mensagem enviada', cls: 'bg-indigo-500/15 text-indigo-300' },
  follow_up: { label: 'Follow-up realizado', cls: 'bg-sky-500/15 text-sky-300' },
  resposta: { label: 'Resposta recebida', cls: 'bg-emerald-500/15 text-emerald-300' },
  reuniao: { label: 'Reunião registrada', cls: 'bg-violet-500/15 text-violet-300' },
}

function ProximasAcoes({ tarefas, titulo }: { tarefas: TarefaDashboard[]; titulo: string }) {
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-semibold text-slate-100"><Clock3 size={16} className="text-cyan-400" /> {titulo}</h2>
        <Link href="/automacao?tab=execucoes" className="text-xs text-indigo-400 hover:underline">Ver todas</Link>
      </div>
      {tarefas.length === 0 ? (
        <div className="py-10 text-center text-sm text-slate-500">Nenhuma tarefa aberta neste módulo.</div>
      ) : (
        <div className="mt-4 space-y-2">
          {tarefas.map((tarefa) => {
            const conteudo = (
              <div className="flex items-center gap-3 rounded-lg border border-[var(--border)] p-3 transition-colors hover:bg-[var(--bg-base)]">
                <ListTodo size={15} className={tarefa.prioridade === 'alta' ? 'text-rose-400' : 'text-cyan-400'} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-slate-200">{tarefa.titulo}</p>
                  {tarefa.cliente && <p className="truncate text-xs text-slate-500">{tarefa.cliente}</p>}
                </div>
                <span className="text-xs text-slate-500">{formatarPrazoTarefa(tarefa.prazoEm)}</span>
              </div>
            )
            return tarefa.leadId
              ? <Link key={tarefa.id} href={`/leads/${tarefa.leadId}`}>{conteudo}</Link>
              : <div key={tarefa.id}>{conteudo}</div>
          })}
        </div>
      )}
    </section>
  )
}

function variacaoVisual(atual: number, anterior: number) {
  if (anterior <= 0) return atual > 0 ? 100 : 0
  return Math.round(((atual - anterior) / anterior) * 100)
}

function Tendencia({ valor, legenda = 'vs. 30 dias anteriores' }: { valor: number; legenda?: string }) {
  const Icon = valor > 0 ? TrendingUp : valor < 0 ? TrendingDown : Minus
  const sinal = valor > 0 ? '+' : ''
  return (
    <div className={styles.trendBlock}>
      <span className={`${styles.trendValue} ${valor > 0 ? styles.trendPositive : valor < 0 ? styles.trendNegative : styles.trendNeutral}`}>
        <Icon size={14} aria-hidden="true" /> {sinal}{valor}%
      </span>
      <span className={styles.trendCaption}>{legenda}</span>
    </div>
  )
}

function caminhoDaSerie(serie: number[], largura: number, altura: number, margem: number) {
  const valores = serie.length > 1 ? serie : [0, ...(serie.length ? serie : [0])]
  const maximo = Math.max(1, ...valores)
  return valores.map((valor, indice) => {
    const x = margem + (indice / (valores.length - 1)) * (largura - margem * 2)
    const y = altura - margem - (valor / maximo) * (altura - margem * 2)
    return { x, y }
  })
}

function MiniGrafico({ serie, tipo = 'linha' }: { serie: number[]; tipo?: 'linha' | 'barras' }) {
  const gradienteId = useId().replace(/:/g, '')
  if (tipo === 'barras') {
    const maximo = Math.max(1, ...serie)
    return (
      <div className={styles.miniBars} aria-hidden="true">
        {serie.map((valor, indice) => (
          <span key={indice} style={{ height: `${Math.round((valor / maximo) * 100)}%` }} />
        ))}
      </div>
    )
  }

  const pontos = caminhoDaSerie(serie, 120, 42, 3)
  const linha = pontos.map((ponto, indice) => `${indice === 0 ? 'M' : 'L'} ${ponto.x} ${ponto.y}`).join(' ')
  const area = `${linha} L ${pontos[pontos.length - 1].x} 42 L ${pontos[0].x} 42 Z`
  return (
    <svg className={styles.miniLine} viewBox="0 0 120 42" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={gradienteId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.32" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradienteId})`} />
      <path d={linha} fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const KPI_TONS = {
  cyan: styles.kpiCyan,
  violet: styles.kpiViolet,
  emerald: styles.kpiEmerald,
  amber: styles.kpiAmber,
}

function KpiProspeccao({
  titulo,
  subtitulo,
  indicador,
  Icon,
  tom,
  grafico = 'linha',
}: {
  titulo: string
  subtitulo: string
  indicador: IndicadorProspeccaoDashboard
  Icon: typeof Users
  tom: keyof typeof KPI_TONS
  grafico?: 'linha' | 'barras'
}) {
  return (
    <article className={`${styles.kpiCard} ${KPI_TONS[tom]}`}>
      <div className={styles.kpiTop}>
        <span className={styles.kpiIcon}><Icon size={25} strokeWidth={1.8} aria-hidden="true" /></span>
        <div className={styles.kpiIdentity}>
          <span className={styles.kpiLabel}>{titulo}</span>
          <strong>{indicador.atual.toLocaleString('pt-BR')}</strong>
        </div>
        <ChevronRight className={styles.kpiArrow} size={22} aria-hidden="true" />
      </div>
      <div className={styles.kpiMiddle}>
        <Tendencia valor={indicador.variacao} />
        <MiniGrafico serie={indicador.serie} tipo={grafico} />
      </div>
      <span className={styles.kpiSubtitle}>{subtitulo}</span>
    </article>
  )
}

function GraficoFollowUps({ serie }: { serie: number[] }) {
  const pontos = caminhoDaSerie(serie, 360, 78, 5)
  const linha = pontos.map((ponto, indice) => `${indice === 0 ? 'M' : 'L'} ${ponto.x} ${ponto.y}`).join(' ')
  const area = `${linha} L ${pontos[pontos.length - 1].x} 78 L ${pontos[0].x} 78 Z`
  return (
    <div className={styles.followChart}>
      <svg viewBox="0 0 360 78" preserveAspectRatio="none" aria-label="Evolução de follow-ups nos últimos 30 dias">
        <defs>
          <linearGradient id="dashboard-follow-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#8b5cf6" stopOpacity="0.48" />
            <stop offset="1" stopColor="#8b5cf6" stopOpacity="0.03" />
          </linearGradient>
        </defs>
        <line x1="0" y1="76" x2="360" y2="76" className={styles.chartGridLine} />
        <line x1="0" y1="39" x2="360" y2="39" className={styles.chartGridLine} />
        <path d={area} fill="url(#dashboard-follow-area)" />
        <path d={linha} className={styles.followLine} />
      </svg>
      <div className={styles.chartLabels}><span>30 dias</span><span>15 dias</span><span>Hoje</span></div>
    </div>
  )
}

function formatarNomeAgrupamento(nome: string) {
  return nome.replace(/(^|\s)([a-zá-ú])/g, (_, espaco: string, letra: string) => `${espaco}${letra.toLocaleUpperCase('pt-BR')}`)
}

function iconeDoNicho(nome: string) {
  const normalizado = nome.toLocaleLowerCase('pt-BR')
  if (/aliment|restaurante|comida/.test(normalizado)) return Utensils
  if (/varejo|loja|com[eé]rcio/.test(normalizado)) return ShoppingCart
  if (/buffet|evento|festa/.test(normalizado)) return Store
  return BriefcaseBusiness
}

function CabecalhoBloco({ Icon, titulo, subtitulo }: {
  Icon: typeof Users
  titulo: string
  subtitulo: string
}) {
  return (
    <div className={styles.sectionHeading}>
      <span className={styles.sectionIcon}><Icon size={19} aria-hidden="true" /></span>
      <div><h2>{titulo}</h2><p>{subtitulo}</p></div>
    </div>
  )
}

function PainelProspeccao({
  dados,
}: {
  dados: ResumoDashboard
}) {
  const indicadores = dados.prospeccao.indicadores
  const followUps = dados.prospeccao.followUps

  return (
    <div className={styles.dashboardContent}>
      <section className={styles.kpiGrid} aria-label="Indicadores de prospecção">
        <KpiProspeccao titulo="Novos leads" subtitulo="Últimos 30 dias" indicador={indicadores.novos} Icon={Users} tom="cyan" />
        <KpiProspeccao titulo="Mensagens enviadas" subtitulo="Abordagens e follow-ups" indicador={indicadores.mensagens} Icon={Mail} tom="violet" grafico="barras" />
        <KpiProspeccao titulo="Respostas recebidas" subtitulo="Últimos 30 dias" indicador={indicadores.respostas} Icon={MessageSquare} tom="emerald" />
        <KpiProspeccao titulo="Oportunidades qualificadas" subtitulo="Repassadas ao comercial" indicador={indicadores.oportunidades} Icon={Target} tom="amber" grafico="barras" />
      </section>

      <section className={styles.activityCard}>
        <div className={styles.activityHeader}>
          <CabecalhoBloco Icon={ListTodo} titulo="Atividade comercial registrada" subtitulo="Últimas mensagens, respostas e movimentações da carteira selecionada." />
          <Link href="/automacao?tab=execucoes" className={styles.historyLink}>Ver histórico <ArrowRight size={14} aria-hidden="true" /></Link>
        </div>
        {dados.prospeccao.atividades.length === 0 ? (
          <div className={styles.emptyState}>Nenhuma atividade registrada nos últimos 30 dias.</div>
        ) : (
          <div className={styles.activityList}>
            {dados.prospeccao.atividades.slice(0, 2).map((atividade) => {
              const visual = ROTULO_ATIVIDADE[atividade.tipo] ?? { label: 'Atividade registrada', cls: styles.activityBadgeDefault }
              return (
                <Link key={atividade.id} href={`/leads/${atividade.leadId}`} className={styles.activityRow}>
                  <span className={`${styles.activityBadge} ${visual.cls}`}>{visual.label}</span>
                  <strong>{atividade.empresa}</strong>
                  <span className={styles.activityDescription}>{atividade.descricao || 'Movimentação registrada no histórico do lead.'}</span>
                  <time dateTime={atividade.realizadaEm}>{formatarDataHora(atividade.realizadaEm)}</time>
                  <MoreVertical size={17} aria-hidden="true" />
                </Link>
              )
            })}
          </div>
        )}
      </section>

      <div className={styles.insightsGrid}>
        <section className={styles.insightCard}>
          <CabecalhoBloco Icon={RefreshCw} titulo="Follow-ups" subtitulo="Situação operacional da carteira ativa." />
          <div className={styles.followSummary}>
            <article className={styles.followMetric}>
              <Users size={23} aria-hidden="true" />
              <span>Clientes em FUP</span>
              <div><strong>{followUps.clientes.toLocaleString('pt-BR')}</strong><Tendencia valor={variacaoVisual(followUps.clientes, followUps.clientesAnteriores)} legenda="vs. mês anterior" /></div>
            </article>
            <article className={styles.followMetric}>
              <Clock3 size={23} aria-hidden="true" />
              <span>Retornos de FUP</span>
              <div><strong>{followUps.retornos.toLocaleString('pt-BR')}</strong><Tendencia valor={variacaoVisual(followUps.retornos, followUps.retornosAnteriores)} legenda="vs. mês anterior" /></div>
            </article>
          </div>
          <p className={styles.chartTitle}>Evolução de follow-ups (últimos 30 dias)</p>
          <GraficoFollowUps serie={followUps.serie} />
        </section>

        <section className={styles.insightCard}>
          <CabecalhoBloco Icon={BarChart3} titulo="Nichos abordados" subtitulo="Distribuição dos leads trabalhados por segmento." />
          {dados.prospeccao.nichos.length === 0 ? (
            <div className={styles.emptyState}>Nenhum nicho abordado nos últimos 30 dias.</div>
          ) : (
            <div className={styles.barList}>
              {dados.prospeccao.nichos.map((item) => {
                const Icon = iconeDoNicho(item.nome)
                return (
                  <div className={styles.barRow} key={item.nome}>
                    <Icon size={20} aria-hidden="true" />
                    <span title={item.nome}>{formatarNomeAgrupamento(item.nome)}</span>
                    <div className={styles.barTrack}><i style={{ width: `${item.percentual}%` }} /></div>
                    <strong>{item.quantidade.toLocaleString('pt-BR')}</strong>
                    <small>{item.percentual}%</small>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        <section className={styles.insightCard}>
          <CabecalhoBloco Icon={MapPin} titulo="Resposta por nicho / região" subtitulo="Onde a prospecção está gerando retorno." />
          {dados.prospeccao.respostasPorNichoRegiao.length === 0 ? (
            <div className={styles.responseEmpty}>Nenhuma resposta com nicho e região no período.</div>
          ) : (
            <div className={styles.responseList}>
              {dados.prospeccao.respostasPorNichoRegiao.map((item) => (
                <div className={styles.responseRow} key={item.nome}>
                  <span title={item.nome}>{formatarNomeAgrupamento(item.nome)}</span>
                  <div className={styles.responseTrack}><i style={{ width: `${item.percentual}%` }} /></div>
                  <strong>{item.quantidade.toLocaleString('pt-BR')}</strong>
                  <small>{item.percentual}%</small>
                </div>
              ))}
            </div>
          )}
          <div className={styles.responseTotal}>
            <BarChart3 size={23} aria-hidden="true" />
            <div><span>Total de respostas recebidas</span><strong>{dados.prospeccao.respostas.toLocaleString('pt-BR')}</strong></div>
            <Tendencia valor={indicadores.respostas.variacao} />
          </div>
        </section>
      </div>
    </div>
  )
}

function PainelRenovacoes({ dados }: { dados: ResumoDashboard }) {
  const metas = dados.operacao.metasMensais
  const empresas = dados.renovacoes.empresas
  const tarefas = dados.tarefas.filter((tarefa) => tarefa.tipo === 'renovacao')
  const [janela, setJanela] = useState<JanelaRenovacao>('todas')
  const [filtroSituacao, setFiltroSituacao] = useState<FiltroSituacaoRenovacao>('todas')
  const [responsavel, setResponsavel] = useState('todos')
  const [busca, setBusca] = useState('')
  const situacoes = dados.renovacoes.situacoes

  const responsaveis = useMemo(() => {
    const unicos = new Map<string, string>()
    for (const item of dados.vencimentos) {
      if (!item.responsavel) continue
      const chave = item.responsavel.id ?? `nome:${item.responsavel.nome}`
      unicos.set(chave, item.responsavel.nome)
    }
    return [...unicos.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'))
  }, [dados.vencimentos])

  const vencimentosFiltrados = useMemo(() => {
    const termo = busca.trim().toLocaleLowerCase('pt-BR')
    return dados.vencimentos.filter((item) => {
      const naJanela = janela === 'todas'
        || (janela === 'vencidas' && item.diasRestantes < 0)
        || (janela === 'ate_30' && item.diasRestantes >= 0 && item.diasRestantes <= 30)
        || (janela === 'de_31_a_60' && item.diasRestantes >= 31 && item.diasRestantes <= 60)
      if (!naJanela) return false

      const naSituacao = filtroSituacao === 'todas'
        || (filtroSituacao === 'pendentes' && ['nao_comunicado', 'encerrado'].includes(item.situacao))
        || (filtroSituacao === 'agendadas' && item.situacao === 'agendado')
        || (filtroSituacao === 'comunicadas' && ['enviado', 'em_acompanhamento'].includes(item.situacao))
        || (filtroSituacao === 'respondidas' && item.situacao === 'respondido')
        || (filtroSituacao === 'erros' && item.situacao === 'erro')
      if (!naSituacao) return false

      const chaveResponsavel = item.responsavel?.id ?? (item.responsavel ? `nome:${item.responsavel.nome}` : 'sem_responsavel')
      if (responsavel !== 'todos' && chaveResponsavel !== responsavel) return false
      if (!termo) return true
      return [item.empresa, item.responsavel?.nome, item.campanha?.nome, ...item.motivos.map((motivo) => motivo.tipo)]
        .filter(Boolean)
        .some((valor) => valor!.toLocaleLowerCase('pt-BR').includes(termo))
    })
  }, [busca, dados.vencimentos, filtroSituacao, janela, responsavel])

  const resumoOperacional: Array<{
    id: FiltroSituacaoRenovacao
    label: string
    valor: number
    cor: string
  }> = [
    { id: 'pendentes', label: 'Não comunicadas', valor: situacoes.nao_comunicado + situacoes.encerrado, cor: 'text-slate-300' },
    { id: 'agendadas', label: 'Aguardando envio', valor: situacoes.agendado, cor: 'text-amber-400' },
    { id: 'comunicadas', label: 'Em acompanhamento', valor: situacoes.enviado + situacoes.em_acompanhamento, cor: 'text-cyan-400' },
    { id: 'respondidas', label: 'Responderam', valor: situacoes.respondido, cor: 'text-violet-400' },
    { id: 'erros', label: 'Com erro', valor: situacoes.erro, cor: 'text-rose-400' },
  ]

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-slate-100">Dashboard de vencimentos e renovações</h2>
        <p className="mt-0.5 text-sm text-slate-500">Empresas únicas classificadas pela validade mais urgente dos seus laudos.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Empresas vencidas" valor={empresas.vencidas} Icon={AlertTriangle} cor="text-rose-400" detalhe="Exigem contato imediato" />
        <Kpi label="Próximos 30 dias" valor={empresas.proximos30} Icon={CalendarClock} cor="text-amber-400" detalhe="Empresas com renovação próxima" />
        <Kpi label="De 31 a 60 dias" valor={empresas.entre31e60} Icon={CalendarCheck} cor="text-cyan-400" detalhe="Segunda janela de preparação" />
        <Kpi label="Renovadas neste mês" valor={dados.renovacoes.renovadosMes} Icon={CheckCircle2} cor="text-emerald-400" detalhe="Renovações registradas" />
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-5" aria-label="Situação da fila priorizada">
        {resumoOperacional.map((item) => (
          <button key={item.id} type="button" onClick={() => setFiltroSituacao((atual) => atual === item.id ? 'todas' : item.id)}
            aria-pressed={filtroSituacao === item.id}
            className={`rounded-xl border p-3 text-left transition-colors ${filtroSituacao === item.id ? 'border-indigo-500 bg-indigo-500/10' : 'border-[var(--border)] bg-[var(--bg-card)] hover:bg-[var(--t-bg-card-hover,#202638)]'}`}>
            <span className={`block text-xl font-bold tabular-nums ${item.cor}`}>{item.valor.toLocaleString('pt-BR')}</span>
            <span className="mt-0.5 block text-[11px] text-slate-500">{item.label}</span>
          </button>
        ))}
      </div>

      <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-card)]">
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 font-semibold text-slate-100"><CalendarClock size={16} className="text-cyan-400" /> Fila de vencimentos e renovações</h2>
            <p className="mt-1 text-xs text-slate-500">Prioridade, comunicação, responsável e próxima ação reunidos por cliente.</p>
          </div>
          <Link href="/base-leads" className="shrink-0 text-xs text-indigo-400 hover:underline">Ver base <ArrowRight className="inline" size={11} /></Link>
        </div>
        {dados.vencimentos.length > 0 && (
          <div className="space-y-3 border-b border-[var(--border)] bg-[var(--bg-subtle)] px-5 py-4">
            <div className="flex flex-wrap items-center gap-2">
              {([
                { id: 'todas', label: 'Todas' },
                { id: 'vencidas', label: 'Vencidas' },
                { id: 'ate_30', label: 'Até 30 dias' },
                { id: 'de_31_a_60', label: '31 a 60 dias' },
              ] as const).map((item) => (
                <button key={item.id} type="button" onClick={() => setJanela(item.id)} aria-pressed={janela === item.id}
                  className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${janela === item.id ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-300' : 'border-[var(--border)] text-slate-500 hover:text-slate-300'}`}>
                  {item.label}
                </button>
              ))}
            </div>
            <div className="grid gap-2 md:grid-cols-3">
              <label className="relative md:col-span-1">
                <span className="sr-only">Buscar cliente, laudo ou campanha</span>
                <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" />
                <input value={busca} onChange={(evento) => setBusca(evento.target.value)} placeholder="Buscar cliente, laudo ou campanha..."
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-base)] py-2 pl-9 pr-3 text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:border-indigo-500" />
              </label>
              <select value={filtroSituacao} onChange={(evento) => setFiltroSituacao(evento.target.value as FiltroSituacaoRenovacao)} aria-label="Filtrar situação da renovação"
                className="rounded-lg border border-[var(--border)] bg-[var(--bg-base)] px-3 py-2 text-xs text-slate-300 outline-none focus:border-indigo-500">
                <option value="todas">Todas as situações</option>
                <option value="pendentes">Não comunicadas</option>
                <option value="agendadas">Aguardando envio</option>
                <option value="comunicadas">Em acompanhamento</option>
                <option value="respondidas">Cliente respondeu</option>
                <option value="erros">Com erro</option>
              </select>
              <select value={responsavel} onChange={(evento) => setResponsavel(evento.target.value)} aria-label="Filtrar responsável"
                className="rounded-lg border border-[var(--border)] bg-[var(--bg-base)] px-3 py-2 text-xs text-slate-300 outline-none focus:border-indigo-500">
                <option value="todos">Todos os responsáveis</option>
                {responsaveis.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
                <option value="sem_responsavel">Sem responsável</option>
              </select>
            </div>
          </div>
        )}
        {dados.vencimentos.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <CheckCircle2 className="mx-auto text-emerald-400" size={24} />
            <p className="mt-2 text-sm font-medium text-slate-300">Nenhum vencimento cadastrado</p>
            <p className="mt-1 text-xs text-slate-500">Cadastre a validade no cliente para formar a fila de renovação.</p>
          </div>
        ) : vencimentosFiltrados.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <Search className="mx-auto text-slate-600" size={22} />
            <p className="mt-2 text-sm font-medium text-slate-300">Nenhum cliente encontrado</p>
            <p className="mt-1 text-xs text-slate-500">Altere os filtros para consultar outra parte da fila.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] table-fixed text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-[11px] uppercase tracking-wide text-slate-600">
                  <th className="w-[20%] px-5 py-3 text-left font-medium">Cliente</th>
                  <th className="w-[15%] px-3 py-3 text-left font-medium">Laudo(s)</th>
                  <th className="w-[12%] px-3 py-3 text-left font-medium">Vencimento</th>
                  <th className="w-[20%] px-3 py-3 text-left font-medium">Operação de renovação</th>
                  <th className="w-[12%] px-3 py-3 text-left font-medium">Último contato</th>
                  <th className="w-[12%] px-3 py-3 text-left font-medium">Próxima ação</th>
                  <th className="w-[9%] px-5 py-3 text-right font-medium">Prioridade</th>
                </tr>
              </thead>
              <tbody>
                {vencimentosFiltrados.map((item) => {
                  const visual = statusVisual(item.status)
                  const operacional = ROTULO_SITUACAO[item.situacao]
                  return (
                    <tr key={item.chave} className="border-b border-[var(--border)]/60 transition-colors last:border-0 hover:bg-[var(--bg-base)]">
                      <td className="px-5 py-3" title={item.empresa}>
                        <p className="truncate font-medium text-slate-200">
                          {item.leadId
                            ? <Link href={`/leads/${item.leadId}`} className="hover:text-cyan-300 hover:underline">{item.empresa}</Link>
                            : item.empresa}
                        </p>
                        <p className="mt-1 flex items-center gap-1 truncate text-[11px] text-slate-600">
                          <UserRound size={10} /> {item.responsavel?.nome ?? 'Sem responsável'}
                        </p>
                      </td>
                      <td className="max-w-[220px] px-3 py-3 text-slate-400">
                        <span className="line-clamp-1">{item.motivos.map((motivo) => motivo.tipo).join(', ')}</span>
                        {item.motivos.length > 1 && <span className="text-[11px] text-cyan-500">{item.motivos.length} vencimentos agrupados</span>}
                      </td>
                      <td className="px-3 py-3">
                        <p className="text-slate-300">{formatarDataIsoSemFuso(item.vencimentoMaisProximo)}</p>
                        <p className="mt-1 text-[11px] text-slate-600">{prazoHumano(item.diasRestantes)}</p>
                      </td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex rounded-full px-2 py-1 text-[11px] font-medium ${operacional.cls}`}>{operacional.label}</span>
                        {item.campanha && (
                          <p className="mt-1 truncate text-[11px] text-slate-500" title={item.campanha.nome}>
                            <Link href={`/automacao/campanhas/${item.campanha.id}`} className="hover:text-cyan-300 hover:underline">{item.campanha.nome}</Link>
                          </p>
                        )}
                        {item.situacao === 'respondido' && item.ultimaRespostaEm
                          ? <p className="mt-1 text-[11px] text-violet-400">Resposta em {formatarDataHora(item.ultimaRespostaEm)}</p>
                          : item.ultimaMensagem
                            ? <p className="mt-1 text-[11px] text-slate-600">Enviado em {formatarDataHora(item.ultimaMensagem.enviadaEm)}</p>
                            : null}
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-500">{item.ultimoContato ? formatarDataHora(item.ultimoContato) : 'Sem contato'}</td>
                      <td className="px-3 py-3 text-xs text-slate-500">{item.proximaAcaoEm ? formatarDataHora(item.proximaAcaoEm) : 'Não agendada'}</td>
                      <td className="px-5 py-3 text-right"><span className={`rounded-full px-2 py-1 text-[11px] font-medium ${visual.cls}`}>{visual.label}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-5 py-3 text-xs text-slate-500">
          <span>{vencimentosFiltrados.length} de {dados.vencimentos.length} clientes na fila priorizada · {empresas.totalMonitoradas.toLocaleString('pt-BR')} empresas monitoradas</span>
          <Link href="/automacao/campanhas/nova?tipo=renovacao" className="font-medium text-cyan-400 hover:underline">Criar campanha de renovação <ArrowRight className="inline" size={11} /></Link>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-5">
        <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-card)] xl:col-span-3">
          <div className="border-b border-[var(--border)] px-5 py-4">
            <h2 className="flex items-center gap-2 font-semibold text-slate-100"><MailCheck size={16} className="text-emerald-400" /> Empresas já comunicadas</h2>
            <p className="mt-1 text-xs text-slate-500">Somente mensagens de renovação efetivamente enviadas; ensaios não entram.</p>
          </div>
          {dados.renovacoes.comunicacoes.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-slate-500">Nenhuma mensagem real de renovação registrada.</div>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {dados.renovacoes.comunicacoes.map((item) => (
                <Link key={item.id} href={`/leads/${item.leadId}`} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-[var(--bg-base)]">
                  <MailCheck size={15} className="shrink-0 text-emerald-400" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-200">{item.empresa}</p>
                    <p className="truncate text-xs text-slate-500">{item.origem}</p>
                  </div>
                  <time className="shrink-0 text-xs text-slate-500" dateTime={item.enviadaEm}>{formatarDataHora(item.enviadaEm)}</time>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5 xl:col-span-2">
          <h2 className="flex items-center gap-2 font-semibold text-slate-100"><Target size={16} className="text-indigo-400" /> Meta de renovação</h2>
          <p className="mt-1 text-xs text-slate-500">Resultado real do mês contra a meta cadastrada.</p>
          <div className="mt-4">
            <MetaCard label="Laudos renovados" atual={dados.metasAtuais.renovacoes} meta={metas.renovacoes} cor="text-cyan-400" />
          </div>
          <dl className="mt-4 divide-y divide-[var(--border)] text-sm">
            <div className="flex justify-between gap-4 py-3"><dt className="text-slate-500">Empresas até 60 dias</dt><dd className="font-semibold text-slate-200">{empresas.proximos60.toLocaleString('pt-BR')}</dd></div>
            <div className="flex justify-between gap-4 py-3"><dt className="text-slate-500">Antecedência operacional</dt><dd className="font-semibold text-slate-200">{dados.antecedenciaDias} dias</dd></div>
          </dl>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
          <h2 className="flex items-center gap-2 font-semibold text-slate-100"><AlertTriangle size={16} className="text-amber-400" /> Alertas de renovação</h2>
          <div className="mt-4 space-y-2">
            {empresas.vencidas > 0 && (
              <Link href="/base-leads" className="flex items-center gap-3 rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 hover:bg-rose-500/15">
                <AlertTriangle size={16} className="shrink-0 text-rose-400" />
                <span className="flex-1 text-sm text-slate-300"><strong>{empresas.vencidas}</strong> {empresas.vencidas === 1 ? 'empresa está vencida' : 'empresas estão vencidas'} e deve ser priorizada.</span>
                <ArrowRight size={13} className="text-rose-400" />
              </Link>
            )}
            {empresas.proximos30 > 0 && (
              <div className="flex items-center gap-3 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3">
                <CalendarClock size={16} className="shrink-0 text-amber-400" />
                <span className="text-sm text-slate-300"><strong>{empresas.proximos30}</strong> {empresas.proximos30 === 1 ? 'empresa entra' : 'empresas entram'} na janela dos próximos 30 dias.</span>
              </div>
            )}
            {empresas.vencidas === 0 && empresas.proximos30 === 0 && (
              <div className="flex items-center gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3">
                <CheckCircle2 size={16} className="text-emerald-400" />
                <span className="text-sm text-slate-300">Nenhuma renovação crítica com os dados atuais.</span>
              </div>
            )}
          </div>
        </section>
        <ProximasAcoes tarefas={tarefas} titulo="Próximas ações de renovação" />
      </div>
    </div>
  )
}

export default function DashboardWidgets() {
  const [dados, setDados] = useState<ResumoDashboard | null>(null)
  const [aba, setAba] = useState<ObjetivoOperacional | null>(null)
  const [responsavelProspeccao, setResponsavelProspeccao] = useState('')
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const requisicaoAtual = useRef(0)

  const carregar = useCallback(async () => {
    const requisicao = ++requisicaoAtual.current
    setCarregando(true)
    setErro(null)
    try {
      const params = new URLSearchParams()
      if (responsavelProspeccao) params.set('responsavel', responsavelProspeccao)
      const url = `/api/dashboard/resumo${params.size ? `?${params.toString()}` : ''}`
      const res = await fetch(url, { cache: 'no-store' })
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(payload?.erro || 'Não foi possível carregar o painel.')
      if (requisicao === requisicaoAtual.current) setDados(payload as ResumoDashboard)
    } catch (e) {
      if (requisicao === requisicaoAtual.current) setErro(e instanceof Error ? e.message : 'Erro ao carregar o painel')
    } finally {
      if (requisicao === requisicaoAtual.current) setCarregando(false)
    }
  }, [responsavelProspeccao])

  useEffect(() => { carregar() }, [carregar])

  const abas = useMemo(() => dados?.operacao.objetivosAtivos ?? [], [dados])

  if (carregando && !dados) {
    return (
      <div className="space-y-5 p-6">
        <CabecalhoDashboard />
        <div className="space-y-4">
          <div className="h-10 animate-pulse rounded-lg bg-[var(--bg-card)]" />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[1, 2, 3, 4].map((item) => <div key={item} className="h-28 animate-pulse rounded-xl bg-[var(--bg-card)]" />)}
          </div>
          <div className="h-72 animate-pulse rounded-xl bg-[var(--bg-card)]" />
        </div>
      </div>
    )
  }

  if (!dados || erro) {
    return (
      <div className="space-y-5 p-6">
        <CabecalhoDashboard />
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-8 text-center">
          <CircleAlert className="mx-auto text-red-400" size={24} />
          <h2 className="mt-3 font-semibold text-slate-100">Painel indisponível</h2>
          <p className="mt-1 text-sm text-slate-500">{erro || 'Não foi possível carregar os dados.'}</p>
          <button type="button" onClick={carregar} className="mt-4 rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-slate-300 hover:bg-[var(--bg-card)]">Tentar novamente</button>
        </div>
      </div>
    )
  }

  const abaAtiva = aba && abas.includes(aba)
    ? aba
    : abas.includes(dados.operacao.objetivoPrincipal)
      ? dados.operacao.objetivoPrincipal
      : abas[0]
  const atualizado = new Date(dados.atualizadoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

  if (abaAtiva === 'vencimentos_laudos') {
    return (
      <div className="p-4 sm:p-6">
        <VencimentosRenovacoes
          atualizadoEm={dados.atualizadoEm}
          vencimentos={dados.vencimentos}
          tarefas={dados.tarefas}
          ciclosRenovados={dados.renovacoes.ciclosRenovados}
          historicoCiclosDisponivel={dados.renovacoes.historicoCiclosDisponivel}
          atualizando={carregando}
          onAtualizar={carregar}
          onVoltarProspeccao={abas.includes('prospeccao') ? () => setAba('prospeccao') : undefined}
        />
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <nav className={styles.breadcrumb} aria-label="Navegação estrutural">
          <span>Prospecção</span><ChevronRight size={13} aria-hidden="true" /><strong>Dashboard</strong>
        </nav>
        <div className={styles.titleRow}>
          <div>
            <h1>Dashboard</h1>
            <p>Acompanhe cada área da operação em seu próprio painel.</p>
          </div>
          <button type="button" onClick={carregar} disabled={carregando} className={styles.refreshButton}>
            <RefreshCw size={17} className={carregando ? 'animate-spin' : ''} aria-hidden="true" /> Atualizado às {atualizado}
          </button>
        </div>
        <div className={styles.controlRow}>
          <div className={styles.tabs} aria-label="Módulo do dashboard">
          {abas.map((item) => (
            <button key={item} type="button" onClick={() => setAba(item)} aria-pressed={abaAtiva === item}
              className={abaAtiva === item ? styles.tabActive : undefined}>
              {ROTULO_OBJETIVO[item]}
            </button>
          ))}
          </div>
          {dados.visaoProspeccao.podeVerEquipe ? (
            <label className={styles.portfolioField}>
              <span>Visualizar carteira</span>
              <div><Users size={17} aria-hidden="true" />
                <select value={responsavelProspeccao} onChange={(evento) => setResponsavelProspeccao(evento.target.value)}>
                  <option value="">Toda a equipe</option>
                  {dados.visaoProspeccao.responsaveis.map((item) => <option key={item.authId} value={item.authId}>{item.nome}</option>)}
                </select>
              </div>
            </label>
          ) : (
            <div className={styles.portfolioField}>
              <span>Visualizar carteira</span>
              <div><UserRound size={17} aria-hidden="true" /><strong>Minha carteira</strong></div>
            </div>
          )}
        </div>
      </header>

      <PainelProspeccao dados={dados} />
    </div>
  )
}
