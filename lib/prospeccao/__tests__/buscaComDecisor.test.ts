import { describe, expect, it } from 'vitest'
import { buscarComDecisor, type Desfecho } from '../buscaComDecisor'

interface Item { cnpj: string; ja_na_base: boolean; dominio: string | null }

const item = (n: number, extra: Partial<Item> = {}): Item => ({ cnpj: String(n).padStart(14, '0'), ja_na_base: false, dominio: 'hotel.com.br', ...extra })

function catalogo(itens: Item[], porPagina = 3) {
  let pos = 0
  let paginas = 0
  return {
    paginas: () => paginas,
    proximaPagina: async () => {
      paginas++
      const fatia = itens.slice(pos, pos + porPagina)
      pos += porPagina
      return { itens: fatia, fim: pos >= itens.length }
    },
  }
}

async function rodar(itens: Item[], resolver: (i: Item) => Promise<Desfecho<string>>, opcoes: { meta?: number; teto?: number; concorrencia?: number; cancelado?: () => boolean } = {}) {
  const cat = catalogo(itens)
  const desfechos: Array<[string, string]> = []
  const resolvidos: string[] = []
  const resumo = await buscarComDecisor<Item, string>({
    meta: opcoes.meta ?? 3,
    teto: opcoes.teto ?? 25,
    concorrencia: opcoes.concorrencia ?? 3,
    proximaPagina: cat.proximaPagina,
    resolver: async (i) => { resolvidos.push(i.cnpj); return resolver(i) },
    aoDesfecho: (i, d) => desfechos.push([i.cnpj, d.tipo === 'completo' ? 'completo' : d.motivo]),
    cancelado: opcoes.cancelado ?? (() => false),
  })
  return { resumo, desfechos, resolvidos, paginas: cat.paginas() }
}

const completo = async (): Promise<Desfecho<string>> => ({ tipo: 'completo', dados: 'ok' })
const semEmail = async (): Promise<Desfecho<string>> => ({ tipo: 'pulado', motivo: 'sem_email' })

