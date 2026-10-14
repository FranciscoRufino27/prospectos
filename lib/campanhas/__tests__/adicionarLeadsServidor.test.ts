import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const mocks = vi.hoisted(() => ({
  buscarCampanha: vi.fn(),
  exigirEnvioRealCampanhaDisponivel: vi.fn(),
  exigirAvisoRetornoPronto: vi.fn(),
  buscarWorkflow: vi.fn(),
  inscreverLeadManual: vi.fn(),
  transferirLeadImportadoParaMotor: vi.fn(),
  restaurarLeadImportadoForaDoMotor: vi.fn(),
}))

vi.mock('../repository', () => ({ buscarCampanha: mocks.buscarCampanha }))
vi.mock('../opcoesServidor', () => ({ exigirEnvioRealCampanhaDisponivel: mocks.exigirEnvioRealCampanhaDisponivel }))
vi.mock('../retornoWhatsappServidor', () => ({
  exigirAvisoRetornoPronto: mocks.exigirAvisoRetornoPronto,
  exigirAvisoEnvioPronto: mocks.exigirAvisoRetornoPronto,
}))
vi.mock('../carteiraServidor', () => ({
  transferirLeadImportadoParaMotor: mocks.transferirLeadImportadoParaMotor,
  restaurarLeadImportadoForaDoMotor: mocks.restaurarLeadImportadoForaDoMotor,
}))
vi.mock('@/lib/workflows', () => ({
  SupabaseWorkflowStore: class { buscarWorkflow = mocks.buscarWorkflow },
  inscreverLeadManual: mocks.inscreverLeadManual,
}))

import {
  adicionarLeadsCampanha,
  buscarCandidatosAdicao,
  normalizarFiltrosAdicao,
} from '../adicionarLeadsServidor'

const ORG = '11111111-1111-4111-8111-111111111111'
const OUTRA_ORG = '22222222-2222-4222-8222-222222222222'
const WF = 'wf-campanha'
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

type Linha = Record<string, unknown>

function lead(n: number, patch: Linha = {}): Linha {
  return {
    id: id(n), organizacao_id: ORG, empresa_id: `emp-${n}`, empresa: `Empresa ${n}`,
    segmento: 'laudos_de_brinquedos', estagio: 'novos_leads', contato_nome: `Contato ${n}`,
    contato_email: `c${n}@x.com`, responsavel_id: 'resp-1', owner: 'n8n',
    optout: false, bounced: false, perdido: false, created_at: '2026-10-09T12:00:00.000Z',
    ...patch,
  }
}

// Supabase em memória: aplica eq/in/gte/lt de verdade e registra os `or`.
function criarAdmin(tabelas: Record<string, Linha[]>) {
  const chamadas: { tabela: string; filtros: string[] }[] = []
  const admin = {
    from(tabela: string) {
      const filtros: string[] = []
      chamadas.push({ tabela, filtros })
      let linhas = [...(tabelas[tabela] ?? [])]
      let limite = Infinity
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => { filtros.push(`eq:${c}`); linhas = linhas.filter((l) => l[c] === v); return q },
        neq: (c: string, v: unknown) => { linhas = linhas.filter((l) => l[c] !== v); return q },
        not: (c: string) => { linhas = linhas.filter((l) => l[c] != null); return q },
        in: (c: string, vs: unknown[]) => { filtros.push(`in:${c}`); linhas = linhas.filter((l) => vs.includes(l[c])); return q },
        gte: (c: string, v: string) => { filtros.push(`gte:${c}:${v}`); linhas = linhas.filter((l) => String(l[c]) >= v); return q },
        lt: (c: string, v: string) => { filtros.push(`lt:${c}:${v}`); linhas = linhas.filter((l) => String(l[c]) < v); return q },
        or: (expr: string) => { filtros.push(`or:${expr}`); return q },
        order: () => q,
        limit: (n: number) => { limite = n; return q },
        maybeSingle: async () => ({ data: linhas[0] ?? null, error: null }),
        then: (ok: (r: { data: Linha[]; error: null }) => unknown) => ok({ data: linhas.slice(0, limite), error: null }),
      }
      return q
    },
  }
  return { admin: admin as unknown as SupabaseClient, chamadas }
}

