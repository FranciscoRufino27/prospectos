// "Adicionar leads" a uma campanha em envio real. GET devolve as opções dos
// filtros; POST inscreve os contatos escolhidos após confirmação numérica exata
// e agenda só as execuções novas, dentro da janela da campanha.
import { NextResponse } from 'next/server'
import { exigirPermissao } from '@/lib/rbac/servidor'
import {
  adicionarLeadsCampanha,
  buscarOpcoesAdicao,
  ErroAdicaoLeads,
} from '@/lib/campanhas/adicionarLeadsServidor'
import { agendarExecucoesCampanha } from '@/lib/campanhas/filaDisparoServidor'
import { buscarCampanha } from '@/lib/campanhas/repository'
import { janelaDeEnvioDaCampanha } from '@/lib/campanhas/agenda'
import { SupabaseWorkflowStore } from '@/lib/workflows'

export const runtime = 'nodejs'

export async function GET() {
  const acc = await exigirPermissao('campaigns.manage')
  if ('erro' in acc) return acc.erro
  try {
    const opcoes = await buscarOpcoesAdicao(acc.acesso.admin, acc.acesso.org)
    return NextResponse.json(opcoes)
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : 'Erro' }, { status: 400 })
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const acc = await exigirPermissao('campaigns.manage')
  if ('erro' in acc) return acc.erro
  const { admin, org, permissoes } = acc.acesso
  try {
    const body = await req.json().catch(() => ({}))
    const { execucoes_criadas: execucaoIds, ...resultado } = await adicionarLeadsCampanha(
      admin,
      org,
      id,
      body.leadIds,
      body.confirmarQuantidade,
      permissoes.has('campaigns.tipos.avancados'),
    )
    const campanha = await buscarCampanha(admin, org, id)
    const fila = await agendarExecucoesCampanha(
      new SupabaseWorkflowStore(org, admin),
      org,
      id,
      execucaoIds,
      { janela: janelaDeEnvioDaCampanha(campanha) },
    )
    return NextResponse.json({ ok: true, ...resultado, fila })
  } catch (e) {
    if (e instanceof ErroAdicaoLeads) return NextResponse.json({ erro: e.message }, { status: e.status })
    return NextResponse.json({ erro: e instanceof Error ? e.message : 'Erro' }, { status: 400 })
  }
}
