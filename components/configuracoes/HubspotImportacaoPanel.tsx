'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertCircle, Building2, Check, ChevronLeft, ChevronRight, Info, RefreshCw, Search } from 'lucide-react'
import { NICHOS } from '@/lib/prospeccao/nichos'
import { ACAO_SUGERIDA, JANELA_ATIVIDADE_DIAS, ROTULO_SITUACAO, SITUACOES, type Situacao } from '@/lib/integracoes/hubspot/situacao'

// Central de Importação HubSpot: mostra SÓ as empresas disponíveis para
// importar — aptas (não cliente, com CNPJ ou domínio e contato com e-mail
// corporativo) e clientes (com e-mail, para envio de novidades) — de
// comerciais mapeados. A lista vem do índice local (botão "Atualizar
// índice"); filtros, paginação e contagens são server-side. Nada é importado
// aqui: "Preparar seleção" grava o lote para a importação.

type Status = 'importada' | 'em_preparo' | 'nao_importada'

interface Linha {
  id: string
  nome: string
  dominio: string | null
  industry: string | null
  owner: { id: string; nome: string } | null
  responsavel: { usuarioId: string; nome: string } | null
  status: Status
  situacao: Situacao
  acao: string
  contatoPrincipal: { id: string; nome: string; cargo: string | null; email: string | null; ultimoContato: string | null } | null
  contatos: { total: number; comEmail: number; corporativos: number; truncado: boolean }
  negocios: { total: number; abertos: number; ganhos: number | null }
  destaque: { tipo: 'ganho' | 'aberto' | 'perdido'; nome: string; estagio: string | null; pipeline: string | null; data: string | null } | null
  ultimaAtividade: string | null
  divergenciaCliente: boolean
  nichoIdentificado: string | null
  enriquecimento: { status: string; confianca: string | null; cnpj: string | null; empresa: string | null; nicho: string | null; executadoEm: string } | null
}

interface ResultadoEnriquecimento {
  hubspot_company_id: string
  nome_hubspot: string | null
  cadastro_atual: { nome: string; documento: string; dominio: string; email_contato: string; empresa_valida: boolean }
  empresa_identificada: string | null
  razao_social: string | null
  nome_fantasia: string | null
  cnpj: string | null
  situacao_cadastral: string | null
  dominio: string | null
  cnae_principal: string | null
  atividade_principal: string | null
  nicho_sugerido: string | null
  fonte: string | null
  confianca: 'alta' | 'media' | 'baixa' | null
  status_enriquecimento: 'resolvida' | 'ambigua' | 'nao_resolvida' | 'erro_fonte'
  evidencias: string[]
}

const LIMITE_ENRIQUECIMENTO = 20

const ROTULO_FONTE: Record<string, string> = {
  hubspot_cnpj: 'CNPJ do HubSpot → OpenCNPJ',
  hubspot_nome: 'CNPJ no nome → OpenCNPJ',
  site_dominio_empresa: 'Site do domínio da empresa → OpenCNPJ',
  site_email_contato: 'Site do e-mail do contato → OpenCNPJ',
}

const ROTULO_ENRIQUECIMENTO: Record<ResultadoEnriquecimento['status_enriquecimento'], { texto: string; classe: string }> = {
  resolvida: { texto: 'Resolvida', classe: 'bg-emerald-500/15 text-emerald-300' },
  ambigua: { texto: 'Ambígua', classe: 'bg-amber-500/15 text-amber-300' },
  nao_resolvida: { texto: 'Não resolvida', classe: 'bg-slate-500/15 text-slate-400' },
  erro_fonte: { texto: 'Fonte indisponível', classe: 'bg-red-500/15 text-red-300' },
}

const COR_CONFIANCA: Record<string, string> = { alta: 'text-emerald-300', media: 'text-sky-300', baixa: 'text-amber-300' }

const TEXTO_CADASTRO: Record<string, Record<string, string | null>> = {
  nome: { valido: null, vazio: 'Nome vazio', invalido: 'Nome inválido', cnpj_como_nome: 'CNPJ usado como nome' },
  documento: { valido: 'CNPJ no HubSpot', digito_invalido: 'CNPJ com dígito inválido', cpf: 'Documento de 11 dígitos (CPF?)', ausente: 'Sem CNPJ', formato_invalido: 'Documento em formato inválido' },
  dominio: { disponivel: 'Domínio disponível', provedor_generico: 'Domínio é provedor genérico', ausente: 'Sem domínio' },
  email_contato: { corporativo: 'Contato com e-mail corporativo', apenas_generico: 'Contato só com e-mail genérico', sem_email: 'Contato sem e-mail', sem_contato: 'Sem contato' },
}

const formatarCnpj = (c: string | null) => (c && /^\d{14}$/.test(c) ? `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}` : c)

interface Pagina {
  total: number
  pagina: number
  tamanho: number
  itens: Linha[]
  foraDoHubspot: number
}