const campanhaAtiva = {
  id: 'camp-1', nome: 'PROSPECÇÃO', tipo: 'prospeccao', status: 'ativa', dry_run: false,
  workflow_id: WF, publico: { selecao: { modo: 'filtros', criterio: 'estagios', estagios: ['novo', 'novos_leads'] } },
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.buscarCampanha.mockResolvedValue(campanhaAtiva)
  mocks.buscarWorkflow.mockResolvedValue({ id: WF, status: 'publicado', versao_atual_id: 'v1' })
  mocks.transferirLeadImportadoParaMotor.mockResolvedValue(true)
  mocks.inscreverLeadManual.mockImplementation(async (_s, _w, leadId: string) => ({ jaInscrito: false, execucaoId: `ex-${leadId}` }))
})

describe('normalizarFiltrosAdicao', () => {
  it('expande estágios equivalentes, descarta valores desconhecidos e sanitiza a busca', () => {
    const f = normalizarFiltrosAdicao({
      estagios: ['novos_leads', 'inexistente'], responsavelId: 'x', busca: 'acme,(x)%', cadastradoDe: '2026-13-40',
    })
    expect(f.estagios?.sort()).toEqual(['novo', 'novos_leads'])
    expect(f.responsavelId).toBeUndefined()
    expect(f.busca).toBe('acme  x')
    expect(f.cadastradoDe).toBeUndefined()
  })
})

describe('buscarCandidatosAdicao', () => {
  it('oculta quem já está na campanha e explica quem não pode entrar', async () => {
    const { admin } = criarAdmin({
      leads: [
        lead(1),
        lead(2),
        lead(3, { optout: true }),
        lead(4, { contato_email: 'invalido' }),
        lead(5),
        lead(6),
        lead(7, { organizacao_id: OUTRA_ORG }),
      ],
      workflow_execucoes: [
        { organizacao_id: ORG, lead_id: id(2), workflow_id: WF, status: 'concluida' },
        { organizacao_id: ORG, lead_id: id(5), workflow_id: 'outro', status: 'em_andamento' },
        { organizacao_id: ORG, lead_id: id(6), workflow_id: 'outro', status: 'concluida' },
      ],
    })
    const previa = await buscarCandidatosAdicao(admin, ORG, 'camp-1', normalizarFiltrosAdicao({ estagios: ['novos_leads'] }), true)

    expect(previa.encontrados).toBe(6)
    expect(previa.jaNaCampanha).toBe(1)
    expect(previa.elegiveis).toBe(2)
    const porId = Object.fromEntries(previa.candidatos.map((c) => [c.id, c]))
    expect(porId[id(1)].elegivel).toBe(true)
    expect(porId[id(2)]).toBeUndefined()
    expect(porId[id(3)].motivo).toBe('bloqueado')
    expect(porId[id(4)].motivo).toBe('sem_email')
    expect(porId[id(5)].motivo).toBe('incompativel')
    expect(porId[id(6)].elegivel).toBe(true)
    expect(porId[id(7)]).toBeUndefined()
  })

  it('aplica organização, responsável e intervalo UTC meio-aberto na consulta', async () => {
    const resp = '33333333-3333-4333-8333-333333333333'
    const { admin, chamadas } = criarAdmin({
      leads: [lead(1)],
      usuarios: [{ id: resp, nome: 'Aline', organizacao_id: ORG }],
    })
    await buscarCandidatosAdicao(admin, ORG, 'camp-1', normalizarFiltrosAdicao({
      responsavelId: resp, cadastradoDe: '2026-10-01', cadastradoAte: '2026-10-09',
    }), true)
    const consultaLeads = chamadas.find((c) => c.tabela === 'leads')!
    expect(consultaLeads.filtros).toEqual(expect.arrayContaining([
      'eq:organizacao_id',
      `or:responsavel_id.eq.${resp},responsavel_nome.ilike.Aline%`,
      'gte:created_at:2026-10-01T00:00:00.000Z',
      'lt:created_at:2026-10-10T00:00:00.000Z',
    ]))
  })

  it.each([
    ['em ensaio', { dry_run: true }],
    ['pausada', { status: 'pausada' }],
    ['de renovação', { tipo: 'renovacao' }],
  ])('recusa campanha %s', async (_rotulo, patch) => {
    mocks.buscarCampanha.mockResolvedValue({ ...campanhaAtiva, ...patch })
    const { admin } = criarAdmin({ leads: [lead(1)] })
    await expect(buscarCandidatosAdicao(admin, ORG, 'camp-1', {}, true)).rejects.toThrow()
  })
})

