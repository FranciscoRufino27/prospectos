// Enrollment REAL, separado da publicação em dry-run. Recalcula o público e
// exige confirmação numérica exata antes de desativar o modo ensaio.
import { NextResponse } from 'next/server'
import { exigirPermissao } from '@/lib/rbac/servidor'
import { inscreverCampanhaReal } from '@/lib/campanhas/ativacaoServidor'
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
    const { execucoes_criadas: execucaoIds, ...resultado } = await inscreverCampanhaReal(
      acc.acesso.admin,
      acc.acesso.org,
      id,
      typeof body.confirmarQuantidade === 'number' ? body.confirmarQuantidade : undefined,
    )
    // Envios só dentro da janela (dias + horário) da campanha.
    const campanha = await buscarCampanha(acc.acesso.admin, acc.acesso.org, id)
    const fila = await agendarExecucoesCampanha(
      new SupabaseWorkflowStore(acc.acesso.org, acc.acesso.admin),
      acc.acesso.org,
      id,
      execucaoIds,
      { janela: janelaDoPublico(campanha?.publico) },
    )
    return NextResponse.json({ ok: true, ...resultado, fila })
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : 'Erro' }, { status: 400 })
  }
}
