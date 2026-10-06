// Início REAL da campanha pelo wizard. Publica a versão em dry-run, recalcula
// o público confirmado, cria as execuções e agenda somente essas execuções para
// processamento após a resposta. Cada execução entra numa fila durável com
// espaçamento de dois minutos; o timestamp persistido continua sendo o fallback.
import { NextResponse } from 'next/server'
import { exigirPermissao } from '@/lib/rbac/servidor'
import { iniciarCampanhaReal } from '@/lib/campanhas/ativacaoServidor'
import { agendarExecucoesCampanha } from '@/lib/campanhas/filaDisparoServidor'
import { buscarCampanha } from '@/lib/campanhas/repository'
import { janelaDoPublico } from '@/lib/campanhas/agenda'
import { SupabaseWorkflowStore } from '@/lib/workflows'

export const runtime = 'nodejs'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const acc = await exigirPermissao('campaigns.manage')
  if ('erro' in acc) return acc.erro

  try {
    const body = await req.json().catch(() => ({}))
    const { execucoes_criadas: execucaoIds, ...resultado } = await iniciarCampanhaReal(
      acc.acesso.admin,
      acc.acesso.org,
      id,
      acc.acesso.user.id,
      typeof body.confirmarQuantidade === 'number' ? body.confirmarQuantidade : undefined,
    )
    const { admin, org } = acc.acesso
    // Envios só dentro da janela (dias + horário) da campanha.
    const campanha = await buscarCampanha(admin, org, id)
    const fila = await agendarExecucoesCampanha(
      new SupabaseWorkflowStore(org, admin),
      org,
      id,
      execucaoIds,
      { janela: janelaDoPublico(campanha?.publico) },
    )
    return NextResponse.json({ ok: true, ...resultado, fila })
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : 'Erro' }, { status: 400 })
  }
}
