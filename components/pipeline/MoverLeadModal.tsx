'use client'

// Modal do Kanban ao soltar um lead em outra coluna: "Apenas mover" ou "Mover e
// enviar" a mensagem da etapa de destino (Plano de Execução 24/09, item 5).
// Reunião Agendada pede data e hora nos dois casos. A prévia vem do servidor
// (mesmo preparo e mesmas travas do envio, sem efeito) e o botão só libera
// quando o servidor aceitaria. Regras em lib/pipeline/mensagemEtapa.ts.
import { useEffect, useRef, useState } from 'react'
import { AlertCircle, ArrowRight, ArrowRightLeft, CalendarClock, Check, FlaskConical, Info, Loader2, Mail, MessageCircle, Send, X } from 'lucide-react'
import { moverLeadKanban, previaMoverLead, type RespostaPreviaMover } from '@/lib/api'
import { exigeReuniao, validarReuniao } from '@/lib/pipeline/mensagemEtapa'
import { labelEstagio } from '@/lib/pipeline-stages'
import s from '@/components/templates/TemplateEditor.module.css'

type Modo = 'mover' | 'enviar'
type Canal = 'email' | 'whatsapp'

export interface MovimentoPendente {
  leadId: string
  empresa: string
  de: string // estágio atual
  para: string // estágio de destino
}

