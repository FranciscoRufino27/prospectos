// Criador de campanhas: até 6 follow-ups além da mensagem inicial. O mesmo
// limite vale no botão do wizard, na normalização do servidor, na validação de
// ativação e na materialização do workflow — e acima dele a campanha é
// recusada inteira, sem cortar follow-up em silêncio.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Publico } from '@/components/automacao/tiposCampanha'
import type { DefinicaoWorkflow } from '@/lib/workflows/types'

const mocks = vi.hoisted(() => ({
  atualizarCampanha: vi.fn(async (_admin: unknown, _org: string, _id: string, _patch: { publico?: Publico }) => {}),
  buscarRemetenteCampanha: vi.fn(async () => ({ conta: 'PADRAO', email: 'padrao@empresa.com' })),
  criarWorkflow: vi.fn(async () => ({ id: 'wf-novo' })),
  salvarRascunho: vi.fn(async (_store: unknown, _id: string, def: DefinicaoWorkflow) => ({ rascunho_definicao: def })),
  buscarWorkflow: vi.fn(async () => null),
  buscarVersao: vi.fn(async () => null),
}))

vi.mock('../repository', () => ({ atualizarCampanha: mocks.atualizarCampanha }))
vi.mock('../opcoesServidor', () => ({ buscarRemetenteCampanha: mocks.buscarRemetenteCampanha }))
vi.mock('@/lib/workflows', () => ({
  criarWorkflow: mocks.criarWorkflow,
  salvarRascunho: mocks.salvarRascunho,
  SupabaseWorkflowStore: class {
    buscarWorkflow = mocks.buscarWorkflow
    buscarVersao = mocks.buscarVersao
  },
}))

import {
  aplicarRegraPublicoPorTipo,
  LIMITE_FOLLOWUPS_CAMPANHA,
  montarDefinicaoCampanha,
  normalizarPublicoCampanha,
  podeAdicionarFollowup,
  validarCampanhaGuiada,
} from '../configuracaoGuiada'
import { materializarCampanhaGuiada } from '../materializarServidor'

const ERRO_LIMITE = 'A campanha aceita no máximo 6 follow-ups.'
const ID_TEMPLATE = '11111111-1111-4111-8111-111111111111'
const DIAS = [3, 7, 14, 21, 30, 45, 60]

function followups(quantidade: number) {
  return Array.from({ length: quantidade }, (_, i) => ({
    diasApos: DIAS[i],
    assunto: `FUP ${i + 1}`,
    corpo: `Corpo do follow-up ${i + 1}`,
  }))
}

// Fake mínimo do client Supabase (tabela `templates`): toda mensagem traz
// `templateId`, então a materialização segue o ramo `.update()`, cujo payload é
// registrado para conferir quais templates da campanha seriam gravados.
function adminFake() {
  const gravacoes: Array<Record<string, unknown>> = []
  const chain = {
    eq: () => chain,
    select: () => chain,
    update: (valores: Record<string, unknown>) => { gravacoes.push(valores); return chain },
    maybeSingle: async () => ({ data: { id: ID_TEMPLATE }, error: null }),
  }
  const from = vi.fn(() => chain)
  return { admin: { from } as unknown as SupabaseClient, gravacoes, from }
}

