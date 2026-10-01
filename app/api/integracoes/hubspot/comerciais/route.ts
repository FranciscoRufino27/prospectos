import { NextResponse } from 'next/server'
import { exigirPermissao } from '@/lib/rbac/servidor'
import { getValidHubSpotAccessToken } from '@/lib/integracoes/hubspot/tokens'
import { listarTodosProprietarios, nomeProprietario } from '@/lib/integracoes/hubspot/owners'
import {
  listarMapeamentos,
  listarUsuariosOrganizacao,
  salvarMapeamento,
  sugerirUsuario,
} from '@/lib/integracoes/hubspot/comerciais'

// Mapeamento de comerciais HubSpot → usuários ProspectOS. Organização sempre
// da sessão. Sugestão por e-mail é só exibida; grava apenas o que o PUT mandar.
export const runtime = 'nodejs'

export async function GET() {
  const acc = await exigirPermissao('workspace.configure')
  if ('erro' in acc) return acc.erro
  const { admin, org } = acc.acesso

  const token = await getValidHubSpotAccessToken(org, { admin })
  if (!token.ok) return NextResponse.json({ erro: token.motivo }, { status: token.motivo === 'nao_conectado' ? 404 : 409 })

  const [owners, usuarios, mapeamentos] = await Promise.all([
    listarTodosProprietarios(token.accessToken),
    listarUsuariosOrganizacao(admin, org),
    listarMapeamentos(admin, org),
  ])
  if (!owners.ok) return NextResponse.json({ erro: owners.codigo }, { status: 502 })

  const porOwner = new Map(mapeamentos.map((m) => [m.hubspotOwnerId, m]))
  return NextResponse.json({
    owners: owners.dados
      .map((o) => {
        const m = porOwner.get(String(o.id))
        return {
          id: String(o.id),
          nome: nomeProprietario(o),
          email: o.email ?? null,
          mapeamento: m ? { usuarioId: m.usuarioId, ativo: m.ativo } : null,
          sugestao: sugerirUsuario(o, usuarios),
        }
      })
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
    usuarios: usuarios.filter((u) => u.ativo).map((u) => ({ id: u.id, nome: u.nome, email: u.email })),
  })
}

export async function PUT(req: Request) {
  const acc = await exigirPermissao('workspace.configure')
  if ('erro' in acc) return acc.erro
  const { admin, org, user } = acc.acesso

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ erro: 'corpo_invalido' }, { status: 400 })

  const r = await salvarMapeamento(admin, org, user.id, {
    hubspotOwnerId: body.hubspotOwnerId,
    usuarioId: body.usuarioId,
    ativo: body.ativo,
  })
  if (!r.ok) return NextResponse.json({ erro: r.motivo, mensagem: r.mensagem }, { status: r.motivo === 'erro_banco' ? 500 : 400 })
  return NextResponse.json({ ok: true, removido: r.removido })
}
