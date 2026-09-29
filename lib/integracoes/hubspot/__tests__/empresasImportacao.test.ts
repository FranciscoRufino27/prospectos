import { describe, it, expect } from 'vitest'
import { parseFiltros, montarCorpoBusca, montarLinha, type FiltrosEmpresas } from '../empresasImportacao'

const BASE: FiltrosEmpresas = { busca: '', owner: 'todos', importada: 'todas', contato: 'todos', negocio: 'todos', pagina: 1, tamanho: 25 }
type Corpo = { limit: number; after?: string; query?: string; filterGroups?: Array<{ filters: Array<Record<string, unknown>> }> }
const corpoDe = (r: ReturnType<typeof montarCorpoBusca>): Corpo => {
  if (!r.ok || !('corpo' in r)) throw new Error('esperava corpo')
  return r.corpo as Corpo
}

describe('parseFiltros', () => {
  it('valores inválidos caem no padrão seguro', () => {
    const f = parseFiltros(new URLSearchParams('owner=abc&importada=x&contato=?&negocio=&pagina=-3&tamanho=5000'))
    expect(f).toEqual(BASE)
  })
  it('lê valores válidos e limita a busca a 100 caracteres', () => {
    const f = parseFiltros(new URLSearchParams(`owner=229861376&importada=nao&contato=sem&negocio=com&pagina=3&tamanho=50&busca=${'a'.repeat(150)}`))
    expect(f).toMatchObject({ owner: '229861376', importada: 'nao', contato: 'sem', negocio: 'com', pagina: 3, tamanho: 50 })
    expect(f.busca).toHaveLength(100)
  })
})

describe('montarCorpoBusca — filtros e paginação server-side no HubSpot', () => {
  it('sem filtros: só limit/props/sort, sem filterGroups nem after', () => {
    const c = corpoDe(montarCorpoBusca(BASE, []))
    expect(c.limit).toBe(25)
    expect(c.after).toBeUndefined()
    expect(c.filterGroups).toBeUndefined()
  })

  it('paginação: página 3 de 25 → after 50; busca vira query', () => {
    const c = corpoDe(montarCorpoBusca({ ...BASE, pagina: 3, busca: 'hotel' }, []))
    expect(c.after).toBe('50')
    expect(c.query).toBe('hotel')
  })

  it('comercial específico → EQ hubspot_owner_id; "sem" → NOT_HAS_PROPERTY', () => {
    expect(corpoDe(montarCorpoBusca({ ...BASE, owner: '229861376' }, [])).filterGroups)
      .toEqual([{ filters: [{ propertyName: 'hubspot_owner_id', operator: 'EQ', value: '229861376' }] }])
    expect(corpoDe(montarCorpoBusca({ ...BASE, owner: 'sem' }, [])).filterGroups)
      .toEqual([{ filters: [{ propertyName: 'hubspot_owner_id', operator: 'NOT_HAS_PROPERTY' }] }])
  })

  it('"sem contato" cobre 0 E propriedade ausente (2 grupos OR), repetindo os filtros base', () => {
    const g = corpoDe(montarCorpoBusca({ ...BASE, owner: '1', contato: 'sem' }, [])).filterGroups!
    expect(g).toHaveLength(2)
    for (const grupo of g) expect(grupo.filters[0]).toEqual({ propertyName: 'hubspot_owner_id', operator: 'EQ', value: '1' })
    expect(g[0].filters[1]).toEqual({ propertyName: 'num_associated_contacts', operator: 'EQ', value: '0' })
    expect(g[1].filters[1]).toEqual({ propertyName: 'num_associated_contacts', operator: 'NOT_HAS_PROPERTY' })
  })

  it('"sem contato" + "sem negócio" → 4 grupos (dentro do limite de 5 do HubSpot)', () => {
    expect(corpoDe(montarCorpoBusca({ ...BASE, contato: 'sem', negocio: 'sem' }, [])).filterGroups).toHaveLength(4)
  })

  it('"com negócio" → GT 0', () => {
    expect(corpoDe(montarCorpoBusca({ ...BASE, negocio: 'com' }, [])).filterGroups)
      .toEqual([{ filters: [{ propertyName: 'num_associated_deals', operator: 'GT', value: '0' }] }])
  })

  it('"não importada" com importadas → NOT_IN hs_object_id; sem importadas → sem filtro', () => {
    expect(corpoDe(montarCorpoBusca({ ...BASE, importada: 'nao' }, ['10', '20'])).filterGroups)
      .toEqual([{ filters: [{ propertyName: 'hs_object_id', operator: 'NOT_IN', values: ['10', '20'] }] }])
    expect(corpoDe(montarCorpoBusca({ ...BASE, importada: 'nao' }, [])).filterGroups).toBeUndefined()
  })

  it('"já importada" sem nenhuma importada → vazio (nem consulta o HubSpot)', () => {
    expect(montarCorpoBusca({ ...BASE, importada: 'sim' }, [])).toEqual({ ok: true, vazio: true })
  })

  it('"já importada" → IN hs_object_id', () => {
    expect(corpoDe(montarCorpoBusca({ ...BASE, importada: 'sim' }, ['10'])).filterGroups)
      .toEqual([{ filters: [{ propertyName: 'hs_object_id', operator: 'IN', values: ['10'] }] }])
  })

  it('mais de 100 importadas → filtro indisponível (limite real do HubSpot), nunca resultado errado', () => {
    const ids = Array.from({ length: 101 }, (_, i) => String(i + 1))
    expect(montarCorpoBusca({ ...BASE, importada: 'nao' }, ids)).toEqual({ ok: false, motivo: 'filtro_importadas_indisponivel' })
    expect(montarCorpoBusca({ ...BASE, importada: 'sim' }, ids)).toEqual({ ok: false, motivo: 'filtro_importadas_indisponivel' })
    // Sem filtro de importação, o limite não importa.
    expect(montarCorpoBusca(BASE, ids).ok).toBe(true)
  })

  it('página além do teto de 10.000 resultados → recusa', () => {
    expect(montarCorpoBusca({ ...BASE, pagina: 401, tamanho: 25 }, [])).toEqual({ ok: false, motivo: 'pagina_fora_do_limite' })
  })
})

