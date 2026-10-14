import { NextResponse } from 'next/server'
import { exigirPermissao } from '@/lib/rbac/servidor'
import { listarGruposZapi } from '@/lib/whatsapp/zapi'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/whatsapp/grupos — grupos da instância Z-API (id + nome) para salvar
// com nome em Configurações > Distribuição. Mesma permissão de salvar a
// configuração (`workspace.configure`). Só leitura; credenciais nunca saem.
export async function GET() {
  const acc = await exigirPermissao('workspace.configure')
  if ('erro' in acc) return acc.erro

  const r = await listarGruposZapi()
  if (!r.ok) {
    console.error('[whatsapp/grupos] Z-API:', r.codigo)
    const texto = r.codigo === 'config_ausente' ? 'WhatsApp (Z-API) não configurado no servidor.' : 'Não foi possível listar os grupos do WhatsApp agora.'
    return NextResponse.json({ erro: texto }, { status: r.codigo === 'config_ausente' ? 503 : 502 })
  }
  return NextResponse.json({ grupos: r.grupos })
}
