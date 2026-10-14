import { NextResponse } from 'next/server'
import { exigirPermissao } from '@/lib/rbac/servidor'
import { listarEmpresasParaImportacao, parseFiltros, resumirSituacoes, selecionaveisDoFiltro } from '@/lib/integracoes/hubspot/empresasImportacao'

// Central de Importação HubSpot: listagem paginada/filtrada server-side com a
// situação comercial de cada empresa. Somente leitura — não importa nada.
// `resumo=1` devolve só o total por situação (com os demais filtros aplicados).
// `selecao=todas` devolve os IDs do filtro que ainda podem entrar num lote.
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const acc = await exigirPermissao('workspace.configure')
  if ('erro' in acc) return acc.erro

  const params = new URL(req.url).searchParams
  const filtros = parseFiltros(params)
  const deps = { admin: acc.acesso.admin }
  if (params.get('selecao') === 'todas') {
    try {
      return NextResponse.json(await selecionaveisDoFiltro(acc.acesso.org, filtros, deps))
    } catch (e) {
      console.error('[hubspot/empresas] seleção do filtro:', e)
      return NextResponse.json({ erro: 'erro_selecao' }, { status: 500 })
    }
  }
  const r = params.get('resumo') === '1'
    ? await resumirSituacoes(acc.acesso.org, filtros, deps)
    : await listarEmpresasParaImportacao(acc.acesso.org, filtros, deps)
  if (!r.ok) return NextResponse.json({ erro: r.motivo }, { status: r.status })
  return NextResponse.json(r)
}
