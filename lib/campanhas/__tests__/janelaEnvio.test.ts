// Janela de envio da campanha (dias + horário de Brasília): o disparo inicial,
// a espera dos follow-ups e a retomada após pausa só agendam envios dentro
// dela. Antes, só os DIAS eram respeitados e o horário era ignorado.
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('@vercel/queue', () => ({ send: vi.fn() }))

import { encaixarNaJanela, janelaDeEnvioDaCampanha, janelaDoPublico, type JanelaCampanha } from '../agenda'
import { montarAgendaDisparoCampanha, reagendarPrimeirosEnviosAoRetomar } from '../filaDisparoServidor'
import { textoPendentes } from '../situacaoDisparo'
import { BancoFalso } from '@/lib/templates/__tests__/bancoFalso'
import { MemoryWorkflowStore } from '@/lib/workflows/store/memoryStore'
import { criarWorkflow, publicar } from '@/lib/workflows/versionamento'
import { registrarBlocosPadrao } from '@/lib/workflows/blocos'
import { inscreverLeadManual, processarExecucao } from '@/lib/workflows/executor'
import type { AmbienteWorkflow } from '@/lib/workflows/ambiente'
import type { WorkflowStore } from '@/lib/workflows'

const UTIL: JanelaCampanha = { diasSemana: ['seg', 'ter', 'qua', 'qui', 'sex'], horarioInicio: '08:00', horarioFim: '17:00' }
const iso = (d: Date) => d.toISOString()
// 2026-10-06 é terça. Brasília = UTC−3.
const brt = (dia: string, hora: string) => new Date(`${dia}T${hora}:00-03:00`)

describe('encaixarNaJanela', () => {
  it('dentro da janela não muda; 08:00 abre e 17:00 já fecha (meio-aberta)', () => {
    expect(iso(encaixarNaJanela(brt('2026-10-06', '16:59'), UTIL))).toBe(iso(brt('2026-10-06', '16:59')))
    expect(iso(encaixarNaJanela(brt('2026-10-06', '08:00'), UTIL))).toBe(iso(brt('2026-10-06', '08:00')))
    expect(iso(encaixarNaJanela(brt('2026-10-06', '17:00'), UTIL))).toBe(iso(brt('2026-10-07', '08:00')))
  })

  it('antes de abrir vai para a abertura do mesmo dia', () => {
    expect(iso(encaixarNaJanela(brt('2026-10-06', '07:30'), UTIL))).toBe(iso(brt('2026-10-06', '08:00')))
  })

  it('23:30 em Brasília (já é o dia seguinte em UTC) vai para 08:00 do dia seguinte de Brasília', () => {
    expect(iso(encaixarNaJanela(brt('2026-10-06', '23:30'), UTIL))).toBe(iso(brt('2026-10-07', '08:00')))
  })

  it('sexta à noite e fim de semana pulam para segunda 08:00', () => {
    expect(iso(encaixarNaJanela(brt('2026-10-09', '18:00'), UTIL))).toBe(iso(brt('2026-10-12', '08:00')))
    expect(iso(encaixarNaJanela(brt('2026-10-10', '10:00'), UTIL))).toBe(iso(brt('2026-10-12', '08:00')))
  })

  it('sem janela ou sem horário válido: só os dias valem; sem agenda não muda nada', () => {
    const t = brt('2026-10-06', '22:00')
    expect(iso(encaixarNaJanela(t, null))).toBe(iso(t))
    expect(iso(encaixarNaJanela(t, { diasSemana: ['ter'] }))).toBe(iso(t))
    expect(iso(encaixarNaJanela(brt('2026-10-10', '10:00'), { diasSemana: ['seg'], horarioInicio: 'x', horarioFim: '17:00' })))
      .toBe(iso(brt('2026-10-12', '00:00')))
  })

  it('lê a janela de campanhas.publico', () => {
    expect(janelaDoPublico({ agenda: { diasSemana: ['seg'], horarioInicio: '09:00', horarioFim: '18:00' } }))
      .toEqual({ diasSemana: ['seg'], horarioInicio: '09:00', horarioFim: '18:00' })
    expect(janelaDoPublico(null)).toBeNull()
  })

  it('disparo único agenda a fila sem janela, mesmo com a agenda padrão gravada no público', () => {
    const agenda = { diasSemana: ['seg', 'ter', 'qua', 'qui', 'sex'], horarioInicio: '09:00', horarioFim: '18:00' }
    expect(janelaDeEnvioDaCampanha({ tipo: 'novidade_clientes', publico: { agenda } })).toBeNull()
    expect(janelaDeEnvioDaCampanha({ tipo: 'comunicado', publico: { agenda, operacao: { modoEnvio: 'disparo_unico' } } })).toBeNull()
    expect(janelaDeEnvioDaCampanha({ tipo: 'prospeccao', publico: { agenda, operacao: { modoEnvio: 'cadencia' } } })).toEqual(agenda)
    expect(janelaDeEnvioDaCampanha(null)).toBeNull()
  })
})

