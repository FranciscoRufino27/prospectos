import { NextResponse } from 'next/server'
import { exigirPermissao } from '@/lib/rbac/servidor'
import { sincronizarIndice } from '@/lib/integracoes/hubspot/indice'

// Atualiza o índice local das empresas do HubSpot (lê a base da conta e
// recalcula o que está disponível para importar). Somente leitura no
// HubSpot; não importa nada. Uma execução por organização por vez.
export const runtime = 'nodejs'
export const maxDuration = 300

const STATUS_POR_MOTIVO: Record<string, number> = {
  sincronizacao_em_andamento: 409,
  base_grande_demais: 422,
  nao_conectado: 404,
  inativo: 409,
  app_nao_configurado: 500,
  erro_refresh: 409,
  erro_hubspot: 502,
  erro_banco: 500,
}

export async function POST() {
  const acc = await exigirPermissao('workspace.configure')
  if ('erro' in acc) return acc.erro

  const r = await sincronizarIndice(acc.acesso.org, { admin: acc.acesso.admin })
  if (!r.ok) return NextResponse.json({ erro: r.motivo }, { status: STATUS_POR_MOTIVO[r.motivo] ?? 400 })
  return NextResponse.json(r)
}
