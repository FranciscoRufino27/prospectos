// Prova o efeito de PROSPECÇÃO em AmbienteSupabase.enviarEmailTemplate (itens
// 2, 3 e 5 da entrega "Prospecção + Follow-up") e, com o mesmo mecanismo,
// prova a REGRESSÃO OBRIGATÓRIA de Renovação/Laudos: para campanhaTipo
// diferente de 'prospeccao', nada do que foi adicionado nesta entrega roda —
// nem o gate de opt-out/bounce/perdido, nem a mudança de estágio, nem o tipo
// de interação (continua 'nota').
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BancoFalso, type Linha } from '@/lib/templates/__tests__/bancoFalso'
import { AmbienteSupabase, ErroEnvioIncerto } from '../ambiente'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Motor } from '@/lib/engine'
import type { TemplateEmail } from '@/lib/engine/store/store'

// Remetente DEDICADO (nomenclaturas.email_conta_key) é exigido pela trava de
// prospecção (lib/workflows/ambiente.ts) sempre que campanhaId + tipo=
// 'prospeccao'. Os testes de envio bem-sucedido de prospecção passam essa
// chave na org; para não abrir uma conexão SMTP real, GmailProvider é
// mockado aqui (só quando a chave usada é esta — os demais testes deste
// arquivo continuam usando o motor falso via `this.motor.email`).
const { CONTA_TESTE, enviosGmailMock, smtpEstado } = vi.hoisted(() => ({
  CONTA_TESTE: 'PROSPECCAOENVIO_TESTE',
  enviosGmailMock: [] as { para: string; assunto: string; corpo: string; html?: string; cc?: string[] }[],
  smtpEstado: { falharAposTentativa: false },
}))
vi.mock('@/lib/engine/email/gmailProvider', () => ({
  lerCredenciaisGmail: (papel?: string) =>
    (papel === CONTA_TESTE ? { user: 'prospeccao@org-a.test', appPassword: 'segredo-teste' } : null),
  GmailProvider: class {
    async enviar(para: string, assunto: string, corpo: string, html?: string, cc?: string[]) {
      enviosGmailMock.push({ para, assunto, corpo, html, cc })
      if (smtpEstado.falharAposTentativa) throw new Error('conexão caiu após DATA')
    }
  },
}))
beforeEach(() => { enviosGmailMock.length = 0; smtpEstado.falharAposTentativa = false })

const ORG = 'aaaaaaaa-0000-4000-8000-000000000001'
const LEAD = 'aaaaaaaa-5555-4555-8555-000000000001'
const CAMPANHA = 'aaaaaaaa-4444-4444-8444-000000000001'

// Estrutural, não `Pick<Lead, ...>`: o tipo `Lead` não declara `optout` (gap
// pré-existente, ver lib/campanhas/prospeccaoEnvio.ts) e este fixture de teste
// precisa dele para exercitar o gate de bloqueio.
interface LeadFalso {
  id: string
  empresa: string | null
  contato_nome: string | null
  contato_email: string
  segmento: string | null
  cidade: string | null
  responsavel_id: string | null
  responsavel_nome: string | null
  data_validade: string | null
  estagio: string
  followups_enviados: number
  optout: boolean
  bounced: boolean
  perdido: boolean
}

function leadBase(overrides: Partial<LeadFalso> = {}): LeadFalso {
  return {
    id: LEAD,
    empresa: 'Empresa Exemplo',
    contato_nome: 'Maria Souza',
    contato_email: 'maria@exemplo.com.br',
    segmento: null,
    cidade: null,
    responsavel_id: null,
    responsavel_nome: 'Aline',
    data_validade: null,
    estagio: 'novos_leads',
    followups_enviados: 0,
    optout: false,
    bounced: false,
    perdido: false,
    ...overrides,
  }
}

