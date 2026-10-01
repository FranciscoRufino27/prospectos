// E-mail do decisor pela Anymail Finder (nome + domínio da empresa). Cobra 1
// crédito só quando acha e-mail válido. A mesma pessoa no mesmo domínio não é
// consultada de novo: o resultado salvo volta sem cobrança.
import { NextResponse } from 'next/server'
import { resolverAcesso } from '@/lib/rbac/servidor'
import { buscarEmailAnymail, MENSAGEM_FALHA_ENRIQUECIMENTO } from '@/lib/prospeccao/enriquecimento'
import { contextoDaEmpresa } from '@/lib/prospeccao/enriquecimentoServidor'
import { lerEnriquecimentoSalvo, salvarEnriquecimento } from '@/lib/prospeccao/decisoresServidor'
import { soLetras } from '@/lib/prospeccao/emailNominal'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: Request) {
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  const { admin, org } = acc.acesso

  const corpo = (await req.json().catch(() => ({}))) as { cnpj?: unknown; nome?: unknown }
  const cnpj = typeof corpo.cnpj === 'string' ? corpo.cnpj.replace(/\D/g, '') : ''
  const nome = typeof corpo.nome === 'string' ? corpo.nome.replace(/\s+/g, ' ').trim().slice(0, 120) : ''
  // Nome e sobrenome: só o primeiro nome não identifica a pessoa.
  if (nome.split(' ').filter((p) => soLetras(p).length > 0).length < 2) {
    return NextResponse.json({ erro: 'Informe nome e sobrenome do decisor.' }, { status: 400 })
  }
  const ctx = await contextoDaEmpresa(admin, org, cnpj)
  if (!ctx.ok) return NextResponse.json({ erro: ctx.erro }, { status: ctx.status })

  try {
    const salvo = await lerEnriquecimentoSalvo(admin, org, cnpj).catch(() => null)
    // "Não encontrado" não foi cobrado: pode tentar de novo.
    const anterior = salvo?.anymail
    if (anterior && anterior.status !== 'nao_encontrado' && anterior.dominio === ctx.dominio && soLetras(anterior.nome) === soLetras(nome)) {
      return NextResponse.json({ ...anterior, reaproveitado: true })
    }

    const r = await buscarEmailAnymail(nome, ctx.dominio, process.env.ANYMAILFINDER_API_KEY)
    if (!r.ok) {
      console.error('[prospeccao/email-decisor] falha:', r.motivo)
      const { texto, status } = MENSAGEM_FALHA_ENRIQUECIMENTO[r.motivo]
      return NextResponse.json({ erro: `Anymail: ${texto}` }, { status })
    }
    await salvarEnriquecimento(admin, org, cnpj, { anymail: r.resultado }).catch((e) => console.error('[prospeccao/email-decisor] não salvou:', e))
    return NextResponse.json({ ...r.resultado, reaproveitado: false })
  } catch (e) {
    console.error('[prospeccao/email-decisor] erro:', e)
    return NextResponse.json({ erro: 'Não foi possível buscar o e-mail agora.' }, { status: 500 })
  }
}
