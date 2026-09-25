import { describe, expect, it } from 'vitest'
import {
  PESQUISAS_LIMITES,
  mesclarWorkspaceConfig,
  parseWorkspaceConfig,
  type PesquisaSalva,
} from '@/lib/config/workspaceConfig'
import { adicionarPesquisa, nomeSugerido, removerPesquisa, renomearPesquisa, resumoPesquisa } from '@/lib/prospeccao/pesquisas'

const AGORA = '2026-09-24T12:00:00.000Z'
const FILTROS = { cnaes: ['5510801'], ufs: ['SP'], portes: ['micro'] }

function pesquisa(id: string, nome: string): PesquisaSalva {
  return { id, nome, filtros: { cnaes: ['5510801'] }, quantidade: null, criadaEm: AGORA }
}

describe('config: prospeccaoPesquisas', () => {
  it('lê só pesquisas válidas, sem duplicar id, e respeita o limite', () => {
    const r = parseWorkspaceConfig({
      prospeccaoPesquisas: [
        { id: 'a', nome: '  Hotéis SP ', filtros: { ...FILTROS, soComEmail: true, lixo: 1 }, quantidade: 40, criadaEm: AGORA },
        { id: 'a', nome: 'duplicado', filtros: FILTROS },
        { id: 'b', nome: 'sem atividade', filtros: { ufs: ['SP'] } },
        { id: 'c', nome: '', filtros: FILTROS },
        { id: 'd', nome: 'quantidade inválida', filtros: FILTROS, quantidade: 9999 },
        'lixo',
      ],
    })
    expect(r.prospeccaoPesquisas).toEqual([
      { id: 'a', nome: 'Hotéis SP', filtros: { cnaes: ['5510801'], ufs: ['SP'], portes: ['micro'], soComEmail: true }, quantidade: 40, criadaEm: AGORA },
      { id: 'd', nome: 'quantidade inválida', filtros: FILTROS, quantidade: null, criadaEm: '' },
    ])
    const muitas = Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, nome: `P${i}`, filtros: FILTROS }))
    expect(parseWorkspaceConfig({ prospeccaoPesquisas: muitas }).prospeccaoPesquisas).toHaveLength(PESQUISAS_LIMITES.total)
  })

  it('limpar o perfil não apaga as pesquisas; lista vazia limpa a chave', () => {
    const atual = parseWorkspaceConfig({ prospeccao: FILTROS, prospeccaoPesquisas: [pesquisa('a', 'A')] })
    const semPerfil = mesclarWorkspaceConfig(atual, { prospeccao: null })
    expect(semPerfil.prospeccao).toBeUndefined()
    expect(semPerfil.prospeccaoPesquisas).toHaveLength(1)
    expect(mesclarWorkspaceConfig(atual, { prospeccaoPesquisas: [] }).prospeccaoPesquisas).toBeUndefined()
  })
})

describe('operações das pesquisas salvas', () => {
  it('adiciona com nome limpo e quantidade', () => {
    const r = adicionarPesquisa([], { nome: '  Hotéis   SP ', filtros: FILTROS, quantidade: 40 }, 'id1', AGORA)
    expect(r).toEqual({ ok: true, lista: [{ id: 'id1', nome: 'Hotéis SP', filtros: FILTROS, quantidade: 40, criadaEm: AGORA }] })
  })

  it('recusa nome vazio/longo, sem atividade, quantidade inválida, nome repetido e acima do limite', () => {
    expect(adicionarPesquisa([], { nome: ' ', filtros: FILTROS }, 'x', AGORA)).toMatchObject({ ok: false, status: 400 })
    expect(adicionarPesquisa([], { nome: 'a'.repeat(61), filtros: FILTROS }, 'x', AGORA)).toMatchObject({ ok: false, status: 400 })
    expect(adicionarPesquisa([], { nome: 'A', filtros: { ufs: ['SP'] } }, 'x', AGORA)).toMatchObject({ ok: false, status: 400 })
    expect(adicionarPesquisa([], { nome: 'A', filtros: FILTROS, quantidade: 0 }, 'x', AGORA)).toMatchObject({ ok: false, status: 400 })
    expect(adicionarPesquisa([pesquisa('a', 'Hotéis')], { nome: 'HOTÉIS', filtros: FILTROS }, 'x', AGORA)).toMatchObject({ ok: false, status: 409 })
    const cheia = Array.from({ length: PESQUISAS_LIMITES.total }, (_, i) => pesquisa(`p${i}`, `P${i}`))
    expect(adicionarPesquisa(cheia, { nome: 'Nova', filtros: FILTROS }, 'x', AGORA)).toMatchObject({ ok: false, status: 409 })
  })

  it('renomeia e remove pelo id; id desconhecido é 404', () => {
    const lista = [pesquisa('a', 'A'), pesquisa('b', 'B')]
    expect(renomearPesquisa(lista, 'a', 'Novo')).toMatchObject({ ok: true, lista: [{ id: 'a', nome: 'Novo' }, { id: 'b', nome: 'B' }] })
    expect(renomearPesquisa(lista, 'a', 'b')).toMatchObject({ ok: false, status: 409 })
    expect(renomearPesquisa(lista, 'a', 'A')).toMatchObject({ ok: true })
    expect(renomearPesquisa(lista, 'z', 'X')).toMatchObject({ ok: false, status: 404 })
    expect(removerPesquisa(lista, 'a')).toEqual({ ok: true, lista: [lista[1]] })
    expect(removerPesquisa(lista, 'z')).toMatchObject({ ok: false, status: 404 })
  })

  it('sugere nome e resume a pesquisa', () => {
    expect(nomeSugerido({ cnaes: ['5510801', '5510802'], ufs: ['SP'], portes: ['micro'] }, 40)).toBe('Hotelaria SP | Microempresa | 40 empresas')
    expect(nomeSugerido({ cnaes: ['5510801', '9601701'] }, null)).toBe('2 nichos Brasil')
    expect(resumoPesquisa({ ...pesquisa('a', 'A'), filtros: { cnaes: ['5510801'], ufs: ['SP'] }, quantidade: 40 }))
      .toBe('1 atividade · São Paulo · até 40 empresas')
  })

  it('cita os municípios quando a pesquisa se restringe a eles', () => {
    expect(nomeSugerido({ cnaes: ['5510801'], ufs: ['SP'], municipios: ['7107', '6291'] }, null)).toBe('Hotelaria SP (2 cidades)')
    expect(resumoPesquisa({ ...pesquisa('a', 'A'), filtros: { cnaes: ['5510801'], ufs: ['SP'], municipios: ['7107'] }, quantidade: null }))
      .toBe('1 atividade · São Paulo · 1 município · sem limite')
  })
})
