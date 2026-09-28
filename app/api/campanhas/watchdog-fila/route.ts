// Watchdog do disparo inicial de campanha (cron curto). Varre TODAS as
// organizações ativas e reenfileira execuções cuja 1ª ação ficou 'aguardando'
// sem avançar muito além do vencimento — indício de falha na ENTREGA da fila
// @vercel/queue (mensagem aceita, callback nunca chamado), não de erro de
// execução (que já vira status='erro' e é tratado à parte). Mesmo padrão de
// autorização e varredura por organização do cron de workflows.
import { NextResponse } from 'next/server'
import { autorizar } from '@/lib/engine/http'
import { listarOrganizacoesAtivas } from '@/lib/engine'
import { AmbienteSupabase, criarWorkflowStore } from '@/lib/workflows'
import { reconciliarDisparosCampanhaTravados } from '@/lib/campanhas/watchdogFilaCampanha'

export const runtime = 'nodejs'

async function executar(req: Request) {
  const negado = autorizar(req)
  if (negado) return negado
  try {
    const orgs = await listarOrganizacoesAtivas()
    const porOrg: Record<string, unknown> = {}
    for (const org of orgs) {
      const store = criarWorkflowStore(org)
      const ambiente = new AmbienteSupabase(org)
      porOrg[org] = await reconciliarDisparosCampanhaTravados(store, ambiente)
    }
    return NextResponse.json({ organizacoes: orgs.length, porOrg })
  } catch (err) {
    console.error('[campanhas/watchdog-fila] erro:', err)
    return NextResponse.json({ erro: 'Erro interno do watchdog de fila de campanha' }, { status: 500 })
  }
}

export const POST = executar
export const GET = executar