// Data/hora local "agora" nos formatos dos inputs, para o mínimo do campo.
function hojeLocal(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export default function MoverLeadModal({
  movimento,
  onFechar,
  onConcluido,
}: {
  movimento: MovimentoPendente
  onFechar: () => void
  // Chamado quando o lead mudou de etapa; `aviso` quando há algo a dizer.
  onConcluido: (aviso: string | null) => void
}) {
  const pedeReuniao = exigeReuniao(movimento.para)
  const destino = labelEstagio(movimento.para)
  const [modo, setModo] = useState<Modo>('mover')
  const [canal, setCanal] = useState<Canal>('email')
  const [data, setData] = useState('')
  const [hora, setHora] = useState('')
  const [previa, setPrevia] = useState<RespostaPreviaMover | null>(null)
  const [carregandoPrevia, setCarregandoPrevia] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [simulado, setSimulado] = useState<string | null>(null)
  const pedido = useRef(0)
  const primeiroCampo = useRef<HTMLButtonElement>(null)

  const reuniaoValida = !pedeReuniao || validarReuniao({ data, hora }).ok
  const reuniaoNoPassado = pedeReuniao && reuniaoValida && new Date(`${data}T${hora}`).getTime() < Date.now()
  const pendenciaReuniao = !pedeReuniao
    ? null
    : !data || !hora
      ? 'Informe a data e a hora da reunião.'
      : !reuniaoValida
        ? 'Data ou hora da reunião inválida.'
        : reuniaoNoPassado
          ? 'Esse horário já passou.'
          : null

  const corpoBase = {
    de: movimento.de,
    para: movimento.para,
    ...(pedeReuniao ? { reuniao: { data, hora } } : {}),
  }

  useEffect(() => { primeiroCampo.current?.focus() }, [])

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => { if (e.key === 'Escape' && !enviando) onFechar() }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [enviando, onFechar])

  // Prévia: só no "Mover e enviar", com a reunião já preenchida. Resposta
  // antiga nunca sobrescreve a mais nova (contador de pedidos).
  useEffect(() => {
    setSimulado(null)
    if (modo !== 'enviar' || pendenciaReuniao) {
      setPrevia(null)
      setCarregandoPrevia(false)
      return
    }
    const meu = ++pedido.current
    setCarregandoPrevia(true)
    const t = setTimeout(async () => {
      const r = await previaMoverLead(movimento.leadId, { ...corpoBase, canal })
      if (meu !== pedido.current) return
      setPrevia(r)
      setCarregandoPrevia(false)
    }, 250)
    return () => clearTimeout(t)
    // corpoBase deriva de movimento/data/hora, já listados.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modo, canal, data, hora, pendenciaReuniao, movimento.leadId, movimento.de, movimento.para])

  const bloqueio = pendenciaReuniao
    ?? (modo === 'enviar'
      ? carregandoPrevia || !previa
        ? 'Montando a mensagem…'
        : !previa.ok
          ? previa.erro
          : null
      : null)

  async function confirmar() {
    if (bloqueio || enviando) return
    setEnviando(true)
    setErro(null)
    setSimulado(null)
    const r = await moverLeadKanban(movimento.leadId, { ...corpoBase, canal: modo === 'enviar' ? canal : null })
    setEnviando(false)
    if (!r.ok) {
      setErro(r.erro)
      return
    }
    if (r.simulado) {
      setSimulado(`Modo ensaio: a mensagem para ${r.destino} foi só simulada — nada foi enviado nem movido. Use "Apenas mover" para trocar a etapa.`)
      return
    }
    onConcluido(
      r.registrada
        ? r.enviado ? `Movido para ${destino} e mensagem enviada por ${r.enviado.canal === 'email' ? 'e-mail' : 'WhatsApp'}.` : null
        : 'O lead foi movido e a mensagem saiu, mas o histórico não foi registrado. Não reenvie.',
    )
  }

  const envio = previa?.ok ? previa.envio : null

  return (
    <div className={s.fundo} onMouseDown={(e) => { if (e.target === e.currentTarget && !enviando) onFechar() }}>
      <div
        className={s.modal}
        style={{ width: modo === 'enviar' ? 'min(980px, 100%)' : 'min(560px, 100%)' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mover-lead-titulo"
      >
        <header className={s.topo}>
          <div className={s.topoTitulo}>
            <span className={s.topoIcone}><ArrowRightLeft size={18} /></span>
            <div className="min-w-0">
              <h3 id="mover-lead-titulo" className="truncate">Mover {movimento.empresa}</h3>
              <p className="flex items-center gap-1.5">
                {labelEstagio(movimento.de)} <ArrowRight size={12} aria-hidden="true" /> <b className="text-slate-200">{destino}</b>
              </p>
            </div>
          </div>
          <button type="button" className={`${s.fechar} focus-ring`} onClick={onFechar} disabled={enviando} aria-label="Fechar">
            <X size={16} />
          </button>
        </header>

        <div className={s.corpo} style={modo === 'enviar' ? undefined : { gridTemplateColumns: '1fr' }}>
          <div className={s.formulario}>
            <section className={s.secao}>
              <div className={s.secaoTitulo}>O que fazer</div>
              <div className="grid gap-2" role="radiogroup" aria-label="O que fazer">
                {([
                  { id: 'mover', titulo: 'Apenas mover', texto: 'Troca a etapa e registra no histórico. Nada é enviado ao cliente.', icone: ArrowRightLeft },
                  { id: 'enviar', titulo: 'Mover e enviar', texto: `Envia a mensagem da etapa ${destino} e registra no histórico.`, icone: Send },
                ] as const).map((o, i) => {
                  const ativo = modo === o.id
                  const Icone = o.icone
                  return (
                    <button
                      key={o.id}
                      ref={i === 0 ? primeiroCampo : undefined}
                      type="button"
                      role="radio"
                      aria-checked={ativo}
                      onClick={() => setModo(o.id)}
                      className={`flex items-start gap-3 rounded-[11px] border px-3 py-2.5 text-left transition-colors focus-ring ${
                        ativo ? 'border-[#6979ff] bg-indigo-500/15' : 'border-[var(--m-border,#155987)] bg-[rgba(3,24,45,0.6)] hover:border-[var(--m-border-strong,#2286cf)]'
                      }`}
                    >
                      <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-[9px] ${ativo ? 'bg-indigo-500/30 text-indigo-100' : 'bg-slate-500/10 text-slate-400'}`}>
                        <Icone size={15} aria-hidden="true" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-slate-100">{o.titulo}</span>
                        <span className="block text-xs text-slate-400">{o.texto}</span>
                      </span>
                      {ativo && <Check size={15} className="ml-auto mt-1 shrink-0 text-indigo-300" aria-hidden="true" />}
                    </button>
                  )
                })}
              </div>
            </section>

            {pedeReuniao && (
              <section className={s.secao}>
                <div className={s.secaoTitulo}><CalendarClock size={13} /> Reunião</div>
                <div className="grid grid-cols-2 gap-3">
                  <label className={s.rotulo}>
                    <span>Data</span>
                    <input type="date" className={s.campo} value={data} min={hojeLocal()} onChange={(e) => setData(e.target.value)} />
                  </label>
                  <label className={s.rotulo}>
                    <span>Hora</span>
                    <input type="time" className={s.campo} value={hora} onChange={(e) => setHora(e.target.value)} />
                  </label>
                </div>
                <p className={s.dica}>Fica no histórico do lead e preenche {'{{data_reuniao}}'} e {'{{hora_reuniao}}'} na mensagem.</p>
              </section>
            )}

            {modo === 'enviar' && (
              <section className={s.secao}>
                <div className={s.secaoTitulo}>Canal</div>
                <div className={s.segmentado} role="group" aria-label="Canal">
                  {([['email', 'E-mail', Mail], ['whatsapp', 'WhatsApp', MessageCircle]] as const).map(([id, rotulo, Icone]) => (
                    <button key={id} type="button" aria-pressed={canal === id} className={canal === id ? s.ativo : undefined} onClick={() => setCanal(id)}>
                      <Icone size={14} /> {rotulo}
                    </button>
                  ))}
                </div>
                <p className={s.dica}>
                  A mensagem é o template ativo de {canal === 'email' ? 'e-mail' : 'WhatsApp'} com a chave <code>{movimento.para}</code> (Comercial &gt; Templates).
                  {canal === 'email' && ' Sai pela conta de prospecção.'}
                </p>
              </section>
            )}
          </div>

          {modo === 'enviar' && (
            <aside className={s.lateral} aria-live="polite">
              <div className={s.previaTitulo}>
                <strong>{canal === 'email' ? <Mail size={14} /> : <MessageCircle size={14} />} Prévia da mensagem</strong>
                {envio && <small className="truncate">{envio.templateNome}</small>}
              </div>

              {pendenciaReuniao ? (
                <p className={`${s.notaPrevia} flex items-center gap-2`}><Info size={13} /> Preencha a data e a hora para ver a mensagem.</p>
              ) : carregandoPrevia || !previa ? (
                <p className={`${s.notaPrevia} flex items-center gap-2`}><Loader2 size={13} className="animate-spin" /> Montando a mensagem…</p>
              ) : !previa.ok ? (
                <p className={`${s.erro} items-start`}><AlertCircle size={14} className="mt-0.5 shrink-0" /> {previa.erro}</p>
              ) : envio && envio.canal === 'email' ? (
                <div className={s.email}>
                  <div className={s.emailCabecalho}>
                    Para: <b>{envio.destino}</b>
                    <div className={s.emailAssunto}>{envio.assunto}</div>
                  </div>
                  <iframe
                    title="Prévia do e-mail"
                    sandbox=""
                    srcDoc={envio.html ?? ''}
                    className="block h-[320px] w-full border-0 bg-white"
                  />
                </div>
              ) : envio ? (
                <>
                  <p className="mb-2 text-xs text-slate-400">Para: <b className="text-slate-200">+{envio.destino}</b></p>
                  <div className={s.whats}>
                    <div className={s.balao}>{envio.texto}<small>agora</small></div>
                  </div>
                </>
              ) : null}

              {previa?.ok && previa.modoEnsaio && (
                <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  <FlaskConical size={14} className="mt-0.5 shrink-0" />
                  Modo ensaio ligado para {canal === 'email' ? 'e-mail' : 'WhatsApp'}: ao confirmar, nada é enviado nem movido.
                </p>
              )}
            </aside>
          )}
        </div>

        <footer className={s.rodape}>
          {erro ? (
            <span className={s.erro}><AlertCircle size={14} /> {erro}</span>
          ) : simulado ? (
            <span className="flex items-center gap-2 text-xs text-amber-200"><FlaskConical size={14} /> {simulado}</span>
          ) : pendenciaReuniao ? (
            <span className={s.pendencia}><AlertCircle size={14} /> {pendenciaReuniao}</span>
          ) : null}
          <div className={s.rodapeAcoes}>
            <button type="button" className={`${s.botao} focus-ring`} onClick={onFechar} disabled={enviando}>Cancelar</button>
            <button
              type="button"
              className={`${s.botao} ${s.botaoPrimario} focus-ring`}
              onClick={confirmar}
              disabled={!!bloqueio || enviando}
            >
              {enviando ? <Loader2 size={15} className="animate-spin" /> : modo === 'enviar' ? <Send size={15} /> : <ArrowRightLeft size={15} />}
              {enviando ? (modo === 'enviar' ? 'Enviando…' : 'Movendo…') : modo === 'enviar' ? 'Mover e enviar' : 'Mover'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