describe('disparo inicial dentro da janela', () => {
  it('mantém 2 min entre envios e continua na próxima abertura o que não cabe hoje', () => {
    const agenda = montarAgendaDisparoCampanha('org', 'camp', ['a', 'b', 'c', 'd', 'e'], brt('2026-10-06', '16:55'), UTIL)
    expect(agenda.map((i) => i.agendadoPara)).toEqual([
      iso(brt('2026-10-06', '16:55')),
      iso(brt('2026-10-06', '16:57')),
      iso(brt('2026-10-06', '16:59')),
      iso(brt('2026-10-07', '08:00')),
      iso(brt('2026-10-07', '08:02')),
    ])
    expect(agenda[3].idempotencyKey).toBe('campanha:camp:execucao:d')
  })

  it('sem janela, o espaçamento antigo continua igual', () => {
    const agora = brt('2026-10-06', '22:00')
    const agenda = montarAgendaDisparoCampanha('org', 'camp', ['a', 'b'], agora)
    expect(agenda.map((i) => i.delaySeconds)).toEqual([0, 120])
  })
})

describe('retomar campanha pausada', () => {
  it('reagenda só quem não recebeu o 1º e-mail, na ordem, dentro da janela e com chave nova na fila', async () => {
    const ORG = 'org-a'
    const banco = new BancoFalso({
      workflow_execucoes: [
        // Venceram durante a pausa (nunca enviadas).
        { id: 'e1', organizacao_id: ORG, campanha_id: 'c1', status: 'aguardando', passo_atual: 0, agendamento_geracao: 0, proxima_verificacao_em: '2026-10-06T22:00:00Z' },
        { id: 'e2', organizacao_id: ORG, campanha_id: 'c1', status: 'aguardando', passo_atual: 0, agendamento_geracao: 0, proxima_verificacao_em: '2026-10-06T22:03:00Z' },
        // Já recebeu e espera o follow-up: não mexe.
        { id: 'e3', organizacao_id: ORG, campanha_id: 'c1', status: 'aguardando', passo_atual: 2, agendamento_geracao: 1, proxima_verificacao_em: '2026-10-09T20:00:00Z' },
        // Cancelada, outra campanha e outra organização: não mexe.
        { id: 'e4', organizacao_id: ORG, campanha_id: 'c1', status: 'cancelado', passo_atual: 0, agendamento_geracao: 0, proxima_verificacao_em: '2026-10-06T22:05:00Z' },
        { id: 'e5', organizacao_id: ORG, campanha_id: 'c2', status: 'aguardando', passo_atual: 0, agendamento_geracao: 0, proxima_verificacao_em: '2026-10-06T22:05:00Z' },
        { id: 'e6', organizacao_id: 'org-b', campanha_id: 'c1', status: 'aguardando', passo_atual: 0, agendamento_geracao: 0, proxima_verificacao_em: '2026-10-06T22:05:00Z' },
      ],
    })
    const admin = banco.cliente() as unknown as SupabaseClient
    const linha = (id: string) => banco.linhas('workflow_execucoes').find((l) => l.id === id)!
    const store = {
      organizacaoId: ORG,
      async buscarExecucao(id: string) { const l = linha(id); return l?.organizacao_id === ORG ? l : null },
      async atualizarExecucao(id: string, patch: Record<string, unknown>) { Object.assign(linha(id), patch) },
      async registrarEvento() {},
    } as unknown as WorkflowStore
    const enviados: { execucaoId: string; chave: string }[] = []
    const enfileirar = vi.fn(async (_t: string, m: { execucaoId: string }, o: { idempotencyKey: string }) => {
      enviados.push({ execucaoId: m.execucaoId, chave: o.idempotencyKey })
    })

    const agora = brt('2026-10-06', '20:00') // retomada à noite
    const r = await reagendarPrimeirosEnviosAoRetomar(store, admin, ORG, 'c1', UTIL, { agora, enfileirar })

    expect(r.agendadas).toBe(2)
    expect(enviados.map((e) => e.execucaoId)).toEqual(['e1', 'e2'])
    expect(enviados[0].chave).toBe(`campanha:c1:execucao:e1:retomada:${agora.getTime()}`)
    expect(linha('e1').proxima_verificacao_em).toBe(iso(brt('2026-10-07', '08:00')))
    expect(linha('e2').proxima_verificacao_em).toBe(iso(brt('2026-10-07', '08:02')))
    expect(linha('e3').proxima_verificacao_em).toBe('2026-10-09T20:00:00Z')
    expect(linha('e5').proxima_verificacao_em).toBe('2026-10-06T22:05:00Z')
    expect(linha('e6').proxima_verificacao_em).toBe('2026-10-06T22:05:00Z')
  })
})