describe('buscarComDecisor', () => {
  it('fonte paga bloqueada não para o lote: segue e o resumo conta prontas, sem e-mail e bloqueadas, com o motivo', async () => {
    const itens = Array.from({ length: 8 }, (_, n) => item(n))
    const resolver = async (i: Item): Promise<Desfecho<string>> => {
      const n = Number(i.cnpj)
      if (n % 4 === 0) return { tipo: 'pulado', motivo: 'bloqueado_anymail', erro: 'Anymail: enriquecimento pago desligado para esta organização.' }
      if (n % 4 === 1) return { tipo: 'pulado', motivo: 'bloqueado_crustdata', erro: 'Crustdata: orçamento do enriquecimento pago esgotado.' }
      if (n % 4 === 2) return { tipo: 'pulado', motivo: 'sem_email' }
      return completo()
    }
    const r = await rodar(itens, resolver, { meta: 10, concorrencia: 1 })
    expect(r.resolvidos).toHaveLength(8) // ninguém ficou sem tentar
    expect(r.resumo).toMatchObject({
      parada: 'fim', erro: null, prontas: 2,
      porMotivo: { bloqueado_anymail: 2, bloqueado_crustdata: 2, sem_email: 2 },
      bloqueios: {
        anymail: 'Anymail: enriquecimento pago desligado para esta organização.',
        crustdata: 'Crustdata: orçamento do enriquecimento pago esgotado.',
      },
    })
  })

  it('falha técnica fatal (ex.: 429) continua parando a busca', async () => {
    const r = await rodar(Array.from({ length: 6 }, (_, n) => item(n)), async () => ({ tipo: 'falha', erro: 'limite', fatal: true }), { meta: 5, concorrencia: 1 })
    expect(r.resumo).toMatchObject({ parada: 'falha', erro: 'limite', prontas: 0 })
    expect(r.resolvidos).toHaveLength(1)
  })

  it('para na meta sem resolver empresa a mais', async () => {
    const r = await rodar(Array.from({ length: 20 }, (_, n) => item(n)), completo, { meta: 5 })
    expect(r.resumo).toMatchObject({ completos: 5, tentativas: 5, parada: 'meta', erro: null })
    expect(r.resolvidos).toHaveLength(5)
  })

  it('completa a meta pulando as incompletas', async () => {
    const r = await rodar(Array.from({ length: 20 }, (_, n) => item(n)), async (i) => (Number(i.cnpj) % 2 ? semEmail() : completo()), { meta: 4 })
    expect(r.resumo.completos).toBe(4)
    expect(r.desfechos.filter(([, d]) => d === 'completo')).toHaveLength(4)
    expect(r.desfechos.some(([, d]) => d === 'sem_email')).toBe(true)
  })

  it('pula sem custo empresa já na base ou sem domínio próprio', async () => {
    const itens = [item(1, { ja_na_base: true }), item(2, { dominio: null }), item(3), item(4)]
    const r = await rodar(itens, completo, { meta: 2 })
    expect(r.resolvidos).toEqual([item(3).cnpj, item(4).cnpj])
    expect(r.desfechos).toContainEqual([item(1).cnpj, 'ja_na_base'])
    expect(r.desfechos).toContainEqual([item(2).cnpj, 'sem_dominio'])
  })

  it('respeita o teto de tentativas', async () => {
    const r = await rodar(Array.from({ length: 50 }, (_, n) => item(n)), semEmail, { meta: 10, teto: 7 })
    expect(r.resumo).toMatchObject({ completos: 0, tentativas: 7, parada: 'teto' })
    expect(r.resolvidos).toHaveLength(7)
  })

  it('termina quando o catálogo acaba antes da meta', async () => {
    const r = await rodar([item(1), item(2)], completo, { meta: 10 })
    expect(r.resumo).toMatchObject({ completos: 2, parada: 'fim' })
  })

  it('falha fatal (sem crédito) para tudo na hora', async () => {
    const r = await rodar(Array.from({ length: 20 }, (_, n) => item(n)), async () => ({ tipo: 'falha', erro: 'Anymail: sem crédito', fatal: true }), { meta: 5, concorrencia: 1 })
    expect(r.resumo).toMatchObject({ parada: 'falha', erro: 'Anymail: sem crédito', completos: 0 })
    expect(r.resolvidos).toHaveLength(1)
  })

  it('falha pontual vira empresa pulada e a busca segue', async () => {
    let n = 0
    const r = await rodar(Array.from({ length: 10 }, (_, i) => item(i)), async () => (n++ === 0 ? { tipo: 'falha', erro: 'OpenCNPJ fora', fatal: false } : completo()), { meta: 3, concorrencia: 1 })
    expect(r.resumo.completos).toBe(3)
    expect(r.desfechos[0]).toEqual([item(0).cnpj, 'erro'])
  })

  it('erro ao carregar a página do catálogo encerra com a mensagem', async () => {
    const resumo = await buscarComDecisor<Item, string>({
      meta: 3, teto: 25, concorrencia: 3,
      proximaPagina: async () => { throw new Error('Falha na busca') },
      resolver: completo, aoDesfecho: () => {}, cancelado: () => false,
    })
    expect(resumo).toMatchObject({ parada: 'falha', erro: 'Falha na busca' })
  })

  it('cancelada (nova busca) não resolve mais nada', async () => {
    let cancelado = false
    const r = await rodar(Array.from({ length: 20 }, (_, n) => item(n)), async () => { cancelado = true; return completo() }, { meta: 10, concorrencia: 1, cancelado: () => cancelado })
    expect(r.resumo.parada).toBe('cancelado')
    expect(r.resolvidos).toHaveLength(1)
    expect(r.desfechos).toHaveLength(0)
  })

  it('com concorrência nunca passa da meta nem do teto', async () => {
    let emVoo = 0
    let pico = 0
    const r = await rodar(Array.from({ length: 40 }, (_, n) => item(n)), async (i) => {
      pico = Math.max(pico, ++emVoo)
      await new Promise((ok) => setTimeout(ok, 1))
      emVoo--
      return Number(i.cnpj) % 3 ? semEmail() : completo()
    }, { meta: 4, concorrencia: 3, teto: 25 })
    expect(pico).toBeLessThanOrEqual(3)
    expect(r.resumo.completos).toBe(4)
    expect(r.resumo.tentativas).toBeLessThanOrEqual(25)
  })
})
