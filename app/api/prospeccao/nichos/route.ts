// Nichos criados pela organização. GET para qualquer sessão (a equipe busca
// por eles); criar exige workspace.configure, como o perfil de busca. Criar
// um nicho com atividade fora do catálogo já registra o pedido de carga.
// Sem atividades no corpo, elas saem do nome (pesquisa só com correspondência forte).
import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { exigirPermissao, resolverAcesso } from '@/lib/rbac/servidor'
import { statusCatalogo } from '@/lib/prospeccao/buscaServidor'
import { pedirCarga } from '@/lib/prospeccao/catalogoRf/pedidos'
import { adicionarNicho, donosDasAtividades } from '@/lib/prospeccao/nichosPersonalizados'
import { gravarNichos, respostaNichos } from '@/lib/prospeccao/nichosServidor'
import { lerConfig } from '@/lib/prospeccao/pesquisasServidor'
import { buscarAtividades, cnaeExiste, descricaoCnae } from '@/lib/prospeccao/referenciaIbge'

export const runtime = 'nodejs'

export async function GET() {
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  const { admin, org, permissoes } = acc.acesso
  try {
    const config = await lerConfig(admin, org)
    return NextResponse.json(await respostaNichos(admin, org, config.prospeccaoNichos ?? [], permissoes.has('workspace.configure')))
  } catch (err) {
    console.error('[prospeccao/nichos GET] erro:', err)
    return NextResponse.json({ erro: 'Não foi possível carregar os nichos.' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const acc = await exigirPermissao('workspace.configure')
  if ('erro' in acc) return acc.erro
  const { admin, org, user } = acc.acesso
  try {
    const corpo = (await req.json().catch(() => ({}))) as { nome?: unknown; cnaes?: unknown }
    const config = await lerConfig(admin, org)
    const lista = config.prospeccaoNichos ?? []
    // Só o nome: as atividades vêm da pesquisa pelo nome, só as correspondências
    // fortes e livres (fora de outro nicho). A resposta diz quais entraram.
    const semAtividade = !Array.isArray(corpo.cnaes) || corpo.cnaes.length === 0
    if (semAtividade && typeof corpo.nome === 'string' && corpo.nome.trim()) {
      const donos = donosDasAtividades(lista)
      const achadas = await buscarAtividades(corpo.nome, 8, { soFortes: true })
      const livres = achadas.map((a) => a.codigo).filter((c) => !donos.has(c))
      if (!livres.length) {
        const ocupada = achadas.find((a) => donos.has(a.codigo))
        const erro = ocupada
          ? `"${ocupada.nome}" já está no nicho ${donos.get(ocupada.codigo)}. Pesquise outra atividade em "Atividades da Receita".`
          : `Não achamos atividade da Receita para "${corpo.nome.trim()}". Pesquise a atividade em "Atividades da Receita".`
        return NextResponse.json({ erro }, { status: 422 })
      }
      corpo.cnaes = livres
    }
    const r = adicionarNicho(lista, corpo, randomUUID(), new Date().toISOString(), cnaeExiste, descricaoCnae)
    if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status })
    const gravada = await gravarNichos(admin, org, config, r.lista)
    const catalogo = await statusCatalogo(admin)
    const pedido = await pedirCarga(admin, org, user.id, r.nicho.cnaes, catalogo?.cnaes ?? [])
    return NextResponse.json({ nichoId: r.nicho.id, pedido, ...(await respostaNichos(admin, org, gravada, true)) }, { status: 201 })
  } catch (err) {
    console.error('[prospeccao/nichos POST] erro:', err)
    return NextResponse.json({ erro: 'Não foi possível criar o nicho.' }, { status: 500 })
  }
}