describe('adicionarLeadsCampanha', () => {
  it('inscreve só os elegíveis da própria organização e ignora IDs de outra', async () => {
    const { admin } = criarAdmin({
      leads: [lead(1), lead(2, { bounced: true }), lead(9, { organizacao_id: OUTRA_ORG })],
      workflow_execucoes: [],
    })
    const r = await adicionarLeadsCampanha(admin, ORG, 'camp-1', [id(1), id(2), id(9)], 1, true)

    expect(r).toMatchObject({ inscritos: 1, ja_inscritos: 0, falhas: 0, publico: 1, execucoes_criadas: [`ex-${id(1)}`] })
    expect(mocks.inscreverLeadManual).toHaveBeenCalledTimes(1)
    expect(mocks.inscreverLeadManual).toHaveBeenCalledWith(expect.anything(), WF, id(1), 'camp-1')
    expect(mocks.exigirEnvioRealCampanhaDisponivel).toHaveBeenCalled()
    expect(mocks.exigirAvisoRetornoPronto).toHaveBeenCalledWith(admin, ORG, expect.anything(), [id(1)])
  })

  it('exige a quantidade exata e não inscreve ninguém se divergir', async () => {
    const { admin } = criarAdmin({ leads: [lead(1), lead(2)], workflow_execucoes: [] })
    await expect(adicionarLeadsCampanha(admin, ORG, 'camp-1', [id(1), id(2)], 3, true))
      .rejects.toThrow('Confirme explicitamente a quantidade atual de 2 contatos.')
    expect(mocks.inscreverLeadManual).not.toHaveBeenCalled()
    expect(mocks.transferirLeadImportadoParaMotor).not.toHaveBeenCalled()
  })

  it('não reinscreve quem já passou pela campanha', async () => {
    const { admin } = criarAdmin({
      leads: [lead(1)],
      workflow_execucoes: [{ organizacao_id: ORG, lead_id: id(1), workflow_id: WF, status: 'em_andamento' }],
    })
    await expect(adicionarLeadsCampanha(admin, ORG, 'camp-1', [id(1)], 1, true))
      .rejects.toThrow('Nenhum dos contatos selecionados está elegível.')
    expect(mocks.inscreverLeadManual).not.toHaveBeenCalled()
  })

  it('exige workflow publicado', async () => {
    mocks.buscarWorkflow.mockResolvedValue({ id: WF, status: 'pausado', versao_atual_id: 'v1' })
    const { admin } = criarAdmin({ leads: [lead(1)], workflow_execucoes: [] })
    await expect(adicionarLeadsCampanha(admin, ORG, 'camp-1', [id(1)], 1, true)).rejects.toThrow('publicado')
    expect(mocks.inscreverLeadManual).not.toHaveBeenCalled()
  })

  it('devolve o lead para fora do motor quando a inscrição dele falha e segue com os demais', async () => {
    mocks.inscreverLeadManual.mockImplementation(async (_s, _w, leadId: string) => {
      if (leadId === id(1)) throw new Error('falhou')
      return { jaInscrito: false, execucaoId: `ex-${leadId}` }
    })
    const { admin } = criarAdmin({ leads: [lead(1), lead(2)], workflow_execucoes: [] })
    const r = await adicionarLeadsCampanha(admin, ORG, 'camp-1', [id(1), id(2)], 2, true)
    expect(r).toMatchObject({ inscritos: 1, falhas: 1 })
    expect(mocks.restaurarLeadImportadoForaDoMotor).toHaveBeenCalledWith(admin, ORG, id(1))
  })

  it('recusa campanha de prospecção para quem só pode comunicado', async () => {
    const { admin } = criarAdmin({ leads: [lead(1)], workflow_execucoes: [] })
    await expect(adicionarLeadsCampanha(admin, ORG, 'camp-1', [id(1)], 1, false)).rejects.toThrow('comunicado')
  })
})