function motorFalso(lead: LeadFalso, templates: TemplateEmail[]) {
  const enviados: { para: string; assunto: string }[] = []
  const interacoes: Record<string, unknown>[] = []
  const atualizacoesLead: { id: string; patch: Record<string, unknown> }[] = []
  const email = { async enviar(para: string, assunto: string) { enviados.push({ para, assunto }) } }
  const motor = {
    email,
    emailProspeccao: email,
    store: {
      organizacaoId: ORG,
      async buscarLead() { return lead },
      async buscarTemplateEmail(nicho: string | null) { return nicho === null ? templates : [] },
      async buscarUsuario() { return null },
      // Envio de campanha exige CC com e-mail (lib/campanhas/emailComCopiaServidor.ts
      // lança sem isto) — mesmo fixture usado em envioFailClosed.test.ts.
      async buscarContextoCampanhaAtiva() {
        return { nome: 'Campanha A', tipo: 'prospeccao', responsavel: { id: 'u1', nome: 'Aline', email: 'aline@org.com.br' } }
      },
      async registrarInteracao(interacao: Record<string, unknown>) { interacoes.push(interacao) },
      async reivindicarMensagem() { return true },
      async liberarMensagem() { /* nada */ },
      async atualizarLead(id: string, patch: Record<string, unknown>) { atualizacoesLead.push({ id, patch }) },
    },
  } as unknown as Motor
  return { motor, enviados, interacoes, atualizacoesLead }
}

const template = (dados: Partial<TemplateEmail> = {}): TemplateEmail => ({
  id: 'tpl-1',
  assunto: 'Contato — {{empresa}}',
  corpo: 'Olá {{nome}}',
  html: null,
  organizacao_id: ORG,
  ...dados,
})

function banco(campanha: Linha, orgConfiguracoes: Record<string, unknown> = {}) {
  return new BancoFalso({
    organizacoes: [{ id: ORG, nome: 'Org A', configuracoes: orgConfiguracoes }],
    campanhas: [{ id: CAMPANHA, organizacao_id: ORG, dry_run: false, publico: {}, ...campanha }],
  })
}

// Org COM remetente dedicado — só para os testes de envio real de prospecção
// (ver comentário do mock de GmailProvider acima).
const configComRemetente = { nomenclaturas: { email_conta_key: CONTA_TESTE } }

interface EstadoReserva { resultado: string; processado_em: string }

// Fake de mensagens_processadas que APLICA os filtros do UPDATE — é neles que
// mora o CAS da reserva (lease vencido, estado esperado). Um mock que só
// registrasse .eq() não provaria nada sobre retomada nem sobre corrida.
function clienteComReserva(opcoes: { falharReserva?: boolean } = {}) {
  const base = banco({ tipo: 'prospeccao', status: 'ativa' }, configComRemetente)
  base.linhas('workflow_execucoes').push({ id: 'exec-1', organizacao_id: ORG, campanha_id: CAMPANHA, status: 'aguardando' })
  const reservas = new Map<string, EstadoReserva>()
  // Ligado no teste para simular processo que morre ANTES de abrir o SMTP.
  const falhas = { emCurso: false }
  const original = base.cliente()
  const client = {
    from(tabela: string) {
      if (tabela !== 'mensagens_processadas') return original.from(tabela)
      return {
        upsert(payload: { mensagem_id: string; resultado: string; processado_em: string }) {
          return { async select() {
            if (opcoes.falharReserva) return { data: null, error: { message: 'banco indisponível' } }
            if (reservas.has(payload.mensagem_id)) return { data: [], error: null }
            reservas.set(payload.mensagem_id, { resultado: payload.resultado, processado_em: payload.processado_em })
            return { data: [{ id: 'reserva-1' }], error: null }
          } }
        },
        update(patch: { resultado: string; processado_em?: string }) {
          const iguais: Record<string, string> = {}
          let menorQue: { coluna: string; valor: string } | null = null
          const aplicar = (): { erro: string | null; linhas: { id: string }[] } => {
            if (falhas.emCurso && patch.resultado === 'envio_em_curso') return { erro: 'banco indisponível', linhas: [] }
            const atual = iguais.mensagem_id ? reservas.get(iguais.mensagem_id) : undefined
            if (iguais.organizacao_id !== ORG || !iguais.mensagem_id || !atual) return { erro: null, linhas: [] }
            if (iguais.resultado && atual.resultado !== iguais.resultado) return { erro: null, linhas: [] }
            if (menorQue && !(atual.processado_em < menorQue.valor)) return { erro: null, linhas: [] }
            reservas.set(iguais.mensagem_id, {
              resultado: patch.resultado,
              processado_em: patch.processado_em ?? atual.processado_em,
            })
            return { erro: null, linhas: [{ id: 'reserva-1' }] }
          }
          const query = {
            eq(campo: string, valor: string) { iguais[campo] = valor; return query },
            lt(campo: string, valor: string) { menorQue = { coluna: campo, valor }; return query },
            async select() {
              const r = aplicar()
              return { data: r.linhas, error: r.erro ? { message: r.erro } : null }
            },
            then(resolve: (valor: { error: { message: string } | null }) => void) {
              const r = aplicar()
              resolve({ error: r.erro ? { message: r.erro } : null })
            },
          }
          return query
        },
      }
    },
  } as unknown as SupabaseClient
  return { client, base, reservas, falhas }
}

