// Métricas agregadas de campanhas (cards do topo da tela de Campanhas), com
// dado real da organização da sessão. Requer campaigns.view. Não retorna mock
// — se não calculável, o valor é null.
//
// Reaproveita o MESMO resumo por campanha da lista (buscarResumosExecucoesCampanhas):
//   campanhasAtivas   campanhas com status 'ativa'
//   mensagensEnviadas eventos email_enviado com enviado=true (cada passo conta)
//   emFollowup        execuções ativas que já receberam o 1º contato
//                     (aguardando/em_andamento − aguardando 1º envio)
//   aguardando1oEnvio execuções ativas que ainda não receberam nada
//   respostas         contatos que responderam (soma por campanha)
//   devolucoes        execuções canceladas com lead marcado como bounce
//   contatados        execuções que passaram do 1º passo (base das taxas)
import { NextResponse } from 'next/server'
import { resolverAcesso } from '@/lib/rbac/servidor'
import { buscarResumosExecucoesCampanhas, lerTodas } from '@/lib/campanhas/resumoExecucoesServidor'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  if (!acc.acesso.permissoes.has('campaigns.view')) {
    return NextResponse.json({ erro: 'Sem permissão' }, { status: 403 })
  }
  const { admin, org } = acc.acesso

  try {
    const campanhas = await lerTodas<{ id: string; status: string }>((de, ate) => admin
      .from('campanhas')
      .select('id, status')
      .eq('organizacao_id', org)
      .order('id')
      .range(de, ate))
    const resumos = Object.values(await buscarResumosExecucoesCampanhas(admin, org, campanhas.map((c) => c.id)))
    const soma = (f: (r: (typeof resumos)[number]) => number) => resumos.reduce((s, r) => s + f(r), 0)
    const aguardando1oEnvio = soma((r) => r.aguardandoPrimeiroEnvio)
    return NextResponse.json({
      campanhasAtivas: campanhas.filter((c) => c.status === 'ativa').length,
      mensagensEnviadas: soma((r) => r.emailsEnviados),
      emFollowup: soma((r) => r.emAndamento + r.aguardando) - aguardando1oEnvio,
      aguardando1oEnvio,
      respostas: soma((r) => r.respostas),
      devolucoes: soma((r) => r.devolvidos),
      contatados: soma((r) => r.jaContatados),
    })
  } catch (e) {
    console.error('[campanhas/metricas] falha:', e instanceof Error ? e.message : e)
    return NextResponse.json({
      campanhasAtivas: null, mensagensEnviadas: null, emFollowup: null, aguardando1oEnvio: null,
      respostas: null, devolucoes: null, contatados: null,
    })
  }
}