interface ResumoIndice {
  atualizadoEm: string | null
  sincronizando: boolean
  total: number
  disponiveis: number
  semResponsavel: number
  porSituacao: Record<Situacao, number>
}

const LIMITE_SELECAO = 200
const TAMANHO = 25

const COR_SITUACAO: Record<Situacao, string> = {
  cliente: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  em_andamento: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  precisa_enriquecer: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  reativar: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  prospectar: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
}

const ROTULO_STATUS: Record<Status, { texto: string; classe: string }> = {
  importada: { texto: 'Já importada', classe: 'bg-emerald-500/15 text-emerald-300' },
  em_preparo: { texto: 'Em lote preparado', classe: 'bg-indigo-500/15 text-indigo-300' },
  nao_importada: { texto: 'Não importada', classe: 'bg-slate-500/15 text-slate-400' },
}

const REGRA: Record<Situacao, string> = {
  cliente: 'Tem negócio ganho (closed won) no HubSpot.',
  em_andamento: `Não é cliente e teve atividade nos últimos ${JANELA_ATIVIDADE_DIAS} dias (negócio ou contato sendo trabalhado).`,
  precisa_enriquecer: `Sem atividade recente e sem contato associado, ou nenhum contato com e-mail.`,
  reativar: `Sem atividade recente, tem contato com e-mail e já teve negócio (aberto parado ou perdido) ou atividade há mais de ${JANELA_ATIVIDADE_DIAS} dias.`,
  prospectar: 'Sem atividade recente, tem contato com e-mail e nunca teve negócio nem atividade registrada.',
}

const ERROS: Record<string, string> = {
  sincronizacao_em_andamento: 'O índice já está sendo atualizado. Aguarde alguns minutos.',
  base_grande_demais: 'A base passa de 10.000 empresas — além do que a busca do HubSpot permite ler.',
  nao_conectado: 'HubSpot não conectado.',
  erro_refresh: 'Não foi possível renovar o acesso ao HubSpot. Reconecte a integração.',
  nicho_invalido: 'Escolha o nicho esperado da importação.',
  selecao_vazia: 'Selecione ao menos uma empresa.',
  selecao_excede_limite: `Selecione no máximo ${LIMITE_SELECAO} empresas por lote.`,
  nenhuma_elegivel: 'Nenhuma empresa selecionada está disponível (já importadas, fora do índice ou sem comercial mapeado). Atualize o índice e tente de novo.',
  erro_hubspot: 'O HubSpot não respondeu à leitura das empresas selecionadas.',
  erro_banco: 'Não foi possível salvar o resultado do enriquecimento.',
  erro_selecao: 'Não foi possível selecionar as empresas do filtro. Tente de novo.',
}
const msgErro = (codigo: string) => ERROS[codigo] ?? `Não foi possível concluir (${codigo}).`

const data = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : null)
const haDias = (iso: string | null) => {
  if (!iso) return null
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  return d <= 0 ? 'hoje' : `há ${d} d`
}

function Select({ valor, onChange, rotulo, opcoes, desabilitado, dica }: {
  valor: string
  onChange: (v: string) => void
  rotulo: string
  opcoes: { valor: string; texto: string }[]
  desabilitado?: boolean
  dica?: string
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-500" title={dica}>
      {rotulo}
      <select
        value={valor}
        disabled={desabilitado}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-[var(--border)] bg-[var(--bg-input)] px-2 py-1.5 text-sm text-slate-200 focus-ring disabled:opacity-50"
      >
        {opcoes.map((o) => (
          <option key={o.valor} value={o.valor}>{o.texto}</option>
        ))}
      </select>
    </label>
  )
}

