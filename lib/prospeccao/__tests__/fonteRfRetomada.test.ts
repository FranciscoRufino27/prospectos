import { describe, it, expect, vi } from 'vitest'
import zlib from 'node:zlib'
import { Readable } from 'node:stream'
import { bytesComRetomada, linhasDeZip } from '../catalogoRf/fonteRf'

// Nenhum teste toca a rede: `fetch` é injetado e o corpo é um iterável falso.

const DADOS = Buffer.from(Array.from({ length: 5000 }, (_, i) => i % 251))

interface Plano {
  status?: number
  // Até onde este corpo entrega antes de "cair" (exclusivo); ausente = até o fim.
  corteEm?: number
  // Servidor ignora o Range e manda tudo de novo (200).
  ignorarRange?: boolean
  // Corpo termina em silêncio (sem erro) neste ponto.
  terminaEm?: number
}

function fetchFalso(planos: Plano[], dados = DADOS) {
  const ranges: Array<string | undefined> = []
  let i = 0
  const fn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const plano = planos[Math.min(i++, planos.length - 1)]
    const range = (init?.headers as Record<string, string> | undefined)?.Range
    ranges.push(range)
    const status = plano.status ?? (range && !plano.ignorarRange ? 206 : 200)
    if (status >= 400) return { ok: false, status, headers: new Headers(), body: null } as unknown as Response
    const inicio = status === 206 && range ? Number(/bytes=(\d+)-/.exec(range)![1]) : 0
    const fim = plano.terminaEm ?? dados.length
    async function* corpo() {
      for (let p = inicio; p < fim; p += 700) {
        const ate = Math.min(p + 700, fim)
        if (plano.corteEm !== undefined && ate > plano.corteEm) {
          if (plano.corteEm > p) yield new Uint8Array(dados.subarray(p, plano.corteEm))
          throw new TypeError('terminated')
        }
        yield new Uint8Array(dados.subarray(p, ate))
      }
    }
    return {
      ok: true, status,
      headers: new Headers(status === 200 ? { 'content-length': String(dados.length) } : {}),
      body: corpo(),
    } as unknown as Response
  })
  return { fn: fn as unknown as typeof fetch, ranges }
}

async function juntar(gen: AsyncGenerator<Buffer>): Promise<Buffer> {
  const partes: Buffer[] = []
  for await (const b of gen) partes.push(b)
  return Buffer.concat(partes)
}

const semEspera = { esperaMs: () => 0 }

describe('bytesComRetomada', () => {
  it('sem queda: entrega o arquivo inteiro numa requisição, sem Range', async () => {
    const f = fetchFalso([{}])
    expect((await juntar(bytesComRetomada('u', { A: '1' }, { fetch: f.fn, ...semEspera }))).equals(DADOS)).toBe(true)
    expect(f.ranges).toEqual([undefined])
  })

  it('queda no meio: retoma do byte exato com Range e a sequência sai contínua', async () => {
    const f = fetchFalso([{ corteEm: 1234 }, { corteEm: 3333 }, {}])
    const avisos: string[] = []
    const total: number[] = []
    const r = await juntar(bytesComRetomada('u', {}, { fetch: f.fn, ...semEspera, aoReconectar: (m) => avisos.push(m), aoTotal: (n) => total.push(n) }))
    expect(r.equals(DADOS)).toBe(true)
    expect(f.ranges).toEqual([undefined, 'bytes=1234-', 'bytes=3333-'])
    expect(avisos).toHaveLength(2)
    expect(total).toEqual([DADOS.length])
  })

  it('servidor ignora o Range (200): descarta o que já foi entregue', async () => {
    const f = fetchFalso([{ corteEm: 2000 }, { ignorarRange: true }])
    expect((await juntar(bytesComRetomada('u', {}, { fetch: f.fn, ...semEspera }))).equals(DADOS)).toBe(true)
  })

  it('corpo termina antes do content-length sem erro: retoma do ponto', async () => {
    const f = fetchFalso([{ terminaEm: 2500 }, {}])
    expect((await juntar(bytesComRetomada('u', {}, { fetch: f.fn, ...semEspera }))).equals(DADOS)).toBe(true)
    expect(f.ranges).toEqual([undefined, 'bytes=2500-'])
  })

  it('erro de rede e 5xx são retomados; 4xx é definitivo', async () => {
    const instavel = fetchFalso([{ status: 503 }, {}])
    expect((await juntar(bytesComRetomada('u', {}, { fetch: instavel.fn, ...semEspera }))).equals(DADOS)).toBe(true)
    const ausente = fetchFalso([{ status: 404 }])
    await expect(juntar(bytesComRetomada('u', {}, { fetch: ausente.fn, ...semEspera }))).rejects.toThrow('HTTP 404')
    expect(ausente.ranges).toHaveLength(1)
  })

  it('desiste depois de N quedas seguidas sem progresso', async () => {
    const f = fetchFalso([{ corteEm: 0 }])
    await expect(juntar(bytesComRetomada('u', {}, { fetch: f.fn, ...semEspera, tentativas: 3 }))).rejects.toThrow('terminated')
    expect(f.ranges).toHaveLength(4)
  })

  it('queda com progresso não consome o limite: muitas quedas espaçadas ainda terminam', async () => {
    const cortes = [500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500].map((corteEm) => ({ corteEm }))
    const f = fetchFalso([...cortes, {}])
    expect((await juntar(bytesComRetomada('u', {}, { fetch: f.fn, ...semEspera, tentativas: 2 }))).equals(DADOS)).toBe(true)
  })
})

describe('retomada + zip da RF', () => {
  it('arquivo zip com queda no meio sai com todas as linhas, sem duplicar nem perder', async () => {
    const linhas = Array.from({ length: 3000 }, (_, i) => `"${String(i).padStart(14, '0')}";"EMPRESA ${i}";"SP"`)
    const deflate = zlib.deflateRawSync(Buffer.from(linhas.join('\n') + '\n', 'latin1'))
    const nome = Buffer.from('K3241.K03200Y0.D60913.ESTABELE', 'latin1')
    const cabecalho = Buffer.alloc(30)
    cabecalho.writeUInt32LE(0x04034b50, 0)
    cabecalho.writeUInt16LE(8, 8)
    cabecalho.writeUInt16LE(nome.length, 26)
    const zip = Buffer.concat([cabecalho, nome, deflate])
    const f = fetchFalso([{ corteEm: Math.floor(zip.length / 3) }, { corteEm: Math.floor((zip.length * 2) / 3) }, {}], zip)

    const lidas: string[] = []
    for await (const l of linhasDeZip(Readable.from(bytesComRetomada('u', {}, { fetch: f.fn, ...semEspera })))) lidas.push(l)
    expect(lidas).toEqual(linhas)
    expect(f.ranges.filter(Boolean)).toHaveLength(2)
  })
})