// Simula o tempo passando sobre uma reserva deixada para trás por um processo
// que morreu: o lease (10 min) vence e ela volta a ser retomável.
function envelhecerReserva(reservas: Map<string, EstadoReserva>, chave: string, minutos = 11) {
  const atual = reservas.get(chave)!
  reservas.set(chave, { ...atual, processado_em: new Date(Date.now() - minutos * 60_000).toISOString() })
}

async function comEnvioReal<T>(fn: () => Promise<T>): Promise<T> {
  const anterior = process.env.MODO_ENSAIO
  process.env.MODO_ENSAIO = 'false'
  try { return await fn() } finally { process.env.MODO_ENSAIO = anterior }
}

describe('prospecção — efeito do envio sobre o lead', () => {
  it('1º contato: registra abordagem e move novos_leads -> primeiro_contato', async () => {
    const lead = leadBase({ estagio: 'novos_leads', followups_enviados: 0 })
    const { motor, interacoes, atualizacoesLead } = motorFalso(lead, [template()])
    const ambiente = new AmbienteSupabase(ORG, { client: banco({ tipo: 'prospeccao' }, configComRemetente).cliente(), motor })

    const r = await comEnvioReal(() => ambiente.enviarEmailTemplate(LEAD, 'abordagem_1', CAMPANHA))

    expect(r.enviado).toBe(true)
    expect(enviosGmailMock).toHaveLength(1)
    expect(interacoes[0]).toMatchObject({ tipo: 'abordagem' })
    expect(atualizacoesLead).toEqual([{ id: LEAD, patch: { estagio: 'primeiro_contato', followups_enviados: 0 } }])
  })

  it('follow-up: registra follow_up, mantém estagio=follow_up e incrementa o cache', async () => {
    const lead = leadBase({ estagio: 'primeiro_contato', followups_enviados: 0 })
    const { motor, interacoes, atualizacoesLead } = motorFalso(lead, [template()])
    const ambiente = new AmbienteSupabase(ORG, { client: banco({ tipo: 'prospeccao' }, configComRemetente).cliente(), motor })

    const r = await comEnvioReal(() => ambiente.enviarEmailTemplate(LEAD, 'follow_up_1', CAMPANHA))

    expect(r.enviado).toBe(true)
    expect(enviosGmailMock).toHaveLength(1)
    expect(interacoes[0]).toMatchObject({ tipo: 'follow_up' })
    expect(atualizacoesLead).toEqual([{ id: LEAD, patch: { estagio: 'follow_up', followups_enviados: 1 } }])
  })

  it('follow-ups seguintes continuam incrementando o cache a cada envio', async () => {
    const lead = leadBase({ estagio: 'follow_up', followups_enviados: 2 })
    const { motor, atualizacoesLead } = motorFalso(lead, [template()])
    const ambiente = new AmbienteSupabase(ORG, { client: banco({ tipo: 'prospeccao' }, configComRemetente).cliente(), motor })

    await comEnvioReal(() => ambiente.enviarEmailTemplate(LEAD, 'follow_up_3', CAMPANHA))

    expect(atualizacoesLead).toEqual([{ id: LEAD, patch: { estagio: 'follow_up', followups_enviados: 3 } }])
  })

  it('bloqueia envio real de prospecção quando a organização não tem remetente configurado (sem fallback silencioso)', async () => {
    const lead = leadBase({ estagio: 'novos_leads' })
    const { motor, interacoes, atualizacoesLead } = motorFalso(lead, [template()])
    // Org SEM email_conta_key (config padrão de `banco`, sem configComRemetente).
    const ambiente = new AmbienteSupabase(ORG, { client: banco({ tipo: 'prospeccao' }).cliente(), motor })

    await comEnvioReal(async () => {
      await expect(ambiente.enviarEmailTemplate(LEAD, 'abordagem_1', CAMPANHA))
        .rejects.toThrow('Configure um remetente em Configurações antes de iniciar a campanha.')
    })
    expect(enviosGmailMock).toEqual([])
    expect(interacoes).toEqual([])
    expect(atualizacoesLead).toEqual([])
  })

  it.each([
    ['optout', { optout: true }],
    ['bounced', { bounced: true }],
    ['perdido', { perdido: true }],
    ['descartado', { estagio: 'descartado' as const }],
  ])('bloqueia envio de prospecção quando o lead está %s', async (_nome, overrides) => {
    const lead = leadBase({ estagio: 'follow_up', ...overrides })
    const { motor, enviados, interacoes, atualizacoesLead } = motorFalso(lead, [template()])
    const ambiente = new AmbienteSupabase(ORG, { client: banco({ tipo: 'prospeccao' }).cliente(), motor })

    const r = await comEnvioReal(() => ambiente.enviarEmailTemplate(LEAD, 'follow_up_1', CAMPANHA))

    expect(r.enviado).toBe(false)
    expect(enviados).toEqual([])
    expect(interacoes).toEqual([])
    expect(atualizacoesLead).toEqual([])
  })
})

