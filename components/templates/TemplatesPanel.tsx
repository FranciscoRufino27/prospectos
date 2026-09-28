'use client'

// Biblioteca de templates da organização (Comercial → Templates). Lê por
// GET /api/templates — nunca direto do Supabase pelo navegador —, então a
// organização, as permissões e o filtro das cópias de campanha vêm do servidor.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Eye, FileText, Loader2, Lock, Pencil, Plus, Power, RotateCcw, Search } from 'lucide-react'
import PreviaEmailModal from '@/components/automacao/PreviaEmailModal'
import TemplateEditorModal from './TemplateEditorModal'
import { definirAtivoTemplateBiblioteca, listarTemplatesBiblioteca, minhasPermissoes } from '@/lib/api'
import {
  CANAIS_FILTRO,
  ErroTemplateApi,
  FORMATOS_FILTRO,
  acessoBiblioteca,
  acoesDoTemplate,
  formatarAtualizadoEm,
  mensagemUsos,
  rotuloCanal,
  rotuloFormato,
  rotuloStatus,
} from '@/lib/templates/biblioteca'
import { previaTemplate } from '@/lib/templates/previa'
import type { CanalTemplate, FiltroAtivo, FormatoTemplate, TemplateBiblioteca } from '@/lib/templates/tipos'

const controle = 'rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 py-1.5 text-sm text-slate-300 focus:outline-none'

