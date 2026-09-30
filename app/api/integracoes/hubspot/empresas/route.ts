import { NextResponse } from 'next/server'
import { exigirPermissao } from '@/lib/rbac/servidor'
import { listarEmpresasParaImportacao, parseFiltros, resumirSituacoes } from '@/lib/integracoes/hubspot/empresasImportacao'

// Central de Importação HubSpot: listagem paginada/filtrada server-side com a
// situação comercial de cada empresa. Somente leitura — não importa nada.
// `resumo=1` devolve só o total por situação (com os demais filtros aplicados).
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const acc = await exigirPermissao('workspace.configure')
  if ('erro' in acc) return acc.erro

  const params = new URL(req.url).searchParams
  const filtros = parseFiltros(params)
  const deps = { admin: acc.acesso.admin }
  const r = params.get('resumo') === '1'
    ? await resumirSituacoes(acc.acesso.org, filtros, deps)
    : await listarEmpresasParaImportacao(acc.acesso.org, filtros, deps)
  if (!r.ok) return NextResponse.json({ erro: r.motivo }, { status: r.status })
  return NextResponse.json(r)
}
