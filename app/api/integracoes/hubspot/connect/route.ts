import { NextResponse } from 'next/server'
import { exigirPermissao } from '@/lib/rbac/servidor'
import { gerarState, lerConfigHubspotApp, montarUrlAutorizacao } from '@/lib/integracoes/hubspot/oauth'

// Inicia o fluxo OAuth: exige sessão + workspace.configure, identifica a
// organização pela SESSÃO (nunca por parâmetro vindo do browser), assina um
// state com TTL curto e redireciona para a tela de autorização do HubSpot.
export const runtime = 'nodejs'

export async function GET() {
  const acc = await exigirPermissao('workspace.configure')
  if ('erro' in acc) return acc.erro

  const cfg = lerConfigHubspotApp()
  if (!cfg) {
    return NextResponse.json({ erro: 'Integração HubSpot não configurada no servidor' }, { status: 500 })
  }

  const state = gerarState(acc.acesso.org, acc.acesso.user.id)
  return NextResponse.redirect(montarUrlAutorizacao(cfg, state))
}
