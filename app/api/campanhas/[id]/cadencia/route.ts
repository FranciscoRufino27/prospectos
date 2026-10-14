// Distribuição da cadência de uma campanha (somente leitura). Requer
// campaigns.view; a organização é sempre a da sessão.
//   GET                → etapas com quantidade e % da base
//   GET ?etapa=<id>    → contatos daquela etapa (até 500)
import { NextResponse } from 'next/server'
import { resolverAcesso } from '@/lib/rbac/servidor'
import { buscarContatosDaEtapa, buscarDistribuicaoCadencia } from '@/lib/campanhas/distribuicaoCadenciaServidor'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ETAPA_VALIDA = /^(primeiro_contato|followup_\d{1,2}|cadencia_enviada|respondeu|devolvido|concluido|saiu|erro|indefinida)$/

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  if (!acc.acesso.permissoes.has('campaigns.view')) {
    return NextResponse.json({ erro: 'Sem permissão' }, { status: 403 })
  }
  const { admin, org } = acc.acesso
  const etapa = new URL(req.url).searchParams.get('etapa')
  try {
    if (etapa !== null) {
      if (!ETAPA_VALIDA.test(etapa)) return NextResponse.json({ erro: 'Etapa inválida.' }, { status: 400 })
      const r = await buscarContatosDaEtapa(admin, org, id, etapa)
      if (!r) return NextResponse.json({ erro: 'Campanha não encontrada' }, { status: 404 })
      return NextResponse.json(r)
    }
    const distribuicao = await buscarDistribuicaoCadencia(admin, org, id)
    if (!distribuicao) return NextResponse.json({ erro: 'Campanha não encontrada' }, { status: 404 })
    return NextResponse.json({ distribuicao })
  } catch (e) {
    console.error('[campanhas/cadencia] falha ao ler a distribuição:', e instanceof Error ? e.message : e)
    return NextResponse.json({ erro: 'Não foi possível ler a distribuição da cadência.' }, { status: 500 })
  }
}