describe('espera do follow-up termina dentro da janela', () => {
  it('a próxima verificação gravada cai em dia útil, entre 08:00 e 17:00 de Brasília', async () => {
    const store = new MemoryWorkflowStore()
    const wf = await criarWorkflow(store, {
      nome: 'W',
      definicao: {
        gatilho: { tipo: 'manual', config: {} },
        condicoes: [],
        acoes: [
          { tipo: 'enviar_email', config: { template: 'primeiro' } },
          { tipo: 'esperar', config: { dias: 3 } },
          { tipo: 'enviar_email', config: { template: 'follow' } },
        ],
      },
    })
    await publicar(store, wf.id)
    const amb = {
      organizacaoId: 'org-test',
      simular: false,
      async buscarControleExecucaoCampanha() {
        return { status: 'ativa', diasSemana: UTIL.diasSemana, horarioInicio: '08:00', horarioFim: '17:00', disparoUnico: false, tipo: 'comunicado_cadencia' }
      },
      async enviarEmailTemplate() { return { enviado: true, assunto: 'a' } },
      async sincronizarConclusaoCampanha() {},
    } as unknown as AmbienteWorkflow
    const inscricao = await inscreverLeadManual(store, wf.id, 'lead-1', 'campanha-1')
    await processarExecucao(store, registrarBlocosPadrao(), amb, inscricao.execucaoId!, new Date().toISOString())

    const ex = await store.buscarExecucao(inscricao.execucaoId!)
    expect(ex?.status).toBe('aguardando')
    const prox = new Date(ex!.proxima_verificacao_em!)
    expect(iso(encaixarNaJanela(prox, UTIL))).toBe(iso(prox)) // já está dentro
    const local = new Date(prox.getTime() - 3 * 3_600_000)
    expect([1, 2, 3, 4, 5]).toContain(local.getUTCDay())
    const minuto = local.getUTCHours() * 60 + local.getUTCMinutes()
    expect(minuto).toBeGreaterThanOrEqual(8 * 60)
    expect(minuto).toBeLessThan(17 * 60)
  })
})

describe('rótulo de pendentes', () => {
  it('separa quem ainda não recebeu o 1º e-mail de quem aguarda follow-up', () => {
    const base = { total: 216, emAndamento: 0, canceladas: 10, erros: 0, respostas: 0 }
    expect(textoPendentes({ ...base, aguardando: 206, aguardandoPrimeiroEnvio: 117 }))
      .toBe('117 aguardando 1º envio · 89 aguardando follow-up')
    expect(textoPendentes({ ...base, aguardando: 89, aguardandoPrimeiroEnvio: 0 })).toBe('89 aguardando follow-up')
    expect(textoPendentes({ ...base, aguardando: 0, aguardandoPrimeiroEnvio: 0 })).toBeNull()
    // Resposta antiga sem o campo novo: mantém o texto anterior.
    expect(textoPendentes({ ...base, aguardando: 5 })).toBe('5 pendentes')
  })
})