describe('renovação — regressão obrigatória (comportamento preservado)', () => {
  it('envio de renovação NÃO grava estágio/followups_enviados (continua sem tocar no lead)', async () => {
    const lead = leadBase({ estagio: 'renovacao', followups_enviados: 0 })
    const { motor, enviados, interacoes, atualizacoesLead } = motorFalso(lead, [template()])
    const ambiente = new AmbienteSupabase(ORG, { client: banco({ tipo: 'renovacao' }).cliente(), motor })

    const r = await comEnvioReal(() => ambiente.enviarEmailTemplate(LEAD, 'renovacao_1', CAMPANHA))

    expect(r.enviado).toBe(true)
    expect(enviados).toHaveLength(1)
    // Continua 'nota', como antes desta entrega — não vira 'abordagem'/'follow_up'.
    expect(interacoes[0]).toMatchObject({ tipo: 'nota' })
    // Nenhuma chamada nova a atualizarLead: renovação não ganhou o efeito de prospecção.
    expect(atualizacoesLead).toEqual([])
  })

  it('envio de renovação NÃO é bloqueado por optout/bounced/perdido (gate novo não se aplica — gap pré-existente preservado)', async () => {
    // Este teste documenta, de propósito, que o gate de segurança adicionado
    // nesta entrega é ESTRITO a campanhaTipo==='prospeccao'. Renovação segue
    // com o comportamento anterior a esta entrega, inclusive esta lacuna
    // conhecida (ver relatório da entrega) — corrigi-la é uma decisão à parte,
    // fora do escopo autorizado aqui.
    const lead = leadBase({ estagio: 'renovacao', optout: true, bounced: true, perdido: true })
    const { motor, enviados } = motorFalso(lead, [template()])
    const ambiente = new AmbienteSupabase(ORG, { client: banco({ tipo: 'renovacao' }).cliente(), motor })

    const r = await comEnvioReal(() => ambiente.enviarEmailTemplate(LEAD, 'renovacao_1', CAMPANHA))

    expect(r.enviado).toBe(true)
    expect(enviados).toHaveLength(1)
  })

  it('envio sem campanha (workflow avulso) continua gravando nota e não toca no lead', async () => {
    const lead = leadBase({ estagio: 'novos_leads' })
    const { motor, enviados, interacoes, atualizacoesLead } = motorFalso(lead, [template()])
    const ambiente = new AmbienteSupabase(ORG, { client: banco({ tipo: 'prospeccao' }).cliente(), motor })

    // Sem 3º argumento (campanhaId): o gate de prospecção não pode se aplicar,
    // mesmo que exista uma campanha 'prospeccao' cadastrada na organização.
    const r = await comEnvioReal(() => ambiente.enviarEmailTemplate(LEAD, 'abordagem_1'))

    expect(r.enviado).toBe(true)
    expect(enviados).toHaveLength(1)
    expect(interacoes[0]).toMatchObject({ tipo: 'nota' })
    expect(atualizacoesLead).toEqual([])
  })
})

