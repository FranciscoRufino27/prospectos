// Travas de custo do enriquecimento pago: configuração por organização,
// orçamento mensal (horário de Brasília) e bloqueio quando não dá para contar.
import { describe, expect, it, vi } from 'vitest'
import { BancoFalso } from '@/lib/templates/__tests__/bancoFalso'
import { mesclarWorkspaceConfig, parseWorkspaceConfig } from '@/lib/config/workspaceConfig'
import { autorizarGasto, inicioDoMesBrasilia, registrarConsumo, travasDaConfig, type ContextoCusto } from '../travasCusto'
import { buscarEmailComCache } from '../inteligencia'

const ORG_A = 'aaaaaaaa-0000-4000-8000-000000000001'
const ORG_B = 'bbbbbbbb-0000-4000-8000-000000000002'
const T0 = Date.UTC(2026, 9, 3, 15) // 03/10/2026 12h em Brasília

const ctx = (banco: BancoFalso, travas: ContextoCusto['travas'], org = ORG_A): ContextoCusto =>
  ({ admin: banco.cliente(), organizacaoId: org, travas, agora: () => T0 })

describe('configuração por organização (organizacoes.configuracoes.enriquecimentoPago)', () => {
  it('ausente = desligado; lê ativo e orçamento por fonte, descartando valor inválido', () => {
    expect(travasDaConfig(parseWorkspaceConfig({}).enriquecimentoPago)).toEqual({ ativo: false, orcamentoMensal: {} })
    const cfg = parseWorkspaceConfig({ enriquecimentoPago: { ativo: true, orcamentoMensal: { crustdata: 12.345, anymail: -1, outra: 9 } } })
    expect(cfg.enriquecimentoPago).toEqual({ ativo: true, orcamentoMensal: { crustdata: 12.35 } })
    expect(parseWorkspaceConfig({ enriquecimentoPago: { ativo: 'sim' } }).enriquecimentoPago).toBeUndefined()
  })

  it('mesclar substitui a seção; null desliga; o resto do blob fica', () => {
    const base = parseWorkspaceConfig({ roi: { custoMensal: 5 } })
    const ligado = mesclarWorkspaceConfig(base, { enriquecimentoPago: { ativo: true, orcamentoMensal: { anymail: 50 } } })
    expect(ligado.enriquecimentoPago).toEqual({ ativo: true, orcamentoMensal: { anymail: 50 } })
    expect(ligado.roi).toEqual({ custoMensal: 5 })
    expect(mesclarWorkspaceConfig(ligado, { enriquecimentoPago: null }).enriquecimentoPago).toBeUndefined()
  })
})

describe('inicioDoMesBrasilia', () => {
  it('meia-noite do dia 1 em Brasília (03:00 UTC), inclusive na virada', () => {
    expect(inicioDoMesBrasilia(T0).toISOString()).toBe('2026-10-01T03:00:00.000Z')
    // 01/10 01h UTC ainda é 30/09 em Brasília → mês de setembro.
    expect(inicioDoMesBrasilia(Date.UTC(2026, 9, 1, 1)).toISOString()).toBe('2026-09-01T03:00:00.000Z')
  })
})

describe('autorizarGasto', () => {
  const ligado = { ativo: true, orcamentoMensal: { crustdata: 10, anymail: 5 } }

  it('desligado ou sem orçamento da fonte → bloqueia com o motivo', async () => {
    const banco = new BancoFalso({})
    expect(await autorizarGasto(ctx(banco, { ativo: false, orcamentoMensal: { anymail: 5 } }), 'anymail', 1)).toMatchObject({ ok: false, motivo: 'pago_desligado' })
    expect(await autorizarGasto(ctx(banco, { ativo: true, orcamentoMensal: { crustdata: 10 } }), 'anymail', 1))
      .toMatchObject({ ok: false, motivo: 'orcamento_esgotado', detalhe: expect.stringMatching(/sem orçamento mensal definido para Anymail/) })
  })

  it('soma só o gasto via API do mês, da própria org e fonte; bloqueia quando a chamada passaria do limite', async () => {
    const banco = new BancoFalso({
      prospeccao_consumo: [
        { organizacao_id: ORG_A, fonte: 'anymail', origem: 'api', custo: 3, criado_em: '2026-10-02T12:00:00Z' },
        { organizacao_id: ORG_A, fonte: 'anymail', origem: 'cache', custo: 0, criado_em: '2026-10-02T12:00:00Z' },
        { organizacao_id: ORG_A, fonte: 'anymail', origem: 'api', custo: 40, criado_em: '2026-09-30T12:00:00Z' }, // setembro
        { organizacao_id: ORG_B, fonte: 'anymail', origem: 'api', custo: 40, criado_em: '2026-10-02T12:00:00Z' }, // outra org
        { organizacao_id: ORG_A, fonte: 'crustdata', origem: 'api', custo: 40, criado_em: '2026-10-02T12:00:00Z' }, // outra fonte
      ],
    })
    expect(await autorizarGasto(ctx(banco, ligado), 'anymail', 1)).toEqual({ ok: true }) // 3 + 1 ≤ 5
    expect(await autorizarGasto(ctx(banco, ligado), 'anymail', 2.5)).toMatchObject({ ok: false, motivo: 'orcamento_esgotado', detalhe: expect.stringMatching(/3 de 5 créditos/) })
  })

  it('não consegue conferir o gasto (função ausente) → bloqueia, não gasta sem contar', async () => {
    const banco = new BancoFalso({})
    banco.falharRpc = true
    expect(await autorizarGasto(ctx(banco, ligado), 'crustdata', 0.65)).toMatchObject({ ok: false, motivo: 'orcamento_esgotado', detalhe: expect.stringMatching(/não foi possível conferir/) })
  })
})

