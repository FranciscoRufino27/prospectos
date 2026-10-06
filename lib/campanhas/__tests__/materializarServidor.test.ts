// Prova, no nível de orquestração (não só das funções puras de acaoId.ts),
// que a invariante pedida se sustenta: o `acaoId` persistido em
// `MensagemCampanha`, o `acoes[].id` gravado no rascunho que vira a versão
// publicada, e o valor que uma futura idempotência usaria como `acao_chave`
// são exatamente o MESMO valor — inclusive para campanha legada.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { DefinicaoWorkflow, Workflow, WorkflowVersao } from '@/lib/workflows/types'

const mocks = vi.hoisted(() => ({
  atualizarCampanha: vi.fn(async () => {}),
  buscarRemetenteDoTipo: vi.fn(async () => ({ conta: 'PADRAO', email: 'padrao@empresa.com' })),
  criarWorkflow: vi.fn(),
  salvarRascunho: vi.fn(async (_store: unknown, _id: string, def: DefinicaoWorkflow) => ({ rascunho_definicao: def })),
  buscarWorkflow: vi.fn(async (): Promise<Workflow | null> => null),
  buscarVersao: vi.fn(async (): Promise<WorkflowVersao | null> => null),
}))

vi.mock('../repository', () => ({ atualizarCampanha: mocks.atualizarCampanha }))
vi.mock('../opcoesServidor', () => ({ buscarRemetenteDoTipo: mocks.buscarRemetenteDoTipo }))
vi.mock('@/lib/workflows', () => ({
  criarWorkflow: mocks.criarWorkflow,
  salvarRascunho: mocks.salvarRascunho,
  SupabaseWorkflowStore: class {
    buscarWorkflow = mocks.buscarWorkflow
    buscarVersao = mocks.buscarVersao
  },
}))

import { materializarCampanhaGuiada } from '../materializarServidor'

// Fake mínimo do client Supabase — só a tabela `templates`, com `templateId`
// já presente na mensagem (ramo `.update()`), pra não precisar simular
// `.insert()`/busca de fallback genérico, irrelevantes a este teste.
// O id é um UUID porque a materialização valida que todo template referenciado
// existe na organização (lib/campanhas/templatesCampanha.ts).
function adminFake(): SupabaseClient {
  const maybeSingle = async () => ({ data: { id: '11111111-1111-4111-8111-111111111111' }, error: null })
  const chain = { eq: () => chain, select: () => chain, update: () => chain, maybeSingle }
  return { from: () => chain } as unknown as SupabaseClient
}

const publicoBase = {
  responsavel_id: 'resp-1',
  selecao: { modo: 'manual' as const, leadIds: ['lead-1'] },
}

function acaoEmailDe(def: DefinicaoWorkflow) {
  return def.acoes.find((a) => a.tipo === 'enviar_email')
}

