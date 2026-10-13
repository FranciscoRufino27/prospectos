// Fonte real: share WebDAV público dos dados abertos do CNPJ na Receita
// Federal. Baixa cada zip em streaming e descompacta sem tocar o disco.
// Só para scripts Node — não importar em rota da Vercel (arquivos de GB).

import zlib from 'node:zlib'
import { Readable, Transform } from 'node:stream'
import type { FonteRf } from './carga'

const RF_BASE = 'https://arquivos.receitafederal.gov.br/public.php/webdav'
// Token do share público oficial da RF (não é segredo: é o link público).
const RF_SHARE_PADRAO = 'YggdBLfdninEJX9'

function autorizacao(): string {
  const token = process.env.PROSPECCAO_RF_SHARE || RF_SHARE_PADRAO
  return 'Basic ' + Buffer.from(`${token}:`).toString('base64')
}

export async function mesMaisRecenteRf(): Promise<string> {
  const res = await fetch(`${RF_BASE}/`, {
    method: 'PROPFIND',
    headers: { Authorization: autorizacao(), Depth: '1' },
  })
  if (!res.ok) throw new Error(`PROPFIND na RF falhou: HTTP ${res.status}`)
  const xml = await res.text()
  const meses = [...xml.matchAll(/webdav\/(\d{4}-\d{2})/g)].map((m) => m[1])
  if (meses.length === 0) throw new Error('Nenhuma pasta de mês encontrada no share da RF')
  return meses.sort().at(-1)!
}

// Remove o local file header do zip e repassa o deflate cru. Os zips da RF
// têm UMA entrada, então basta pular o cabeçalho; o central directory no fim
// é ignorado pelo inflate depois do fim do stream deflate.
function criarStripZipHeader(): Transform {
  let cabecalho: Buffer = Buffer.alloc(0)
  let pularRestante = -1 // -1 = ainda lendo o cabeçalho fixo
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      if (pularRestante === -1) {
        cabecalho = Buffer.concat([cabecalho, chunk])
        if (cabecalho.length < 30) return cb()
        if (cabecalho.readUInt32LE(0) !== 0x04034b50) {
          return cb(new Error('Arquivo baixado não é um zip (assinatura inválida)'))
        }
        if (cabecalho.readUInt16LE(8) !== 8) {
          return cb(new Error('Zip da RF não usa deflate — layout do arquivo mudou'))
        }
        pularRestante = 30 + cabecalho.readUInt16LE(26) + cabecalho.readUInt16LE(28)
        chunk = cabecalho
        cabecalho = Buffer.alloc(0)
      }
      if (pularRestante > 0) {
        const corta = Math.min(pularRestante, chunk.length)
        pularRestante -= corta
        chunk = chunk.subarray(corta)
      }
      if (chunk.length > 0) this.push(chunk)
      cb()
    },
  })
}

const INTERVALO_PROGRESSO_MS = 30_000

export interface OpcoesRetomada {
  /** Reconexões seguidas sem progresso antes de desistir (padrão 8). */
  tentativas?: number
  /** Espera antes da reconexão n (1, 2, …), em ms. */
  esperaMs?: (tentativa: number) => number
  fetch?: typeof fetch
  aoReconectar?: (msg: string) => void
  /** Tamanho total informado na primeira resposta (content-length). */
  aoTotal?: (bytes: number) => void
}

const esperaPadrao = (tentativa: number) => Math.min(30_000, 2_000 * 2 ** (tentativa - 1))
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Bytes de um arquivo com retomada. O share da RF derruba transferências
 * longas ("terminated" depois de minutos, em arquivos de GB); em vez de
 * abortar a carga, reabre com `Range: bytes=<recebido>-` e continua. A
 * sequência entregue é contínua, então o inflate segue sem perceber. Se o
 * servidor ignorar o Range (200 em vez de 206), os bytes já entregues são
 * descartados. Corpo que termina antes do content-length também é retomado.
 * Erro HTTP 4xx (exceto 429) é definitivo.
 */
