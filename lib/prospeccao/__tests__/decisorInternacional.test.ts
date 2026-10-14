// Decisor não obrigatório (incompletas entram na lista) e decisor automático
// da busca internacional, sem rede: APIs e persistência são falsas.
import { describe, expect, it, vi } from 'vitest'
import { buscarComDecisor, type Desfecho } from '../buscaComDecisor'
import { resolverDecisorInternacional, type DependenciasInternacional } from '../decisorAutomatico'
import { corpoPessoasCrustdata } from '../enriquecimento'
import { corpoCrustdata, normalizarBuscaInternacional } from '../crustdata'
import { dominioValido } from '../decisoresInternacionaisServidor'

interface Item { id: number; dominio: string | null; ja_na_base?: boolean }

async function rodar(itens: Item[], resolver: (i: Item) => Promise<Desfecho<string>>, aceitaIncompletas: boolean, meta = 3) {
  let pos = 0
  const lista: number[] = []
  const fora: number[] = []
  const resolvidos: number[] = []
  const resumo = await buscarComDecisor<Item, string>({
    meta, teto: 25, concorrencia: 1, aceitaIncompletas,
    proximaPagina: async () => { const f = itens.slice(pos, pos + 5); pos += 5; return { itens: f, fim: pos >= itens.length } },
    resolver: async (i) => { resolvidos.push(i.id); return resolver(i) },
    aoDesfecho: (i, d) => ((d.tipo === 'completo' || (aceitaIncompletas && d.motivo !== 'ja_na_base' && d.motivo !== 'erro')) ? lista : fora).push(i.id),
    cancelado: () => false,
  })
  return { resumo, lista, fora, resolvidos }
}

const semEmail = async (): Promise<Desfecho<string>> => ({ tipo: 'pulado', motivo: 'sem_email' })

describe('decisor obrigatório desligado', () => {
  it('incompletas entram na lista e contam para a meta', async () => {
    const r = await rodar(Array.from({ length: 10 }, (_, id) => ({ id, dominio: 'a.com' })), semEmail, true, 3)
    expect(r.resumo).toMatchObject({ completos: 3, parada: 'meta' })
    expect(r.lista).toEqual([0, 1, 2])
    expect(r.resolvidos).toHaveLength(3)
  })

  it('sem domínio entra sem chamar nada; já na base continua fora', async () => {
    const itens: Item[] = [{ id: 1, dominio: null }, { id: 2, dominio: 'a.com', ja_na_base: true }, { id: 3, dominio: 'b.com' }]
    const r = await rodar(itens, semEmail, true, 2)
    expect(r.lista).toEqual([1, 3])
    expect(r.fora).toEqual([2])
    expect(r.resolvidos).toEqual([3])
  })

  it('ligado (padrão): incompletas ficam fora da lista', async () => {
    const r = await rodar(Array.from({ length: 4 }, (_, id) => ({ id, dominio: 'a.com' })), semEmail, false, 2)
    expect(r.lista).toEqual([])
    expect(r.resumo.parada).toBe('fim')
  })
})

function deps(extra: Partial<DependenciasInternacional> = {}) {
  return {
    buscarPessoas: vi.fn(async () => ({
      ok: true as const,
      candidatos: [
        { nome: 'Ana Costa', cargo: 'CEO', linkedin: 'https://www.linkedin.com/in/ana', local: null },
        { nome: 'Rui Lopes', cargo: 'Director', linkedin: null, local: null },
      ],
    })),
    buscarEmail: vi.fn(async (nome: string, dominio: string) => ({
      ok: true as const,
      resultado: nome === 'Ana Costa'
        ? { nome, dominio, status: 'nao_encontrado' as const, email: null, consultadoEm: 'x' }
        : { nome, dominio, status: 'valido' as const, email: 'rui@hotel.pt', consultadoEm: 'x' },
    })),
    salvar: vi.fn(async () => {}),
    ...extra,
  }
}

