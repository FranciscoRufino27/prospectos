import { NextResponse } from 'next/server'
import { exigirPermissao } from '@/lib/rbac/servidor'
import { importarLote } from '@/lib/integracoes/hubspot/importacao'

// Importa um lote preparado: cria empresas, contatos e leads (responsável =
// comercial mapeado, sem segmento, fora do motor de cadência). Simulação é o
// padrão: só grava com `simular: false` explícito no corpo.
export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const acc = await exigirPermissao('workspace.configure')
  if ('erro' in acc) return acc.erro

  const body = (await req.json().catch(() => null)) as { simular?: unknown } | null
  const simular = body?.simular !== false
  const r = await importarLote(acc.acesso.org, id, { simular }, { admin: acc.acesso.admin })
  if (!r.ok) return NextResponse.json({ erro: r.motivo }, { status: r.status })
  return NextResponse.json(r)
}