describe('montarLinha — responsável e status', () => {
  const ctx = {
    nomesOwners: new Map([['229861376', 'Bruno Veloso'], ['76540616', 'Silmara Gonçalves']]),
    responsaveis: new Map([['229861376', 'u-bruno']]),
    nomesUsuarios: new Map([['u-bruno', 'Bruno Veloso']]),
    importadas: new Set(['1']),
    emPreparo: new Set(['2']),
  }
  const emp = (id: string, owner?: string) => ({
    id,
    properties: { name: 'Hotel X', domain: 'x.com', industry: 'HOSPITALITY', hubspot_owner_id: owner ?? null, num_associated_contacts: '3', num_associated_deals: '0' },
  })

  it('owner mapeado → responsável ProspectOS', () => {
    expect(montarLinha(emp('9', '229861376'), ctx)).toMatchObject({
      owner: { id: '229861376', nome: 'Bruno Veloso' },
      responsavel: { usuarioId: 'u-bruno', nome: 'Bruno Veloso' },
      contatos: 3,
      negocios: 0,
      status: 'nao_importada',
    })
  })

  it('owner sem mapeamento → responsável null ("Responsável não mapeado"), nunca outro vendedor', () => {
    const l = montarLinha(emp('9', '76540616'), ctx)
    expect(l.owner).toEqual({ id: '76540616', nome: 'Silmara Gonçalves' })
    expect(l.responsavel).toBeNull()
  })

  it('sem owner → owner e responsável null', () => {
    const l = montarLinha(emp('9'), ctx)
    expect(l.owner).toBeNull()
    expect(l.responsavel).toBeNull()
  })

  it('status: importada > em preparo > não importada', () => {
    expect(montarLinha(emp('1'), ctx).status).toBe('importada')
    expect(montarLinha(emp('2'), ctx).status).toBe('em_preparo')
    expect(montarLinha(emp('3'), ctx).status).toBe('nao_importada')
  })
})
