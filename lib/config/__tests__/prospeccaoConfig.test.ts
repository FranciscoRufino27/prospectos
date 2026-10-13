import { describe, expect, it } from 'vitest'
import {
  PROSPECCAO_LIMITES,
  WORKSPACE_CONFIG_SCHEMA_VERSION,
  mesclarWorkspaceConfig,
  parseWorkspaceConfig,
} from '../workspaceConfig'

describe('workspaceConfig.prospeccao (perfil de busca)', () => {
  it('blob v4 sem perfil migra para a versão atual sem inventar perfil', () => {
    const r = parseWorkspaceConfig({ _schema_version: 4, roi: { custoMensal: 10 } })
    expect(r._schema_version).toBe(WORKSPACE_CONFIG_SCHEMA_VERSION)
    expect(WORKSPACE_CONFIG_SCHEMA_VERSION).toBe(10)
    expect(r.prospeccao).toBeUndefined()
    expect(r.roi).toEqual({ custoMensal: 10 })
  })

  it('aceita só valores válidos e deduplica', () => {
    const r = parseWorkspaceConfig({
      prospeccao: {
        cnaes: ['5510801', '5510801', '5510-8/02', 123, ' 5510802 '],
        ufs: ['SP', 'XX', 'sp', 'RJ'],
        municipios: ['7107', 'abc'],
        portes: ['micro', 'gigante'],
        faixasFuncionarios: ['11-50', '11-50', 'desconhecida'],
        cargosAlvo: ['proprietario', 'owner'],
        areasAlvo: ['ti', 'vendas'],
        excluirMei: true,
        incluirCnaesSecundarios: 'sim',
        campoDesconhecido: 1,
      },
    })
    expect(r.prospeccao).toEqual({
      cnaes: ['5510801', '5510802'],
      ufs: ['SP', 'RJ'],
      municipios: ['7107'],
      portes: ['micro'],
      faixasFuncionarios: ['11-50'],
      cargosAlvo: ['proprietario'],
      areasAlvo: ['ti'],
      excluirMei: true,
    })
  })

  it('porte de corte do decisor aceita só pequeno/demais', () => {
    expect(parseWorkspaceConfig({ prospeccao: { cnaes: ['5510801'], porteOutroDecisor: 'demais' } }).prospeccao?.porteOutroDecisor).toBe('demais')
    expect(parseWorkspaceConfig({ prospeccao: { cnaes: ['5510801'], porteOutroDecisor: 'micro' } }).prospeccao?.porteOutroDecisor).toBeUndefined()
    expect(parseWorkspaceConfig({ prospeccao: { cnaes: ['5510801'], porteOutroDecisor: 3 } }).prospeccao?.porteOutroDecisor).toBeUndefined()
  })

  it('perfil sem nenhum valor válido some do blob', () => {
    expect(parseWorkspaceConfig({ prospeccao: { cnaes: ['x'], ufs: [] } }).prospeccao).toBeUndefined()
    expect(parseWorkspaceConfig({ prospeccao: 'SP' }).prospeccao).toBeUndefined()
  })

  it('limita a quantidade de CNAEs', () => {
    const cnaes = Array.from({ length: 30 }, (_, i) => String(1000000 + i))
    expect(parseWorkspaceConfig({ prospeccao: { cnaes } }).prospeccao?.cnaes).toHaveLength(PROSPECCAO_LIMITES.cnaes)
  })

  it('mescla substitui o perfil inteiro, null limpa e ausente não toca', () => {
    const base = parseWorkspaceConfig({ comercial: { grupoWhatsappId: 'g' } })
    const comPerfil = mesclarWorkspaceConfig(base, { prospeccao: { cnaes: ['5510801'], ufs: ['SP'] } })
    expect(comPerfil.prospeccao).toEqual({ cnaes: ['5510801'], ufs: ['SP'] })
    expect(comPerfil.comercial).toEqual({ grupoWhatsappId: 'g' })

    const trocado = mesclarWorkspaceConfig(comPerfil, { prospeccao: { cnaes: ['5510802'] } })
    expect(trocado.prospeccao).toEqual({ cnaes: ['5510802'] })

    expect(mesclarWorkspaceConfig(trocado, {}).prospeccao).toEqual({ cnaes: ['5510802'] })
    expect(mesclarWorkspaceConfig(trocado, { prospeccao: null }).prospeccao).toBeUndefined()
  })
})

describe('workspaceConfig.prospeccaoNichos (nichos da organização)', () => {
  const nicho = (id: string, nome: string, cnaes: string[]) => ({ id, nome, cnaes, criadoEm: '2026-10-13T00:00:00Z' })

  it('blob v9 migra sem inventar nichos', () => {
    const r = parseWorkspaceConfig({ _schema_version: 9, prospeccao: { cnaes: ['5510801'] } })
    expect(r._schema_version).toBe(10)
    expect(r.prospeccaoNichos).toBeUndefined()
  })

  it('descarta nicho sem nome, sem CNAE válido, id ou nome repetido', () => {
    const r = parseWorkspaceConfig({
      prospeccaoNichos: [
        nicho('a', ' Academias ', ['9313100', 'xx', '9313100']),
        nicho('b', '', ['8630504']),
        nicho('c', 'Sem atividade', ['123']),
        nicho('a', 'Id repetido', ['8630504']),
        nicho('d', 'ACADEMIAS', ['8630504']),
      ],
    })
    expect(r.prospeccaoNichos).toEqual([nicho('a', 'Academias', ['9313100'])])
  })

  it('uma atividade fica em um só nicho (o primeiro que a usou)', () => {
    const r = parseWorkspaceConfig({
      prospeccaoNichos: [nicho('a', 'Academias', ['9313100']), nicho('b', 'Esportes', ['9313100', '9319101'])],
    })
    expect(r.prospeccaoNichos?.map((n) => n.cnaes)).toEqual([['9313100'], ['9319101']])
  })

  it('mescla substitui a lista, null limpa e não toca no perfil', () => {
    const base = parseWorkspaceConfig({ prospeccao: { cnaes: ['5510801'] } })
    const com = mesclarWorkspaceConfig(base, { prospeccaoNichos: [nicho('a', 'Academias', ['9313100'])] })
    expect(com.prospeccaoNichos).toHaveLength(1)
    expect(com.prospeccao).toEqual({ cnaes: ['5510801'] })
    expect(mesclarWorkspaceConfig(com, { prospeccaoNichos: null }).prospeccaoNichos).toBeUndefined()
  })
})
