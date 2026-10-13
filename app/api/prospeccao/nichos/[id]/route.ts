// Excluir um nicho da organização. Só age na lista da organização da sessão:
// id de outra org não é encontrado (404). As atividades continuam no catálogo,
// mas saem do perfil de busca salvo (sem o nicho, ficariam soltas).
import { NextResponse } from 'next/server'
import { exigirPermissao } from '@/lib/rbac/servidor'
import { removerNicho } from '@/lib/prospeccao/nichosPersonalizados'
import { gravarNichos, respostaNichos } from '@/lib/prospeccao/nichosServidor'
import { lerConfig } from '@/lib/prospeccao/pesquisasServidor'

export const runtime = 'nodejs'

type Contexto = { params: Promise<{ id: string }> }

export async function DELETE(_req: Request, { params }: Contexto) {
  const { id } = await params
  const acc = await exigirPermissao('workspace.configure')
  if ('erro' in acc) return acc.erro
  const { admin, org } = acc.acesso
  try {
    const config = await lerConfig(admin, org)
    const removido = (config.prospeccaoNichos ?? []).find((n) => n.id === id)
    const lista = removerNicho(config.prospeccaoNichos ?? [], id)
    if (!lista || !removido) return NextResponse.json({ erro: 'Nicho não encontrado.' }, { status: 404 })
    const gravada = await gravarNichos(admin, org, config, lista, removido.cnaes)
    return NextResponse.json(await respostaNichos(admin, org, gravada, true))
  } catch (err) {
    console.error('[prospeccao/nichos DELETE] erro:', err)
    return NextResponse.json({ erro: 'Não foi possível excluir o nicho.' }, { status: 500 })
  }
}
