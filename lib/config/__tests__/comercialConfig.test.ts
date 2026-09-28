import { describe, it, expect } from 'vitest'
import { WORKSPACE_CONFIG_SCHEMA_VERSION, mesclarWorkspaceConfig, parseWorkspaceConfig } from '../workspaceConfig'

// Grupo de avisos do handoff comercial (Fase 2) no blob por organização.
describe('workspaceConfig.comercial', () => {
  it('lê o grupo quando é string não vazia; descarta tipo errado/vazio', () => {
    expect(parseWorkspaceConfig({ comercial: { grupoWhatsappId: ' 120363019502650977-group ' } }).comercial)
      .toEqual({ grupoWhatsappId: '120363019502650977-group' })
    expect(parseWorkspaceConfig({ comercial: { grupoWhatsappId: '' } }).comercial).toBeUndefined()
    expect(parseWorkspaceConfig({ comercial: { grupoWhatsappId: 123 } }).comercial).toBeUndefined()
    expect(parseWorkspaceConfig({ comercial: 'x' }).comercial).toBeUndefined()
  })

  it('blob antigo (v3) migra para v4 preservando o resto', () => {
    const r = parseWorkspaceConfig({ _schema_version: 3, roi: { custoMensal: 10 } })
    expect(r._schema_version).toBe(WORKSPACE_CONFIG_SCHEMA_VERSION)
    expect(r.roi).toEqual({ custoMensal: 10 })
    expect(r.comercial).toBeUndefined()
  })

  it('mesclar define, preserva quando ausente e limpa com null/vazio', () => {
    const base = parseWorkspaceConfig({ roi: { custoMensal: 5 } })
    const definido = mesclarWorkspaceConfig(base, { comercialGrupoWhatsappId: '120363019502650977-group' })
    expect(definido.comercial).toEqual({ grupoWhatsappId: '120363019502650977-group' })
    expect(definido.roi).toEqual({ custoMensal: 5 })
    expect(mesclarWorkspaceConfig(definido, { roiCustoMensal: 7 }).comercial).toEqual({ grupoWhatsappId: '120363019502650977-group' })
    expect(mesclarWorkspaceConfig(definido, { comercialGrupoWhatsappId: null }).comercial).toBeUndefined()
    expect(mesclarWorkspaceConfig(definido, { comercialGrupoWhatsappId: '  ' }).comercial).toBeUndefined()
  })
})

// Fase 3: janela do check-in (minutos), padrão 7 dias.
import { HANDOFF_REVISAO_MINUTOS_PADRAO, handoffRevisaoMinutosEfetivo } from '../workspaceConfig'

describe('workspaceConfig.comercial.handoffRevisaoMinutos', () => {
  it('ausente/inválido → 7 dias; inteiro positivo → valor da org', () => {
    expect(HANDOFF_REVISAO_MINUTOS_PADRAO).toBe(10080)
    expect(handoffRevisaoMinutosEfetivo(parseWorkspaceConfig({}))).toBe(10080)
    expect(handoffRevisaoMinutosEfetivo(parseWorkspaceConfig({ comercial: { handoffRevisaoMinutos: 5 } }))).toBe(5)
    expect(handoffRevisaoMinutosEfetivo(parseWorkspaceConfig({ comercial: { handoffRevisaoMinutos: 0 } }))).toBe(10080)
    expect(handoffRevisaoMinutosEfetivo(parseWorkspaceConfig({ comercial: { handoffRevisaoMinutos: -3 } }))).toBe(10080)
    expect(handoffRevisaoMinutosEfetivo(parseWorkspaceConfig({ comercial: { handoffRevisaoMinutos: 2.5 } }))).toBe(10080)
    expect(handoffRevisaoMinutosEfetivo(parseWorkspaceConfig({ comercial: { handoffRevisaoMinutos: '5' } }))).toBe(10080)
    expect(handoffRevisaoMinutosEfetivo(null)).toBe(10080)
  })

  it('mesclar define a janela sem perder o grupo, e null volta ao padrão', () => {
    const base = mesclarWorkspaceConfig(parseWorkspaceConfig({}), { comercialGrupoWhatsappId: '120363019502650977-group' })
    const comJanela = mesclarWorkspaceConfig(base, { comercialHandoffRevisaoMinutos: 5 })
    expect(comJanela.comercial).toEqual({ grupoWhatsappId: '120363019502650977-group', handoffRevisaoMinutos: 5 })
    // Salvar os dois juntos (tela) preserva ambos.
    const juntos = mesclarWorkspaceConfig(base, { comercialGrupoWhatsappId: '120363019502650977-group', comercialHandoffRevisaoMinutos: 5 })
    expect(juntos.comercial).toEqual({ grupoWhatsappId: '120363019502650977-group', handoffRevisaoMinutos: 5 })
    const limpo = mesclarWorkspaceConfig(comJanela, { comercialHandoffRevisaoMinutos: null })
    expect(limpo.comercial).toEqual({ grupoWhatsappId: '120363019502650977-group' })
    expect(handoffRevisaoMinutosEfetivo(limpo)).toBe(10080)
    // Outra org (outro blob) não é afetada: o valor vive no blob de cada uma.
    expect(handoffRevisaoMinutosEfetivo(parseWorkspaceConfig({}))).toBe(10080)
  })
})