describe('consumo e cache', () => {
  it('cache hit não gera custo e não passa pelas travas (funciona até com o pago desligado)', async () => {
    const banco = new BancoFalso({})
    const api = vi.fn(async () => ({ ok: true as const, resultado: { nome: 'Maria Lima', dominio: 'sol.com', status: 'valido' as const, email: 'maria@sol.com', consultadoEm: 'x' } }))
    // Org A (ligada) paga a consulta.
    await buscarEmailComCache({ admin: banco.cliente(), organizacaoId: ORG_A, agora: () => T0, travas: { ativo: true, orcamentoMensal: { anymail: 5 } } }, 'Maria Lima', 'sol.com', api)
    // Org B (desligada) recebe o fato do cache, sem chamar e sem custo.
    const r = await buscarEmailComCache({ admin: banco.cliente(), organizacaoId: ORG_B, agora: () => T0, travas: { ativo: false, orcamentoMensal: {} } }, 'Maria Lima', 'sol.com', api)
    expect(r).toMatchObject({ ok: true, resultado: { email: 'maria@sol.com' } })
    expect(api).toHaveBeenCalledTimes(1)
    const consumo = banco.linhas('prospeccao_consumo')
    expect(consumo).toEqual([
      expect.objectContaining({ organizacao_id: ORG_A, fonte: 'anymail', origem: 'api', custo: 1, referencia: 'sol.com', pessoa: 'Maria Lima' }),
      expect.objectContaining({ organizacao_id: ORG_B, fonte: 'anymail', origem: 'cache', custo: 0 }),
    ])
  })

  it('sem chave configurada: a fonte não é chamada e nada é registrado como gasto', async () => {
    const banco = new BancoFalso({})
    const semChave = vi.fn(async () => ({ ok: false as const, motivo: 'sem_chave' as const }))
    const r = await buscarEmailComCache({ admin: banco.cliente(), organizacaoId: ORG_A, agora: () => T0, travas: { ativo: true, orcamentoMensal: { anymail: 5 } } }, 'Maria Lima', 'sol.com', semChave)
    expect(r).toEqual({ ok: false, motivo: 'sem_chave' })
    expect(banco.linhas('prospeccao_consumo')).toHaveLength(0)
    expect(banco.linhas('enriquecimento_cache')).toHaveLength(0)
  })

  it('registrarConsumo grava a org da sessão e não derruba a consulta se o banco falhar', async () => {
    const banco = new BancoFalso({})
    await registrarConsumo(ctx(banco, { ativo: true, orcamentoMensal: {} }), { fonte: 'crustdata', operacao: 'pessoas', origem: 'api', resultado: 'ok', custo: 0.26 })
    expect(banco.linhas('prospeccao_consumo')[0]).toMatchObject({ organizacao_id: ORG_A, custo: 0.26 })
    const quebrado = { from: () => { throw new Error('fora do ar') } } as unknown as ContextoCusto['admin']
    await expect(registrarConsumo({ admin: quebrado, organizacaoId: ORG_A, travas: { ativo: true, orcamentoMensal: {} } }, { fonte: 'anymail', operacao: 'email', origem: 'api', resultado: 'ok', custo: 1 })).resolves.toBeUndefined()
  })
})