describe('limite de follow-ups do criador de campanhas', () => {
  it('o botão do wizard permite chegar ao 6º follow-up e bloqueia o 7º', () => {
    expect(LIMITE_FOLLOWUPS_CAMPANHA).toBe(6)
    for (const quantidade of [0, 1, 2, 3, 4, 5]) expect(podeAdicionarFollowup(quantidade)).toBe(true)
    expect(podeAdicionarFollowup(6)).toBe(false)
    expect(podeAdicionarFollowup(7)).toBe(false)
  })

  it.each([4, 5, 6])('%i follow-ups: o servidor mantém todos, na ordem e com o conteúdo intacto', (quantidade) => {
    const publico = normalizarPublicoCampanha({ operacao: { followups: followups(quantidade) } })

    expect(publico.operacao?.followups).toHaveLength(quantidade)
    expect(publico.operacao?.followups).toEqual(followups(quantidade))
  })

  it('7 follow-ups: a requisição é recusada inteira, nada é truncado em silêncio', () => {
    expect(() => normalizarPublicoCampanha({ operacao: { followups: followups(7) } })).toThrow(ERRO_LIMITE)
  })

  it('7 follow-ups no estado do wizard: a validação de ativação também recusa', () => {
    const publico = { operacao: { followups: followups(7) } } as Publico
    expect(validarCampanhaGuiada(publico)).toContain(ERRO_LIMITE)
  })

  it('6 follow-ups completos passam na validação de ativação', () => {
    const publico = aplicarRegraPublicoPorTipo(normalizarPublicoCampanha({
      responsavel_id: 'perfil-1',
      selecao: { modo: 'manual', leadIds: ['lead-1'] },
      operacao: {
        remetenteEmail: 'time@empresa.com',
        mensagemInicial: { assunto: 'Inicial', corpo: 'Olá' },
        followups: followups(6),
      },
    }), 'prospeccao')

    expect(publico.operacao?.followups).toHaveLength(6)
    expect(validarCampanhaGuiada(publico)).toEqual([])
  })

  it('workflow da campanha: inicial → espera → FUP 1 … → espera → FUP 6, na ordem', () => {
    const publico = normalizarPublicoCampanha({
      operacao: {
        mensagemInicial: { assunto: 'Inicial', corpo: 'Corpo', templateTipo: 'campanha_x_m1' },
        followups: followups(6).map((f, i) => ({ ...f, templateTipo: `campanha_x_m${i + 2}` })),
      },
    })

    expect(montarDefinicaoCampanha(publico).acoes).toEqual([
      { id: 'email-0', tipo: 'enviar_email', config: { template: 'campanha_x_m1' } },
      { id: 'espera-1', tipo: 'esperar', config: { dias: 3, horas: 0 } },
      { id: 'email-1', tipo: 'enviar_email', config: { template: 'campanha_x_m2' } },
      { id: 'espera-2', tipo: 'esperar', config: { dias: 4, horas: 0 } },
      { id: 'email-2', tipo: 'enviar_email', config: { template: 'campanha_x_m3' } },
      { id: 'espera-3', tipo: 'esperar', config: { dias: 7, horas: 0 } },
      { id: 'email-3', tipo: 'enviar_email', config: { template: 'campanha_x_m4' } },
      { id: 'espera-4', tipo: 'esperar', config: { dias: 7, horas: 0 } },
      { id: 'email-4', tipo: 'enviar_email', config: { template: 'campanha_x_m5' } },
      { id: 'espera-5', tipo: 'esperar', config: { dias: 9, horas: 0 } },
      { id: 'email-5', tipo: 'enviar_email', config: { template: 'campanha_x_m6' } },
      { id: 'espera-6', tipo: 'esperar', config: { dias: 15, horas: 0 } },
      { id: 'email-6', tipo: 'enviar_email', config: { template: 'campanha_x_m7' } },
    ])
  })

  it('campanha antiga com 4 follow-ups já materializados continua idêntica', () => {
    // Formato gravado em campanhas.publico pela versão anterior (limite 4).
    const legado = {
      responsavel_id: 'perfil-1',
      selecao: { modo: 'filtros', estagios: ['novo', 'novos_leads'], criterio: 'estagios' },
      operacao: {
        modoEnvio: 'cadencia',
        remetenteEmail: 'time@empresa.com',
        mensagemInicial: { assunto: 'Inicial', corpo: 'Corpo', templateId: ID_TEMPLATE, templateTipo: 'campanha_legado_m1', acaoId: 'email-0' },
        followups: [
          { assunto: 'F1', corpo: 'C1', templateTipo: 'campanha_legado_m2', acaoId: 'email-1', diasApos: 3 },
          { assunto: 'F2', corpo: 'C2', templateTipo: 'campanha_legado_m3', acaoId: 'uuid-f2', diasApos: 7 },
          { assunto: 'F3', corpo: 'C3', templateTipo: 'campanha_legado_m4', acaoId: 'uuid-f3', diasApos: 14 },
          { assunto: 'F4', corpo: 'C4', templateTipo: 'campanha_legado_m5', acaoId: 'uuid-f4', diasApos: 30 },
        ],
        workflowGerenciadoId: 'wf-legado',
      },
    }
    const publico = normalizarPublicoCampanha(legado)

    expect(publico.operacao?.followups?.map((f) => [f.templateTipo, f.acaoId, f.diasApos])).toEqual([
      ['campanha_legado_m2', 'email-1', 3],
      ['campanha_legado_m3', 'uuid-f2', 7],
      ['campanha_legado_m4', 'uuid-f3', 14],
      ['campanha_legado_m5', 'uuid-f4', 30],
    ])
    expect(montarDefinicaoCampanha(publico).acoes).toEqual([
      { id: 'email-0', tipo: 'enviar_email', config: { template: 'campanha_legado_m1' } },
      { id: 'espera-1', tipo: 'esperar', config: { dias: 3, horas: 0 } },
      { id: 'email-1', tipo: 'enviar_email', config: { template: 'campanha_legado_m2' } },
      { id: 'espera-2', tipo: 'esperar', config: { dias: 4, horas: 0 } },
      { id: 'uuid-f2', tipo: 'enviar_email', config: { template: 'campanha_legado_m3' } },
      { id: 'espera-3', tipo: 'esperar', config: { dias: 7, horas: 0 } },
      { id: 'uuid-f3', tipo: 'enviar_email', config: { template: 'campanha_legado_m4' } },
      { id: 'espera-4', tipo: 'esperar', config: { dias: 16, horas: 0 } },
      { id: 'uuid-f4', tipo: 'enviar_email', config: { template: 'campanha_legado_m5' } },
    ])
    // Re-salvar a campanha antiga não muda nada.
    expect(normalizarPublicoCampanha(publico)).toEqual(publico)
  })
})

