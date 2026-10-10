// Prévia somente leitura de "Adicionar leads": filtra a base da organização e
// classifica quem pode entrar na campanha. Não grava nada.
import { NextResponse } from 'next/server'
import { exigirPermissao } from '@/lib/rbac/servidor'
import {
  buscarCandidatosAdicao,
  ErroAdicaoLeads,
  normalizarFiltrosAdicao,
} from '@/lib/campanhas/adicionarLeadsServidor'

export const runtime = 'nodejs'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const acc = await exigirPermissao('campaigns.manage')
  if ('erro' in acc) return acc.erro
  const { admin, org, permissoes } = acc.acesso
  try {
    const body = await req.json().catch(() => ({}))
    const previa = await buscarCandidatosAdicao(
      admin,
      org,
      id,
      normalizarFiltrosAdicao(body),
      permissoes.has('campaigns.tipos.avancados'),
    )
    return NextResponse.json({ previa })
  } catch (e) {
    if (e instanceof ErroAdicaoLeads) return NextResponse.json({ erro: e.message }, { status: e.status })
    return NextResponse.json({ erro: e instanceof Error ? e.message : 'Erro' }, { status: 400 })
  }
}
