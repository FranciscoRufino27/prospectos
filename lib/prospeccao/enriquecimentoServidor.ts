// Contexto comum das rotas de enriquecimento pago: a empresa precisa estar no
// catálogo RF (a rota não é um proxy aberto das APIs pagas) e ter domínio
// próprio, tirado do e-mail cadastral. `org` vem SEMPRE da sessão.

import type { SupabaseClient } from '@supabase/supabase-js'
import { parseWorkspaceConfig, type ProspeccaoConfig } from '@/lib/config/workspaceConfig'
import { dominioDaEmpresa } from './dominioEmpresa'
import { travasDaConfig, type TravasCusto } from './travasCusto'

export type ContextoEmpresa =
  | { ok: true; dominio: string; perfil: ProspeccaoConfig | undefined; travas: TravasCusto }
  | { ok: false; erro: string; status: number }

export async function contextoDaEmpresa(admin: SupabaseClient, org: string, cnpj: string): Promise<ContextoEmpresa> {
  if (!/^\d{14}$/.test(cnpj)) return { ok: false, erro: 'CNPJ inválido.', status: 400 }
  const [empresa, orgRow] = await Promise.all([
    admin.from('catalogo_estabelecimentos').select('cnpj, email, nome_fantasia, razao_social').eq('cnpj', cnpj).maybeSingle(),
    admin.from('organizacoes').select('configuracoes').eq('id', org).maybeSingle(),
  ])
  if (empresa.error || orgRow.error) return { ok: false, erro: 'Não foi possível consultar agora.', status: 500 }
  if (!empresa.data) return { ok: false, erro: 'CNPJ fora do catálogo.', status: 404 }
  const dominio = dominioDaEmpresa(empresa.data.email, [empresa.data.nome_fantasia, empresa.data.razao_social])
  if (!dominio) {
    return { ok: false, erro: 'A empresa não tem domínio próprio (o e-mail da Receita é pessoal, de contador ou ausente).', status: 422 }
  }
  const config = parseWorkspaceConfig(orgRow.data?.configuracoes)
  return { ok: true, dominio: dominio.dominio, perfil: config.prospeccao, travas: travasDaConfig(config.enriquecimentoPago) }
}
