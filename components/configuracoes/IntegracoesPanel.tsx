'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AlertCircle, Building2, Check, Lock, Plug, RefreshCw, Unplug, Users } from 'lucide-react'
import HubspotComerciaisPanel from './HubspotComerciaisPanel'
import HubspotImportacaoPanel from './HubspotImportacaoPanel'

interface StatusHubspot {
  conectado: boolean
  conexao?: {
    hubspotPortalId: number
    scopes: string[]
    ativo: boolean
    ultimaSincronizacao: string | null
  }
  podeGerenciar: boolean
}

const ERROS_CALLBACK: Record<string, string> = {
  state_formato_invalido: 'A solicitação de conexão expirou ou é inválida. Tente conectar novamente.',
  state_assinatura_invalida: 'A solicitação de conexão não pôde ser verificada. Tente conectar novamente.',
  state_expirado: 'A solicitação de conexão expirou. Tente conectar novamente.',
  sem_code: 'O HubSpot não retornou autorização. Tente conectar novamente.',
  app_nao_configurado: 'A integração HubSpot não está configurada no servidor.',
  troca_falhou: 'Não foi possível concluir a autorização com o HubSpot.',
  metadados_falharam: 'Autorizado, mas não foi possível identificar a conta HubSpot.',
  persistencia_falhou: 'Autorizado, mas não foi possível salvar a conexão.',
}

export default function IntegracoesPanel() {
  const searchParams = useSearchParams()
  const [status, setStatus] = useState<StatusHubspot | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [validando, setValidando] = useState(false)
  const [desconectando, setDesconectando] = useState(false)
  const [resultadoValidacao, setResultadoValidacao] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [visao, setVisao] = useState<'comerciais' | 'importar' | null>(null)

  const erroCallback = searchParams.get('hubspot_erro')

  function carregarStatus() {
    setCarregando(true)
    fetch('/api/integracoes/hubspot/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: StatusHubspot | null) => setStatus(d))
      .catch(() => setErro('Não foi possível carregar o status da integração.'))
      .finally(() => setCarregando(false))
  }

  useEffect(() => {
    carregarStatus()
  }, [])

  async function desconectar() {
    if (!confirm('Desconectar o HubSpot desta organização?')) return
    setDesconectando(true)
    setErro(null)
    try {
      const r = await fetch('/api/integracoes/hubspot/disconnect', { method: 'POST' })
      if (!r.ok) throw new Error()
      setResultadoValidacao(null)
      carregarStatus()
    } catch {
      setErro('Não foi possível desconectar.')
    } finally {
      setDesconectando(false)
    }
  }

  async function validar() {
    setValidando(true)
    setErro(null)
    setResultadoValidacao(null)
    try {
      const r = await fetch('/api/integracoes/hubspot/testar-leitura', { method: 'POST' })
      const d = await r.json()
      if (!r.ok) throw new Error(d?.erro ?? 'Falha na validação')
      const total = (chave: 'empresas' | 'contatos' | 'negocios' | 'proprietarios') =>
        d[chave]?.ok ? `${d[chave].total} ${chave}` : `${chave}: falhou`
      setResultadoValidacao(
        `Leitura ok — ${total('empresas')}, ${total('contatos')}, ${total('negocios')}, ${total('proprietarios')}.`,
      )
      carregarStatus()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha na validação')
    } finally {
      setValidando(false)
    }
  }

  if (carregando) {
    return <div className="p-4 text-sm text-slate-500">Carregando…</div>
  }

  const podeGerenciar = status?.podeGerenciar ?? false

  return (
    <div className="space-y-4">
      {erroCallback && (
        <div className="max-w-2xl rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300 flex items-start gap-2">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{ERROS_CALLBACK[erroCallback] ?? 'Não foi possível concluir a conexão com o HubSpot.'}</span>
        </div>
      )}

      <div className="max-w-2xl rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Plug size={18} className="text-orange-400" />
            <h3 className="text-base font-semibold text-slate-100">HubSpot</h3>
          </div>
          {status?.conectado && (
            <span
              className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                status.conexao?.ativo ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-500/15 text-slate-400'
              }`}
            >
              {status.conexao?.ativo ? 'Ativo' : 'Inativo'}
            </span>
          )}
        </div>

        <p className="mt-1 text-sm text-slate-400">
          Leitura de contatos, empresas, negócios e proprietários via OAuth. Somente leitura — nenhum dado é
          gravado no HubSpot.
        </p>

        {!status?.conectado ? (
          <div className="mt-4">
            {podeGerenciar ? (
              <a
                href="/api/integracoes/hubspot/connect"
                className="inline-flex items-center gap-1.5 rounded-lg bg-orange-500/90 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-500 focus-ring"
              >
                <Plug size={14} /> Conectar HubSpot
              </a>
            ) : (
              <p className="text-xs text-slate-500 flex items-center gap-1.5">
                <Lock size={12} /> Requer a permissão <code className="text-indigo-300">workspace.configure</code>.
              </p>
            )}
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <dt className="text-slate-500">Conta (portal HubSpot)</dt>
              <dd className="text-slate-200">{status.conexao?.hubspotPortalId}</dd>
              <dt className="text-slate-500">Escopos</dt>
              <dd className="text-slate-200">{status.conexao?.scopes.join(', ') || '—'}</dd>
              <dt className="text-slate-500">Última sincronização</dt>
              <dd className="text-slate-200">
                {status.conexao?.ultimaSincronizacao
                  ? new Date(status.conexao.ultimaSincronizacao).toLocaleString('pt-BR')
                  : 'Nunca'}
              </dd>
            </dl>

            {podeGerenciar && (
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={validar}
                  disabled={validando}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-medium text-slate-200 hover:bg-white/5 disabled:opacity-50 focus-ring"
                >
                  <RefreshCw size={14} className={validando ? 'animate-spin' : ''} /> Validar conexão
                </button>
                <button
                  onClick={desconectar}
                  disabled={desconectando}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-1.5 text-sm font-medium text-red-300 hover:bg-red-500/10 disabled:opacity-50 focus-ring"
                >
                  <Unplug size={14} /> Desconectar
                </button>
                <button
                  onClick={() => setVisao((v) => (v === 'comerciais' ? null : 'comerciais'))}
                  aria-pressed={visao === 'comerciais'}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-medium text-slate-200 hover:bg-white/5 focus-ring"
                >
                  <Users size={14} /> Comerciais
                </button>
                <button
                  onClick={() => setVisao((v) => (v === 'importar' ? null : 'importar'))}
                  aria-pressed={visao === 'importar'}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 focus-ring"
                >
                  <Building2 size={14} /> Importar empresas
                </button>
              </div>
            )}

            {resultadoValidacao && (
              <p className="text-xs text-emerald-300 flex items-center gap-1.5">
                <Check size={12} /> {resultadoValidacao}
              </p>
            )}
          </div>
        )}

        {erro && <p className="mt-2 text-xs text-red-400">{erro}</p>}
      </div>

      {status?.conectado && podeGerenciar && visao === 'comerciais' && <HubspotComerciaisPanel />}
      {status?.conectado && podeGerenciar && visao === 'importar' && <HubspotImportacaoPanel />}
    </div>
  )
}