describe('resolverDecisorInternacional', () => {
  it('tenta a 2ª pessoa quando a 1ª não tem e-mail; a com e-mail vira o decisor', async () => {
    const d = deps()
    const r = await resolverDecisorInternacional('hotel.pt', undefined, null, d)
    expect(r).toMatchObject({ status: 'completo', email: 'rui@hotel.pt', decisor: { nome: 'Rui Lopes', cargo: 'Director' } })
    expect(d.buscarEmail).toHaveBeenCalledTimes(2)
    expect(d.salvar).toHaveBeenCalledWith(expect.objectContaining({ decisor: expect.objectContaining({ nome: 'Rui Lopes' }) }))
  })

  it('ninguém com cargo-alvo: sem_decisor, sem gastar Anymail', async () => {
    const d = deps({ buscarPessoas: vi.fn(async () => ({ ok: true as const, candidatos: [] })) })
    const r = await resolverDecisorInternacional('hotel.pt', undefined, null, d)
    expect(r).toMatchObject({ status: 'incompleto', motivo: 'sem_decisor' })
    expect(d.buscarEmail).not.toHaveBeenCalled()
  })

  it('reaproveita o que a org já consultou: nenhuma chamada paga de novo', async () => {
    const d = deps()
    const salvo = {
      candidatos: [{ nome: 'Ana Costa', cargo: 'CEO', linkedin: null, local: null }],
      anymail: [{ nome: 'Ana Costa', dominio: 'hotel.pt', status: 'valido' as const, email: 'ana@hotel.pt', consultadoEm: 'x' }],
    }
    const r = await resolverDecisorInternacional('hotel.pt', undefined, salvo, d)
    expect(r).toMatchObject({ status: 'completo', email: 'ana@hotel.pt' })
    expect(d.buscarPessoas).not.toHaveBeenCalled()
    expect(d.buscarEmail).not.toHaveBeenCalled()
  })

  it('Crustdata sem crédito: empresa incompleta (bloqueado_crustdata), a busca segue', async () => {
    const d = deps({ buscarPessoas: vi.fn(async () => ({ ok: false as const, motivo: 'sem_credito' as const })) })
    expect(await resolverDecisorInternacional('hotel.pt', undefined, null, d)).toMatchObject({ status: 'incompleto', motivo: 'bloqueado_crustdata', bloqueio: { fonte: 'crustdata', motivo: 'sem_credito' } })
  })

  it('Anymail bloqueada pelo orçamento: decisor achado, empresa incompleta (bloqueado_anymail)', async () => {
    const d = deps({ buscarEmail: vi.fn(async () => ({ ok: false as const, motivo: 'orcamento_esgotado' as const, detalhe: 'orçamento mensal de Anymail esgotado: 5 de 5 créditos usados' })) })
    const r = await resolverDecisorInternacional('hotel.pt', undefined, null, d)
    expect(r).toMatchObject({ status: 'incompleto', motivo: 'bloqueado_anymail', bloqueio: { fonte: 'anymail' } })
    expect(r.status === 'incompleto' && r.candidatos.length).toBeGreaterThan(0)
  })

  it('limite (429) da Crustdata continua sendo falha técnica', async () => {
    const d = deps({ buscarPessoas: vi.fn(async () => ({ ok: false as const, motivo: 'limite' as const })) })
    expect(await resolverDecisorInternacional('hotel.pt', undefined, null, d)).toMatchObject({ status: 'falha', httpStatus: 429 })
  })
})

describe('custo da busca internacional', () => {
  it('pede só as pessoas que vai tentar e nunca mais que 5', () => {
    expect(corpoPessoasCrustdata('hotel.pt', ['CEO'], 2).limit).toBe(2)
    expect(corpoPessoasCrustdata('hotel.pt', ['CEO'], 50).limit).toBe(5)
  })
  it('página menor só quando pedida (1–24); fora disso, o padrão de 25', () => {
    const b = normalizarBuscaInternacional({ paises: ['PRT'], limite: 10 })!
    expect(corpoCrustdata(b).limit).toBe(10)
    expect(corpoCrustdata(normalizarBuscaInternacional({ paises: ['PRT'], limite: 500 })!).limit).toBe(25)
  })
  it('domínio aceito na rota: normalizado e com TLD', () => {
    expect(dominioValido('https://www.Hotel.PT/contato')).toBe('hotel.pt')
    expect(dominioValido('localhost')).toBeNull()
    expect(dominioValido(42)).toBeNull()
  })
})

describe('cadastro duplicado na Crustdata (ex.: CBA)', () => {
  it('ninguém no domínio: procura pelo nome do empregador e usa o domínio dele no e-mail', async () => {
    const buscarPessoas = vi.fn(async (alvo: unknown) => (typeof alvo === 'string'
      ? { ok: true as const, candidatos: [] }
      : { ok: true as const, candidatos: [{ nome: 'Ana Lima', cargo: 'Diretora', linkedin: null, local: null, dominio: 'cba.com.br' }] }))
    const buscarEmail = vi.fn(async (nome: string, dominio: string) => ({
      ok: true as const, resultado: { nome, dominio, status: 'valido' as const, email: `ana@${dominio}`, consultadoEm: 'x' },
    }))
    const r = await resolverDecisorInternacional('cbaluminio.com.br', undefined, null, { buscarPessoas, buscarEmail, salvar: vi.fn(async () => {}) }, 'Companhia Brasileira de Alumínio')
    expect(buscarPessoas).toHaveBeenNthCalledWith(2, { nomeEmpresa: 'Companhia Brasileira de Alumínio', dominioEmpresa: 'cbaluminio.com.br' }, expect.any(Array))
    expect(buscarEmail).toHaveBeenCalledWith('Ana Lima', 'cba.com.br')
    expect(r).toMatchObject({ status: 'completo', email: 'ana@cba.com.br' })
  })

  it('sem nome da empresa, não faz a 2ª busca (não gasta)', async () => {
    const buscarPessoas = vi.fn(async () => ({ ok: true as const, candidatos: [] }))
    const r = await resolverDecisorInternacional('x.com', undefined, null, { buscarPessoas, buscarEmail: vi.fn(), salvar: vi.fn(async () => {}) })
    expect(buscarPessoas).toHaveBeenCalledOnce()
    expect(r).toMatchObject({ status: 'incompleto', motivo: 'sem_decisor' })
  })
})

