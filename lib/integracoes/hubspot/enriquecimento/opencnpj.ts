import 'server-only'
import { mapearSocios, type Socio } from '@/lib/prospeccao/socios'

// OpenCNPJ (https://api.opencnpj.org/{cnpj}) — grátis, sem chave, CNPJ a CNPJ.
// Sem cabeçalho de limite; o projeto já usa espaçamento de ~150 ms entre
// chamadas (scripts/prospeccao-freetier-hotelaria.ts). 404 = CNPJ inexistente.

export interface DadosCnpj {
  cnpj: string
  razao_social: string | null
  nome_fantasia: string | null
  situacao_cadastral: string | null
  cnae_principal: string | null
  atividade_principal: string | null
  email: string | null
  uf: string | null
  municipio: string | null
  // Quadro societário (sócios pessoa física). Ausente em entrada antiga do
  // cache: quem precisa dos sócios trata como "não consultado" e consulta de novo.
  socios?: Socio[]
}

export type ResultadoOpenCnpj =
  | { status: 'ok'; dados: DadosCnpj }
  | { status: 'nao_encontrado' }
  | { status: 'falha'; motivo: string }

const TIMEOUT_MS = 8000

type Bruto = {
  razao_social?: string
  nome_fantasia?: string
  situacao_cadastral?: string
  cnae_principal?: string
  cnaes?: Array<{ codigo?: string; descricao?: string; is_principal?: boolean }>
  email?: string
  uf?: string
  municipio?: string
  QSA?: unknown
}

const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

export function mapearOpenCnpj(cnpj: string, d: Bruto): DadosCnpj {
  const principal = (d.cnaes ?? []).find((c) => c.is_principal) ?? (d.cnaes ?? []).find((c) => c.codigo === d.cnae_principal)
  return {
    cnpj,
    razao_social: texto(d.razao_social),
    nome_fantasia: texto(d.nome_fantasia),
    situacao_cadastral: texto(d.situacao_cadastral),
    cnae_principal: texto(d.cnae_principal),
    atividade_principal: texto(principal?.descricao),
    email: texto(d.email)?.toLowerCase() ?? null,
    uf: texto(d.uf),
    municipio: texto(d.municipio),
    socios: mapearSocios(d.QSA),
  }
}

export async function consultarOpenCnpj(cnpj: string, doFetch: typeof fetch = fetch): Promise<ResultadoOpenCnpj> {
  if (!/^\d{14}$/.test(cnpj)) return { status: 'nao_encontrado' }
  try {
    const r = await doFetch(`https://api.opencnpj.org/${cnpj}`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (r.status === 404) return { status: 'nao_encontrado' }
    if (!r.ok) return { status: 'falha', motivo: `HTTP ${r.status}` }
    return { status: 'ok', dados: mapearOpenCnpj(cnpj, (await r.json()) as Bruto) }
  } catch (e) {
    return { status: 'falha', motivo: e instanceof Error ? e.message : String(e) }
  }
}
