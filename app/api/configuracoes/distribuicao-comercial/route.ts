// Configurações > Distribuição: quem participa do
// round-robin do handoff comercial. GET p/ qualquer sessão da org (a tela
// mostra em somente-leitura); PUT exige workspace.configure. Regras de negócio
// ficam em lib/comercial/handoff — aqui só auth, parse e status HTTP.
import { NextResponse } from 'next/server'
import { resolverAcesso, exigirPermissao } from '@/lib/rbac/servidor'
import { SupabaseHandoffRepository } from '@/lib/comercial/handoff/supabaseRepository'
import { definirParticipacaoComercial, listarDistribuicaoComercial } from '@/lib/comercial/handoff/handoffService'

export const runtime = 'nodejs'

export async function GET() {
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  const { admin, org, permissoes } = acc.acesso
  try {
    const participantes = await listarDistribuicaoComercial(new SupabaseHandoffRepository(admin), org)
    return NextResponse.json({ participantes, podeEditar: permissoes.has('workspace.configure') })
  } catch (err) {
    console.error('[configuracoes/distribuicao-comercial GET] erro:', err)
    return NextResponse.json({ erro: 'Não foi possível carregar a distribuição comercial.' }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  const acc = await exigirPermissao('workspace.configure')
  if ('erro' in acc) return acc.erro
  const { admin, org } = acc.acesso

  const b = (await req.json().catch(() => null)) as { usuarioId?: unknown; participa?: unknown } | null
  const usuarioId = typeof b?.usuarioId === 'string' ? b.usuarioId.trim() : ''
  if (!usuarioId || typeof b?.participa !== 'boolean') {
    return NextResponse.json({ erro: 'Informe usuarioId e participa (boolean).' }, { status: 400 })
  }

  try {
    const repo = new SupabaseHandoffRepository(admin)
    const r = await definirParticipacaoComercial(repo, org, usuarioId, b.participa)
    if (r === 'usuario_nao_encontrado') {
      return NextResponse.json({ erro: 'Comercial não encontrado nesta organização.' }, { status: 404 })
    }
    const participantes = await listarDistribuicaoComercial(repo, org)
    return NextResponse.json({ ok: true, participantes })
  } catch (err) {
    console.error('[configuracoes/distribuicao-comercial PUT] erro:', err)
    return NextResponse.json({ erro: 'Não foi possível salvar a distribuição comercial.' }, { status: 500 })
  }
}
