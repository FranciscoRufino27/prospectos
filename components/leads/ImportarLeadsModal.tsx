'use client'

import { useState } from 'react'
import { X, Loader2, Upload, FileSpreadsheet, CheckCircle2 } from 'lucide-react'

// Modal de importação em LOTE (2.2). Fluxo: (1) escolhe o CSV → (2) preview com
// contagens (o server parseia/valida/dedupe) → (3) confirma → insere na carteira
// do usuário autenticado. Importar não inscreve em campanha nem libera o motor.
type Resumo = {
  totalLinhas: number
  validas: number
  pulados: Record<string, number>
  duplicadosNoArquivo: number
  jaExistentes: number
  novos: number
  nichos: Array<{ nicho: string; leads: number; templateAtivo: boolean }>
  // Quantos realmente entram: novos menos os que têm responsável não reconhecido.
  importaveis: number
  semResponsavelValido: number
  responsaveisNaoReconhecidos: Array<{ valor: string; motivo: string; detalhe?: string; linhas: number }>
  semSegmento: number
  comValidade: number
  emRenovacao: number
  validadeInvalida: number
}
const MOTIVO_LABEL: Record<string, string> = {
  sem_nome: 'sem nome',
  sem_email: 'sem e-mail',
  email_invalido: 'e-mail inválido',
  sem_empresa: 'sem empresa',
  sem_responsavel: 'sem responsável',
}

