// Pesquisa de atividades (subclasses CNAE do IBGE) por nome ou código, para
// montar um nicho. Diz quais já estão no catálogo: as outras precisam de carga.
import { NextResponse } from 'next/server'
import { resolverAcesso } from '@/lib/rbac/servidor'
import { statusCatalogo } from '@/lib/prospeccao/buscaServidor'
import { buscarAtividades } from '@/lib/prospeccao/referenciaIbge'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  const termo = (new URL(req.url).searchParams.get('q') ?? '').trim().slice(0, 80)
  if (termo.length < 2) return NextResponse.json({ atividades: [] })
  try {
    const catalogo = new Set((await statusCatalogo(acc.acesso.admin))?.cnaes ?? [])
    const atividades = (await buscarAtividades(termo)).map((a) => ({ ...a, noCatalogo: catalogo.has(a.codigo) }))
    return NextResponse.json({ atividades })
  } catch (err) {
    console.error('[prospeccao/atividades GET] erro:', err)
    return NextResponse.json({ erro: 'Não foi possível pesquisar as atividades.' }, { status: 500 })
  }
}
