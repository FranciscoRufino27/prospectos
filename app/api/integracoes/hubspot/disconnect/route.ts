import { NextResponse } from 'next/server'
import { exigirPermissao } from '@/lib/rbac/servidor'
import { desconectar } from '@/lib/integracoes/hubspot/tokens'

export const runtime = 'nodejs'

export async function POST() {
  const acc = await exigirPermissao('workspace.configure')
  if ('erro' in acc) return acc.erro

  const r = await desconectar(acc.acesso.org, acc.acesso.admin)
  if (!r.ok) return NextResponse.json({ erro: r.mensagem }, { status: 400 })
  return NextResponse.json({ ok: true })
}
