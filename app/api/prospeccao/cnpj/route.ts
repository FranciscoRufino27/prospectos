// Empresa fora do catálogo RF: dados oficiais de um CNPJ via OpenCNPJ (grátis).
// A tela só chama quando o CNPJ digitado não apareceu na busca do catálogo.
// Só consulta; nada é gravado.
import { NextRequest, NextResponse } from 'next/server'
import { resolverAcesso } from '@/lib/rbac/servidor'
import { consultarOpenCnpjComCache } from '@/lib/prospeccao/inteligencia'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro

  const cnpj = (req.nextUrl.searchParams.get('cnpj') ?? '').replace(/\D/g, '')
  if (!/^\d{14}$/.test(cnpj)) return NextResponse.json({ erro: 'CNPJ inválido.' }, { status: 400 })

  const r = await consultarOpenCnpjComCache({ admin: acc.acesso.admin, organizacaoId: acc.acesso.org }, cnpj)
  if (r.status === 'nao_encontrado') return NextResponse.json({ erro: 'CNPJ não encontrado na Receita.' }, { status: 404 })
  if (r.status === 'falha') {
    console.error('[prospeccao/cnpj] OpenCNPJ falhou:', r.motivo)
    return NextResponse.json({ erro: 'OpenCNPJ indisponível no momento.' }, { status: 502 })
  }
  return NextResponse.json(r.dados)
}
