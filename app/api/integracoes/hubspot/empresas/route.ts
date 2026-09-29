import { NextResponse } from 'next/server'
import { exigirPermissao } from '@/lib/rbac/servidor'
import { listarEmpresasParaImportacao, parseFiltros } from '@/lib/integracoes/hubspot/empresasImportacao'

// Listagem paginada/filtrada server-side das empresas do HubSpot. Somente
// leitura — não importa nada.
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const acc = await exigirPermissao('workspace.configure')
  if ('erro' in acc) return acc.erro

  const filtros = parseFiltros(new URL(req.url).searchParams)
  const r = await listarEmpresasParaImportacao(acc.acesso.org, filtros, { admin: acc.acesso.admin })
  if (!r.ok) return NextResponse.json({ erro: r.motivo }, { status: r.status })
  return NextResponse.json(r)
}