function rotuloNicho(nicho: string): string {
  const texto = nicho.replace(/_/g, ' ')
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

export default function ImportarLeadsModal({
  onClose,
  onImported,
}: {
  onClose: () => void
  onImported: () => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [resumo, setResumo] = useState<Resumo | null>(null)
  const [carregandoPrevia, setCarregandoPrevia] = useState(false)
  const [inserindo, setInserindo] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [feito, setFeito] = useState<{ inseridos: number; responsaveis?: Array<{ nome: string; leads: number }> } | null>(null)

  async function escolherArquivo(f: File | null) {
    setFile(f)
    setResumo(null)
    setErro(null)
    if (!f) return
    setCarregandoPrevia(true)
    try {
      const fd = new FormData()
      fd.append('file', f)
      fd.append('modo', 'previa')
      const res = await fetch('/api/leads/importar', { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setErro(data.erro || 'Não foi possível ler o arquivo.'); return }
      setResumo(data.resumo)
    } catch {
      setErro('Erro ao enviar o arquivo.')
    } finally {
      setCarregandoPrevia(false)
    }
  }

  async function confirmar() {
    if (!file || inserindo) return
    setInserindo(true)
    setErro(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('modo', 'confirmar')
      const res = await fetch('/api/leads/importar', { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErro([data.erro, data.detalhe].filter(Boolean).join(' — ') || 'Falha ao importar.')
        return
      }
      setFeito({ inseridos: data.inseridos ?? 0, responsaveis: data.responsaveis })
      onImported()
    } catch {
      setErro('Erro de conexão ao importar.')
    } finally {
      setInserindo(false)
    }
  }

  const pulosTexto = resumo
    ? Object.entries(resumo.pulados).map(([m, n]) => `${n} ${MOTIVO_LABEL[m] ?? m}`).join(', ')
    : ''

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => !inserindo && onClose()}>
      <div className="bg-[var(--t-bg-card,#1a1f2e)] rounded-2xl shadow-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Importar leads">
        <div className="flex items-start justify-between mb-4">
          <h3 className="font-bold text-lg text-slate-100 flex items-center gap-2">
            <FileSpreadsheet size={18} className="text-indigo-400" /> Importar leads
          </h3>
          <button onClick={() => !inserindo && onClose()} className="text-slate-500 hover:text-slate-300"><X size={20} /></button>
        </div>

        {feito ? (
          <div className="flex flex-col items-center text-center gap-3 py-6">
            <CheckCircle2 size={40} className="text-emerald-400" />
            <p className="text-slate-100 font-medium">{feito.inseridos} lead{feito.inseridos === 1 ? '' : 's'} importado{feito.inseridos === 1 ? '' : 's'}</p>
            {feito.responsaveis && feito.responsaveis.length > 0 && (
              <div className="w-full max-w-xs space-y-1 text-sm">
                <p className="text-xs uppercase tracking-wide text-slate-600">Distribuídos entre</p>
                {feito.responsaveis.map((r) => (
                  <div key={r.nome} className="flex justify-between gap-3 text-slate-400">
                    <span className="truncate">{r.nome}</span>
                    <span className="tabular-nums text-slate-300">{r.leads}</span>
                  </div>
                ))}
              </div>
            )}
            <button onClick={onClose} className="mt-2 text-sm px-4 py-2 rounded-lg text-white font-medium" style={{ backgroundColor: '#1e3a5f' }}>Fechar</button>
          </div>
        ) : (
          <>
            {/* 1) Upload */}
            <label className="block text-sm text-slate-400 mb-1.5">Arquivo CSV</label>
            <label className="flex items-center gap-2 cursor-pointer bg-[var(--t-bg-base,#0f1117)] border border-dashed border-[var(--t-border,#2a3147)] rounded-lg px-3 py-3 text-sm text-slate-300 hover:border-blue-500/50">
              <Upload size={16} className="text-slate-500" />
              <span className="truncate">{file ? file.name : 'Escolher arquivo…'}</span>
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => escolherArquivo(e.target.files?.[0] ?? null)} />
            </label>
            <p className="text-xs text-slate-600 mt-1.5">
              Obrigatórias: <span className="text-slate-500">Nome, E-mail, Empresa, Responsável</span> · Opcionais: Nicho/Segmento, Origem, Telefone, Cargo, Cidade, Estado e Validade do laudo (dd/mm/aaaa).
            </p>
            <p className="text-xs leading-5 text-slate-600 mt-1">
              <span className="text-slate-500">Responsável</span> é o comercial dono do lead — use o nome ou o e-mail exato de
              um membro ativo da equipe. É quem recebe o retorno quando a campanha estiver no modo
              &ldquo;responsável de cada lead&rdquo;.
            </p>

            {carregandoPrevia && (
              <div className="flex items-center gap-2 text-sm text-slate-400 mt-4"><Loader2 size={14} className="animate-spin" /> Lendo arquivo…</div>
            )}

            {/* 2) Preview */}
            {resumo && (
              <div className="mt-4 rounded-lg border border-[var(--t-border,#2a3147)] bg-[var(--t-bg-base,#0f1117)] p-3 text-sm space-y-1">
                <div className="flex justify-between"><span className="text-slate-400">Linhas no arquivo</span><span className="text-slate-200 tabular-nums">{resumo.totalLinhas}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Válidas</span><span className="text-slate-200 tabular-nums">{resumo.validas}</span></div>
                {resumo.duplicadosNoArquivo > 0 && <div className="flex justify-between"><span className="text-slate-400">Duplicadas no arquivo</span><span className="text-slate-300 tabular-nums">{resumo.duplicadosNoArquivo}</span></div>}
                {resumo.jaExistentes > 0 && <div className="flex justify-between"><span className="text-slate-400">Já existem na base</span><span className="text-slate-300 tabular-nums">{resumo.jaExistentes}</span></div>}
                {pulosTexto && <div className="flex justify-between gap-3"><span className="text-slate-400">Puladas</span><span className="text-amber-300/80 text-right">{pulosTexto}</span></div>}
                {resumo.semResponsavelValido > 0 && (
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-400">Responsável não reconhecido</span>
                    <span className="text-rose-400 tabular-nums">{resumo.semResponsavelValido}</span>
                  </div>
                )}
                <div className="flex justify-between pt-1 border-t border-[var(--t-border,#2a3147)] mt-1"><span className="text-slate-200 font-medium">A inserir</span><span className="text-emerald-400 font-semibold tabular-nums">{resumo.importaveis}</span></div>
                {resumo.responsaveisNaoReconhecidos.length > 0 && (
                  <div className="pt-2 mt-2 border-t border-[var(--t-border,#2a3147)] space-y-1.5">
                    <p className="text-xs font-medium text-rose-300">Responsáveis que não existem na equipe</p>
                    {resumo.responsaveisNaoReconhecidos.map((item) => (
                      <div key={item.valor} className="flex items-start justify-between gap-3 text-xs">
                        <span className="text-slate-300 truncate">“{item.valor}”</span>
                        <span className="text-rose-300/80 shrink-0">
                          {item.linhas} linha{item.linhas === 1 ? '' : 's'}
                          {item.motivo === 'ambiguo' ? ' · ambíguo' : ''}
                        </span>
                      </div>
                    ))}
                    <p className="text-xs leading-5 text-rose-300/80">
                      Essas linhas não serão importadas. Corrija a planilha para o nome ou e-mail exato de um
                      membro ativo, ou cadastre a pessoa em Equipe antes de importar.
                    </p>
                  </div>
                )}
                {resumo.semSegmento > 0 && (
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-400">Sem segmento</span>
                    <span className="text-amber-300/80 tabular-nums">{resumo.semSegmento}</span>
                  </div>
                )}
                {resumo.comValidade > 0 && (
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-400">Com validade do laudo</span>
                    <span className="text-slate-300 tabular-nums">{resumo.comValidade}</span>
                  </div>
                )}
                {resumo.emRenovacao > 0 && (
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-400">Entram em Renovação</span>
                    <span className="text-slate-300 tabular-nums">{resumo.emRenovacao}</span>
                  </div>
                )}
                {resumo.validadeInvalida > 0 && (
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-400">Validade não reconhecida</span>
                    <span className="text-amber-300/80 tabular-nums">{resumo.validadeInvalida}</span>
                  </div>
                )}
                {resumo.nichos.length > 0 && (
                  <div className="pt-2 mt-2 border-t border-[var(--t-border,#2a3147)] space-y-1.5">
                    <p className="text-xs font-medium text-slate-400">Nichos dos novos leads</p>
                    {resumo.nichos.map((item) => (
                      <div key={item.nicho} className="flex items-center justify-between gap-3 text-xs">
                        <span className="text-slate-300">{rotuloNicho(item.nicho)} · {item.leads} lead{item.leads === 1 ? '' : 's'}</span>
                        <span className={item.templateAtivo ? 'text-emerald-400' : 'text-amber-300'}>
                          {item.templateAtivo ? 'template pronto' : 'sem template de 1º contato'}
                        </span>
                      </div>
                    ))}
                    {resumo.nichos.some((item) => !item.templateAtivo) && (
                      <p className="text-xs leading-5 text-amber-300/80">
                        Esses leads podem ser importados, mas o primeiro e-mail fica bloqueado até existir um template para o nicho.
                      </p>
                    )}
                  </div>
                )}
                {resumo.semSegmento > 0 && (
                  <p className="pt-2 mt-2 border-t border-[var(--t-border,#2a3147)] text-xs leading-5 text-amber-300/80">
                    {resumo.semSegmento} lead{resumo.semSegmento === 1 ? '' : 's'} sem segmento na planilha.
                    {resumo.semSegmento === 1 ? ' Ele entra' : ' Eles entram'} na base normalmente, mas o motor
                    não escolhe a mensagem de primeiro contato sem segmento — classifique depois na ficha do lead
                    para {resumo.semSegmento === 1 ? 'ele entrar' : 'eles entrarem'} na esteira.
                  </p>
                )}
                {resumo.validadeInvalida > 0 && (
                  <p className="pt-2 mt-2 border-t border-[var(--t-border,#2a3147)] text-xs leading-5 text-amber-300/80">
                    {resumo.validadeInvalida} linha{resumo.validadeInvalida === 1 ? '' : 's'} com validade que não foi
                    reconhecida como data — use dd/mm/aaaa ou aaaa-mm-dd. {resumo.validadeInvalida === 1 ? 'Ela entra' : 'Elas entram'} na
                    base sem validade; preencha depois na ficha do lead.
                  </p>
                )}
              </div>
            )}

            {/* 3) Destino operacional */}
            {resumo && resumo.importaveis > 0 && (
              <div className="mt-4 rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
                <p className="text-sm font-medium text-slate-200">Cada lead vai para o responsável indicado na planilha</p>
                <p className="text-xs leading-5 text-slate-400 mt-1">
                  A importação não inicia campanha nem envia e-mails. Um gestor será avisado para preparar e ativar o follow-up.
                </p>
              </div>
            )}

            {erro && <p className="text-sm text-rose-400 mt-4">{erro}</p>}

            <div className="flex justify-end gap-2 mt-5">
              <button onClick={onClose} disabled={inserindo} className="text-sm px-4 py-2 rounded-lg text-slate-300 hover:bg-[var(--t-bg-base,#0f1117)]">Cancelar</button>
              <button
                onClick={confirmar}
                disabled={!file || !resumo || resumo.importaveis === 0 || inserindo}
                className="text-sm px-4 py-2 rounded-lg text-white font-medium flex items-center gap-2 disabled:opacity-50"
                style={{ backgroundColor: '#1e3a5f' }}
              >
                {inserindo && <Loader2 size={14} className="animate-spin" />} Importar {resumo && resumo.importaveis > 0 ? `${resumo.importaveis}` : ''}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