export default function TemplatesPanel() {
  const [acesso, setAcesso] = useState({ podeVer: true, podeGerenciar: false })
  const [templates, setTemplates] = useState<TemplateBiblioteca[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [canal, setCanal] = useState<CanalTemplate | ''>('')
  const [formato, setFormato] = useState<FormatoTemplate | ''>('')
  const [status, setStatus] = useState<FiltroAtivo>('ativos')
  const [editor, setEditor] = useState<{ template: TemplateBiblioteca | null } | null>(null)
  const [previa, setPrevia] = useState<TemplateBiblioteca | null>(null)
  const [abaPrevia, setAbaPrevia] = useState<'visual' | 'codigo'>('visual')

  useEffect(() => {
    minhasPermissoes()
      .then((permissoes) => setAcesso(acessoBiblioteca(permissoes)))
      .catch(() => undefined)
  }, [])

  const carregar = useCallback(async () => {
    setCarregando(true)
    try {
      const lista = await listarTemplatesBiblioteca({
        busca: busca.trim() || undefined,
        canal: canal || undefined,
        formato: formato || undefined,
        ativo: status,
      })
      setTemplates(lista)
      setErro(null)
    } catch (e) {
      setTemplates([])
      if (e instanceof ErroTemplateApi && e.status === 403) {
        setAcesso({ podeVer: false, podeGerenciar: false })
        setErro(null)
      } else {
        setErro(e instanceof Error ? e.message : 'Não foi possível carregar os templates.')
      }
    } finally {
      setCarregando(false)
    }
  }, [busca, canal, formato, status])

  useEffect(() => {
    const id = setTimeout(() => { void carregar() }, 250)
    return () => clearTimeout(id)
  }, [carregar])

  const tiposConhecidos = useMemo(() => [...new Set(templates.map((t) => t.tipo))].sort(), [templates])
  const nichosConhecidos = useMemo(
    () => [...new Set(templates.map((t) => t.nicho).filter((n): n is string => !!n))].sort(),
    [templates],
  )

  async function alternarAtivo(template: TemplateBiblioteca) {
    setAviso(null)
    setErro(null)
    try {
      await definirAtivoTemplateBiblioteca(template.id, !template.ativo)
      await carregar()
    } catch (e) {
      if (e instanceof ErroTemplateApi && e.status === 409) setAviso(mensagemUsos(e.usos))
      else setErro(e instanceof Error ? e.message : 'Não foi possível alterar o template.')
    }
  }

  if (!acesso.podeVer) {
    return (
      <div className="flex flex-col items-center gap-2 py-16 text-center text-slate-500">
        <Lock size={20} />
        <span className="text-sm font-medium text-slate-400">Sem acesso à biblioteca de templates.</span>
        <span className="text-xs">Requer a permissão <code className="text-indigo-300">templates.view</code>.</span>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-slate-400">
          {carregando ? 'Carregando…' : `${templates.length} template(s)`}
          <span className="text-slate-600"> · a biblioteca é da sua organização; cópias geradas por campanhas ficam com a campanha.</span>
        </p>
        {acesso.podeGerenciar ? (
          <button onClick={() => setEditor({ template: null })}
            className="focus-ring flex shrink-0 items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white" style={{ backgroundColor: '#1e3a5f' }}>
            <Plus size={15} /> Novo template
          </button>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-500"><Lock size={12} /> Somente leitura — requer <code className="text-indigo-300">templates.manage</code>.</span>
        )}
      </div>

      <div className="card flex flex-wrap items-center gap-3 p-4">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome"
            className={`${controle} pl-8`} aria-label="Buscar por nome" />
        </div>
        <select className={controle} value={canal} onChange={(e) => setCanal(e.target.value as CanalTemplate | '')} aria-label="Canal">
          <option value="">Todos os canais</option>
          {CANAIS_FILTRO.map((c) => <option key={c.valor} value={c.valor}>{c.label}</option>)}
        </select>
        <select className={controle} value={formato} onChange={(e) => setFormato(e.target.value as FormatoTemplate | '')} aria-label="Formato">
          <option value="">Todos os formatos</option>
          {FORMATOS_FILTRO.map((f) => <option key={f.valor} value={f.valor}>{f.label}</option>)}
        </select>
        <select className={controle} value={status} onChange={(e) => setStatus(e.target.value as FiltroAtivo)} aria-label="Status">
          <option value="ativos">Ativos</option>
          <option value="inativos">Inativos</option>
          <option value="todos">Todos</option>
        </select>
      </div>

      {aviso && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>{aviso}</span>
        </div>
      )}
      {erro && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{erro}</div>}

      {carregando ? (
        <div className="flex items-center justify-center gap-2 py-16 text-slate-500">
          <Loader2 size={18} className="animate-spin" /> <span className="text-sm">Carregando templates…</span>
        </div>
      ) : templates.length === 0 ? (
        <div className="py-16 text-center text-sm text-slate-500">
          <FileText size={20} className="mx-auto mb-2 text-slate-600" />
          Nenhum template com esses filtros.
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--border)] text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Nome</th>
                <th className="px-3 py-3 text-left font-medium">Canal</th>
                <th className="px-3 py-3 text-left font-medium">Formato</th>
                <th className="px-3 py-3 text-left font-medium">Status</th>
                <th className="px-3 py-3 text-left font-medium">Atualizado em</th>
                <th className="px-4 py-3 text-right font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((template) => {
                const acoes = acoesDoTemplate(template, acesso.podeGerenciar)
                return (
                  <tr key={template.id} className="border-b border-[var(--border)] last:border-0">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-100">{template.nome}</div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        {template.assunto ? `✉ ${template.assunto}` : template.tipo}
                        {template.nicho ? ` · ${template.nicho}` : ''}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-slate-300">{rotuloCanal(template.canal)}</td>
                    <td className="px-3 py-3 text-slate-300">{rotuloFormato(template.formato)}</td>
                    <td className="px-3 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${template.ativo ? 'bg-emerald-500/15 text-emerald-300' : 'bg-[var(--bg-input)] text-slate-400'}`}>
                        {rotuloStatus(template.ativo)}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-slate-400">{formatarAtualizadoEm(template.atualizadoEm)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-3">
                        <button onClick={() => setPrevia(template)} className="focus-ring inline-flex items-center gap-1 rounded text-xs text-blue-400 hover:text-blue-300">
                          <Eye size={13} /> Ver
                        </button>
                        {acoes.includes('editar') && (
                          <button onClick={() => setEditor({ template })} className="focus-ring inline-flex items-center gap-1 rounded text-xs text-slate-300 hover:text-[var(--t-strong,#fff)]">
                            <Pencil size={13} /> Editar
                          </button>
                        )}
                        {acoes.includes('desativar') && (
                          <button onClick={() => void alternarAtivo(template)} className="focus-ring inline-flex items-center gap-1 rounded text-xs text-amber-400 hover:text-amber-300">
                            <Power size={13} /> Desativar
                          </button>
                        )}
                        {acoes.includes('reativar') && (
                          <button onClick={() => void alternarAtivo(template)} className="focus-ring inline-flex items-center gap-1 rounded text-xs text-emerald-400 hover:text-emerald-300">
                            <RotateCcw size={13} /> Reativar
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {editor && (
        <TemplateEditorModal
          template={editor.template}
          tiposConhecidos={tiposConhecidos}
          nichosConhecidos={nichosConhecidos}
          onFechar={() => setEditor(null)}
          onSalvo={() => { setEditor(null); void carregar() }}
        />
      )}

      {previa && (
        <PreviaEmailModal
          aberto
          onFechar={() => setPrevia(null)}
          titulo={previa.nome}
          assunto={previa.canal === 'email' ? previaTemplate(previa).assunto : null}
          html={previa.canal === 'email'
            ? previaTemplate(previa).html ?? ''
            : `<pre style="white-space:pre-wrap;font-family:Arial,Helvetica,sans-serif;padding:16px">${previaTemplate(previa).texto.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))}</pre>`}
          codigo={previa.html ?? undefined}
          aba={abaPrevia}
          onAba={setAbaPrevia}
        />
      )}
    </div>
  )
}
