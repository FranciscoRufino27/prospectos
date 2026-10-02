import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { aberturaAte, filtrosDoPerfil, normalizarFiltros, paramsExtras, temFiltrosExtras } from '@/lib/prospeccao/filtros'
import { buscarProspeccao } from '@/lib/prospeccao/buscaServidor'

const perfil = { cnaes: ['5510801'] } as Parameters<typeof filtrosDoPerfil>[0]

describe('filtros de tempo de empresa, capital e telefone (0058)', () => {
  it('perfil começa sem nenhum filtro extra', () => {
    const f = filtrosDoPerfil(perfil)
    expect([f.anosMinimos, f.capitalMinimo, f.telefone]).toEqual([null, null, ''])
    expect(temFiltrosExtras(f)).toBe(false)
  })

  it('aceita só as opções oferecidas na tela', () => {
    const f = normalizarFiltros({ anosMinimos: 5, capitalMinimo: 100_000, telefone: 'celular' }, perfil)
    expect([f.anosMinimos, f.capitalMinimo, f.telefone]).toEqual([5, 100_000, 'celular'])
    expect(temFiltrosExtras(f)).toBe(true)
    const invalido = normalizarFiltros({ anosMinimos: 7, capitalMinimo: '100000', telefone: 'fixo' }, perfil)
    expect([invalido.anosMinimos, invalido.capitalMinimo, invalido.telefone]).toEqual([null, null, ''])
  })

  it('"há mais de N anos" vira data limite em UTC', () => {
    expect(aberturaAte(5, new Date('2026-10-01T02:00:00Z'))).toBe('2021-10-01')
    expect(paramsExtras({ ...filtrosDoPerfil(perfil), anosMinimos: 1, telefone: 'com' }, new Date('2026-10-01T12:00:00Z')))
      .toEqual({ p_abertura_ate: '2025-10-01', p_capital_min: null, p_telefone: 'com' })
  })
})

function adminFake() {
  const rpc = vi.fn(async (nome: string, _params: object) => ({ data: nome.startsWith('prospeccao_contar') ? 0 : [], error: null }))
  const consulta = {
    select: () => consulta, eq: () => consulta, order: () => consulta, limit: () => consulta,
    maybeSingle: async () => ({ data: null, error: null }),
  }
  return { admin: { rpc, from: vi.fn(() => consulta) } as unknown as SupabaseClient, rpc }
}

describe('buscarProspeccao escolhe a RPC pelos filtros extras', () => {
  it('sem filtro extra usa as RPCs antigas, sem parâmetros novos', async () => {
    const { admin, rpc } = adminFake()
    await buscarProspeccao(admin, 'org-a', filtrosDoPerfil(perfil), null, { contar: true })
    const nomes = rpc.mock.calls.map((c) => c[0])
    expect(nomes).toEqual(expect.arrayContaining(['prospeccao_buscar_por_nota', 'prospeccao_contar']))
    expect(rpc.mock.calls.every((c) => !('p_telefone' in c[1]))).toBe(true)
  })

  it('com filtro extra usa as _v2 com a org da sessão e os parâmetros novos', async () => {
    const { admin, rpc } = adminFake()
    await buscarProspeccao(admin, 'org-a', { ...filtrosDoPerfil(perfil), capitalMinimo: 50_000 }, null, { contar: true })
    expect(rpc).toHaveBeenCalledWith('prospeccao_buscar_por_nota_v2', expect.objectContaining({ p_org: 'org-a', p_capital_min: 50_000, p_telefone: '' }))
    expect(rpc).toHaveBeenCalledWith('prospeccao_contar_v2', expect.objectContaining({ p_org: 'org-a', p_capital_min: 50_000 }))
  })
})

describe('filtrosEspecificos (busca de uma empresa, independente do perfil)', () => {
  it('abre tudo menos o texto: todas as atividades do catálogo, inclusive secundária', async () => {
    const { filtrosEspecificos } = await import('@/lib/prospeccao/filtros')
    const f = filtrosEspecificos('  Pousada São João ', ['5510801', '5590601', 'x'])!
    expect(f).toMatchObject({
      cnaes: ['5510801', '5590601'], incluirCnaesSecundarios: true, ufs: [], municipios: [], portes: [],
      excluirMei: false, soComEmail: false, texto: 'Pousada Sao Joao', anosMinimos: null, capitalMinimo: null, telefone: '',
    })
  })
  it('texto curto demais não busca; CNPJ passa', async () => {
    const { filtrosEspecificos } = await import('@/lib/prospeccao/filtros')
    expect(filtrosEspecificos('a', ['5510801'])).toBeNull()
    expect(filtrosEspecificos('%', ['5510801'])).toBeNull()
    expect(filtrosEspecificos('05.406.438/0001-98', ['5510801'])?.texto).toBe('05.406.438/0001-98')
  })
})
