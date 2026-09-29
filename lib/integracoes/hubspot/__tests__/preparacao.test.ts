import { describe, it, expect, vi, beforeAll } from 'vitest'
import { cifrar } from '@/lib/seguranca/criptografia'
import { validarSelecao, prepararLote, LIMITE_EMPRESAS_LOTE } from '../preparacao'
import { supabaseFake, tocouSoOrg, type Chain } from './supabaseFake'

beforeAll(() => {
  process.env.INTEGRACOES_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
})

const ORG = 'org-a'

describe('validarSelecao', () => {
  it('nicho precisa existir em NICHOS', () => {
    expect(validarSelecao({ nicho: 'inexistente', companyIds: ['1'] })).toEqual({ ok: false, motivo: 'nicho_invalido' })
    expect(validarSelecao({ nicho: undefined, companyIds: ['1'] })).toEqual({ ok: false, motivo: 'nicho_invalido' })
  })
  it('seleção vazia, IDs inválidos e excesso', () => {
    expect(validarSelecao({ nicho: 'hotelaria', companyIds: [] })).toEqual({ ok: false, motivo: 'selecao_vazia' })
    expect(validarSelecao({ nicho: 'hotelaria', companyIds: ['1', 'abc'] })).toEqual({ ok: false, motivo: 'id_invalido' })
    const muitos = Array.from({ length: LIMITE_EMPRESAS_LOTE + 1 }, (_, i) => String(i + 1))
    expect(validarSelecao({ nicho: 'hotelaria', companyIds: muitos })).toEqual({ ok: false, motivo: 'selecao_excede_limite' })
  })
  it('deduplica IDs repetidos', () => {
    expect(validarSelecao({ nicho: 'hotelaria', companyIds: ['1', '1', '2'] })).toEqual({ ok: true, nicho: 'hotelaria', ids: ['1', '2'] })
  })
})

function cenario(opts: { importadas?: string[]; erroItens?: boolean } = {}) {
  return supabaseFake((t: string, c: Chain) => {
    if (t === 'integracoes_hubspot') {
      return { data: { access_token_cifrado: cifrar('at'), refresh_token_cifrado: cifrar('rt'), expires_at: new Date(Date.now() + 3600_000).toISOString(), ativo: true } }
    }
    if (t === 'empresas') return { data: (opts.importadas ?? []).map((id) => ({ hubspot_company_id: id })) }
    if (t === 'hubspot_owners_mapeamento') return { data: [{ hubspot_owner_id: '229861376', usuario_id: 'u-bruno', ativo: true }] }
    if (t === 'hubspot_importacao_lotes' && c.mode === 'insert') return { data: { id: 'lote-1' } }
    if (t === 'hubspot_importacao_itens' && c.mode === 'insert' && opts.erroItens) return { error: { message: 'falhou' } }
    return {}
  })
}

// batch/read devolve só 2 das 3 empresas pedidas (a "3" não existe).
function fetchHubspot() {
  return vi.fn(async (url: string | URL | Request) => {
    expect(String(url)).toBe('https://api.hubapi.com/crm/v3/objects/companies/batch/read')
    return {
      ok: true, status: 200,
      json: async () => ({
        results: [
          { id: '1', properties: { name: 'Hotel A', domain: 'a.com', industry: 'HOSPITALITY', hubspot_owner_id: '229861376' } },
          { id: '2', properties: { name: 'Hotel B', domain: null, industry: null, hubspot_owner_id: '76540616' } },
        ],
      }),
    } as unknown as Response
  }) as unknown as typeof fetch
}

