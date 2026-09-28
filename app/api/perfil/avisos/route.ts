// Avisos no WhatsApp do PRÓPRIO usuário (migration 0053): o número que recebe
// o aviso "cliente respondeu" e o liga/desliga. Rota separada de /api/perfil
// para que a tela de perfil siga funcionando mesmo antes da migration.
// Sempre o perfil da sessão, filtrado pela organização da sessão.
import { NextResponse } from 'next/server'
import { resolverAcesso } from '@/lib/rbac/servidor'
import { numeroWhatsappAvisos } from '@/lib/comercial/avisosResposta/numero'
import { modoAvisoResposta, parseWorkspaceConfig } from '@/lib/config/workspaceConfig'

export const runtime = 'nodejs'

export async function GET() {
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  const { admin, org, user } = acc.acesso
  const [{ data, error }, { data: orgRow }] = await Promise.all([
    admin.from('perfis').select('whatsapp_avisos, avisos_whatsapp_ativo').eq('organizacao_id', org).eq('id', user.id).maybeSingle(),
    admin.from('organizacoes').select('configuracoes').eq('id', org).maybeSingle(),
  ])
  if (error) {
    // Coluna ausente = migration 0053 ainda não aplicada neste banco.
    return NextResponse.json({ erro: 'Avisos no WhatsApp ainda não disponíveis neste ambiente.', disponivel: false }, { status: 503 })
  }
  const modo = modoAvisoResposta(parseWorkspaceConfig(orgRow?.configuracoes))
  return NextResponse.json({
    disponivel: true,
    whatsapp: (data?.whatsapp_avisos as string | null) ?? '',
    ativo: data?.avisos_whatsapp_ativo === true,
    // A org precisa mandar avisos ao responsável para o número ser usado.
    organizacaoAvisaResponsavel: modo === 'responsavel' || modo === 'ambos',
  })
}

export async function PUT(req: Request) {
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  const { admin, org, user } = acc.acesso
  const b = (await req.json().catch(() => ({}))) as { whatsapp?: unknown; ativo?: unknown }
  const bruto = typeof b.whatsapp === 'string' ? b.whatsapp.trim() : ''
  const ativo = b.ativo === true
  const numero = bruto ? numeroWhatsappAvisos(bruto) : null
  if (bruto && !numero) {
    return NextResponse.json({ erro: 'Número inválido. Use DDD + número, ex.: (11) 99999-8888.' }, { status: 400 })
  }
  if (ativo && !numero) {
    return NextResponse.json({ erro: 'Informe o número para ligar os avisos.' }, { status: 400 })
  }
  const { error } = await admin
    .from('perfis')
    .update({ whatsapp_avisos: numero, avisos_whatsapp_ativo: ativo })
    .eq('organizacao_id', org)
    .eq('id', user.id)
  if (error) return NextResponse.json({ erro: error.message }, { status: 400 })
  return NextResponse.json({ ok: true, whatsapp: numero ?? '', ativo })
}
