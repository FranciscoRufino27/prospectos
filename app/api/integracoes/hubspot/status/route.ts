import { NextResponse } from 'next/server'
import { resolverAcesso } from '@/lib/rbac/servidor'
import { statusConexao } from '@/lib/integracoes/hubspot/tokens'

// Status é leitura simples (qualquer sessão da organização vê se está
// conectado) — conectar/desconectar/validar exigem workspace.configure.
export const runtime = 'nodejs'

export async function GET() {
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro

  const status = await statusConexao(acc.acesso.org, acc.acesso.admin)
  return NextResponse.json({
    ...status,
    podeGerenciar: acc.acesso.permissoes.has('workspace.configure'),
  })
}
