// Quadro societário de um CNPJ via OpenCNPJ, para o passo "analisar".
// Só consulta CNPJ presente no catálogo: a rota não é um proxy aberto.
// A avaliação (sócio serve ou precisa de outro decisor) usa o perfil de busca
// da organização da sessão; o e-mail nominal compara o e-mail do catálogo com
// os nomes do quadro.
import { NextRequest, NextResponse } from 'next/server'
import { resolverAcesso } from '@/lib/rbac/servidor'
import { parseWorkspaceConfig } from '@/lib/config/workspaceConfig'
import { consultarSociosComCache } from '@/lib/prospeccao/inteligencia'
import { avaliarDecisor } from '@/lib/prospeccao/adequacaoDecisor'
import { donoDoEmail } from '@/lib/prospeccao/emailNominal'
import type { ConsultaSocios } from '@/lib/prospeccao/decisores'
import { salvarConsulta } from '@/lib/prospeccao/decisoresServidor'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  const { admin, org } = acc.acesso

  const cnpj = (req.nextUrl.searchParams.get('cnpj') ?? '').replace(/\D/g, '')
  if (!/^\d{14}$/.test(cnpj)) return NextResponse.json({ erro: 'CNPJ inválido.' }, { status: 400 })

  const [empresa, orgRow] = await Promise.all([
    admin.from('catalogo_estabelecimentos').select('cnpj, porte, mei, email').eq('cnpj', cnpj).maybeSingle(),
    admin.from('organizacoes').select('configuracoes').eq('id', org).maybeSingle(),
  ])
  if (empresa.error || orgRow.error) return NextResponse.json({ erro: 'Não foi possível consultar agora.' }, { status: 500 })
  if (!empresa.data) return NextResponse.json({ erro: 'CNPJ fora do catálogo.' }, { status: 404 })

  const r = await consultarSociosComCache({ admin, organizacaoId: org }, cnpj)
  if (!r.ok) {
    return NextResponse.json(
      { erro: r.motivo === 'nao_encontrado' ? 'OpenCNPJ não encontrou este CNPJ.' : 'OpenCNPJ indisponível no momento.' },
      { status: r.motivo === 'nao_encontrado' ? 404 : 502 },
    )
  }
  const perfil = parseWorkspaceConfig(orgRow.data?.configuracoes).prospeccao
  const dono = donoDoEmail(empresa.data.email, r.socios)
  const avaliacao = avaliarDecisor(r.socios, empresa.data, perfil, dono)
  const consulta: ConsultaSocios = {
    socios: avaliacao.socios,
    sugerido: avaliacao.sugerido,
    status: avaliacao.status,
    motivo: avaliacao.motivo,
    // Nome do sócio dono do e-mail cadastral; null = e-mail não é nominal.
    emailNominalDe: dono?.nome ?? null,
  }
  // Guarda para a org não perder a análise ao recarregar (0057). Falha ao
  // guardar não impede a resposta: a consulta em si deu certo.
  await salvarConsulta(admin, org, cnpj, consulta).catch((e) => console.error('[prospeccao/socios] não salvou a consulta:', e))
  return NextResponse.json(consulta)
}