export default function HubspotImportacaoPanel() {
  const [owners, setOwners] = useState<{ id: string; nome: string }[]>([])
  const [situacao, setSituacao] = useState('todas')
  const [owner, setOwner] = useState('todos')
  const [importada, setImportada] = useState('todas')
  const [buscaDigitada, setBuscaDigitada] = useState('')
  const [busca, setBusca] = useState('')
  const [pagina, setPagina] = useState(1)
  const [dados, setDados] = useState<Pagina | null>(null)
  const [resumo, setResumo] = useState<ResumoIndice | null>(null)
  const [atualizandoIndice, setAtualizandoIndice] = useState(false)
  const [versaoIndice, setVersaoIndice] = useState(0)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [selecionadas, setSelecionadas] = useState<Map<string, string>>(new Map())
  const [confirmando, setConfirmando] = useState(false)
  const [nicho, setNicho] = useState('')
  const [preparando, setPreparando] = useState(false)
  const [resultado, setResultado] = useState<string | null>(null)
  const [mostrarRegra, setMostrarRegra] = useState(false)
  const [enriquecendo, setEnriquecendo] = useState(false)
  const [enriquecidos, setEnriquecidos] = useState<ResultadoEnriquecimento[] | null>(null)
  const [selecionandoFiltro, setSelecionandoFiltro] = useState(false)
  const [avisoSelecao, setAvisoSelecao] = useState<string | null>(null)
  const seqLista = useRef(0)
  const seqResumo = useRef(0)

  // Só comerciais mapeados: os demais não têm empresa disponível.
  useEffect(() => {
    fetch('/api/integracoes/hubspot/comerciais')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.owners) return
        setOwners(d.owners
          .filter((o: { mapeamento: { ativo: boolean } | null }) => o.mapeamento?.ativo)
          .map((o: { id: string; nome: string }) => ({ id: o.id, nome: o.nome })))
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const t = setTimeout(() => { setBusca(buscaDigitada.trim()); setPagina(1) }, 400)
    return () => clearTimeout(t)
  }, [buscaDigitada])

  const qsBase = () => {
    const qs = new URLSearchParams({ owner, importada })
    if (busca) qs.set('busca', busca)
    return qs
  }

  function carregarLista() {
    const minha = ++seqLista.current
    setCarregando(true)
    setErro(null)
    const qs = qsBase()
    qs.set('situacao', situacao)
    qs.set('pagina', String(pagina))
    qs.set('tamanho', String(TAMANHO))
    fetch(`/api/integracoes/hubspot/empresas?${qs}`)
      .then(async (r) => {
        const d = await r.json()
        if (minha !== seqLista.current) return // resposta antiga não sobrescreve a nova
        if (!r.ok) { setDados(null); setErro(msgErro(d?.erro ?? `HTTP ${r.status}`)); return }
        setDados(d)
      })
      .catch(() => { if (minha === seqLista.current) setErro('Falha ao carregar empresas do HubSpot.') })
      .finally(() => { if (minha === seqLista.current) setCarregando(false) })
  }

  useEffect(() => {
    carregarLista()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [situacao, owner, importada, busca, pagina, versaoIndice])

  // Resumo (disponíveis e por situação): depende dos DEMAIS filtros (não da situação nem da página).
  useEffect(() => {
    const minha = ++seqResumo.current
    const qs = qsBase()
    qs.set('resumo', '1')
    fetch(`/api/integracoes/hubspot/empresas?${qs}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (minha === seqResumo.current && d?.resumo) setResumo(d.resumo) })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, importada, busca, versaoIndice])

  async function atualizarIndice() {
    setAtualizandoIndice(true)
    setErro(null)
    setResultado(null)
    try {
      const r = await fetch('/api/integracoes/hubspot/indice', { method: 'POST' })
      const d = await r.json()
      if (!r.ok) throw new Error(msgErro(d?.erro ?? `HTTP ${r.status}`))
      setResultado(`Índice atualizado: ${d.total.toLocaleString('pt-BR')} empresas lidas do HubSpot, ${d.disponiveis.toLocaleString('pt-BR')} disponíveis para importar (${d.aptas} aptas · ${d.clientes} clientes) antes do filtro de comercial mapeado.`)
      setPagina(1)
      setVersaoIndice((v) => v + 1)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao atualizar o índice.')
    } finally {
      setAtualizandoIndice(false)
    }
  }

  const mudar = (set: (v: string) => void) => (v: string) => { set(v); setPagina(1); setAvisoSelecao(null) }

  const totalPaginas = dados ? Math.max(1, Math.ceil(dados.total / TAMANHO)) : 1
  const selecionavel = (l: Linha) => l.status !== 'importada'
  const selecionaveis = (dados?.itens ?? []).filter(selecionavel)
  const paginaToda = selecionaveis.length > 0 && selecionaveis.every((l) => selecionadas.has(l.id))
  const indiceVazio = resumo !== null && !resumo.atualizadoEm

  function alternar(l: Linha) {
    setSelecionadas((atual) => {
      const novo = new Map(atual)
      if (novo.has(l.id)) novo.delete(l.id)
      else if (novo.size < LIMITE_SELECAO) novo.set(l.id, l.nome)
      return novo
    })
  }

  function alternarPagina() {
    setSelecionadas((atual) => {
      const novo = new Map(atual)
      if (paginaToda) selecionaveis.forEach((l) => novo.delete(l.id))
      else for (const l of selecionaveis) { if (novo.size >= LIMITE_SELECAO) break; novo.set(l.id, l.nome) }
      return novo
    })
  }

  // Todas as empresas do filtro atual que ainda não foram importadas nem estão
  // em lote, na ordem da lista, até completar o limite do lote.
  async function selecionarTodasDoFiltro() {
    setSelecionandoFiltro(true)
    setAvisoSelecao(null)
    try {
      const qs = qsBase()
      qs.set('situacao', situacao)
      qs.set('selecao', 'todas')
      const r = await fetch(`/api/integracoes/hubspot/empresas?${qs}`)
      const d = await r.json()
      if (!r.ok) throw new Error(msgErro(d?.erro ?? `HTTP ${r.status}`))
      const itens = d.itens as { id: string; nome: string }[]
      const total = d.total as number
      if (total === 0) {
        setAvisoSelecao('Nenhuma empresa deste filtro para selecionar: todas já foram importadas ou já estão em lote preparado.')
        return
      }
      const novo = new Map(selecionadas)
      for (const e of itens) {
        if (novo.size >= LIMITE_SELECAO) break
        novo.set(e.id, e.nome)
      }
      const doFiltro = itens.filter((e) => novo.has(e.id)).length
      setSelecionadas(novo)
      setAvisoSelecao(doFiltro >= total
        ? `${total.toLocaleString('pt-BR')} empresa(s) do filtro selecionada(s).`
        : `${doFiltro.toLocaleString('pt-BR')} de ${total.toLocaleString('pt-BR')} empresas do filtro selecionadas (limite de ${LIMITE_SELECAO} por lote). Prepare este lote e clique de novo para selecionar as seguintes.`)
    } catch (e) {
      setAvisoSelecao(e instanceof Error ? e.message : 'Falha ao selecionar as empresas do filtro.')
    } finally {
      setSelecionandoFiltro(false)
    }
  }

  async function enriquecer() {
    setEnriquecendo(true)
    setErro(null)
    setEnriquecidos(null)
    try {
      const r = await fetch('/api/integracoes/hubspot/enriquecimento', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyIds: [...selecionadas.keys()] }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(msgErro(d?.erro ?? `HTTP ${r.status}`))
      setEnriquecidos(d.itens)
      carregarLista()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao enriquecer.')
    } finally {
      setEnriquecendo(false)
    }
  }

  async function preparar() {
    const nomeNicho = NICHOS.find((n) => n.id === nicho)?.nome ?? nicho
    setPreparando(true)
    setErro(null)
    setResultado(null)
    try {
      const r = await fetch('/api/integracoes/hubspot/importacoes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nicho, companyIds: [...selecionadas.keys()] }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(msgErro(d?.erro ?? `HTTP ${r.status}`))
      const extras = [
        d.clientes ? `${d.clientes} cliente(s) marcado(s) para novidades` : null,
        d.jaImportadas ? `${d.jaImportadas} já importada(s) ignorada(s)` : null,
        d.indisponiveis ? `${d.indisponiveis} fora do índice ou sem comercial mapeado` : null,
        d.naoEncontradas ? `${d.naoEncontradas} não encontrada(s) no HubSpot` : null,
      ].filter(Boolean).join(' · ')
      setResultado(`Lote preparado com ${d.incluidas} empresa(s), nicho esperado “${nomeNicho}”.${extras ? ` ${extras}.` : ''} Nada foi importado ainda.`)
      setSelecionadas(new Map())
      setAvisoSelecao(null)
      setConfirmando(false)
      setNicho('')
      carregarLista()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao preparar a seleção.')
    } finally {
      setPreparando(false)
    }
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2">
            <Building2 size={16} className="text-slate-300" /> Central de Importação HubSpot
          </h3>
          <p className="mt-1 text-sm text-slate-400">
            Só aparecem empresas disponíveis para importar: aptas (CNPJ ou site + contato com e-mail da empresa) e clientes com
            e-mail, de comerciais mapeados. Nada é importado aqui e nenhum lead é criado.
          </p>
        </div>
        <button
          onClick={() => setMostrarRegra((v) => !v)}
          className="shrink-0 inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 focus-ring rounded"
          aria-expanded={mostrarRegra}
        >
          <Info size={13} /> Como a situação é calculada
        </button>
      </div>

      {mostrarRegra && (
        <div className="rounded-lg border border-[var(--border)] p-3 text-xs text-slate-400 space-y-1.5">
          <p>Regra determinística, sem IA. Vale a primeira que casar, nesta ordem:</p>
          <ol className="list-decimal pl-5 space-y-1">
            {SITUACOES.map((s) => (
              <li key={s}>
                <span className="text-slate-200">{ROTULO_SITUACAO[s]}</span> — {REGRA[s]} <span className="text-slate-500">Ação: {ACAO_SUGERIDA[s]}.</span>
              </li>
            ))}
          </ol>
          <p>
            Contato principal: tem e-mail → cargo mais sênior (sócio/diretor/CEO; depois gerente/gestor/compras) → contato mais recente → menor ID.
            O cargo é o informado no HubSpot; ninguém é marcado como decisor sem essa evidência.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border)] px-3 py-2 text-xs text-slate-400">
        <span>
          {resumo === null ? 'Carregando índice…' : resumo.atualizadoEm ? (
            <>
              <span className="text-slate-200 font-medium">{resumo.disponiveis.toLocaleString('pt-BR')}</span> disponíveis para importar
              {' '}de {resumo.total.toLocaleString('pt-BR')} empresas no HubSpot
              {resumo.semResponsavel > 0 && <> · <span className="text-amber-300">{resumo.semResponsavel} aguardam comercial mapeado</span></>}
              {' '}· índice atualizado em {new Date(resumo.atualizadoEm).toLocaleString('pt-BR')}
            </>
          ) : 'O índice ainda não foi montado.'}
        </span>
        <button
          onClick={atualizarIndice}
          disabled={atualizandoIndice || resumo?.sincronizando}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 font-medium text-slate-200 hover:bg-white/5 disabled:opacity-50 focus-ring"
          title="Lê a base do HubSpot de novo (cerca de 1 minuto). Não importa nada."
        >
          <RefreshCw size={13} className={atualizandoIndice ? 'animate-spin' : ''} />
          {atualizandoIndice || resumo?.sincronizando ? 'Atualizando índice…' : 'Atualizar índice'}
        </button>
      </div>

      {indiceVazio && !atualizandoIndice && (
        <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-4 text-sm text-slate-300">
          Para listar as empresas disponíveis, clique em <span className="font-medium text-slate-100">Atualizar índice</span>. A leitura da base do
          HubSpot leva cerca de 1 minuto e não importa nada.
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => mudar(setSituacao)('todas')}
          className={`rounded-lg border px-3 py-1.5 text-xs font-medium focus-ring ${situacao === 'todas' ? 'border-indigo-500/60 bg-indigo-500/15 text-indigo-200' : 'border-[var(--border)] text-slate-400 hover:text-slate-200'}`}
        >
          Todas
        </button>
        {SITUACOES.filter((s) => situacao === s || !resumo || resumo.porSituacao[s] > 0).map((s) => (
          <button
            key={s}
            onClick={() => mudar(setSituacao)(s)}
            aria-pressed={situacao === s}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium focus-ring ${COR_SITUACAO[s]} ${situacao === s ? 'ring-1 ring-current' : 'opacity-80 hover:opacity-100'}`}
          >
            {ROTULO_SITUACAO[s]}
            <span className="ml-1.5 tabular-nums">{resumo ? resumo.porSituacao[s].toLocaleString('pt-BR') : '…'}</span>
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5 items-end">
        <Select
          rotulo="Situação comercial"
          valor={situacao}
          onChange={mudar(setSituacao)}
          opcoes={[{ valor: 'todas', texto: 'Todas' }, ...SITUACOES.map((s) => ({ valor: s, texto: ROTULO_SITUACAO[s] }))]}
        />
        <Select
          rotulo="Comercial HubSpot"
          valor={owner}
          onChange={mudar(setOwner)}
          opcoes={[{ valor: 'todos', texto: 'Todos os mapeados' }, ...owners.map((o) => ({ valor: o.id, texto: o.nome }))]}
        />
        <Select
          rotulo="Importação"
          valor={importada}
          onChange={mudar(setImportada)}
          opcoes={[{ valor: 'todas', texto: 'Todas' }, { valor: 'nao', texto: 'Não importada' }, { valor: 'sim', texto: 'Já importada' }]}
        />
        <Select
          rotulo="Nicho identificado"
          valor="indisponivel"
          onChange={() => {}}
          desabilitado
          dica="O nicho aparece em cada empresa depois de “Enriquecer selecionadas”. O filtro por nicho ainda não está disponível."
          opcoes={[{ valor: 'indisponivel', texto: 'Filtro ainda indisponível' }]}
        />
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          Buscar
          <span className="relative">
            <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={buscaDigitada}
              onChange={(e) => setBuscaDigitada(e.target.value)}
              placeholder="Empresa, domínio, contato ou e-mail"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-input)] pl-7 pr-2 py-1.5 text-sm text-slate-200 focus-ring"
            />
          </span>
        </label>
      </div>

      {!!dados?.foraDoHubspot && (
        <p className="text-xs text-amber-300 flex items-center gap-1.5">
          <AlertCircle size={12} /> {dados.foraDoHubspot} empresa(s) desta página não existem mais no HubSpot. Atualize o índice.
        </p>
      )}
      {erro && (
        <p className="text-xs text-red-400 flex items-center gap-1.5">
          <AlertCircle size={12} /> {erro}
        </p>
      )}
      {resultado && (
        <p className="text-xs text-emerald-300 flex items-center gap-1.5">
          <Check size={12} /> {resultado}
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1400px] text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500 border-b border-[var(--border)]">
              <th className="py-2 pr-3 w-8">
                <input type="checkbox" checked={paginaToda} disabled={selecionaveis.length === 0} onChange={alternarPagina} aria-label="Selecionar empresas desta página" />
              </th>
              <th className="py-2 pr-3 font-medium">Empresa</th>
              <th className="py-2 pr-3 font-medium">Contato principal</th>
              <th className="py-2 pr-3 font-medium">Cargo</th>
              <th className="py-2 pr-3 font-medium">E-mail</th>
              <th className="py-2 pr-3 font-medium">Responsável HubSpot / ProspectOS</th>
              <th className="py-2 pr-3 font-medium">Situação comercial</th>
              <th className="py-2 pr-3 font-medium">Negócios</th>
              <th className="py-2 pr-3 font-medium">Último ganho / negócio relevante</th>
              <th className="py-2 pr-3 font-medium">Última interação</th>
              <th className="py-2 pr-3 font-medium">Industry HubSpot</th>
              <th className="py-2 font-medium">Status ProspectOS</th>
            </tr>
          </thead>
          <tbody className={carregando ? 'opacity-50' : ''}>
            {(dados?.itens ?? []).map((l) => (
              <tr key={l.id} className="border-b border-[var(--border)]/60 align-top">
                <td className="py-2 pr-3">
                  <input
                    type="checkbox"
                    checked={selecionadas.has(l.id)}
                    disabled={!selecionavel(l) || (!selecionadas.has(l.id) && selecionadas.size >= LIMITE_SELECAO)}
                    title={l.status === 'importada' ? 'Já importada' : l.situacao === 'cliente' ? 'Cliente: entra marcado para envio de novidades, nunca prospecção fria' : undefined}
                    onChange={() => alternar(l)}
                    aria-label={`Selecionar ${l.nome}`}
                  />
                </td>
                <td className="py-2 pr-3">
                  <div className="text-slate-200">{l.nome}</div>
                  {l.dominio && <div className="text-xs text-slate-500">{l.dominio}</div>}
                  {l.enriquecimento && (
                    <div className="mt-0.5 text-xs text-slate-500" title={`Enriquecido em ${data(l.enriquecimento.executadoEm)}`}>
                      {l.enriquecimento.status === 'resolvida'
                        ? <>CNPJ {formatarCnpj(l.enriquecimento.cnpj)}{l.enriquecimento.confianca ? <span className={COR_CONFIANCA[l.enriquecimento.confianca]}> · {l.enriquecimento.confianca}</span> : null}{l.nichoIdentificado ? ` · ${l.nichoIdentificado}` : ''}</>
                        : ROTULO_ENRIQUECIMENTO[l.enriquecimento.status as ResultadoEnriquecimento['status_enriquecimento']]?.texto ?? l.enriquecimento.status}
                    </div>
                  )}
                </td>
                <td className="py-2 pr-3">
                  {l.contatoPrincipal ? (
                    <>
                      <div className="text-slate-300">{l.contatoPrincipal.nome}</div>
                      <div className="text-xs text-slate-500">
                        {l.contatos.total} contato(s) · {l.contatos.corporativos} com e-mail da empresa
                      </div>
                    </>
                  ) : (
                    <span className="text-xs text-slate-500">Sem contato</span>
                  )}
                </td>
                <td className="py-2 pr-3 text-xs text-slate-400">{l.contatoPrincipal?.cargo ?? '—'}</td>
                <td className="py-2 pr-3 text-xs">
                  {l.contatoPrincipal?.email ? <span className="text-slate-300">{l.contatoPrincipal.email}</span> : <span className="text-amber-300">Sem e-mail</span>}
                </td>
                <td className="py-2 pr-3">
                  {l.owner ? (
                    <>
                      <div className="text-slate-300">{l.owner.nome}</div>
                      {l.responsavel
                        ? <div className="text-xs text-slate-500">ProspectOS: {l.responsavel.nome}</div>
                        : <div className="text-xs text-amber-300">Responsável não mapeado</div>}
                    </>
                  ) : (
                    <span className="text-xs text-slate-500">Sem responsável no HubSpot</span>
                  )}
                </td>
                <td className="py-2 pr-3">
                  <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${COR_SITUACAO[l.situacao]}`}>{ROTULO_SITUACAO[l.situacao]}</span>
                  <div className="mt-1 text-xs text-slate-500 max-w-[200px]">{l.acao}</div>
                  {l.divergenciaCliente && <div className="mt-1 text-xs text-amber-300">HubSpot e negócios divergem sobre “cliente”</div>}
                </td>
                <td className="py-2 pr-3 text-xs text-slate-400 whitespace-nowrap">
                  {l.negocios.total === 0 ? 'Nunca teve' : (
                    <>
                      <div>{l.negocios.total} no total</div>
                      <div>{l.negocios.abertos} aberto(s){l.negocios.ganhos !== null ? ` · ${l.negocios.ganhos} ganho(s)` : ''}</div>
                    </>
                  )}
                </td>
                <td className="py-2 pr-3 text-xs">
                  {l.destaque ? (
                    <>
                      <div className={l.destaque.tipo === 'ganho' ? 'text-emerald-300' : l.destaque.tipo === 'aberto' ? 'text-sky-300' : 'text-slate-400'}>
                        {l.destaque.tipo === 'ganho' ? 'Ganho' : l.destaque.tipo === 'aberto' ? 'Aberto' : 'Perdido'}
                        {l.destaque.data ? ` · ${data(l.destaque.data)}` : ''}
                      </div>
                      <div className="text-slate-400">{l.destaque.nome}</div>
                      {l.destaque.tipo === 'aberto' && l.destaque.estagio && <div className="text-slate-500">{l.destaque.estagio}</div>}
                    </>
                  ) : <span className="text-slate-500">—</span>}
                </td>
                <td className="py-2 pr-3 text-xs text-slate-400 whitespace-nowrap">
                  {l.ultimaAtividade ? <>{data(l.ultimaAtividade)}<div className="text-slate-500">{haDias(l.ultimaAtividade)}</div></> : <span className="text-slate-500">Nenhuma</span>}
                </td>
                <td className="py-2 pr-3 text-xs text-slate-400">{l.industry ?? '—'}</td>
                <td className="py-2">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${ROTULO_STATUS[l.status].classe}`}>{ROTULO_STATUS[l.status].texto}</span>
                </td>
              </tr>
            ))}
            {!carregando && dados && dados.itens.length === 0 && (
              <tr>
                <td colSpan={12} className="py-6 text-center text-sm text-slate-500">Nenhuma empresa encontrada com estes filtros.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <button onClick={() => setPagina((p) => Math.max(1, p - 1))} disabled={pagina <= 1 || carregando} className="rounded-lg border border-[var(--border)] p-1.5 disabled:opacity-40 focus-ring" aria-label="Página anterior">
            <ChevronLeft size={14} />
          </button>
          <span>Página {pagina} de {totalPaginas}{dados ? ` · ${dados.total.toLocaleString('pt-BR')} empresa(s)` : ''}</span>
          <button onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))} disabled={pagina >= totalPaginas || carregando} className="rounded-lg border border-[var(--border)] p-1.5 disabled:opacity-40 focus-ring" aria-label="Próxima página">
            <ChevronRight size={14} />
          </button>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={selecionarTodasDoFiltro}
            disabled={selecionandoFiltro || carregando || indiceVazio || importada === 'sim' || selecionadas.size >= LIMITE_SELECAO}
            title={`Seleciona as empresas deste filtro que ainda não foram importadas nem estão em lote (até ${LIMITE_SELECAO} por lote)`}
            className="text-xs text-indigo-300 hover:text-indigo-200 underline underline-offset-2 disabled:opacity-50 disabled:no-underline focus-ring rounded"
          >
            {selecionandoFiltro ? 'Selecionando…' : 'Selecionar todas do filtro'}
          </button>
          <span className="text-xs text-slate-400">
            {selecionadas.size} selecionada(s){selecionadas.size >= LIMITE_SELECAO ? ` (máximo ${LIMITE_SELECAO})` : ''}
          </span>
          {selecionadas.size > 0 && (
            <button onClick={() => { setSelecionadas(new Map()); setAvisoSelecao(null) }} className="text-xs text-slate-400 hover:text-slate-200 underline underline-offset-2">Limpar</button>
          )}
          <button
            onClick={enriquecer}
            disabled={selecionadas.size === 0 || selecionadas.size > LIMITE_ENRIQUECIMENTO || enriquecendo}
            title={selecionadas.size > LIMITE_ENRIQUECIMENTO ? `Enriquecimento: no máximo ${LIMITE_ENRIQUECIMENTO} empresas por vez` : 'Preview: não altera o HubSpot'}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-medium text-slate-200 hover:bg-white/5 disabled:opacity-50 focus-ring"
          >
            {enriquecendo ? 'Enriquecendo…' : `Enriquecer selecionadas${selecionadas.size > LIMITE_ENRIQUECIMENTO ? ` (máx. ${LIMITE_ENRIQUECIMENTO})` : ''}`}
          </button>
          <button
            onClick={() => setConfirmando(true)}
            disabled={selecionadas.size === 0 || preparando}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50 focus-ring"
          >
            Preparar seleção
          </button>
        </div>
      </div>

      {avisoSelecao && <p className="text-xs text-slate-300 text-right">{avisoSelecao}</p>}

      {confirmando && (
        <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-4 space-y-3">
          <p className="text-sm text-slate-200">Preparar {selecionadas.size} empresa(s) para a próxima etapa</p>
          <p className="text-xs text-slate-400">
            Escolha o nicho esperado desta operação. Ele não filtra nada: é comparado com o nicho sugerido pelo enriquecimento (CNAE na Receita).
            Nada é importado e nenhum lead é criado. Clientes entram marcados para envio de novidades (nunca prospecção fria);
            empresas já importadas ficam de fora.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              Nicho esperado *
              <select value={nicho} onChange={(e) => setNicho(e.target.value)} className="rounded-lg border border-[var(--border)] bg-[var(--bg-input)] px-2 py-1.5 text-sm text-slate-200 focus-ring">
                <option value="">Selecione…</option>
                {NICHOS.map((n) => <option key={n.id} value={n.id}>{n.nome}</option>)}
              </select>
            </label>
            <button onClick={preparar} disabled={!nicho || preparando} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50 focus-ring">
              {preparando ? 'Preparando…' : 'Confirmar preparo'}
            </button>
            <button onClick={() => setConfirmando(false)} disabled={preparando} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-slate-300 hover:bg-white/5 focus-ring">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {enriquecidos && (
        <div className="rounded-lg border border-[var(--border)] p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-slate-200">Resultado do enriquecimento — preview para revisão</p>
              <p className="text-xs text-slate-500">
                Nada foi alterado no HubSpot e nada foi importado. Cascata: CNPJ do HubSpot → domínio da empresa → e-mail corporativo do contato,
                sempre confirmado na OpenCNPJ. Nenhuma empresa é deduzida pelo nome da pessoa.
              </p>
            </div>
            <button onClick={() => setEnriquecidos(null)} className="shrink-0 text-xs text-slate-400 hover:text-slate-200 underline underline-offset-2">Fechar</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1500px] text-xs">
              <thead>
                <tr className="text-left text-slate-500 border-b border-[var(--border)]">
                  <th className="py-2 pr-3 font-medium">Empresa (HubSpot)</th>
                  <th className="py-2 pr-3 font-medium">Cadastro atual</th>
                  <th className="py-2 pr-3 font-medium">Empresa identificada</th>
                  <th className="py-2 pr-3 font-medium">Razão social</th>
                  <th className="py-2 pr-3 font-medium">Nome fantasia</th>
                  <th className="py-2 pr-3 font-medium">CNPJ</th>
                  <th className="py-2 pr-3 font-medium">Domínio</th>
                  <th className="py-2 pr-3 font-medium">CNAE principal / atividade</th>
                  <th className="py-2 pr-3 font-medium">Nicho sugerido</th>
                  <th className="py-2 pr-3 font-medium">Fonte</th>
                  <th className="py-2 pr-3 font-medium">Confiança</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {enriquecidos.map((r) => (
                  <tr key={r.hubspot_company_id} className="border-b border-[var(--border)]/60 align-top">
                    <td className="py-2 pr-3">
                      <div className="text-slate-200">{r.nome_hubspot || '(sem nome)'}</div>
                      <div className="text-slate-500">#{r.hubspot_company_id}</div>
                    </td>
                    <td className="py-2 pr-3 text-slate-400">
                      {(['nome', 'documento', 'dominio', 'email_contato'] as const)
                        .map((k) => TEXTO_CADASTRO[k][r.cadastro_atual[k]])
                        .filter(Boolean)
                        .map((t) => <div key={t}>{t}</div>)}
                      {!r.cadastro_atual.empresa_valida && <div className="text-amber-300">Cadastro insuficiente</div>}
                    </td>
                    <td className="py-2 pr-3 text-slate-200">{r.empresa_identificada ?? '—'}</td>
                    <td className="py-2 pr-3 text-slate-300">{r.razao_social ?? '—'}</td>
                    <td className="py-2 pr-3 text-slate-300">{r.nome_fantasia ?? '—'}</td>
                    <td className="py-2 pr-3 text-slate-300 whitespace-nowrap">
                      {formatarCnpj(r.cnpj) ?? '—'}
                      {r.situacao_cadastral && !/^ativa$/i.test(r.situacao_cadastral) && <div className="text-red-300">{r.situacao_cadastral}</div>}
                    </td>
                    <td className="py-2 pr-3 text-slate-400">{r.dominio ?? '—'}</td>
                    <td className="py-2 pr-3 text-slate-400">
                      {r.cnae_principal ? <><div>{r.cnae_principal}</div><div className="text-slate-500">{r.atividade_principal}</div></> : '—'}
                    </td>
                    <td className="py-2 pr-3 text-slate-300">{r.nicho_sugerido ?? (r.cnae_principal ? <span className="text-slate-500">Fora dos nichos configurados</span> : '—')}</td>
                    <td className="py-2 pr-3 text-slate-400">{r.fonte ? ROTULO_FONTE[r.fonte] ?? r.fonte : '—'}</td>
                    <td className={`py-2 pr-3 font-medium ${r.confianca ? COR_CONFIANCA[r.confianca] : 'text-slate-500'}`}>
                      {r.confianca ? { alta: 'Alta', media: 'Média', baixa: 'Baixa' }[r.confianca] : '—'}
                    </td>
                    <td className="py-2">
                      <span className={`inline-block rounded-full px-2 py-0.5 font-medium ${ROTULO_ENRIQUECIMENTO[r.status_enriquecimento].classe}`}>
                        {ROTULO_ENRIQUECIMENTO[r.status_enriquecimento].texto}
                      </span>
                      {r.evidencias.length > 0 && (
                        <details className="mt-1 text-slate-500">
                          <summary className="cursor-pointer">Evidências</summary>
                          <ul className="mt-1 list-disc pl-4 space-y-0.5 max-w-[320px]">
                            {r.evidencias.map((ev) => <li key={ev}>{ev}</li>)}
                          </ul>
                        </details>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
