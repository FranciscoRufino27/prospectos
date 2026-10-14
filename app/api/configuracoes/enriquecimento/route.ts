// Configurações > Integrações > Prospecção e enriquecimento: travas de custo
// (liga/desliga + orçamento mensal por fonte) e uso do mês da organização DA
// SESSÃO — a rota não recebe organização nenhuma do navegador. Leitura para
// qualquer membro; alterar é pela rota de configurações (PUT
// /api/configuracoes/workspace, campo enriquecimentoPago), que exige
// workspace.configure. Chaves das APIs nunca passam por aqui.
import { NextResponse } from 'next/server'
import { resolverAcesso } from '@/lib/rbac/servidor'
import { parseWorkspaceConfig } from '@/lib/config/workspaceConfig'
import { consumoDoMes, travasDaConfig } from '@/lib/prospeccao/travasCusto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  const { admin, org } = acc.acesso

  const { data, error } = await admin.from('organizacoes').select('configuracoes').eq('id', org).maybeSingle()
  if (error) return NextResponse.json({ erro: 'Não foi possível ler a configuração.' }, { status: 500 })

  const travas = travasDaConfig(parseWorkspaceConfig(data?.configuracoes).enriquecimentoPago)
  const consumo = await consumoDoMes(admin, org, travas)
  return NextResponse.json({ ...consumo, podeEditar: acc.acesso.permissoes.has('workspace.configure') })
}
