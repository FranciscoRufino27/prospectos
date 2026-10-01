// Busca internacional por nome e país (Crustdata Company Search). Cada chamada
// gasta crédito da conta Crustdata, então só roda no clique de "Buscar"/"Carregar
// mais" da tela. Nada é gravado; a chave fica só no servidor.
import { NextResponse } from 'next/server'
import { resolverAcesso } from '@/lib/rbac/servidor'
import { buscarEmpresasCrustdata, MENSAGEM_FALHA, normalizarBuscaInternacional } from '@/lib/prospeccao/crustdata'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro

  const busca = normalizarBuscaInternacional(await req.json().catch(() => null))
  if (!busca) return NextResponse.json({ erro: 'Informe o nome da empresa (2+ letras) ou o país.' }, { status: 400 })

  const r = await buscarEmpresasCrustdata(busca, process.env.CRUSTDATA_API_KEY)
  if (!r.ok) {
    if (r.motivo === 'indisponivel' || r.motivo === 'sem_chave') console.error('[prospeccao/internacional] falha:', r.motivo)
    const { texto, status } = MENSAGEM_FALHA[r.motivo]
    return NextResponse.json({ erro: texto }, { status })
  }
  return NextResponse.json(r.resposta)
}