export async function* bytesComRetomada(
  url: string,
  headers: Record<string, string>,
  opcoes: OpcoesRetomada = {},
): AsyncGenerator<Buffer> {
  const doFetch = opcoes.fetch ?? fetch
  const maxTentativas = opcoes.tentativas ?? 8
  const espera = opcoes.esperaMs ?? esperaPadrao
  let entregue = 0
  let total: number | null = null
  let falhas = 0
  let progressoNaUltimaFalha = 0

  const falhar = async (motivo: unknown): Promise<void> => {
    // Conta só falhas seguidas SEM progresso: uma queda depois de centenas de
    // MB recebidos não consome o limite de quem trava no mesmo ponto.
    if (entregue > progressoNaUltimaFalha) falhas = 0
    progressoNaUltimaFalha = entregue
    falhas++
    if (falhas > maxTentativas) throw motivo instanceof Error ? motivo : new Error(String(motivo))
    const texto = motivo instanceof Error ? motivo.message : String(motivo)
    opcoes.aoReconectar?.(`conexão caiu em ${(entregue / 1048576).toFixed(0)} MB (${texto}); retomando, tentativa ${falhas}/${maxTentativas}`)
    await esperar(espera(falhas))
  }

  for (;;) {
    let res: Response
    try {
      res = await doFetch(url, { headers: entregue > 0 ? { ...headers, Range: `bytes=${entregue}-` } : headers })
    } catch (e) {
      await falhar(e)
      continue
    }
    if (!res.ok || !res.body) {
      const erro = new Error(`HTTP ${res.status}`)
      if (res.status >= 500 || res.status === 429) { await falhar(erro); continue }
      throw erro
    }
    if (total === null && res.status === 200) {
      const n = Number(res.headers.get('content-length') || 0)
      if (n > 0) { total = n; opcoes.aoTotal?.(n) }
    }
    let pular = entregue > 0 && res.status !== 206 ? entregue : 0
    try {
      for await (const pedaco of res.body as unknown as AsyncIterable<Uint8Array>) {
        let buf = Buffer.from(pedaco)
        if (pular > 0) {
          const corta = Math.min(pular, buf.length)
          pular -= corta
          buf = buf.subarray(corta)
          if (buf.length === 0) continue
        }
        entregue += buf.length
        yield buf
      }
    } catch (e) {
      await falhar(e)
      continue
    }
    if (total !== null && entregue < total) {
      await falhar(new Error(`corpo terminou em ${entregue} de ${total} bytes`))
      continue
    }
    return
  }
}

export function criarFonteRf(mesRf: string, opcoes: { aoProgredir?: (msg: string) => void } = {}): FonteRf {
  return {
    async *linhas(arquivo: string) {
      const url = `${RF_BASE}/${mesRf}/${arquivo}`
      // Os arquivos têm centenas de MB: sem progresso dentro do arquivo não dá
      // para distinguir download lento de processo travado.
      let total = 0
      const origem = bytesComRetomada(url, { Authorization: autorizacao() }, {
        aoTotal: (n) => { total = n },
        aoReconectar: (msg) => opcoes.aoProgredir?.(`${arquivo}: ${msg}`),
      })
      let bytes = 0
      const contador = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          bytes += chunk.length
          cb(null, chunk)
        },
      })
      const timer = opcoes.aoProgredir
        ? setInterval(() => {
            const mb = (bytes / 1048576).toFixed(0)
            const pct = total ? ` (${((bytes / total) * 100).toFixed(1)}%)` : ''
            opcoes.aoProgredir!(`${arquivo}: ${mb} MB${pct}`)
          }, INTERVALO_PROGRESSO_MS)
        : null

      // Erro definitivo (HTTP 4xx ou quedas seguidas além do limite) destrói o
      // fluxo e chega ao consumidor: carga parcial nunca termina "normalmente".
      const fonte = Readable.from(origem, { objectMode: false })
      fonte.on('error', (e) => contador.destroy(new Error(`Download da RF falhou (${arquivo}): ${e.message}`)))
      try {
        yield* linhasDeZip(fonte.pipe(contador))
      } finally {
        if (timer) clearInterval(timer)
        fonte.destroy()
      }
    },
  }
}

/** Linhas (latin1) da única entrada de um zip recebido em stream. */
export async function* linhasDeZip(fonte: Readable): AsyncGenerator<string> {
  const strip = criarStripZipHeader()
  const inflate = zlib.createInflateRaw()
  inflate.setEncoding('latin1')

  // Erro em qualquer elo precisa chegar ao consumidor: um download truncado
  // não pode terminar "normalmente" e virar catálogo incompleto. A iteração
  // do inflate rejeita quando ele é destruído com erro (inclusive o
  // "unexpected end of file" de um deflate cortado).
  const repassar = (e: Error) => inflate.destroy(e)
  fonte.on('error', repassar)
  strip.on('error', repassar)
  fonte.pipe(strip).pipe(inflate)

  try {
    yield* dividirLinhas(inflate)
  } finally {
    fonte.destroy()
  }
}

export async function* dividirLinhas(texto: AsyncIterable<string>): AsyncGenerator<string> {
  let resto = ''
  for await (const pedaco of texto) {
    const partes = (resto + pedaco).split('\n')
    resto = partes.pop() ?? ''
    for (const p of partes) yield p.endsWith('\r') ? p.slice(0, -1) : p
  }
  if (resto) yield resto.endsWith('\r') ? resto.slice(0, -1) : resto
}
