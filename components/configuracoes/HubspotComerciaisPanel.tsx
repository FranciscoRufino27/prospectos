'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, Check, Save, Users } from 'lucide-react'

// Mapeamento hubspot_owner_id → usuário ProspectOS. A sugestão por e-mail é
// só exibida; nada é gravado até clicar em Salvar. Sem mapeamento = "Não
// mapeado" (nenhum vendedor é atribuído automaticamente).

type Sugestao = { tipo: 'email'; usuarioId: string } | { tipo: 'ambigua'; candidatos: number } | { tipo: 'nenhuma' }

interface OwnerLinha {
  id: string
  nome: string
  email: string | null
  mapeamento: { usuarioId: string; ativo: boolean } | null
  sugestao: Sugestao
}

interface Usuario {
  id: string
  nome: string
  email: string
}

export default function HubspotComerciaisPanel() {
  const [owners, setOwners] = useState<OwnerLinha[]>([])
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [rascunho, setRascunho] = useState<Record<string, { usuarioId: string; ativo: boolean }>>({})
  const [salvando, setSalvando] = useState<string | null>(null)
  const [salvo, setSalvo] = useState<string | null>(null)
  const [filtro, setFiltro] = useState('')

  function carregar() {
    setCarregando(true)
    setErro(null)
    fetch('/api/integracoes/hubspot/comerciais')
      .then(async (r) => {
        const d = await r.json()
        if (!r.ok) throw new Error(d?.erro ?? 'Falha ao carregar comerciais')
        setOwners(d.owners)
        setUsuarios(d.usuarios)
        setRascunho({})
      })
      .catch((e) => setErro(e instanceof Error ? e.message : 'Falha ao carregar comerciais'))
      .finally(() => setCarregando(false))
  }

  useEffect(() => {
    carregar()
  }, [])

  const nomeUsuario = useMemo(() => new Map(usuarios.map((u) => [u.id, u.nome])), [usuarios])

  const visiveis = owners.filter((o) => {
    const t = filtro.trim().toLowerCase()
    return !t || o.nome.toLowerCase().includes(t) || (o.email ?? '').toLowerCase().includes(t) || o.id.includes(t)
  })

  function valorAtual(o: OwnerLinha) {
    return rascunho[o.id] ?? { usuarioId: o.mapeamento?.usuarioId ?? '', ativo: o.mapeamento?.ativo ?? true }
  }

  function alterado(o: OwnerLinha) {
    const r = rascunho[o.id]
    if (!r) return false
    return r.usuarioId !== (o.mapeamento?.usuarioId ?? '') || (!!r.usuarioId && r.ativo !== (o.mapeamento?.ativo ?? true))
  }

  async function salvar(o: OwnerLinha) {
    const v = valorAtual(o)
    setSalvando(o.id)
    setErro(null)
    try {
      const r = await fetch('/api/integracoes/hubspot/comerciais', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hubspotOwnerId: o.id, usuarioId: v.usuarioId || null, ativo: v.ativo }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d?.mensagem ?? d?.erro ?? 'Falha ao salvar')
      setSalvo(o.id)
      carregar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao salvar')
    } finally {
      setSalvando(null)
    }
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2">
            <Users size={16} className="text-slate-300" /> Comerciais HubSpot → ProspectOS
          </h3>
          <p className="mt-1 text-sm text-slate-400">
            Defina qual usuário do ProspectOS responde por cada comercial do HubSpot. A sugestão usa só e-mail
            idêntico; nada é salvo automaticamente. Sem mapeamento, a empresa fica com “Responsável não mapeado”.
          </p>
        </div>
        <input
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          placeholder="Filtrar por nome, e-mail ou ID"
          className="w-60 shrink-0 rounded-lg border border-[var(--border)] bg-[var(--bg-input)] px-3 py-1.5 text-sm text-slate-200 focus-ring"
        />
      </div>

      {erro && (
        <p className="text-xs text-red-400 flex items-center gap-1.5">
          <AlertCircle size={12} /> {erro}
        </p>
      )}

      {carregando ? (
        <p className="text-sm text-slate-500">Carregando…</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-[var(--border)]">
                <th className="py-2 pr-3 font-medium">Comercial HubSpot</th>
                <th className="py-2 pr-3 font-medium">Usuário ProspectOS</th>
                <th className="py-2 pr-3 font-medium">Sugestão</th>
                <th className="py-2 pr-3 font-medium">Ativo</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {visiveis.map((o) => {
                const v = valorAtual(o)
                return (
                  <tr key={o.id} className="border-b border-[var(--border)]/60 align-top">
                    <td className="py-2 pr-3">
                      <div className="text-slate-200">{o.nome}</div>
                      <div className="text-xs text-slate-500">
                        {o.email ?? 'sem e-mail'} · owner {o.id}
                      </div>
                    </td>
                    <td className="py-2 pr-3">
                      <select
                        value={v.usuarioId}
                        onChange={(e) => setRascunho((r) => ({ ...r, [o.id]: { ...v, usuarioId: e.target.value } }))}
                        className="w-56 rounded-lg border border-[var(--border)] bg-[var(--bg-input)] px-2 py-1.5 text-sm text-slate-200 focus-ring"
                      >
                        <option value="">Não mapeado</option>
                        {usuarios.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.nome} — {u.email}
                          </option>
                        ))}
                      </select>
                      {!o.mapeamento && !rascunho[o.id] && (
                        <div className="mt-1 text-xs text-amber-300">Não mapeado</div>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-xs">
                      {o.sugestao.tipo === 'email' && o.mapeamento?.usuarioId !== o.sugestao.usuarioId ? (
                        <button
                          onClick={() =>
                            setRascunho((r) => ({ ...r, [o.id]: { ...v, usuarioId: (o.sugestao as { usuarioId: string }).usuarioId } }))
                          }
                          className="text-indigo-300 hover:text-indigo-200 underline underline-offset-2"
                        >
                          Usar {nomeUsuario.get(o.sugestao.usuarioId) ?? 'sugestão'} (e-mail igual)
                        </button>
                      ) : o.sugestao.tipo === 'ambigua' ? (
                        <span className="text-amber-300">E-mail ambíguo ({o.sugestao.candidatos} usuários)</span>
                      ) : o.sugestao.tipo === 'email' ? (
                        <span className="text-slate-500">Confere com o e-mail</span>
                      ) : (
                        <span className="text-slate-500">Nenhuma por e-mail</span>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="checkbox"
                        checked={v.ativo}
                        disabled={!v.usuarioId}
                        onChange={(e) => setRascunho((r) => ({ ...r, [o.id]: { ...v, ativo: e.target.checked } }))}
                        aria-label={`Mapeamento ativo para ${o.nome}`}
                      />
                    </td>
                    <td className="py-2 text-right whitespace-nowrap">
                      {alterado(o) ? (
                        <button
                          onClick={() => salvar(o)}
                          disabled={salvando === o.id}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50 focus-ring"
                        >
                          <Save size={12} /> {salvando === o.id ? 'Salvando…' : 'Salvar'}
                        </button>
                      ) : salvo === o.id ? (
                        <span className="text-xs text-emerald-300 inline-flex items-center gap-1">
                          <Check size={12} /> Salvo
                        </span>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
