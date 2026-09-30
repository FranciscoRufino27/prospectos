import 'server-only'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { cnpjValido, soDigitos } from './cadastro'

// CNPJs publicados na página inicial de um domínio (rodapé de site
// brasileiro costuma trazer "CNPJ 00.000.000/0000-00"). Somente leitura de
// página pública. Medido em 29/09: ~15% dos sites mostram CNPJ válido, então
// é evidência de apoio — o CNPJ ainda passa pela OpenCNPJ.
//
// Proteção contra SSRF: só nome de domínio (nunca IP), resolve o DNS e recusa
// endereço privado/loopback/link-local em CADA salto de redirect (manual),
// timeout, tamanho máximo e só http/https.

export type ResultadoSite =
  | { status: 'ok'; cnpjs: string[]; url: string }
  | { status: 'nao_encontrado'; url: string | null } // página lida, nenhum CNPJ válido
  | { status: 'falha'; motivo: string }

export interface DepsSite {
  fetch?: typeof fetch
  resolver?: (host: string) => Promise<string[]>
}

const TIMEOUT_MS = 6000
const MAX_BYTES = 1_500_000
const MAX_REDIRECTS = 3
const HOST_VALIDO = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/
const SUFIXOS_INTERNOS = /\.(local|localhost|internal|lan|home|arpa|test|invalid|example)$/

export function hostPermitido(host: string): boolean {
  const h = host.toLowerCase()
  return HOST_VALIDO.test(h) && !isIP(h) && h !== 'localhost' && !SUFIXOS_INTERNOS.test(h)
}

export function enderecoPublico(ip: string): boolean {
  const v = ip.toLowerCase()
  if (v.startsWith('::ffff:')) return enderecoPublico(v.slice(7))
  if (isIP(v) === 4) {
    const [a, b] = v.split('.').map(Number)
    if (a === 10 || a === 127 || a === 0 || a >= 224) return false
    if (a === 169 && b === 254) return false
    if (a === 172 && b >= 16 && b <= 31) return false
    if (a === 192 && b === 168) return false
    if (a === 100 && b >= 64 && b <= 127) return false // CGNAT
    return true
  }
  if (isIP(v) === 6) {
    return !(v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb'))
  }
  return false
}

const resolverPadrao = async (host: string) => (await lookup(host, { all: true })).map((r) => r.address)

// Máscara completa em qualquer lugar; sem máscara, só logo após "CNPJ".
const COM_MASCARA = /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g
const APOS_ROTULO = /cnpj[^0-9]{0,30}(\d{14}|\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})/gi

export function extrairCnpjs(html: string): string[] {
  const achados = new Set<string>()
  for (const m of html.matchAll(COM_MASCARA)) achados.add(soDigitos(m[0]))
  for (const m of html.matchAll(APOS_ROTULO)) achados.add(soDigitos(m[1]))
  return [...achados].filter(cnpjValido).sort()
}

async function lerCorpo(r: Response): Promise<string> {
  if (!r.body) return (await r.text()).slice(0, MAX_BYTES)
  const reader = r.body.getReader()
  const partes: Uint8Array[] = []
  let total = 0
  while (total < MAX_BYTES) {
    const { done, value } = await reader.read()
    if (done) break
    partes.push(value)
    total += value.length
  }
  await reader.cancel().catch(() => {})
  return new TextDecoder('utf-8', { fatal: false }).decode(Buffer.concat(partes.map((p) => Buffer.from(p))))
}

async function buscarPagina(urlInicial: string, deps: DepsSite): Promise<{ html: string; url: string } | { erro: string }> {
  const doFetch = deps.fetch ?? fetch
  const resolver = deps.resolver ?? resolverPadrao
  let url = new URL(urlInicial)
  for (let salto = 0; salto <= MAX_REDIRECTS; salto++) {
    const portaPadrao = !url.port || url.port === '80' || url.port === '443'
    if (!['http:', 'https:'].includes(url.protocol) || !portaPadrao) return { erro: 'protocolo_ou_porta' }
    if (!hostPermitido(url.hostname)) return { erro: 'host_nao_permitido' }
    let ips: string[]
    try { ips = await resolver(url.hostname) } catch { return { erro: 'dns' } }
    if (!ips.length || !ips.every(enderecoPublico)) return { erro: 'endereco_nao_publico' }

    let r: Response
    try {
      r = await doFetch(url.toString(), {
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ProspectOS-verificacao/1.0)', Accept: 'text/html' },
      })
    } catch (e) {
      return { erro: e instanceof Error ? e.name : 'rede' }
    }
    if (r.status >= 300 && r.status < 400) {
      const destino = r.headers.get('location')
      if (!destino) return { erro: 'redirect_sem_destino' }
      url = new URL(destino, url)
      continue
    }
    if (!r.ok) return { erro: `HTTP ${r.status}` }
    const tipo = r.headers.get('content-type') ?? ''
    if (tipo && !/text\/html|application\/xhtml/i.test(tipo)) return { erro: 'nao_html' }
    return { html: await lerCorpo(r), url: url.toString() }
  }
  return { erro: 'redirects_demais' }
}

// Tenta https://dominio, https://www.dominio e http://dominio; para no
// primeiro que responder uma página.
export async function cnpjsNoSite(dominio: string, deps: DepsSite = {}): Promise<ResultadoSite> {
  if (!hostPermitido(dominio)) return { status: 'falha', motivo: 'host_nao_permitido' }
  const tentativas = [`https://${dominio}`, `https://www.${dominio}`, `http://${dominio}`]
  let ultimoErro = 'sem_resposta'
  for (const t of tentativas) {
    const p = await buscarPagina(t, deps)
    if ('erro' in p) { ultimoErro = p.erro; continue }
    const cnpjs = extrairCnpjs(p.html)
    return cnpjs.length ? { status: 'ok', cnpjs, url: p.url } : { status: 'nao_encontrado', url: p.url }
  }
  return { status: 'falha', motivo: ultimoErro }
}
