'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertCircle, Building2, Check, ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { NICHOS } from '@/lib/prospeccao/nichos'

// Preparo da importação de empresas do HubSpot (microentrega 1). Filtros e
// paginação são server-side; o navegador só recebe a página atual. "Preparar
// seleção" grava o lote (nicho esperado + empresas) — NÃO importa, não cria
// empresas nem leads. Validação OpenCNPJ/DGCBR é a próxima etapa.

type Status = 'importada' | 'em_preparo' | 'nao_importada'

interface Linha {
  id: string
  nome: string
  dominio: string | null
  industry: string | null
  contatos: number | null
  negocios: number | null
  owner: { id: string; nome: string } | null
  responsavel: { usuarioId: string; nome: string } | null
  status: Status
}

interface Pagina {
  total: number
  pagina: number
  tamanho: number
  itens: Linha[]
}

const LIMITE_SELECAO = 200
const TAMANHO = 25

const ROTULO_STATUS: Record<Status, { texto: string; classe: string }> = {
  importada: { texto: 'Já importada', classe: 'bg-emerald-500/15 text-emerald-300' },
  em_preparo: { texto: 'Em lote preparado', classe: 'bg-indigo-500/15 text-indigo-300' },
  nao_importada: { texto: 'Não importada', classe: 'bg-slate-500/15 text-slate-400' },
}

const ERROS: Record<string, string> = {
  filtro_importadas_indisponivel: 'Filtro “Já importada / Não importada” indisponível: há mais de 100 empresas importadas (limite da busca do HubSpot).',
  pagina_fora_do_limite: 'A busca do HubSpot só alcança os primeiros 10.000 resultados. Refine os filtros.',
  nao_conectado: 'HubSpot não conectado.',
  erro_refresh: 'Não foi possível renovar o acesso ao HubSpot. Reconecte a integração.',
  nicho_invalido: 'Escolha o nicho da importação.',
  selecao_vazia: 'Selecione ao menos uma empresa.',
  selecao_excede_limite: `Selecione no máximo ${LIMITE_SELECAO} empresas por lote.`,
  nenhuma_elegivel: 'Nenhuma empresa selecionada está disponível (todas já importadas ou não encontradas).',
}

const msgErro = (codigo: string) => ERROS[codigo] ?? `Não foi possível concluir (${codigo}).`

function Select({ valor, onChange, rotulo, opcoes }: {
  valor: string
  onChange: (v: string) => void
  rotulo: string
  opcoes: { valor: string; texto: string }[]
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-500">
      {rotulo}
      <select
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-[var(--border)] bg-[var(--bg-input)] px-2 py-1.5 text-sm text-slate-200 focus-ring"
      >
        {opcoes.map((o) => (
          <option key={o.valor} value={o.valor}>{o.texto}</option>
        ))}
      </select>
    </label>
  )
}