describe('pessoa achada pelo nome do empregador', async () => {
  const { mapearPessoa, corpoPessoasCrustdata } = await import('../enriquecimento')
  it('filtro por nome com (.) e domínio tirado do site do empregador que casou', () => {
    expect((corpoPessoasCrustdata({ nomeEmpresa: 'Companhia Brasileira de Alumínio' }, ['Diretor'], 2).filters as { conditions: unknown[] }).conditions[0])
      .toEqual({ field: 'experience.employment_details.current.company_name', type: '(.)', value: 'Companhia Brasileira de Alumínio' })
    const p = mapearPessoa({
      basic_profile: { name: 'Ana Lima', current_title: 'Diretora' },
      experience: { employment_details: { current: [
        { name: 'Amcham-Brasil', company_website: 'https://www.amcham.com.br' },
        { name: 'CBA | Companhia Brasileira de Alumínio', company_website: 'http://www.cba.com.br' },
      ] } },
    }, { nomeEmpresa: 'Companhia Brasileira de Alumínio' })
    expect(p?.dominio).toBe('cba.com.br')
  })
})

describe('nomeParaBuscaDePessoas', async () => {
  const { nomeParaBuscaDePessoas } = await import('../enriquecimento')
  it('tira sufixo societário do Brasil e de fora', () => {
    expect(nomeParaBuscaDePessoas('Companhia Brasileira de Alumínio S.A.')).toBe('Companhia Brasileira de Alumínio')
    expect(nomeParaBuscaDePessoas('Hotel Sol Ltda - EPP')).toBe('Hotel Sol')
    expect(nomeParaBuscaDePessoas('Acme, Inc.')).toBe('Acme')
    expect(nomeParaBuscaDePessoas('Vila Galé Hotéis, Lda')).toBe('Vila Galé Hotéis')
    expect(nomeParaBuscaDePessoas('Siemens AG')).toBe('Siemens')
  })
  it('não estraga nome sem sufixo nem nome que é só sigla', () => {
    expect(nomeParaBuscaDePessoas('Inovacode RFID Solutions')).toBe('Inovacode RFID Solutions')
    expect(nomeParaBuscaDePessoas('SA')).toBe('SA')
  })
})

describe('busca específica: escolher a empresa certa e o decisor certo', async () => {
  const { ordenarBuscaEspecifica, minimoFuncionarios } = await import('../crustdata')
  const { empregadorConfere } = await import('../enriquecimento')
  const emp = (id: number, nome: string, dominio: string | null, funcionarios: string | null) =>
    ({ id, nome, dominio, site: null, linkedin: null, pais: null, cidade: null, sede: null, fundacao: null, funcionarios, tipo: null })

  it('nome igual primeiro, depois porte; sem domínio vai para o fim', () => {
    const lista = [
      emp(1, 'Barkley Trading', 'barkleytrading.com', '51-200'),
      emp(2, 'BARKLEY APARTMENTS LIMITED', null, null),
      emp(3, 'Barkley', 'barkleyus.com', '201-500'),
      emp(4, 'Barkley Transportation', 'bt.com', '2-10'),
    ]
    expect(ordenarBuscaEspecifica(lista, 'Barkley').map((e) => e.id)).toEqual([3, 1, 4, 2])
    expect(minimoFuncionarios('10001+')).toBe(10001)
    expect(minimoFuncionarios(null)).toBe(0)
  })

  it('pelo nome, só vale quem trabalha na empresa procurada', () => {
    const cba = { nomeEmpresa: 'Companhia Brasileira de Alumínio', dominioEmpresa: 'cbaluminio.com.br' }
    expect(empregadorConfere({ name: 'CBA | Companhia Brasileira de Alumínio', company_website: 'http://www.cba.com.br' }, cba)).toBe(true)
    const barkley = { nomeEmpresa: 'Barkley', dominioEmpresa: 'barkleyus.com' }
    expect(empregadorConfere({ name: 'Barkley Trading', company_website: 'barkleytrading.com' }, barkley)).toBe(false)
    expect(empregadorConfere({ name: 'Barkley', company_website: null }, barkley)).toBe(true)
    expect(empregadorConfere({ name: 'Barkley Inc.', company_website: 'https://barkleyus.com' }, barkley)).toBe(true)
  })

  it('lista vazia de pessoas não é guardada nem reaproveitada (tentar de novo é grátis)', async () => {
    const salvar = vi.fn(async () => {})
    const buscarPessoas = vi.fn(async () => ({ ok: true as const, candidatos: [] }))
    await resolverDecisorInternacional('x.com', undefined, { candidatos: [], anymail: [] }, { buscarPessoas, buscarEmail: vi.fn(), salvar })
    expect(buscarPessoas).toHaveBeenCalledOnce()
    expect(salvar).not.toHaveBeenCalled()
  })
})
