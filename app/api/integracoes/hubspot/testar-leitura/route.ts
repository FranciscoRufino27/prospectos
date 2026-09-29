import { NextResponse } from 'next/server'
import { exigirPermissao } from '@/lib/rbac/servidor'
import { getValidHubSpotAccessToken, registrarSincronizacao } from '@/lib/integracoes/hubspot/tokens'
import { listarEmpresas } from '@/lib/integracoes/hubspot/companies'
import { listarContatos } from '@/lib/integracoes/hubspot/contacts'
import { listarNegocios } from '@/lib/integracoes/hubspot/deals'
import { listarProprietarios } from '@/lib/integracoes/hubspot/owners'

// Primeira validação da Fase 1: prova ProspectOS → OAuth → HubSpot →
// Companies/Contacts/Deals/Owners. Só LEITURA (até 10 de cada) — nada é
// gravado em leads/empresas.
export const runtime = 'nodejs'

const LIMITE = 10

export async function POST() {
  const acc = await exigirPermissao('workspace.configure')
  if ('erro' in acc) return acc.erro

  const token = await getValidHubSpotAccessToken(acc.acesso.org, { admin: acc.acesso.admin })
  if (!token.ok) {
    const status = token.motivo === 'nao_conectado' ? 404 : 409
    return NextResponse.json({ erro: token.motivo }, { status })
  }

  const [empresas, contatos, negocios, proprietarios] = await Promise.all([
    listarEmpresas(token.accessToken, LIMITE),
    listarContatos(token.accessToken, LIMITE),
    listarNegocios(token.accessToken, LIMITE),
    listarProprietarios(token.accessToken, LIMITE),
  ])

  const falhaAutorizacao = [empresas, contatos, negocios, proprietarios].find(
    (r) => !r.ok && r.codigo === 'nao_autorizado',
  )
  if (falhaAutorizacao) {
    return NextResponse.json({ erro: 'token_sem_autorizacao' }, { status: 409 })
  }

  await registrarSincronizacao(acc.acesso.org, acc.acesso.admin)

  return NextResponse.json({
    empresas: empresas.ok
      ? { ok: true, total: empresas.dados.results.length, amostra: empresas.dados.results.map((e) => ({ id: e.id, nome: e.properties.name })) }
      : { ok: false, mensagem: empresas.mensagem },
    contatos: contatos.ok
      ? { ok: true, total: contatos.dados.results.length, amostra: contatos.dados.results.map((c) => ({ id: c.id, nome: `${c.properties.firstname ?? ''} ${c.properties.lastname ?? ''}`.trim(), email: c.properties.email })) }
      : { ok: false, mensagem: contatos.mensagem },
    negocios: negocios.ok
      ? { ok: true, total: negocios.dados.results.length, amostra: negocios.dados.results.map((d) => ({ id: d.id, nome: d.properties.dealname })) }
      : { ok: false, mensagem: negocios.mensagem },
    proprietarios: proprietarios.ok
      ? { ok: true, total: proprietarios.dados.results.length, amostra: proprietarios.dados.results.map((o) => ({ id: o.id, email: o.email })) }
      : { ok: false, mensagem: proprietarios.mensagem },
  })
}
