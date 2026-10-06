// Métricas agregadas de campanhas (Fase 2): contatos em cadência com dado real.
// Requer campaigns.view. Não retorna mock — se não calculável, diz "null".
import { NextResponse } from 'next/server'
import { resolverAcesso } from '@/lib/rbac/servidor'

export const runtime = 'nodejs'

export async function GET() {
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  if (!acc.acesso.permissoes.has('campaigns.view')) {
    return NextResponse.json({ erro: 'Sem permissão' }, { status: 403 })
  }
  const { admin, org } = acc.acesso

  // Execuções ativas de campanha, separadas em: já receberam o 1º e-mail e
  // aguardam o próximo passo (em cadência) × ainda na fila do 1º envio (passo 0).
  const ativas = () => admin
    .from('workflow_execucoes')
    .select('id', { count: 'exact', head: true })
    .eq('organizacao_id', org)
    .not('campanha_id', 'is', null)
    .in('status', ['em_andamento', 'aguardando'])
  const [cadencia, fila] = await Promise.all([ativas().gt('passo_atual', 0), ativas().eq('passo_atual', 0)])

  if (cadencia.error || fila.error) {
    return NextResponse.json({ emCadencia: null, naFila: null })
  }

  return NextResponse.json({ emCadencia: cadencia.count ?? 0, naFila: fila.count ?? 0 })
}