describe('materialização da campanha com o novo limite', () => {
  beforeEach(() => vi.clearAllMocks())

  const publicoBase = { responsavel_id: 'resp-1', selecao: { modo: 'manual' as const, leadIds: ['lead-1'] } }

  it('6 follow-ups: grava os 7 templates da campanha e o rascunho com as 6 mensagens na ordem', async () => {
    const { admin, gravacoes } = adminFake()

    const resultado = await materializarCampanhaGuiada(admin, 'org-1', 'camp-6', 'Campanha 6', {
      ...publicoBase,
      operacao: {
        mensagemInicial: { assunto: 'Inicial', corpo: 'Corpo', templateId: ID_TEMPLATE },
        followups: followups(6).map((f) => ({ ...f, templateId: ID_TEMPLATE })),
      },
    })

    const tiposEsperados = [1, 2, 3, 4, 5, 6, 7].map((n) => `campanha_camp6_m${n}`)
    expect(gravacoes.map((g) => g.tipo)).toEqual(tiposEsperados)
    expect(gravacoes.map((g) => g.assunto)).toEqual(['Inicial', 'FUP 1', 'FUP 2', 'FUP 3', 'FUP 4', 'FUP 5', 'FUP 6'])

    const salvos = resultado.publico.operacao?.followups ?? []
    expect(salvos.map((f) => [f.templateTipo, f.diasApos])).toEqual(
      tiposEsperados.slice(1).map((tipo, i) => [tipo, DIAS[i]]),
    )

    const def = mocks.salvarRascunho.mock.calls[0][2]
    expect(def.acoes.map((a) => a.tipo)).toEqual([
      'enviar_email', 'esperar', 'enviar_email', 'esperar', 'enviar_email', 'esperar', 'enviar_email',
      'esperar', 'enviar_email', 'esperar', 'enviar_email', 'esperar', 'enviar_email',
    ])
    const envios = def.acoes.filter((a) => a.tipo === 'enviar_email')
    expect(envios.map((a) => a.config.template)).toEqual(tiposEsperados)
    expect(def.acoes.filter((a) => a.tipo === 'esperar').map((a) => a.config.dias)).toEqual([3, 4, 7, 7, 9, 15])
    // Identidade estável: o mesmo acaoId fica na mensagem persistida e na ação.
    expect(envios.map((a) => a.id)).toEqual([
      resultado.publico.operacao?.mensagemInicial?.acaoId,
      ...salvos.map((f) => f.acaoId),
    ])

    expect(mocks.atualizarCampanha).toHaveBeenCalledTimes(1)
    expect(mocks.atualizarCampanha.mock.calls[0][3].publico?.operacao?.followups).toHaveLength(6)
  })

  it('7 follow-ups: recusa antes de qualquer escrita (template, workflow ou campanha)', async () => {
    const { admin, from } = adminFake()

    await expect(materializarCampanhaGuiada(admin, 'org-1', 'camp-7', 'Campanha 7', {
      ...publicoBase,
      operacao: {
        mensagemInicial: { assunto: 'Inicial', corpo: 'Corpo', templateId: ID_TEMPLATE },
        followups: followups(7).map((f) => ({ ...f, templateId: ID_TEMPLATE })),
      },
    })).rejects.toThrow(ERRO_LIMITE)

    expect(from).not.toHaveBeenCalled()
    expect(mocks.criarWorkflow).not.toHaveBeenCalled()
    expect(mocks.salvarRascunho).not.toHaveBeenCalled()
    expect(mocks.atualizarCampanha).not.toHaveBeenCalled()
  })
})
