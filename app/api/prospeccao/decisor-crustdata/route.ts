// Decisores pela Crustdata (People Search) no domínio da empresa: pessoas que
// trabalham lá hoje com cargo de decisão (cargos-alvo do perfil). Paga: só no
// clique, e o resultado salvo é devolvido sem nova cobrança.
import { NextResponse } from 'next/server'
import { resolverAcesso } from '@/lib/rbac/servidor'
import { buscarDecisoresCrustdata, LIMITE_CANDIDATOS, MENSAGEM_FALHA_ENRIQUECIMENTO, titulosDeDecisao } from '@/lib/prospeccao/enriquecimento'
import { buscarPessoasComCache } from '@/lib/prospeccao/inteligencia'
import { contextoDaEmpresa } from '@/lib/prospeccao/enriquecimentoServidor'
import { lerEnriquecimentoSalvo, salvarEnriquecimento } from '@/lib/prospeccao/decisoresServidor'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  const { admin, org } = acc.acesso

  const corpo = (await req.json().catch(() => ({}))) as { cnpj?: unknown }
  const cnpj = typeof corpo.cnpj === 'string' ? corpo.cnpj.replace(/\D/g, '') : ''
  const ctx = await contextoDaEmpresa(admin, org, cnpj)
  if (!ctx.ok) return NextResponse.json({ erro: ctx.erro }, { status: ctx.status })

  try {
    // Já pago para este domínio pela org: devolve o salvo, sem nova cobrança.
    // Lista vazia passa pelo cache de inteligência, que guarda o "não achou"
    // por 30 dias (e o que outra org já pagou para o mesmo domínio).
    const salvo = await lerEnriquecimentoSalvo(admin, org, cnpj).catch(() => null)
    if (salvo?.crustdata?.dominio === ctx.dominio && salvo.crustdata.candidatos.length > 0) return NextResponse.json({ ...salvo.crustdata, reaproveitado: true })

    const titulos = titulosDeDecisao(ctx.perfil?.cargosAlvo)
    const r = await buscarPessoasComCache({ admin, organizacaoId: org }, ctx.dominio, titulos, LIMITE_CANDIDATOS,
      () => buscarDecisoresCrustdata(ctx.dominio, titulos, process.env.CRUSTDATA_API_KEY))
    if (!r.ok) {
      console.error('[prospeccao/decisor-crustdata] falha:', r.motivo)
      const { texto, status } = MENSAGEM_FALHA_ENRIQUECIMENTO[r.motivo]
      return NextResponse.json({ erro: `Crustdata: ${texto}` }, { status })
    }
    const crustdata = { dominio: ctx.dominio, candidatos: r.candidatos, consultadoEm: new Date().toISOString() }
    // Guardar falhou (ex.: banco sem a 0060): a consulta já foi paga, então
    // entrega o resultado mesmo assim.
    await salvarEnriquecimento(admin, org, cnpj, { crustdata }).catch((e) => console.error('[prospeccao/decisor-crustdata] não salvou:', e))
    return NextResponse.json({ ...crustdata, reaproveitado: false })
  } catch (e) {
    console.error('[prospeccao/decisor-crustdata] erro:', e)
    return NextResponse.json({ erro: 'Não foi possível buscar o decisor agora.' }, { status: 500 })
  }
}
