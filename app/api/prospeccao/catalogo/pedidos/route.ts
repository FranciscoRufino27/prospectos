// Pedidos de carga do catálogo da organização da sessão (a tela "Buscando"
// acompanha por aqui). POST pede as atividades que ainda faltam — exige
// workspace.configure, como criar nicho.
import { NextResponse } from 'next/server'
import { exigirPermissao, resolverAcesso } from '@/lib/rbac/servidor'
import { statusCatalogo } from '@/lib/prospeccao/buscaServidor'
import { pedidosDaOrg, pedirCarga } from '@/lib/prospeccao/catalogoRf/pedidos'
import { cnaeExiste, descricoesCnae } from '@/lib/prospeccao/referenciaIbge'

export const runtime = 'nodejs'

export async function GET() {
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  const { admin, org } = acc.acesso
  try {
    const [pedidos, catalogo] = await Promise.all([pedidosDaOrg(admin, org), statusCatalogo(admin)])
    return NextResponse.json({ pedidos, catalogoCnaes: catalogo?.cnaes ?? [], nomesAtividades: descricoesCnae(pedidos.flatMap((p) => p.cnaes)) })
  } catch (err) {
    console.error('[prospeccao/catalogo/pedidos GET] erro:', err)
    return NextResponse.json({ erro: 'Não foi possível carregar o andamento.' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const acc = await exigirPermissao('workspace.configure')
  if ('erro' in acc) return acc.erro
  const { admin, org, user } = acc.acesso
  try {
    const corpo = (await req.json().catch(() => ({}))) as { cnaes?: unknown }
    const brutos = Array.isArray(corpo.cnaes) ? corpo.cnaes : []
    const cnaes = [...new Set(brutos.filter((c): c is string => typeof c === 'string' && cnaeExiste(c)))].slice(0, 20)
    if (!cnaes.length) return NextResponse.json({ erro: 'Nenhuma atividade válida.' }, { status: 400 })
    const catalogo = await statusCatalogo(admin)
    const pedido = await pedirCarga(admin, org, user.id, cnaes, catalogo?.cnaes ?? [])
    const pedidos = await pedidosDaOrg(admin, org)
    return NextResponse.json({ pedido, pedidos, nomesAtividades: descricoesCnae(pedidos.flatMap((p) => p.cnaes)) }, { status: pedido ? 201 : 200 })
  } catch (err) {
    console.error('[prospeccao/catalogo/pedidos POST] erro:', err)
    return NextResponse.json({ erro: 'Não foi possível registrar o pedido.' }, { status: 500 })
  }
}
