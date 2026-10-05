// Decisor automático de UMA empresa do catálogo: sócio sugerido (OpenCNPJ) →
// e-mail dele (Anymail) → LinkedIn/cargo (Crustdata). A tela chama empresa a
// empresa até completar a meta da busca. Paga: o que a org já consultou é
// reaproveitado sem nova cobrança. `org` vem SEMPRE da sessão.
import { NextResponse } from 'next/server'
import { resolverAcesso } from '@/lib/rbac/servidor'
import { parseWorkspaceConfig } from '@/lib/config/workspaceConfig'
import { buscarDecisoresCrustdata, buscarEmailAnymail, LIMITE_CANDIDATOS } from '@/lib/prospeccao/enriquecimento'
import { buscarEmailComCache, buscarPessoasComCache, consultarSociosComCache } from '@/lib/prospeccao/inteligencia'
import { carregarAnalises, salvarConsulta, salvarDecisor, salvarEnriquecimento } from '@/lib/prospeccao/decisoresServidor'
import { resolverDecisorAutomatico } from '@/lib/prospeccao/decisorAutomatico'
import { travasDaConfig } from '@/lib/prospeccao/travasCusto'
import type { AnaliseSalva } from '@/lib/prospeccao/decisores'

export const runtime = 'nodejs'
// OpenCNPJ (8s) + Anymail (até 50s) + Crustdata (20s) no pior caso.
export const maxDuration = 90

export async function POST(req: Request) {
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  const { admin, org, user } = acc.acesso

  const corpo = (await req.json().catch(() => ({}))) as { cnpj?: unknown }
  const cnpj = typeof corpo.cnpj === 'string' ? corpo.cnpj.replace(/\D/g, '') : ''
  if (!/^\d{14}$/.test(cnpj)) return NextResponse.json({ erro: 'CNPJ inválido.' }, { status: 400 })

  try {
    const [empresa, orgRow] = await Promise.all([
      admin.from('catalogo_estabelecimentos').select('cnpj, porte, mei, email, razao_social, nome_fantasia').eq('cnpj', cnpj).maybeSingle(),
      admin.from('organizacoes').select('configuracoes').eq('id', org).maybeSingle(),
    ])
    if (empresa.error || orgRow.error) return NextResponse.json({ erro: 'Não foi possível consultar agora.' }, { status: 500 })
    // Só CNPJ do catálogo: a rota não é um proxy aberto das APIs pagas.
    if (!empresa.data) return NextResponse.json({ erro: 'CNPJ fora do catálogo.' }, { status: 404 })

    const config = parseWorkspaceConfig(orgRow.data?.configuracoes)
    const perfil = config.prospeccao
    // Sem o salvo (falha de leitura), segue consultando: só perde o reaproveitamento.
    const analises = await carregarAnalises(admin, org, [cnpj]).catch((e) => {
      console.error('[prospeccao/decisor-automatico] sem análise salva:', e)
      return {} as Record<string, AnaliseSalva>
    })
    const salvo = analises[cnpj] ?? null

    // Toda consulta externa passa antes pelo cache de inteligência (global).
    // Travas de custo da org (liga/desliga + orçamento) valem para Crustdata e Anymail.
    const intel = { admin, organizacaoId: org, travas: travasDaConfig(config.enriquecimentoPago), usuarioId: user.id }
    const r = await resolverDecisorAutomatico(empresa.data, perfil, salvo, {
      consultarSocios: (c) => consultarSociosComCache(intel, c),
      buscarEmail: (nome, dominio) => buscarEmailComCache(intel, nome, dominio,
        () => buscarEmailAnymail(nome, dominio, process.env.ANYMAILFINDER_API_KEY)),
      buscarPessoas: (alvo, titulos) => buscarPessoasComCache(intel, alvo, titulos, LIMITE_CANDIDATOS,
        () => buscarDecisoresCrustdata(alvo, titulos, process.env.CRUSTDATA_API_KEY)),
      salvarConsulta: (consulta) => salvarConsulta(admin, org, cnpj, consulta),
      salvarEnriquecimento: async (parte) => { await salvarEnriquecimento(admin, org, cnpj, parte) },
      salvarDecisor: (d) => salvarDecisor(admin, org, user.id, { cnpj, nome: d.nome, cargo: d.cargo || null, linkedin: d.linkedin ?? null }),
    })
    if (r.status === 'falha') return NextResponse.json({ erro: r.erro }, { status: r.httpStatus })
    return NextResponse.json(r)
  } catch (e) {
    console.error('[prospeccao/decisor-automatico] erro:', e)
    return NextResponse.json({ erro: 'Não foi possível buscar o decisor agora.' }, { status: 500 })
  }
}
