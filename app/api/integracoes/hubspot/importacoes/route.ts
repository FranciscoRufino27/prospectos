import { NextResponse } from 'next/server'
import { exigirPermissao } from '@/lib/rbac/servidor'
import { prepararLote } from '@/lib/integracoes/hubspot/preparacao'
import { listarLotes } from '@/lib/integracoes/hubspot/importacao'

// POST prepara um lote de importação (nicho esperado + empresas selecionadas)
// e NÃO importa. GET lista os lotes da organização. A importação de um lote
// fica em ./[id]/importar.
export const runtime = 'nodejs'

export async function GET() {
  const acc = await exigirPermissao('workspace.configure')
  if ('erro' in acc) return acc.erro
  try {
    return NextResponse.json({ lotes: await listarLotes(acc.acesso.org, { admin: acc.acesso.admin }) })
  } catch (e) {
    console.error('[hubspot/importacoes] listar lotes:', e)
    return NextResponse.json({ erro: 'erro_banco' }, { status: 500 })
  }
}

const STATUS_POR_MOTIVO: Record<string, number> = {
  nicho_invalido: 400,
  selecao_vazia: 400,
  selecao_excede_limite: 400,
  id_invalido: 400,
  nenhuma_elegivel: 409,
  nao_conectado: 404,
  inativo: 409,
  app_nao_configurado: 500,
  erro_refresh: 409,
  erro_hubspot: 502,
  erro_banco: 500,
}

export async function POST(req: Request) {
  const acc = await exigirPermissao('workspace.configure')
  if ('erro' in acc) return acc.erro

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ erro: 'corpo_invalido' }, { status: 400 })

  const r = await prepararLote(acc.acesso.org, acc.acesso.user.id, { nicho: body.nicho, companyIds: body.companyIds }, { admin: acc.acesso.admin })
  if (!r.ok) return NextResponse.json({ erro: r.motivo }, { status: STATUS_POR_MOTIVO[r.motivo] ?? 400 })
  return NextResponse.json(r)
}