// Fase 4: campanha de follow-up de retorno.
describe('workspaceConfig.comercial.campanhaRetornoId', () => {
  it('lê/define/limpa sem perder grupo e janela', () => {
    expect(parseWorkspaceConfig({ comercial: { campanhaRetornoId: ' camp-1 ' } }).comercial).toEqual({ campanhaRetornoId: 'camp-1' })
    expect(parseWorkspaceConfig({ comercial: { campanhaRetornoId: 7 } }).comercial).toBeUndefined()
    const base = mesclarWorkspaceConfig(parseWorkspaceConfig({}), { comercialGrupoWhatsappId: '120363019502650977-group', comercialHandoffRevisaoMinutos: 5 })
    const com = mesclarWorkspaceConfig(base, { comercialCampanhaRetornoId: 'camp-1' })
    expect(com.comercial).toEqual({ grupoWhatsappId: '120363019502650977-group', handoffRevisaoMinutos: 5, campanhaRetornoId: 'camp-1' })
    // Salvar os três juntos (tela) preserva todos.
    const juntos = mesclarWorkspaceConfig(parseWorkspaceConfig({}), { comercialGrupoWhatsappId: '120363019502650977-group', comercialHandoffRevisaoMinutos: 5, comercialCampanhaRetornoId: 'camp-1' })
    expect(juntos.comercial).toEqual(com.comercial)
    expect(mesclarWorkspaceConfig(com, { comercialCampanhaRetornoId: null }).comercial).toEqual({ grupoWhatsappId: '120363019502650977-group', handoffRevisaoMinutos: 5 })
  })
})

// Chave-mestra do rodízio: DESLIGADA por padrão (a distribuição é por carteira
// do lead). Só `true` explícito, gravado pela tela, reativa.
import { rodizioHandoffAtivo } from '../workspaceConfig'

describe('workspaceConfig.comercial.rodizioHandoff', () => {
  it('ausente/inválido → desligado; só o booleano true liga', () => {
    expect(rodizioHandoffAtivo(parseWorkspaceConfig({}))).toBe(false)
    expect(rodizioHandoffAtivo(null)).toBe(false)
    expect(rodizioHandoffAtivo(parseWorkspaceConfig({ comercial: { rodizioHandoff: 'true' } }))).toBe(false)
    expect(rodizioHandoffAtivo(parseWorkspaceConfig({ comercial: { rodizioHandoff: 1 } }))).toBe(false)
    expect(rodizioHandoffAtivo(parseWorkspaceConfig({ comercial: { rodizioHandoff: false } }))).toBe(false)
    expect(rodizioHandoffAtivo(parseWorkspaceConfig({ comercial: { rodizioHandoff: true } }))).toBe(true)
  })

  it('org com participantes e grupo configurados continua desligada até religar', () => {
    // Estado real da Laudo de Brinquedos antes desta mudança: grupo salvo e
    // gente marcada no rodízio, mas sem a chave nova no blob.
    const legado = parseWorkspaceConfig({ comercial: { grupoWhatsappId: '120363019502650977-group' } })
    expect(rodizioHandoffAtivo(legado)).toBe(false)

    const ligado = mesclarWorkspaceConfig(legado, { comercialRodizioHandoff: true })
    expect(ligado.comercial).toEqual({ grupoWhatsappId: '120363019502650977-group', rodizioHandoff: true })
    expect(rodizioHandoffAtivo(ligado)).toBe(true)

    // Desligar remove a chave (o blob não guarda o valor padrão) sem perder o grupo.
    const desligado = mesclarWorkspaceConfig(ligado, { comercialRodizioHandoff: false })
    expect(desligado.comercial).toEqual({ grupoWhatsappId: '120363019502650977-group' })
    expect(rodizioHandoffAtivo(desligado)).toBe(false)
    expect(rodizioHandoffAtivo(mesclarWorkspaceConfig(ligado, { comercialRodizioHandoff: null }))).toBe(false)
  })
})

// Aviso de "cliente respondeu" no WhatsApp: DESLIGADO por padrão; só os três
// modos válidos ficam no blob.
import { modoAvisoResposta } from '../workspaceConfig'

describe('workspaceConfig.comercial.avisoResposta', () => {
  it('ausente/inválido → desligado (null); modos válidos são lidos', () => {
    expect(modoAvisoResposta(parseWorkspaceConfig({}))).toBeNull()
    expect(modoAvisoResposta(null)).toBeNull()
    expect(modoAvisoResposta(parseWorkspaceConfig({ comercial: { avisoResposta: 'todos' } }))).toBeNull()
    expect(modoAvisoResposta(parseWorkspaceConfig({ comercial: { avisoResposta: true } }))).toBeNull()
    for (const m of ['responsavel', 'grupo', 'ambos'] as const) {
      expect(modoAvisoResposta(parseWorkspaceConfig({ comercial: { avisoResposta: m } }))).toBe(m)
    }
  })

  it('mesclar liga, troca e desliga sem mexer no resto do comercial', () => {
    const base = parseWorkspaceConfig({ comercial: { grupoWhatsappId: '120363019502650977-group', rodizioHandoff: true } })
    const ligado = mesclarWorkspaceConfig(base, { comercialAvisoResposta: 'ambos' })
    expect(ligado.comercial).toEqual({ grupoWhatsappId: '120363019502650977-group', rodizioHandoff: true, avisoResposta: 'ambos' })
    expect(mesclarWorkspaceConfig(ligado, { comercialAvisoResposta: 'grupo' }).comercial?.avisoResposta).toBe('grupo')
    const desligado = mesclarWorkspaceConfig(ligado, { comercialAvisoResposta: null })
    expect(desligado.comercial).toEqual({ grupoWhatsappId: '120363019502650977-group', rodizioHandoff: true })
    // Valor inválido vindo da API também desliga, nunca grava lixo.
    expect(mesclarWorkspaceConfig(ligado, { comercialAvisoResposta: 'x' as never }).comercial?.avisoResposta).toBeUndefined()
  })
})
