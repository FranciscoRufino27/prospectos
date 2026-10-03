// Busca de prospecção no catálogo RF (migration 0050/0051). POST porque o
// filtro é um objeto; a organização vem da sessão, nunca do corpo.
import { NextResponse } from 'next/server'
import { resolverAcesso } from '@/lib/rbac/servidor'
import { parseWorkspaceConfig, UFS_BRASIL } from '@/lib/config/workspaceConfig'
import { cnpjDoTexto, cursorValido, filtrosDoPerfil, filtrosEspecificos, limitePagina, normalizarFiltros } from '@/lib/prospeccao/filtros'
import { municipiosDaCidade, normalizarTextoMunicipio } from '@/lib/prospeccao/municipios'
import { listarMunicipios } from '@/lib/prospeccao/municipiosServidor'
import { buscarProspeccao, statusCatalogo } from '@/lib/prospeccao/buscaServidor'
import { siteValido } from '@/lib/prospeccao/crustdata'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  const { admin, org, role } = acc.acesso

  try {
    const corpo = (await req.json().catch(() => ({}))) as {
      filtros?: unknown; cursor?: unknown; limite?: unknown; especifica?: unknown; uf?: unknown; cidade?: unknown; site?: unknown
    }
    const { data: orgRow, error } = await admin.from('organizacoes').select('configuracoes').eq('id', org).maybeSingle()
    if (error) throw error
    const perfil = parseWorkspaceConfig(orgRow?.configuracoes).prospeccao
    let filtros = normalizarFiltros(corpo.filtros, perfil)
    if (corpo.especifica === true) {
      // Empresa específica: ignora o perfil e procura em todo o catálogo pelo
      // nome/CNPJ, no estado escolhido (obrigatório, salvo CNPJ) e, se vier, na
      // cidade. Sem catálogo carregado, cai nas atividades do perfil.
      const texto = filtros.texto.replace(/\\(.)/g, '$1')
      const ehCnpj = cnpjDoTexto(texto) !== null
      const uf = typeof corpo.uf === 'string' && (UFS_BRASIL as readonly string[]).includes(corpo.uf) ? corpo.uf : null
      // Com o site, o estado vira opcional: o site já identifica a empresa.
      if (!uf && !ehCnpj && !siteValido(corpo.site)) return NextResponse.json({ erro: 'Escolha o estado da empresa.' }, { status: 400 })
      let municipios: string[] = []
      const cidade = normalizarTextoMunicipio(corpo.cidade)
      if (uf && cidade && !ehCnpj) {
        municipios = municipiosDaCidade(await listarMunicipios(admin, { ufs: [uf], texto: cidade, codigos: [] }), cidade.replace(/\\(.)/g, '$1'))
        // Cidade sem empresa no catálogo: nada a buscar aqui (a tela segue na Crustdata).
        if (municipios.length === 0) {
          return NextResponse.json({ itens: [], proximoCursor: null, total: 0, totalComEmail: 0, catalogo: await statusCatalogo(admin), filtros, perfil: filtrosDoPerfil(perfil), temPerfil: !!perfil?.cnaes?.length, paisesInternacional: perfil?.paises ?? [], ehAdmin: role === 'admin' })
        }
      }
      const catalogo = await statusCatalogo(admin)
      const especificos = filtrosEspecificos(texto, catalogo?.cnaes.length ? catalogo.cnaes : perfil?.cnaes ?? [], ehCnpj ? {} : { ufs: uf ? [uf] : [], municipios })
      if (!especificos) return NextResponse.json({ erro: 'Digite ao menos 2 letras do nome ou o CNPJ.' }, { status: 400 })
      filtros = especificos
    }
    const cursor = cursorValido(corpo.cursor)
    const resposta = await buscarProspeccao(admin, org, filtros, cursor, {
      contar: cursor === null,
      limite: limitePagina(corpo.limite),
    })
    return NextResponse.json({
      ...resposta,
      filtros,
      perfil: filtrosDoPerfil(perfil),
      temPerfil: !!perfil?.cnaes?.length,
      // Países-alvo da aba Internacional (os nichos vêm de `perfil.cnaes`).
      paisesInternacional: perfil?.paises ?? [],
      // Só exibição: administradores veem o selo de procedência da Receita.
      ehAdmin: role === 'admin',
    })
  } catch (err) {
    console.error('[prospeccao/busca] erro:', err)
    return NextResponse.json({ erro: 'Não foi possível buscar agora.' }, { status: 500 })
  }
}