describe('reserva estrita do SMTP de prospecção', () => {
  it('falha fechada se não consegue confirmar reserva no banco', async () => {
    const { motor } = motorFalso(leadBase(), [template()])
    const { client } = clienteComReserva({ falharReserva: true })
    const ambiente = new AmbienteSupabase(ORG, { client, motor })
    await comEnvioReal(async () => {
      await expect(ambiente.enviarEmailTemplate(LEAD, 'follow_up_1', CAMPANHA, 'exec-1:email-1'))
        .rejects.toThrow('Reserva de envio indisponível')
    })
    expect(enviosGmailMock).toHaveLength(0)
  })

  it('retry e job duplicado não repetem SMTP depois de envio confirmado', async () => {
    const { motor } = motorFalso(leadBase(), [template()])
    const { client, reservas } = clienteComReserva()
    const ambiente = new AmbienteSupabase(ORG, { client, motor })
    await comEnvioReal(async () => {
      expect((await ambiente.enviarEmailTemplate(LEAD, 'follow_up_1', CAMPANHA, 'exec-1:email-1')).enviado).toBe(true)
      expect((await ambiente.enviarEmailTemplate(LEAD, 'follow_up_1', CAMPANHA, 'exec-1:email-1')).enviado).toBe(false)
    })
    expect(enviosGmailMock).toHaveLength(1)
    expect(reservas.get('envio:exec-1:email-1')?.resultado).toBe('envio_confirmado')
  })

  it('SMTP ambíguo fica incerto e não recebe retry cego', async () => {
    const { motor } = motorFalso(leadBase(), [template()])
    const { client, reservas } = clienteComReserva()
    const ambiente = new AmbienteSupabase(ORG, { client, motor })
    smtpEstado.falharAposTentativa = true
    await comEnvioReal(async () => {
      await expect(ambiente.enviarEmailTemplate(LEAD, 'follow_up_1', CAMPANHA, 'exec-1:email-1'))
        .rejects.toBeInstanceOf(ErroEnvioIncerto)
      smtpEstado.falharAposTentativa = false
      expect((await ambiente.enviarEmailTemplate(LEAD, 'follow_up_1', CAMPANHA, 'exec-1:email-1')).enviado).toBe(false)
    })
    expect(enviosGmailMock).toHaveLength(1)
    expect(reservas.get('envio:exec-1:email-1')?.resultado).toBe('envio_incerto')
  })
})

