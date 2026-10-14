// Busca internacional (Crustdata Company Search) por nicho/país ou de uma
// empresa específica. Cada chamada gasta crédito, então só roda no clique.
// Nada é gravado; a chave fica só no servidor.
import { NextResponse } from 'next/server'
import { resolverAcesso } from '@/lib/rbac/servidor'
import {
  buscarEmpresasCrustdata, CANDIDATAS_BUSCA_ESPECIFICA, CREDITO_POR_EMPRESA, LIMITE_INTERNACIONAL, MENSAGEM_FALHA, nomeCasa, normalizarBuscaInternacional, ordenarBuscaEspecifica,
  type BuscaInternacional,
} from '@/lib/prospeccao/crustdata'
import { LIMITE_BUSCA_ESPECIFICA } from '@/lib/prospeccao/filtros'
import { parseWorkspaceConfig } from '@/lib/config/workspaceConfig'
import { autorizarGasto, registrarConsumo, travasDaConfig, type ContextoCusto } from '@/lib/prospeccao/travasCusto'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  const { admin, org, user } = acc.acesso

  // Travas de custo: cada busca na Crustdata passa por liga/desliga + orçamento
  // da org e vira uma linha de consumo (0,03 crédito por empresa devolvida).
  const orgRow = await admin.from('organizacoes').select('configuracoes').eq('id', org).maybeSingle()
  if (orgRow.error) return NextResponse.json({ erro: 'Não foi possível consultar agora.' }, { status: 500 })
  const custo: ContextoCusto = { admin, organizacaoId: org, travas: travasDaConfig(parseWorkspaceConfig(orgRow.data?.configuracoes).enriquecimentoPago), usuarioId: user.id }
  const buscarPago = async (b: BuscaInternacional) => {
    const autorizacao = await autorizarGasto(custo, 'crustdata', (b.limite ?? LIMITE_INTERNACIONAL) * CREDITO_POR_EMPRESA)
    if (!autorizacao.ok) return { ok: false as const, bloqueio: autorizacao }
    const r = await buscarEmpresasCrustdata(b, process.env.CRUSTDATA_API_KEY)
    if (r.ok || r.motivo !== 'sem_chave') {
      await registrarConsumo(custo, {
        fonte: 'crustdata', operacao: 'empresas_busca', origem: 'api',
        resultado: r.ok ? (r.resposta.itens.length ? 'ok' : 'nao_encontrado') : 'falha',
        custo: r.ok ? r.resposta.itens.length * CREDITO_POR_EMPRESA : 0,
        referencia: b.site || b.nome || b.paises.join(','),
      })
    }
    return r
  }
  const bloqueado = (a: { motivo: string; detalhe: string }) =>
    NextResponse.json({ erro: a.motivo === 'pago_desligado' ? 'Busca internacional: enriquecimento pago desligado para esta organização.' : `Busca internacional: ${a.detalhe}.` }, { status: a.motivo === 'pago_desligado' ? 503 : 402 })

  const corpo = await req.json().catch(() => null)
  const busca = normalizarBuscaInternacional(corpo)
  if (!busca) return NextResponse.json({ erro: 'Informe o nome da empresa (2+ letras) ou o país.' }, { status: 400 })
  const especifica = !!corpo && typeof corpo === 'object' && (corpo as { especifica?: unknown }).especifica === true && busca.nome !== ''

  const porSite = !!corpo && typeof corpo === 'object' && (corpo as { especifica?: unknown }).especifica === true && !!busca.site
  if (porSite) {
    // Pelo site: filtro exato no domínio. Sem cadastro na Crustdata, devolve a
    // empresa só com o domínio — o decisor é procurado direto nele.
    const r = await buscarPago({ ...busca, cursor: null, limite: LIMITE_BUSCA_ESPECIFICA })
    if (!r.ok && 'bloqueio' in r) return bloqueado(r.bloqueio)
    if (!r.ok) {
      if (r.motivo === 'indisponivel' || r.motivo === 'sem_chave') console.error('[prospeccao/internacional] falha:', r.motivo)
      const { texto, status } = MENSAGEM_FALHA[r.motivo]
      return NextResponse.json({ erro: texto }, { status })
    }
    const itens = r.resposta.itens.length ? r.resposta.itens : [{
      id: 0, nome: busca.nome || busca.site!, dominio: busca.site!, site: `https://${busca.site}`, linkedin: null,
      pais: null, cidade: null, sede: null, fundacao: null, funcionarios: null, tipo: null,
    }]
    return NextResponse.json({ itens, proximoCursor: null, total: itens.length })
  }

  if (especifica) {
    // Empresa específica: pede mais candidatas, ordena (nome exato, porte) e
    // devolve as melhores. Muito cadastro não tem cidade/estado preenchido:
    // se o local zerar o resultado, tenta sem a cidade e depois sem o estado.
    const tentativas: BuscaInternacional[] = [
      { ...busca, cursor: null, limite: undefined },
      ...(busca.cidade ? [{ ...busca, cursor: null, limite: undefined, cidade: undefined }] : []),
      ...(busca.estado ? [{ ...busca, cursor: null, limite: undefined, cidade: undefined, estado: undefined }] : []),
    ].map((b) => ({ ...b, limite: CANDIDATAS_BUSCA_ESPECIFICA - 1 }))
    for (const tentativa of tentativas) {
      const r = await buscarPago(tentativa)
      if (!r.ok && 'bloqueio' in r) return bloqueado(r.bloqueio)
      if (!r.ok) {
        if (r.motivo === 'indisponivel' || r.motivo === 'sem_chave') console.error('[prospeccao/internacional] falha:', r.motivo)
        const { texto, status } = MENSAGEM_FALHA[r.motivo]
        return NextResponse.json({ erro: texto }, { status })
      }
      // Só empresas com o nome buscado no nome (a busca da Crustdata também
      // casa descrição etc.); sem nenhuma assim, relaxa o local.
      const comNome = r.resposta.itens.filter((e) => nomeCasa(e.nome, busca.nome))
      if (comNome.length > 0) {
        const itens = ordenarBuscaEspecifica(comNome, busca.nome).slice(0, LIMITE_BUSCA_ESPECIFICA)
        return NextResponse.json({ itens, proximoCursor: null, total: r.resposta.total, localRelaxado: tentativa !== tentativas[0] })
      }
    }
    return NextResponse.json({ itens: [], proximoCursor: null, total: 0 })
  }

  const r = await buscarPago(busca)
  if (!r.ok && 'bloqueio' in r) return bloqueado(r.bloqueio)
  if (!r.ok) {
    if (r.motivo === 'indisponivel' || r.motivo === 'sem_chave') console.error('[prospeccao/internacional] falha:', r.motivo)
    const { texto, status } = MENSAGEM_FALHA[r.motivo]
    return NextResponse.json({ erro: texto }, { status })
  }
  return NextResponse.json(r.resposta)
}
