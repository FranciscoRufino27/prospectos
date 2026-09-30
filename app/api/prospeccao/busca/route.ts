// Busca de prospecção no catálogo RF (migration 0050/0051). POST porque o
// filtro é um objeto; a organização vem da sessão, nunca do corpo.
import { NextResponse } from 'next/server'
import { resolverAcesso } from '@/lib/rbac/servidor'
import { parseWorkspaceConfig } from '@/lib/config/workspaceConfig'
import { cursorValido, filtrosDoPerfil, limitePagina, normalizarFiltros } from '@/lib/prospeccao/filtros'
import { buscarProspeccao } from '@/lib/prospeccao/buscaServidor'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  const { admin, org, role } = acc.acesso

  try {
    const corpo = (await req.json().catch(() => ({}))) as { filtros?: unknown; cursor?: unknown; limite?: unknown }
    const { data: orgRow, error } = await admin.from('organizacoes').select('configuracoes').eq('id', org).maybeSingle()
    if (error) throw error
    const perfil = parseWorkspaceConfig(orgRow?.configuracoes).prospeccao
    const filtros = normalizarFiltros(corpo.filtros, perfil)
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
      // Só exibição: administradores veem o selo de procedência da Receita.
      ehAdmin: role === 'admin',
    })
  } catch (err) {
    console.error('[prospeccao/busca] erro:', err)
    return NextResponse.json({ erro: 'Não foi possível buscar agora.' }, { status: 500 })
  }
}