describe('materializarCampanhaGuiada — acaoId estável (Microentrega A)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('campanha NOVA (sem workflow ainda): mensagem sem acaoId ganha um novo, e é EXATAMENTE o que vai para o rascunho publicável', async () => {
    mocks.criarWorkflow.mockResolvedValue({ id: 'wf-novo' })

    const resultado = await materializarCampanhaGuiada(adminFake(), 'org-1', 'camp-nova', 'Campanha Nova', {
      ...publicoBase,
      operacao: { mensagemInicial: { assunto: 'Olá {empresa}', corpo: 'Corpo', templateId: '11111111-1111-4111-8111-111111111111' } },
    })

    const acaoIdPersistido = resultado.publico.operacao?.mensagemInicial?.acaoId
    expect(acaoIdPersistido).toBeTruthy()
    expect(acaoIdPersistido).not.toBe('email-0') // não é o formato posicional legado

    const defSalva = mocks.salvarRascunho.mock.calls[0][2] as DefinicaoWorkflow
    expect(acaoEmailDe(defSalva)?.id).toBe(acaoIdPersistido) // MESMO valor no rascunho
  })

  it('campanha LEGADA (workflow já publicado, mensagem sem acaoId salvo): herda o id JÁ EM PRODUÇÃO — não inventa UUID', async () => {
    mocks.buscarWorkflow.mockResolvedValue({
      id: 'wf-campanha-inicial',
      nome: 'Campanha — CAMPANHA INICIAL',
      status: 'publicado',
      versao_atual_id: 'versao-1',
      rascunho_definicao: null,
      criado_em: '', atualizado_em: '',
    })
    mocks.buscarVersao.mockResolvedValue({
      id: 'versao-1',
      workflow_id: 'wf-campanha-inicial',
      numero: 1,
      definicao: {
        gatilho: { id: 'gatilho-manual', tipo: 'manual', config: {} },
        condicoes: [],
        acoes: [{ id: 'email-0', tipo: 'enviar_email', config: { template: 'campanha_x_m1' } }],
      },
      publicado_em: '', publicado_por: null,
    })

    const resultado = await materializarCampanhaGuiada(adminFake(), 'org-1', 'camp-legada', 'CAMPANHA INICIAL', {
      ...publicoBase,
      operacao: {
        mensagemInicial: { assunto: 'LAUDO DE BRINQUEDOS', corpo: 'Corpo', templateId: '11111111-1111-4111-8111-111111111111' },
        workflowGerenciadoId: 'wf-campanha-inicial',
      },
    })

    // 1) valor persistido em MensagemCampanha:
    expect(resultado.publico.operacao?.mensagemInicial?.acaoId).toBe('email-0')
    // 2) exatamente o mesmo valor no que seria (re)publicado:
    const defSalva = mocks.salvarRascunho.mock.calls[0][2] as DefinicaoWorkflow
    expect(acaoEmailDe(defSalva)?.id).toBe('email-0')
    // não deve ter criado um workflow novo para uma campanha que já tem um
    expect(mocks.criarWorkflow).not.toHaveBeenCalled()
  })

  it('re-save preserva o acaoId já persistido, mesmo sem versão publicada nova (nunca recalcula)', async () => {
    mocks.buscarWorkflow.mockResolvedValue({
      id: 'wf-x', nome: 'x', status: 'rascunho', versao_atual_id: null, rascunho_definicao: null,
      criado_em: '', atualizado_em: '',
    })

    const resultado = await materializarCampanhaGuiada(adminFake(), 'org-1', 'camp-x', 'X', {
      ...publicoBase,
      operacao: {
        mensagemInicial: { assunto: 'Olá', corpo: 'Corpo', templateId: '11111111-1111-4111-8111-111111111111', acaoId: 'ja-persistido-antes' },
        workflowGerenciadoId: 'wf-x',
      },
    })

    expect(resultado.publico.operacao?.mensagemInicial?.acaoId).toBe('ja-persistido-antes')
  })

  it('adicionar follow-up a campanha legada: mensagem original herda o id publicado, a nova ganha UUID — nenhuma reescreve a outra', async () => {
    mocks.buscarWorkflow.mockResolvedValue({
      id: 'wf-legado', nome: 'y', status: 'publicado', versao_atual_id: 'v1', rascunho_definicao: null,
      criado_em: '', atualizado_em: '',
    })
    mocks.buscarVersao.mockResolvedValue({
      id: 'v1', workflow_id: 'wf-legado', numero: 1,
      definicao: {
        gatilho: { id: 'g', tipo: 'manual', config: {} }, condicoes: [],
        acoes: [{ id: 'email-0', tipo: 'enviar_email', config: {} }],
      },
      publicado_em: '', publicado_por: null,
    })

    const resultado = await materializarCampanhaGuiada(adminFake(), 'org-1', 'camp-y', 'Y', {
      ...publicoBase,
      operacao: {
        mensagemInicial: { assunto: 'Original', corpo: 'C', templateId: '11111111-1111-4111-8111-111111111111' },
        followups: [{ assunto: 'Novo follow-up', corpo: 'C2', templateId: '11111111-1111-4111-8111-111111111111', diasApos: 3 }],
        workflowGerenciadoId: 'wf-legado',
      },
    })

    expect(resultado.publico.operacao?.mensagemInicial?.acaoId).toBe('email-0')
    const idFollowup = resultado.publico.operacao?.followups?.[0]?.acaoId
    expect(idFollowup).toBeTruthy()
    expect(idFollowup).not.toBe('email-0')
  })
})