export default function HubspotImportacaoPanel() {
  const [nicho, setNicho] = useState('')
  const [owners, setOwners] = useState<{ id: string; nome: string }[]>([])
  const [owner, setOwner] = useState('todos')
  const [importada, setImportada] = useState('todas')
  const [contato, setContato] = useState('todos')
  const [negocio, setNegocio] = useState('todos')
  const [buscaDigitada, setBuscaDigitada] = useState('')
  const [busca, setBusca] = useState('')
  const [pagina, setPagina] = useState(1)
  const [dados, setDados] = useState<Pagina | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [selecionadas, setSelecionadas] = useState<Map<string, string>>(new Map())
  const [preparando, setPreparando] = useState(false)
  const [resultado, setResultado] = useState<string | null>(null)
  const seq = useRef(0)

  // Owners para o filtro (mesma fonte do mapeamento).
  useEffect(() => {
    fetch('/api/integracoes/hubspot/comerciais')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.owners) setOwners(d.owners.map((o: { id: string; nome: string }) => ({ id: o.id, nome: o.nome }))) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const t = setTimeout(() => { setBusca(buscaDigitada.trim()); setPagina(1) }, 350)
    return () => clearTimeout(t)
  }, [buscaDigitada])

  function carregar() {
    const minha = ++seq.current
    setCarregando(true)
    setErro(null)
    const qs = new URLSearchParams({ owner, importada, contato, negocio, pagina: String(pagina), tamanho: String(TAMANHO) })
    if (busca) qs.set('busca', busca)
    fetch(`/api/integracoes/hubspot/empresas?${qs}`)
      .then(async (r) => {
        const d = await r.json()
        if (minha !== seq.current) return // resposta antiga não sobrescreve a nova
        if (!r.ok) { setDados(null); setErro(msgErro(d?.erro ?? `HTTP ${r.status}`)); return }
        setDados(d)
      })
      .catch(() => { if (minha === seq.current) setErro('Falha ao carregar empresas do HubSpot.') })
      .finally(() => { if (minha === seq.current) setCarregando(false) })
  }

  useEffect(() => {
    carregar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, importada, contato, negocio, busca, pagina])

  const mudarFiltro = (set: (v: string) => void) => (v: string) => { set(v); setPagina(1) }

  const totalPaginas = dados ? Math.max(1, Math.ceil(dados.total / TAMANHO)) : 1
  const selecionaveis = (dados?.itens ?? []).filter((l) => l.status !== 'importada')
  const paginaToda = selecionaveis.length > 0 && selecionaveis.every((l) => selecionadas.has(l.id))

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

  async function preparar() {
    const nomeNicho = NICHOS.find((n) => n.id === nicho)?.nome ?? nicho
    if (!confirm(`Preparar ${selecionadas.size} empresa(s) para importação no nicho “${nomeNicho}”?\n\nNada será importado agora: a seleção fica salva para a validação (OpenCNPJ/DGCBR) na próxima etapa.`)) return
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
        d.jaImportadas ? `${d.jaImportadas} já importada(s) ignorada(s)` : null,
        d.naoEncontradas ? `${d.naoEncontradas} não encontrada(s) no HubSpot` : null,
      ].filter(Boolean).join(' · ')
      setResultado(`Lote preparado com ${d.incluidas} empresa(s) no nicho “${nomeNicho}”.${extras ? ` ${extras}.` : ''} Nenhuma empresa foi importada ainda.`)
      setSelecionadas(new Map())
      carregar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao preparar a seleção.')
    } finally {
      setPreparando(false)
    }
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5 space-y-4">
      <div>
        <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2">
          <Building2 size={16} className="text-slate-300" /> Importar empresas do HubSpot
        </h3>
        <p className="mt-1 text-sm text-slate-400">
          Escolha o nicho esperado, filtre e selecione as empresas. Esta etapa só prepara a seleção — nada é importado
          e nenhum lead é criado.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6 items-end">
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          Nicho da importação *
          <select
            value={nicho}
            onChange={(e) => setNicho(e.target.value)}
            className="rounded-lg border border-[var(--border)] bg-[var(--bg-input)] px-2 py-1.5 text-sm text-slate-200 focus-ring"
          >
            <option value="">Selecione…</option>
            {NICHOS.map((n) => (
              <option key={n.id} value={n.id}>{n.nome}</option>
            ))}
          </select>
        </label>
        <Select
          rotulo="Comercial HubSpot"
          valor={owner}
          onChange={mudarFiltro(setOwner)}
          opcoes={[
            { valor: 'todos', texto: 'Todos' },
            { valor: 'sem', texto: 'Sem responsável' },
            ...owners.map((o) => ({ valor: o.id, texto: o.nome })),
          ]}
        />
        <Select
          rotulo="Importação"
          valor={importada}
          onChange={mudarFiltro(setImportada)}
          opcoes={[
            { valor: 'todas', texto: 'Todas' },
            { valor: 'nao', texto: 'Não importada' },
            { valor: 'sim', texto: 'Já importada' },
          ]}
        />
        <Select
          rotulo="Contato"
          valor={contato}
          onChange={mudarFiltro(setContato)}
          opcoes={[
            { valor: 'todos', texto: 'Todos' },
            { valor: 'com', texto: 'Com contato' },
            { valor: 'sem', texto: 'Sem contato' },
          ]}
        />
        <Select
          rotulo="Negócio"
          valor={negocio}
          onChange={mudarFiltro(setNegocio)}
          opcoes={[
            { valor: 'todos', texto: 'Todos' },
            { valor: 'com', texto: 'Com negócio' },
            { valor: 'sem', texto: 'Sem negócio' },
          ]}
        />
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          Buscar
          <span className="relative">
            <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={buscaDigitada}
              onChange={(e) => setBuscaDigitada(e.target.value)}
              placeholder="Nome ou domínio"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-input)] pl-7 pr-2 py-1.5 text-sm text-slate-200 focus-ring"
            />
          </span>
        </label>
      </div>

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
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500 border-b border-[var(--border)]">
              <th className="py-2 pr-3 w-8">
                <input
                  type="checkbox"
                  checked={paginaToda}
                  disabled={selecionaveis.length === 0}
                  onChange={alternarPagina}
                  aria-label="Selecionar empresas desta página"
                />
              </th>
              <th className="py-2 pr-3 font-medium">Empresa</th>
              <th className="py-2 pr-3 font-medium">Responsável HubSpot</th>
              <th className="py-2 pr-3 font-medium text-right">Contatos</th>
              <th className="py-2 pr-3 font-medium text-right">Negócios</th>
              <th className="py-2 pr-3 font-medium">Industry HubSpot</th>
              <th className="py-2 font-medium">Status no ProspectOS</th>
            </tr>
          </thead>
          <tbody className={carregando ? 'opacity-50' : ''}>
            {(dados?.itens ?? []).map((l) => (
              <tr key={l.id} className="border-b border-[var(--border)]/60 align-top">
                <td className="py-2 pr-3">
                  <input
                    type="checkbox"
                    checked={selecionadas.has(l.id)}
                    disabled={l.status === 'importada' || (!selecionadas.has(l.id) && selecionadas.size >= LIMITE_SELECAO)}
                    onChange={() => alternar(l)}
                    aria-label={`Selecionar ${l.nome}`}
                  />
                </td>
                <td className="py-2 pr-3">
                  <div className="text-slate-200">{l.nome}</div>
                  {l.dominio && <div className="text-xs text-slate-500">{l.dominio}</div>}
                </td>
                <td className="py-2 pr-3">
                  {l.owner ? (
                    <>
                      <div className="text-slate-300">{l.owner.nome}</div>
                      {l.responsavel ? (
                        <div className="text-xs text-slate-500">ProspectOS: {l.responsavel.nome}</div>
                      ) : (
                        <div className="text-xs text-amber-300">Responsável não mapeado</div>
                      )}
                    </>
                  ) : (
                    <span className="text-xs text-slate-500">Sem responsável no HubSpot</span>
                  )}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-slate-300">{l.contatos ?? '—'}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-slate-300">{l.negocios ?? '—'}</td>
                <td className="py-2 pr-3 text-xs text-slate-400">{l.industry ?? '—'}</td>
                <td className="py-2">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ROTULO_STATUS[l.status].classe}`}>
                    {ROTULO_STATUS[l.status].texto}
                  </span>
                </td>
              </tr>
            ))}
            {!carregando && dados && dados.itens.length === 0 && (
              <tr>
                <td colSpan={7} className="py-6 text-center text-sm text-slate-500">Nenhuma empresa encontrada com estes filtros.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <button
            onClick={() => setPagina((p) => Math.max(1, p - 1))}
            disabled={pagina <= 1 || carregando}
            className="rounded-lg border border-[var(--border)] p-1.5 disabled:opacity-40 focus-ring"
            aria-label="Página anterior"
          >
            <ChevronLeft size={14} />
          </button>
          <span>
            Página {pagina} de {totalPaginas}
            {dados ? ` · ${dados.total.toLocaleString('pt-BR')} empresa(s)` : ''}
          </span>
          <button
            onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
            disabled={pagina >= totalPaginas || carregando}
            className="rounded-lg border border-[var(--border)] p-1.5 disabled:opacity-40 focus-ring"
            aria-label="Próxima página"
          >
            <ChevronRight size={14} />
          </button>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400">
            {selecionadas.size} selecionada(s){selecionadas.size >= LIMITE_SELECAO ? ` (máximo ${LIMITE_SELECAO})` : ''}
          </span>
          {selecionadas.size > 0 && (
            <button onClick={() => setSelecionadas(new Map())} className="text-xs text-slate-400 hover:text-slate-200 underline underline-offset-2">
              Limpar
            </button>
          )}
          <button
            onClick={preparar}
            disabled={!nicho || selecionadas.size === 0 || preparando}
            title={!nicho ? 'Escolha o nicho da importação' : undefined}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50 focus-ring"
          >
            {preparando ? 'Preparando…' : 'Preparar seleção'}
          </button>
        </div>
      </div>
    </div>
  )
}
