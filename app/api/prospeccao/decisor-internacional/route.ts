// Decisor automático de UMA empresa da busca internacional: pessoa com
// cargo-alvo no domínio (Crustdata) → e-mail dela (Anymail). A tela chama
// empresa a empresa até completar a meta. Pago: o que a org já consultou para
// o domínio é reaproveitado sem nova cobrança (0061). `org` vem da sessão.
import { NextResponse } from 'next/server'
import { resolverAcesso } from '@/lib/rbac/servidor'
import { parseWorkspaceConfig } from '@/lib/config/workspaceConfig'
import { buscarDecisoresCrustdata, buscarEmailAnymail } from '@/lib/prospeccao/enriquecimento'
import { CANDIDATOS_EMAIL_INTERNACIONAL, resolverDecisorInternacional } from '@/lib/prospeccao/decisorAutomatico'
import { dominioValido, lerDecisorInternacional, salvarDecisorInternacional } from '@/lib/prospeccao/decisoresInternacionaisServidor'

export const runtime = 'nodejs'
// Crustdata (20s) + até 2 consultas Anymail (50s cada) no pior caso.
export const maxDuration = 120

export async function POST(req: Request) {
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  const { admin, org } = acc.acesso

  const corpo = (await req.json().catch(() => ({}))) as { dominio?: unknown; nome?: unknown }
  const dominio = dominioValido(corpo.dominio)
  if (!dominio) return NextResponse.json({ erro: 'Domínio inválido.' }, { status: 400 })

  try {
    const orgRow = await admin.from('organizacoes').select('configuracoes').eq('id', org).maybeSingle()
    if (orgRow.error) return NextResponse.json({ erro: 'Não foi possível consultar agora.' }, { status: 500 })
    const perfil = parseWorkspaceConfig(orgRow.data?.configuracoes).prospeccao
    // Sem a tabela da 0061 (ou falha de leitura) segue consultando: só perde o cache.
    const salvo = await lerDecisorInternacional(admin, org, dominio).catch((e) => {
      console.error('[prospeccao/decisor-internacional] sem cache:', e)
      return null
    })

    const r = await resolverDecisorInternacional(dominio, perfil, salvo, {
      // Só pede quantas pessoas vai tentar na Anymail: cada uma devolvida custa.
      buscarPessoas: (alvo, titulos) => buscarDecisoresCrustdata(alvo, titulos, process.env.CRUSTDATA_API_KEY, fetch, CANDIDATOS_EMAIL_INTERNACIONAL),
      buscarEmail: (nome, d) => buscarEmailAnymail(nome, d, process.env.ANYMAILFINDER_API_KEY),
      salvar: (parte) => salvarDecisorInternacional(admin, org, dominio, parte),
    }, typeof corpo.nome === 'string' ? corpo.nome.replace(/\s+/g, ' ').trim().slice(0, 120) : null)
    if (r.status === 'falha') return NextResponse.json({ erro: r.erro }, { status: r.httpStatus })
    return NextResponse.json(r)
  } catch (e) {
    console.error('[prospeccao/decisor-internacional] erro:', e)
    return NextResponse.json({ erro: 'Não foi possível buscar o decisor agora.' }, { status: 500 })
  }
}