describe('trava no momento do envio (agendamentos antigos fora da janela)', () => {
  it('prospecção: follow-up que vence às 18h não sai; é adiado para 08:00–10:00 do dia útil seguinte', async () => {
    const { retomarProspeccao } = await import('@/lib/workflows/retomadaProspeccao')
    vi.useFakeTimers()
    try {
      const inicio = brt('2026-10-06', '10:00')
      vi.setSystemTime(inicio)
      const store = new MemoryWorkflowStore('org-a')
      const emails: string[] = []
      const jobs: Array<{ mensagem: { organizacaoId: string; execucaoId: string; geracao: number } }> = []
      const controle: Record<string, unknown> = { status: 'ativa', tipo: 'prospeccao', diasSemana: null, disparoUnico: false }
      const ambiente = {
        organizacaoId: 'org-a', simular: false,
        async buscarControleExecucaoCampanha() { return controle },
        async enviarEmailTemplate(_l: string, t: string) { emails.push(t); return { enviado: true, assunto: t } },
        async leadRespondeu() { return false },
        async sincronizarConclusaoCampanha() {},
      } as unknown as AmbienteWorkflow
      const enfileirar = vi.fn(async (_t: string, mensagem: { organizacaoId: string; execucaoId: string; geracao: number }) => {
        jobs.push({ mensagem })
      }) as unknown as typeof import('@vercel/queue').send
      const def = {
        gatilho: { tipo: 'manual', config: {} }, condicoes: [],
        acoes: [
          { id: 'e0', tipo: 'enviar_email', config: { template: 'inicial' } },
          { id: 'w1', tipo: 'esperar', config: { horas: 8 } },
          { id: 'e1', tipo: 'enviar_email', config: { template: 'fup1' } },
        ],
      }
      const wf = await store.criarWorkflow({ nome: 'T', rascunho_definicao: def })
      const versao = await store.criarVersao({ workflow_id: wf.id, numero: 1, definicao: def })
      await store.atualizarWorkflow(wf.id, { status: 'publicado', versao_atual_id: versao.id })
      const ex = await store.criarExecucao({ workflow_id: wf.id, versao_id: versao.id, lead_id: 'lead', campanha_id: 'campanha' })

      // Agendado como no código antigo (sem horário): espera vence às 18:00.
      await processarExecucao(store, registrarBlocosPadrao(), ambiente, ex.id, inicio.toISOString(), { enfileirarRetomada: enfileirar })
      expect(emails).toEqual(['inicial'])
      expect((await store.buscarExecucao(ex.id))!.proxima_verificacao_em).toBe(iso(brt('2026-10-06', '18:00')))

      // A campanha passa a ter horário; o job vence às 18:00.
      Object.assign(controle, { diasSemana: UTIL.diasSemana, horarioInicio: '08:00', horarioFim: '17:00' })
      vi.setSystemTime(brt('2026-10-06', '18:00'))
      await retomarProspeccao(store, registrarBlocosPadrao(), ambiente, jobs[0].mensagem, { enfileirar })

      expect(emails).toEqual(['inicial']) // fup1 NÃO saiu às 18h
      const adiada = (await store.buscarExecucao(ex.id))!
      expect(adiada).toMatchObject({ status: 'aguardando', passo_atual: 2, agendamento_geracao: 2 })
      const prox = new Date(adiada.proxima_verificacao_em!).getTime()
      expect(prox).toBeGreaterThanOrEqual(brt('2026-10-07', '08:00').getTime())
      expect(prox).toBeLessThan(brt('2026-10-07', '10:00').getTime())
      expect(jobs.at(-1)!.mensagem.geracao).toBe(2) // republicado na fila

      // Na nova hora, dentro da janela, sai normalmente.
      vi.setSystemTime(new Date(prox))
      await retomarProspeccao(store, registrarBlocosPadrao(), ambiente, jobs.at(-1)!.mensagem, { enfileirar })
      expect(emails).toEqual(['inicial', 'fup1'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('demais campanhas: execução vencida fora da janela não envia e ganha nova hora na abertura', async () => {
    const store = new MemoryWorkflowStore()
    const wf = await criarWorkflow(store, {
      nome: 'W',
      definicao: { gatilho: { tipo: 'manual', config: {} }, condicoes: [], acoes: [{ tipo: 'enviar_email', config: { template: 'c' } }] },
    })
    await publicar(store, wf.id)
    const emails: string[] = []
    const amb = {
      organizacaoId: 'org-test', simular: false,
      async buscarControleExecucaoCampanha() {
        return { status: 'ativa', diasSemana: UTIL.diasSemana, horarioInicio: '08:00', horarioFim: '17:00', disparoUnico: false, tipo: 'comunicado_cadencia' }
      },
      async enviarEmailTemplate(_l: string, t: string) { emails.push(t); return { enviado: true, assunto: t } },
      async sincronizarConclusaoCampanha() {},
    } as unknown as AmbienteWorkflow
    const inscricao = await inscreverLeadManual(store, wf.id, 'lead-1', 'campanha-1')
    await processarExecucao(store, registrarBlocosPadrao(), amb, inscricao.execucaoId!, iso(brt('2026-10-06', '19:00')))
    expect(emails).toEqual([])
    const ex = (await store.buscarExecucao(inscricao.execucaoId!))!
    expect(ex.status).toBe('aguardando')
    const prox = new Date(ex.proxima_verificacao_em!).getTime()
    expect(prox).toBeGreaterThanOrEqual(brt('2026-10-07', '08:00').getTime())
    expect(prox).toBeLessThan(brt('2026-10-07', '10:00').getTime())
  })
})
