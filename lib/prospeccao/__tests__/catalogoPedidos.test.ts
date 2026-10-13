import { afterEach, describe, expect, it, vi } from 'vitest'
import { planejarAtendimento, type PedidoAberto } from '../catalogoRf/atenderPedidos'
import { escopoDosPerfis } from '../catalogoRf/escopo'
import { acordarJob, cnaesAPedir, type PedidoCarga } from '../catalogoRf/pedidos'

const pedido = (id: string, cnaes: string[], status: PedidoAberto['status'] = 'pendente', iniciado_em: string | null = null): PedidoAberto =>
  ({ id, organizacao_id: `org-${id}`, cnaes, status, iniciado_em })

describe('planejarAtendimento', () => {
  const AGORA = new Date('2026-10-13T12:00:00Z')

  it('junta as atividades que faltam de todos os pedidos pendentes', () => {
    const p = planejarAtendimento([pedido('a', ['9313100']), pedido('b', ['8630504', '9313100'])], ['5510801'], AGORA)
    expect(p.cnaes).toEqual(['8630504', '9313100'])
    expect(p.aCarregar.map((x) => x.id)).toEqual(['a', 'b'])
    expect(p.jaAtendidos).toEqual([])
  })

  it('pedido já coberto pelo catálogo fecha sem carga', () => {
    const p = planejarAtendimento([pedido('a', ['9313100'])], ['9313100'], AGORA)
    expect(p).toMatchObject({ cnaes: [], aCarregar: [], jaAtendidos: [{ id: 'a' }] })
  })

  it('em andamento recente fica com quem está rodando; abandonado volta para a fila', () => {
    const recente = pedido('r', ['9313100'], 'em_andamento', '2026-10-13T11:00:00Z')
    const morto = pedido('m', ['8630504'], 'em_andamento', '2026-10-13T02:00:00Z')
    const p = planejarAtendimento([recente, morto], [], AGORA)
    expect(p.abandonados.map((x) => x.id)).toEqual(['m'])
    expect(p.aCarregar.map((x) => x.id)).toEqual(['m'])
    expect(p.cnaes).toEqual(['8630504'])
  })
})

describe('cnaesAPedir', () => {
  const aberto = (cnaes: string[], status: PedidoCarga['status']): PedidoCarga =>
    ({ id: 'p', cnaes, status, erro: null, criadoEm: '', iniciadoEm: null, concluidoEm: null })

  it('pede só o que não está no catálogo nem em pedido aberto', () => {
    expect(cnaesAPedir(['5510801', '9313100', '8630504'], ['5510801'], [aberto(['9313100'], 'em_andamento')])).toEqual(['8630504'])
  })

  it('pedido com erro ou concluído não impede pedir de novo', () => {
    expect(cnaesAPedir(['9313100'], [], [aberto(['9313100'], 'erro')])).toEqual(['9313100'])
  })
})

describe('acordarJob', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('sem token ou repositório não chama o GitHub', async () => {
    vi.stubEnv('GITHUB_DISPATCH_TOKEN', '')
    const f = vi.fn()
    expect(await acordarJob(f as unknown as typeof fetch)).toBe(false)
    expect(f).not.toHaveBeenCalled()
  })

  it('dispara repository_dispatch e não lança se o GitHub falhar', async () => {
    vi.stubEnv('GITHUB_DISPATCH_TOKEN', 'tok')
    vi.stubEnv('GITHUB_REPOSITORIO', 'dono/repo')
    const ok = vi.fn(async () => new Response(null, { status: 204 }))
    expect(await acordarJob(ok as unknown as typeof fetch)).toBe(true)
    const [url, init] = ok.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.github.com/repos/dono/repo/dispatches')
    expect(JSON.parse(String(init.body))).toEqual({ event_type: 'catalogo-rf-pedido' })
    const erro = vi.fn(async () => { throw new Error('rede') })
    expect(await acordarJob(erro as unknown as typeof fetch)).toBe(false)
  })
})

describe('escopoDosPerfis com nichos da organização', () => {
  it('a carga mensal inclui as atividades dos nichos criados, mesmo fora do perfil', () => {
    const e = escopoDosPerfis([
      { prospeccao: { cnaes: ['5510801'] }, prospeccaoNichos: [{ id: 'n', nome: 'Academias', cnaes: ['9313100'], criadoEm: '' }] },
      { prospeccaoNichos: [{ id: 'm', nome: 'Dentistas', cnaes: ['8630504'], criadoEm: '' }] },
    ])
    expect(e).toEqual({ cnaes: ['5510801', '8630504', '9313100'], cnaesSecundarios: [], organizacoes: 2 })
  })
})
