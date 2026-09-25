// Seletor de municípios: normalização do texto, poda por estado e a rota
// (auth + parâmetros revalidados antes da RPC da migration 0052).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizarTextoMunicipio, podarMunicipios, type Municipio } from '../municipios'
import { consultaDaUrl, listarMunicipios } from '../municipiosServidor'

const estado = vi.hoisted(() => ({ acesso: null as unknown }))
vi.mock('@/lib/rbac/servidor', () => ({
  resolverAcesso: async () => estado.acesso,
}))

import { NextRequest } from 'next/server'
import { GET } from '@/app/api/prospeccao/municipios/route'

const SP: Municipio = { codigo: '7107', nome: 'SAO PAULO', uf: 'SP' }
const RJ: Municipio = { codigo: '6001', nome: 'RIO DE JANEIRO', uf: 'RJ' }

describe('normalizarTextoMunicipio', () => {
  it('tira acento, sobe a caixa e junta espaços, como a RF grava', () => {
    expect(normalizarTextoMunicipio('  são   joão del-rei ')).toBe('SAO JOAO DEL-REI')
  })
  it('escapa curingas do ILIKE e ignora o que não é texto', () => {
    expect(normalizarTextoMunicipio('50%_a\\b')).toBe('50\\%\\_A\\\\B')
    expect(normalizarTextoMunicipio(null)).toBe('')
    expect(normalizarTextoMunicipio(42)).toBe('')
  })
})

describe('podarMunicipios', () => {
  const conhecidos = { [SP.codigo]: SP, [RJ.codigo]: RJ }
  it('tira município de estado que saiu do filtro', () => {
    expect(podarMunicipios(['7107', '6001'], ['SP'], conhecidos)).toEqual(['7107'])
  })
  it('sem estado = Brasil todo, nada sai', () => {
    expect(podarMunicipios(['7107', '6001'], [], conhecidos)).toEqual(['7107', '6001'])
  })
  it('mantém código cujo nome ainda não carregou', () => {
    expect(podarMunicipios(['9999'], ['SP'], conhecidos)).toEqual(['9999'])
  })
})

describe('consultaDaUrl', () => {
  it('revalida UF, código e texto', () => {
    const q = consultaDaUrl(new URLSearchParams('uf=SP&uf=XX&uf=SP&codigo=7107&codigo=abc&codigo=12345678&q=Campos%25'))
    expect(q).toEqual({ ufs: ['SP'], codigos: ['7107'], texto: 'CAMPOS\\%' })
  })
})

describe('listarMunicipios', () => {
  it('pede página curta para sugestão e todos os códigos para resolver nomes', async () => {
    const rpc = vi.fn(async () => ({ data: [SP], error: null }))
    const admin = { rpc } as never
    await listarMunicipios(admin, { ufs: ['SP'], texto: 'SAO', codigos: [] })
    expect(rpc).toHaveBeenLastCalledWith('prospeccao_municipios', { p_ufs: ['SP'], p_texto: 'SAO', p_codigos: [], p_limite: 50 })
    await listarMunicipios(admin, { ufs: [], texto: '', codigos: ['7107', '6001'] })
    expect(rpc).toHaveBeenLastCalledWith('prospeccao_municipios', expect.objectContaining({ p_codigos: ['7107', '6001'], p_limite: 2 }))
  })
  it('propaga erro da RPC', async () => {
    const admin = { rpc: async () => ({ data: null, error: { message: 'boom' } }) } as never
    await expect(listarMunicipios(admin, { ufs: [], texto: 'X', codigos: [] })).rejects.toThrow('boom')
  })
})

describe('GET /api/prospeccao/municipios', () => {
  const rpc = vi.fn(async () => ({ data: [SP], error: null }))
  beforeEach(() => {
    rpc.mockClear()
    estado.acesso = { acesso: { admin: { rpc }, org: 'org-a' } }
  })

  it('sem sessão devolve o erro do resolverAcesso e não consulta', async () => {
    const { NextResponse } = await import('next/server')
    estado.acesso = { erro: NextResponse.json({ erro: 'Não autenticado' }, { status: 401 }) }
    const res = await GET(new NextRequest('http://localhost/api/prospeccao/municipios?q=sao'))
    expect(res.status).toBe(401)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('lista os municípios com os parâmetros normalizados', async () => {
    const res = await GET(new NextRequest('http://localhost/api/prospeccao/municipios?uf=SP&q=são'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ municipios: [SP] })
    expect(rpc).toHaveBeenCalledWith('prospeccao_municipios', expect.objectContaining({ p_ufs: ['SP'], p_texto: 'SAO' }))
  })

  it('falha da RPC vira 500 sem vazar a mensagem do banco', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'relation x' } } as never)
    const res = await GET(new NextRequest('http://localhost/api/prospeccao/municipios?q=a'))
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('relation')
  })
})
