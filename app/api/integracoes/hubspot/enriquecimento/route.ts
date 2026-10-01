import { NextResponse } from 'next/server'
import { exigirPermissao } from '@/lib/rbac/servidor'
import { enriquecerEmpresas } from '@/lib/integracoes/hubspot/enriquecimento/cascata'

// Enriquecimento em PREVIEW de até 20 empresas do HubSpot (OpenCNPJ + CNPJ
// publicado no site). Não altera o HubSpot, não importa, não cria lead: o
// resultado fica em hubspot_enriquecimentos para revisão.
export const runtime = 'nodejs'
export const maxDuration = 60

const STATUS_POR_MOTIVO: Record<string, number> = {
  selecao_vazia: 400,
  selecao_excede_limite: 400,
  id_invalido: 400,
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

  const r = await enriquecerEmpresas(acc.acesso.org, acc.acesso.user.id, { companyIds: body.companyIds }, { admin: acc.acesso.admin })
  if (!r.ok) return NextResponse.json({ erro: r.motivo }, { status: STATUS_POR_MOTIVO[r.motivo] ?? 400 })
  return NextResponse.json(r)
}