// Ciclo de vida da reserva: reservado → em curso → confirmado. A reserva é
// tomada ANTES do SMTP, então ela sozinha não prova entrega; o que separa
// "abandonada antes de tentar" (retomável) de "tentativa em voo" (nunca
// reenviada) é o estado + o lease.
describe('lease da reserva de envio de prospecção', () => {
  const CHAVE = 'envio:exec-1:email-1'

  it('reserva abandonada antes do SMTP é retomada e envia uma única vez', async () => {
    const { motor } = motorFalso(leadBase(), [template()])
    const { client, reservas, falhas } = clienteComReserva()
    const ambiente = new AmbienteSupabase(ORG, { client, motor })

    // Processo morre entre a reserva e a abertura do SMTP.
    falhas.emCurso = true
    await comEnvioReal(async () => {
      await expect(ambiente.enviarEmailTemplate(LEAD, 'follow_up_1', CAMPANHA, 'exec-1:email-1'))
        .rejects.toThrow('Reserva de envio indisponível')
    })
    expect(enviosGmailMock).toHaveLength(0)
    expect(reservas.get(CHAVE)?.resultado).toBe('envio_reservado')

    // Lease ainda vivo: ninguém rouba o passo de quem talvez ainda esteja nele.
    falhas.emCurso = false
    await comEnvioReal(async () => {
      expect((await ambiente.enviarEmailTemplate(LEAD, 'follow_up_1', CAMPANHA, 'exec-1:email-1')).enviado).toBe(false)
    })
    expect(enviosGmailMock).toHaveLength(0)

    // Lease vencido: a reserva órfã volta a ser retomável e o envio acontece UMA vez.
    envelhecerReserva(reservas, CHAVE)
    await comEnvioReal(async () => {
      expect((await ambiente.enviarEmailTemplate(LEAD, 'follow_up_1', CAMPANHA, 'exec-1:email-1')).enviado).toBe(true)
      expect((await ambiente.enviarEmailTemplate(LEAD, 'follow_up_1', CAMPANHA, 'exec-1:email-1')).enviado).toBe(false)
    })
    expect(enviosGmailMock).toHaveLength(1)
    expect(reservas.get(CHAVE)?.resultado).toBe('envio_confirmado')
  })

  it('tentativa morta com o SMTP em voo vira envio_incerto e nunca é reenviada', async () => {
    const { motor } = motorFalso(leadBase(), [template()])
    const { client, reservas } = clienteComReserva()
    const ambiente = new AmbienteSupabase(ORG, { client, motor })
    // Estado deixado por um processo que caiu DEPOIS de começar o SMTP.
    reservas.set(CHAVE, { resultado: 'envio_em_curso', processado_em: new Date(Date.now() - 11 * 60_000).toISOString() })

    await comEnvioReal(async () => {
      expect((await ambiente.enviarEmailTemplate(LEAD, 'follow_up_1', CAMPANHA, 'exec-1:email-1')).enviado).toBe(false)
    })
    expect(enviosGmailMock).toHaveLength(0)
    expect(reservas.get(CHAVE)?.resultado).toBe('envio_incerto')

    // Nem com mais tempo: ambiguidade de SMTP não vira reenvio automático.
    envelhecerReserva(reservas, CHAVE, 60)
    await comEnvioReal(async () => {
      expect((await ambiente.enviarEmailTemplate(LEAD, 'follow_up_1', CAMPANHA, 'exec-1:email-1')).enviado).toBe(false)
    })
    expect(enviosGmailMock).toHaveLength(0)
    expect(reservas.get(CHAVE)?.resultado).toBe('envio_incerto')
  })

  it('duas tentativas concorrentes: só uma reserva prossegue', async () => {
    const { motor } = motorFalso(leadBase(), [template()])
    const { client, reservas } = clienteComReserva()
    const ambiente = new AmbienteSupabase(ORG, { client, motor })

    const resultados = await comEnvioReal(() => Promise.all([
      ambiente.enviarEmailTemplate(LEAD, 'follow_up_1', CAMPANHA, 'exec-1:email-1'),
      ambiente.enviarEmailTemplate(LEAD, 'follow_up_1', CAMPANHA, 'exec-1:email-1'),
    ]))
    expect(resultados.filter((r) => r.enviado)).toHaveLength(1)
    expect(enviosGmailMock).toHaveLength(1)
    expect(reservas.get(CHAVE)?.resultado).toBe('envio_confirmado')
  })

  it('renovação não passa pelo ciclo de reserva — nem toca em mensagens_processadas', async () => {
    const { motor, enviados } = motorFalso(leadBase({ estagio: 'renovacao' }), [template()])
    const base = banco({ tipo: 'renovacao' })
    const client = {
      from(tabela: string) {
        if (tabela === 'mensagens_processadas') throw new Error('renovação não pode usar a reserva de prospecção')
        return base.cliente().from(tabela)
      },
    } as unknown as SupabaseClient
    const ambiente = new AmbienteSupabase(ORG, { client, motor })

    const r = await comEnvioReal(() => ambiente.enviarEmailTemplate(LEAD, 'renovacao_1', CAMPANHA, 'exec-9:email-0'))

    expect(r.enviado).toBe(true)
    expect(enviados).toHaveLength(1)
  })
})

// Gates que impedem o follow-up depois que a espera já venceu. Sem eles, o
// despertar durável (0047) acordaria a execução e mandaria e-mail para quem já
// respondeu ou para execução que o monitor de respostas cancelou.
describe('gates de resposta e cancelamento no envio de prospecção', () => {
  it('lead com interação de resposta não recebe follow-up', async () => {
    const { motor } = motorFalso(leadBase(), [template()])
    const { client, base, reservas } = clienteComReserva()
    base.linhas('interacoes').push({ id: 'int-1', organizacao_id: ORG, lead_id: LEAD, tipo: 'resposta' })
    const ambiente = new AmbienteSupabase(ORG, { client, motor })
    await comEnvioReal(async () => {
      expect((await ambiente.enviarEmailTemplate(LEAD, 'follow_up_1', CAMPANHA, 'exec-1:email-1')).enviado).toBe(false)
    })
    expect(enviosGmailMock).toHaveLength(0)
    // Gate antes da reserva: a chave de idempotência não é consumida à toa.
    expect(reservas.size).toBe(0)
  })

  it('resposta de OUTRO lead não bloqueia o envio deste', async () => {
    const { motor } = motorFalso(leadBase(), [template()])
    const { client, base } = clienteComReserva()
    base.linhas('interacoes').push({ id: 'int-2', organizacao_id: ORG, lead_id: 'outro-lead', tipo: 'resposta' })
    const ambiente = new AmbienteSupabase(ORG, { client, motor })
    await comEnvioReal(async () => {
      expect((await ambiente.enviarEmailTemplate(LEAD, 'follow_up_1', CAMPANHA, 'exec-1:email-1')).enviado).toBe(true)
    })
    expect(enviosGmailMock).toHaveLength(1)
  })

  it('execução cancelada durante a espera não envia', async () => {
    const { motor } = motorFalso(leadBase(), [template()])
    const { client, base } = clienteComReserva()
    base.linhas('workflow_execucoes')[0].status = 'cancelado'
    const ambiente = new AmbienteSupabase(ORG, { client, motor })
    await comEnvioReal(async () => {
      expect((await ambiente.enviarEmailTemplate(LEAD, 'follow_up_1', CAMPANHA, 'exec-1:email-1')).enviado).toBe(false)
    })
    expect(enviosGmailMock).toHaveLength(0)
  })

  it('campanha pausada não envia, mesmo com a espera vencida', async () => {
    const { motor } = motorFalso(leadBase(), [template()])
    const base = banco({ tipo: 'prospeccao', status: 'pausada' }, configComRemetente)
    const ambiente = new AmbienteSupabase(ORG, { client: base.cliente(), motor })
    await comEnvioReal(async () => {
      expect((await ambiente.enviarEmailTemplate(LEAD, 'follow_up_1', CAMPANHA, 'exec-1:email-1')).enviado).toBe(false)
    })
    expect(enviosGmailMock).toHaveLength(0)
  })
})

