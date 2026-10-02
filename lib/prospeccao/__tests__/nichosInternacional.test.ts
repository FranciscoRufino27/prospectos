import { describe, expect, it } from 'vitest'
import { nichosInternacionaisDoPerfil, SETORES_DO_NICHO, SETORES_VALIDOS, setoresDosNichos } from '../nichosInternacional'
import { NICHOS } from '../nichos'
import { parseProspeccaoConfig } from '@/lib/config/workspaceConfig'

describe('nichos na busca internacional', () => {
  it('todo nicho do Brasil tem setor equivalente lá fora', () => {
    for (const n of NICHOS) expect(SETORES_DO_NICHO[n.id]?.length, n.id).toBeGreaterThan(0)
  })

  it('perfil por CNAE vira os mesmos nichos, na ordem da aba Brasil; CNAE solto fica de fora', () => {
    const nichos = nichosInternacionaisDoPerfil(['5611201', '5510801', '5510802', '1234567'])
    expect(nichos.map((n) => n.id)).toEqual(['hotelaria', 'restaurantes'])
    expect(nichos[0].setores).toEqual(['Hotels and Motels', 'Hospitality'])
  })

  it('setores sem repetição (buffets e eventos dividem Events Services)', () => {
    const setores = setoresDosNichos(nichosInternacionaisDoPerfil(['5620102', '8230001']))
    expect(setores.filter((x) => x === 'Events Services')).toHaveLength(1)
    expect(setores.every((x) => SETORES_VALIDOS.has(x))).toBe(true)
  })
})

describe('perfil de busca: países da busca internacional', () => {
  it('guarda só países da lista, sem repetir', () => {
    expect(parseProspeccaoConfig({ cnaes: ['5510801'], paises: ['PRT', 'ESP', 'XXX', 'PRT', 3] })?.paises).toEqual(['PRT', 'ESP'])
  })
  it('sem país válido o campo nem aparece', () => {
    expect(parseProspeccaoConfig({ cnaes: ['5510801'], paises: ['XXX'] })).toEqual({ cnaes: ['5510801'] })
  })
})
