// Regras client-safe da agenda de campanhas: os DIAS em que execuções podem
// avançar e a JANELA de envio (dias + horário de Brasília, `encaixarNaJanela`),
// aplicada ao agendar o disparo, ao agendar as esperas dos follow-ups e, como
// trava final, no momento do envio (lib/workflows/executor.ts).

export const DIAS_CAMPANHA = [
  { id: 'dom', label: 'Dom' },
  { id: 'seg', label: 'Seg' },
  { id: 'ter', label: 'Ter' },
  { id: 'qua', label: 'Qua' },
  { id: 'qui', label: 'Qui' },
  { id: 'sex', label: 'Sex' },
  { id: 'sab', label: 'Sáb' },
] as const

export type DiaCampanha = (typeof DIAS_CAMPANHA)[number]['id']

const DIAS_VALIDOS = new Set<string>(DIAS_CAMPANHA.map((dia) => dia.id))
const DIA_INTL: Record<string, DiaCampanha> = {
  Sun: 'dom',
  Mon: 'seg',
  Tue: 'ter',
  Wed: 'qua',
  Thu: 'qui',
  Fri: 'sex',
  Sat: 'sab',
}

export function normalizarDiasCampanha(valor: unknown): DiaCampanha[] {
  if (!Array.isArray(valor)) return []
  const recebidos = new Set(
    valor.filter((dia): dia is string => typeof dia === 'string' && DIAS_VALIDOS.has(dia)),
  )
  return DIAS_CAMPANHA.map((dia) => dia.id).filter((dia) => recebidos.has(dia))
}

export function validarDiasCampanha(valor: unknown): DiaCampanha[] {
  if (!Array.isArray(valor)) throw new Error('Informe os dias de execução da campanha.')
  const invalidos = valor.filter((dia) => typeof dia !== 'string' || !DIAS_VALIDOS.has(dia))
  if (invalidos.length) throw new Error('A agenda contém um dia inválido.')
  const dias = normalizarDiasCampanha(valor)
  if (!dias.length) throw new Error('Escolha ao menos um dia de execução.')
  return dias
}

export function diaCampanhaEmFuso(
  agoraISO: string,
  fuso = 'America/Sao_Paulo',
): DiaCampanha {
  const data = new Date(agoraISO)
  if (Number.isNaN(data.getTime())) throw new Error('Data inválida para avaliar a agenda da campanha.')
  const sigla = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: fuso }).format(data)
  const dia = DIA_INTL[sigla]
  if (!dia) throw new Error(`Não foi possível identificar o dia da semana no fuso ${fuso}.`)
  return dia
}

export function agendaPermiteProcessar(
  diasSemana: unknown,
  agoraISO: string,
  fuso = 'America/Sao_Paulo',
): boolean {
  // Compatibilidade aditiva: campanhas legadas, criadas antes de a agenda ser
  // persistida, mantêm o comportamento anterior (sem gate de dia). Uma agenda
  // explicitamente presente, porém vazia/inválida, não libera o processamento.
  if (diasSemana == null) return true
  const dias = normalizarDiasCampanha(diasSemana)
  if (!dias.length) return false
  return dias.includes(diaCampanhaEmFuso(agoraISO, fuso))
}

export function publicoComDiasAtualizados(
  publicoAtual: unknown,
  diasSemana: unknown,
): Record<string, unknown> {
  const dias = validarDiasCampanha(diasSemana)
  const publico = publicoAtual && typeof publicoAtual === 'object' && !Array.isArray(publicoAtual)
    ? publicoAtual as Record<string, unknown>
    : {}
  const agenda = publico.agenda && typeof publico.agenda === 'object' && !Array.isArray(publico.agenda)
    ? publico.agenda as Record<string, unknown>
    : {}
  return {
    ...publico,
    agenda: {
      ...agenda,
      diasSemana: dias,
    },
  }
}

// ---- Janela de envio (dias + horário) ---------------------------------------
// Horário de Brasília (UTC−3, sem horário de verão desde 2019). A janela é
// meio-aberta: [horarioInicio, horarioFim). Fora dela, o envio vai para a
// próxima abertura — nunca é descartado.

export interface JanelaCampanha {
  diasSemana?: unknown
  horarioInicio?: unknown
  horarioFim?: unknown
}

const OFFSET_BRASILIA_MS = 3 * 60 * 60 * 1000
const ORDEM_DIAS: DiaCampanha[] = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab']

function minutosDoHorario(valor: unknown): number | null {
  if (typeof valor !== 'string') return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(valor.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 24 || min > 59 || (h === 24 && min > 0)) return null
  return h * 60 + min
}

/** Primeiro instante >= `instante` dentro da janela da campanha. */
export function encaixarNaJanela(instante: Date, janela: JanelaCampanha | null | undefined): Date {
  if (!janela || Number.isNaN(instante.getTime())) return instante
  const dias = janela.diasSemana == null ? null : normalizarDiasCampanha(janela.diasSemana)
  // Agenda vazia/inválida é barrada por agendaPermiteProcessar; aqui não inventa horário.
  if (dias && !dias.length) return instante
  let inicio = minutosDoHorario(janela.horarioInicio)
  let fim = minutosDoHorario(janela.horarioFim)
  if (inicio === null || fim === null || fim <= inicio) { inicio = 0; fim = 24 * 60 }

  const local = new Date(instante.getTime() - OFFSET_BRASILIA_MS) // campos UTC = hora de Brasília
  const meiaNoite = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate())
  const minutoAgora = local.getUTCHours() * 60 + local.getUTCMinutes() + local.getUTCSeconds() / 60
  for (let d = 0; d < 8; d++) {
    const diaInicio = meiaNoite + d * 86_400_000
    const dia = ORDEM_DIAS[new Date(diaInicio).getUTCDay()]
    if (dias && !dias.includes(dia)) continue
    const abre = new Date(diaInicio + inicio * 60_000 + OFFSET_BRASILIA_MS)
    if (d > 0) return abre
    if (minutoAgora < inicio) return abre
    if (minutoAgora < fim) return instante
  }
  return instante
}

/** Janela a partir de campanhas.publico (agenda). null = sem agenda persistida. */
export function janelaDoPublico(publico: unknown): JanelaCampanha | null {
  if (!publico || typeof publico !== 'object' || Array.isArray(publico)) return null
  const agenda = (publico as Record<string, unknown>).agenda
  if (!agenda || typeof agenda !== 'object' || Array.isArray(agenda)) return null
  const a = agenda as Record<string, unknown>
  return { diasSemana: a.diasSemana, horarioInicio: a.horarioInicio, horarioFim: a.horarioFim }
}