describe('cópia ao responsável nos envios da campanha (publico.operacao.responsavelRecebe)', () => {
  it('campanha sem a opção (anterior a ela): o responsável vai em cópia, como sempre', async () => {
    const lead = leadBase({ estagio: 'novos_leads', followups_enviados: 0 })
    const { motor } = motorFalso(lead, [template()])
    const ambiente = new AmbienteSupabase(ORG, { client: banco({ tipo: 'prospeccao' }, configComRemetente).cliente(), motor })

    const r = await comEnvioReal(() => ambiente.enviarEmailTemplate(LEAD, 'abordagem_1', CAMPANHA))

    expect(r.enviado).toBe(true)
    expect(enviosGmailMock).toHaveLength(1)
    expect(enviosGmailMock[0].cc).toBe('aline@org.com.br')
  })

  it('"somente as respostas": o e-mail sai sem cópia e segue assinado pelo responsável', async () => {
    const lead = leadBase({ estagio: 'primeiro_contato', followups_enviados: 0 })
    const { motor } = motorFalso(lead, [template()])
    const ambiente = new AmbienteSupabase(ORG, {
      client: banco({ tipo: 'prospeccao', publico: { operacao: { responsavelRecebe: 'somente_respostas' } } }, configComRemetente).cliente(),
      motor,
    })

    const r = await comEnvioReal(() => ambiente.enviarEmailTemplate(LEAD, 'follow_up_1', CAMPANHA))

    expect(r.enviado).toBe(true)
    expect(enviosGmailMock).toHaveLength(1)
    expect(enviosGmailMock[0].cc).toBeUndefined()
    expect(enviosGmailMock[0].html).toContain('Aline')
  })

  it('"mensagens e respostas" explícito mantém a cópia', async () => {
    const lead = leadBase({ estagio: 'primeiro_contato', followups_enviados: 0 })
    const { motor } = motorFalso(lead, [template()])
    const ambiente = new AmbienteSupabase(ORG, {
      client: banco({ tipo: 'prospeccao', publico: { operacao: { responsavelRecebe: 'envios_e_respostas' } } }, configComRemetente).cliente(),
      motor,
    })

    await comEnvioReal(() => ambiente.enviarEmailTemplate(LEAD, 'follow_up_1', CAMPANHA))

    expect(enviosGmailMock[0].cc).toBe('aline@org.com.br')
  })
})

