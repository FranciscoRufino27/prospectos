// Municípios do catálogo RF para o seletor da Prospecção (perfil e filtro).
// GET ?uf=SP&q=campos → sugestões; GET ?codigo=7107 → nomes do que está salvo.
import { NextResponse, type NextRequest } from 'next/server'
import { resolverAcesso } from '@/lib/rbac/servidor'
import { consultaDaUrl, listarMunicipios } from '@/lib/prospeccao/municipiosServidor'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  const { admin } = acc.acesso

  try {
    const municipios = await listarMunicipios(admin, consultaDaUrl(req.nextUrl.searchParams))
    return NextResponse.json({ municipios })
  } catch (err) {
    console.error('[prospeccao/municipios] erro:', err)
    return NextResponse.json({ erro: 'Não foi possível carregar os municípios.' }, { status: 500 })
  }
}
