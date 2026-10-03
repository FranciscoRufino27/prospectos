// Busca internacional (Crustdata Company Search) por nicho/país ou de uma
// empresa específica. Cada chamada gasta crédito, então só roda no clique.
// Nada é gravado; a chave fica só no servidor.
import { NextResponse } from 'next/server'
import { resolverAcesso } from '@/lib/rbac/servidor'
import {
  buscarEmpresasCrustdata, CANDIDATAS_BUSCA_ESPECIFICA, MENSAGEM_FALHA, nomeCasa, normalizarBuscaInternacional, ordenarBuscaEspecifica,
  type BuscaInternacional,
} from '@/lib/prospeccao/crustdata'
import { LIMITE_BUSCA_ESPECIFICA } from '@/lib/prospeccao/filtros'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro

  const corpo = await req.json().catch(() => null)
  const busca = normalizarBuscaInternacional(corpo)
  if (!busca) return NextResponse.json({ erro: 'Informe o nome da empresa (2+ letras) ou o país.' }, { status: 400 })
  const especifica = !!corpo && typeof corpo === 'object' && (corpo as { especifica?: unknown }).especifica === true && busca.nome !== ''

  const porSite = !!corpo && typeof corpo === 'object' && (corpo as { especifica?: unknown }).especifica === true && !!busca.site
  if (porSite) {
    // Pelo site: filtro exato no domínio. Sem cadastro na Crustdata, devolve a
    // empresa só com o domínio — o decisor é procurado direto nele.
    const r = await buscarEmpresasCrustdata({ ...busca, cursor: null, limite: LIMITE_BUSCA_ESPECIFICA }, process.env.CRUSTDATA_API_KEY)
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
      const r = await buscarEmpresasCrustdata(tentativa, process.env.CRUSTDATA_API_KEY)
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

  const r = await buscarEmpresasCrustdata(busca, process.env.CRUSTDATA_API_KEY)
  if (!r.ok) {
    if (r.motivo === 'indisponivel' || r.motivo === 'sem_chave') console.error('[prospeccao/internacional] falha:', r.motivo)
    const { texto, status } = MENSAGEM_FALHA[r.motivo]
    return NextResponse.json({ erro: texto }, { status })
  }
  return NextResponse.json(r.resposta)
}