describe('aviso de envio no WhatsApp (publico.operacao.avisoEnvio)', () => {
  const GRUPO = '120363000000000099-group'
  const publicoComAviso = (avisoEnvio?: Record<string, unknown>) => ({
    operacao: {
      mensagemInicial: { templateTipo: 'renovacao_1' },
      followups: [{ templateTipo: 'renovacao_2' }, { templateTipo: 'renovacao_3' }],
      ...(avisoEnvio ? { avisoEnvio } : {}),
    },
  })

  it('envio real avisa com campanha, etapa, assunto e a chave do envio', async () => {
    const { motor } = motorFalso(leadBase({ estagio: 'renovacao' }), [template()])
    const avisarEnvio = vi.fn().mockResolvedValue({ tipo: 'processado', resultados: [] })
    const client = banco({ tipo: 'renovacao', nome: 'CAMPANHA INICIAL', publico: publicoComAviso({ whatsapp: ['grupo'], grupoWhatsappId: GRUPO }) }).cliente()
    const ambiente = new AmbienteSupabase(ORG, { client, motor, avisarEnvio })

    const r = await comEnvioReal(() => ambiente.enviarEmailTemplate(LEAD, 'renovacao_3', CAMPANHA, 'exec-1:email-3'))

    expect(r.enviado).toBe(true)
    expect(avisarEnvio).toHaveBeenCalledTimes(1)
    expect(avisarEnvio).toHaveBeenCalledWith({
      organizacaoId: ORG,
      leadId: LEAD,
      eventoId: 'envio:exec-1:email-3',
      destinos: ['grupo'],
      grupoIdCampanha: GRUPO,
      responsavelPerfil: { id: 'u1', nome: 'Aline' },
      campanhaNome: 'CAMPANHA INICIAL',
      etapa: 'follow-up 2',
      assunto: 'Contato — Empresa Exemplo',
    })
  })

  it('mensagem inicial é identificada como tal', async () => {
    const { motor } = motorFalso(leadBase({ estagio: 'renovacao' }), [template()])
    const avisarEnvio = vi.fn().mockResolvedValue({ tipo: 'processado', resultados: [] })
    const client = banco({ tipo: 'renovacao', nome: 'C', publico: publicoComAviso({ whatsapp: ['grupo'] }) }).cliente()
    await comEnvioReal(() => new AmbienteSupabase(ORG, { client, motor, avisarEnvio })
      .enviarEmailTemplate(LEAD, 'renovacao_1', CAMPANHA, 'exec-1:email-1'))
    expect(avisarEnvio.mock.calls[0][0]).toMatchObject({ etapa: 'mensagem inicial', grupoIdCampanha: null })
  })

  it('sem avisoEnvio na campanha não avisa', async () => {
    const { motor } = motorFalso(leadBase({ estagio: 'renovacao' }), [template()])
    const avisarEnvio = vi.fn()
    const client = banco({ tipo: 'renovacao', publico: publicoComAviso() }).cliente()
    await comEnvioReal(() => new AmbienteSupabase(ORG, { client, motor, avisarEnvio })
      .enviarEmailTemplate(LEAD, 'renovacao_1', CAMPANHA, 'exec-1:email-1'))
    expect(avisarEnvio).not.toHaveBeenCalled()
  })

  it('campanha em dry_run não envia nem avisa', async () => {
    const { motor, enviados } = motorFalso(leadBase({ estagio: 'renovacao' }), [template()])
    const avisarEnvio = vi.fn()
    const client = banco({ tipo: 'renovacao', dry_run: true, publico: publicoComAviso({ whatsapp: ['grupo'] }) }).cliente()
    const r = await comEnvioReal(() => new AmbienteSupabase(ORG, { client, motor, avisarEnvio })
      .enviarEmailTemplate(LEAD, 'renovacao_1', CAMPANHA, 'exec-1:email-1'))
    expect(r.enviado).toBe(false)
    expect(enviados).toHaveLength(0)
    expect(avisarEnvio).not.toHaveBeenCalled()
  })

  it('simulação não avisa', async () => {
    const { motor } = motorFalso(leadBase({ estagio: 'renovacao' }), [template()])
    const avisarEnvio = vi.fn()
    const client = banco({ tipo: 'renovacao', publico: publicoComAviso({ whatsapp: ['grupo'] }) }).cliente()
    await comEnvioReal(() => new AmbienteSupabase(ORG, { client, motor, avisarEnvio, simular: true })
      .enviarEmailTemplate(LEAD, 'renovacao_1', CAMPANHA, 'exec-1:email-1'))
    expect(avisarEnvio).not.toHaveBeenCalled()
  })

  it('falha no aviso não derruba o envio já feito', async () => {
    const { motor, enviados } = motorFalso(leadBase({ estagio: 'renovacao' }), [template()])
    const avisarEnvio = vi.fn().mockRejectedValue(new Error('Z-API fora'))
    const client = banco({ tipo: 'renovacao', publico: publicoComAviso({ whatsapp: ['grupo'] }) }).cliente()
    const r = await comEnvioReal(() => new AmbienteSupabase(ORG, { client, motor, avisarEnvio })
      .enviarEmailTemplate(LEAD, 'renovacao_1', CAMPANHA, 'exec-1:email-1'))
    expect(r.enviado).toBe(true)
    expect(enviados).toHaveLength(1)
  })
})
