// Configurações > Distribuição > E-mail de envio: a organização DA SESSÃO
// conecta a própria conta Gmail (e-mail + senha de app). Nada de chave de
// ambiente nem organização vinda do navegador.
//   GET    status sem segredo (qualquer membro; a senha nunca sai daqui)
//   PUT    { email, senhaApp } → testa SMTP+IMAP, salva a senha cifrada
//   DELETE remove a conta (conectada e/ou a chave legada da config)
// PUT/DELETE exigem workspace.configure.
import { NextResponse } from 'next/server'
import { exigirPermissao, resolverAcesso } from '@/lib/rbac/servidor'
import {
  conectarRemetenteOrganizacao,
  desconectarRemetenteOrganizacao,
  situacaoRemetenteOrganizacao,
  statusPublico,
} from '@/lib/email/remetenteOrganizacao'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  const { admin, org } = acc.acesso
  try {
    const situacao = await situacaoRemetenteOrganizacao(admin, org)
    return NextResponse.json({ ...statusPublico(situacao), podeEditar: acc.acesso.permissoes.has('workspace.configure') })
  } catch (e) {
    console.error('[remetente] não leu o status:', e instanceof Error ? e.message : e)
    return NextResponse.json({ erro: 'Não foi possível ler o e-mail de envio.' }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  const acc = await exigirPermissao('workspace.configure')
  if ('erro' in acc) return acc.erro
  const { admin, org, user } = acc.acesso
  const corpo = (await req.json().catch(() => null)) as { email?: unknown; senhaApp?: unknown } | null
  if (!corpo || typeof corpo !== 'object') return NextResponse.json({ erro: 'Corpo inválido.' }, { status: 400 })
  const r = await conectarRemetenteOrganizacao(admin, org, { email: corpo.email, senhaApp: corpo.senhaApp }, user.id)
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status })
  return NextResponse.json({ ...r.status, podeEditar: true })
}

export async function DELETE() {
  const acc = await exigirPermissao('workspace.configure')
  if ('erro' in acc) return acc.erro
  const { admin, org } = acc.acesso
  try {
    await desconectarRemetenteOrganizacao(admin, org)
    const situacao = await situacaoRemetenteOrganizacao(admin, org)
    return NextResponse.json({ ...statusPublico(situacao), podeEditar: true })
  } catch (e) {
    console.error('[remetente] não desconectou:', e instanceof Error ? e.message : e)
    return NextResponse.json({ erro: 'Não foi possível desconectar agora.' }, { status: 500 })
  }
}