describe('prepararLote', () => {
  it('nicho inválido → não chama HubSpot nem banco', async () => {
    const { client, chains } = cenario()
    const f = fetchHubspot()
    const r = await prepararLote(ORG, 'perfil-1', { nicho: 'x', companyIds: ['1'] }, { admin: client, fetch: f })
    expect(r).toEqual({ ok: false, motivo: 'nicho_invalido' })
    expect(chains).toHaveLength(0)
    expect(f).not.toHaveBeenCalled()
  })

  it('grava lote + itens com owner lido do HubSpot e responsável só quando mapeado', async () => {
    const { client, chains } = cenario()
    const r = await prepararLote(ORG, 'perfil-1', { nicho: 'hotelaria', companyIds: ['1', '2', '3'] }, { admin: client, fetch: fetchHubspot() })
    expect(r).toEqual({ ok: true, loteId: 'lote-1', nicho: 'hotelaria', incluidas: 2, jaImportadas: 0, naoEncontradas: 1 })

    const lote = chains.find((c) => c.table === 'hubspot_importacao_lotes' && c.mode === 'insert')
    expect(lote?.payload).toMatchObject({ organizacao_id: ORG, nicho_esperado: 'hotelaria', status: 'preparado', total_itens: 2, criado_por: 'perfil-1' })

    const itens = chains.find((c) => c.table === 'hubspot_importacao_itens' && c.mode === 'insert')?.payload as Record<string, unknown>[]
    expect(itens).toEqual([
      expect.objectContaining({ organizacao_id: ORG, lote_id: 'lote-1', hubspot_company_id: '1', hubspot_owner_id: '229861376', usuario_id: 'u-bruno' }),
      // owner sem mapeamento → usuario_id null (não atribui vendedor errado)
      expect.objectContaining({ organizacao_id: ORG, hubspot_company_id: '2', hubspot_owner_id: '76540616', usuario_id: null }),
    ])
  })

  it('NÃO importa: não escreve em empresas, contatos nem leads', async () => {
    const { client, chains } = cenario()
    await prepararLote(ORG, 'perfil-1', { nicho: 'hotelaria', companyIds: ['1', '2'] }, { admin: client, fetch: fetchHubspot() })
    const escritas = chains.filter((c) => c.mode !== 'select')
    expect(escritas.map((c) => c.table).sort()).toEqual(['hubspot_importacao_itens', 'hubspot_importacao_lotes'])
  })

  it('dedup: empresa já importada (org + hubspot_company_id) fica de fora', async () => {
    const { client, chains } = cenario({ importadas: ['1'] })
    const r = await prepararLote(ORG, 'perfil-1', { nicho: 'hotelaria', companyIds: ['1', '2'] }, { admin: client, fetch: fetchHubspot() })
    expect(r).toMatchObject({ ok: true, incluidas: 1, jaImportadas: 1 })
    const dedup = chains.find((c) => c.table === 'empresas')
    expect(dedup?.temEq('organizacao_id', ORG)).toBe(true)
    expect(dedup?.inCalls).toEqual([['hubspot_company_id', ['1', '2']]])
  })

  it('todas já importadas → nenhuma_elegivel, nada gravado', async () => {
    const { client, chains } = cenario({ importadas: ['1', '2'] })
    const r = await prepararLote(ORG, 'perfil-1', { nicho: 'hotelaria', companyIds: ['1', '2'] }, { admin: client, fetch: fetchHubspot() })
    expect(r).toEqual({ ok: false, motivo: 'nenhuma_elegivel' })
    expect(chains.some((c) => c.mode === 'insert')).toBe(false)
  })

  it('falha ao gravar itens → desfaz o lote (delete filtrado pela org)', async () => {
    const { client, chains } = cenario({ erroItens: true })
    const r = await prepararLote(ORG, 'perfil-1', { nicho: 'hotelaria', companyIds: ['1'] }, { admin: client, fetch: fetchHubspot() })
    expect(r).toMatchObject({ ok: false, motivo: 'erro_banco' })
    const del = chains.find((c) => c.table === 'hubspot_importacao_lotes' && c.mode === 'delete')
    expect(del?.temEq('organizacao_id', ORG)).toBe(true)
    expect(del?.temEq('id', 'lote-1')).toBe(true)
  })

  it('isolamento: toda leitura/escrita usa só a organização do chamador', async () => {
    const { client, chains } = cenario()
    await prepararLote(ORG, 'perfil-1', { nicho: 'hotelaria', companyIds: ['1', '2'] }, { admin: client, fetch: fetchHubspot() })
    expect(tocouSoOrg(chains, ORG)).toBe(true)
  })

  it('integração inexistente → nao_conectado, sem ler o HubSpot', async () => {
    const { client } = supabaseFake(() => ({ data: null }))
    const f = fetchHubspot()
    const r = await prepararLote(ORG, 'perfil-1', { nicho: 'hotelaria', companyIds: ['1'] }, { admin: client, fetch: f })
    expect(r).toEqual({ ok: false, motivo: 'nao_conectado' })
    expect(f).not.toHaveBeenCalled()
  })
})
