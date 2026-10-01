// Salva o decisor escolhido na Prospecção (migration 0057), por organização.
// A organização vem SEMPRE da sessão; o corpo só traz cnpj + nome/cargo/linkedin.
// Só aceita CNPJ do catálogo: a rota não é um armazenamento livre.
import { NextResponse } from 'next/server'
import { resolverAcesso } from '@/lib/rbac/servidor'
import { validarDecisorSalvo } from '@/lib/prospeccao/decisores'
import { salvarDecisor } from '@/lib/prospeccao/decisoresServidor'

export const runtime = 'nodejs'

export async function PUT(req: Request) {
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  const { admin, org, user } = acc.acesso

  const validacao = validarDecisorSalvo(await req.json().catch(() => null))
  if (!validacao.ok) return NextResponse.json({ erro: validacao.erro }, { status: 400 })

  const { data: empresa, error } = await admin
    .from('catalogo_estabelecimentos').select('cnpj').eq('cnpj', validacao.cnpj).maybeSingle()
  if (error) return NextResponse.json({ erro: 'Não foi possível salvar agora.' }, { status: 500 })
  if (!empresa) return NextResponse.json({ erro: 'CNPJ fora do catálogo.' }, { status: 404 })

  try {
    await salvarDecisor(admin, org, user.id, validacao)
    return NextResponse.json({ salvo: true })
  } catch (e) {
    console.error('[prospeccao/decisores] erro:', e)
    return NextResponse.json({ erro: 'Não foi possível salvar o decisor agora.' }, { status: 500 })
  }
}
