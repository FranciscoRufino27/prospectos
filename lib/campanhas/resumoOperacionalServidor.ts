import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { parseWorkspaceConfig } from '@/lib/config/workspaceConfig'
import { remetenteComPadrao } from '@/lib/email/remetenteOrganizacao'
import type { DefinicaoWorkflow } from '@/lib/workflows/types'
import type { ContextoResumoOperacional } from './resumoOperacional'

interface CampanhaParaResumo {
  workflow_id: string | null
  publico: Record<string, unknown> | null
}

interface OpcoesResumoServidor {
  resolverRemetente?: (conta: string) => string | null
}

// Compõe somente contexto de leitura já existente. Toda consulta com service_role
// permanece escopada à organização da sessão; nenhum dado é criado ou alterado.
export async function buscarContextoResumoOperacional(
  admin: SupabaseClient,
  org: string,
  campanha: CampanhaParaResumo,
  opcoes: OpcoesResumoServidor = {},
): Promise<ContextoResumoOperacional> {
  const publico = (campanha.publico ?? {}) as Record<string, unknown>
  const responsavelId = typeof publico.responsavel_id === 'string' ? publico.responsavel_id : null
  const responsavelLegado = typeof publico.responsavel === 'string' && publico.responsavel.trim()
    ? publico.responsavel.trim()
    : null

  let responsavel = responsavelLegado
  if (responsavelId) {
    const { data, error } = await admin
      .from('perfis')
      .select('nome')
      .eq('organizacao_id', org)
      .eq('id', responsavelId)
      .maybeSingle()
    if (error) throw error
    const perfil = data as { nome?: string | null } | null
    responsavel = perfil?.nome?.trim() || responsavelLegado
  }

  // No modo carteira o destino é o responsável de cada lead; o perfil acima é
  // só o fallback. A tela de detalhe mostra a mesma frase que o wizard, para
  // ninguém ler "Responsável: Fulano" e achar que todo retorno vai para ele.
  if (publico.retornoPara === 'lead') {
    responsavel = `Responsável de cada lead (fallback: ${responsavel ?? 'não configurado'})`
  }

  const { data: orgRow, error: orgError } = await admin
    .from('organizacoes')
    .select('configuracoes')
    .eq('id', org)
    .maybeSingle()
  if (orgError) throw orgError
  const config = parseWorkspaceConfig((orgRow as { configuracoes?: unknown } | null)?.configuracoes)
  // Mesma regra do envio (conta conectada → chave legada → padrão); só o e-mail sai daqui.
  const resolverRemetente = opcoes.resolverRemetente
  const remetente = (await remetenteComPadrao(admin, org, {
    config,
    ...(resolverRemetente
      ? { lerCredenciais: (conta: string) => { const user = resolverRemetente(conta); return user ? { user, appPassword: '' } : null } }
      : {}),
  }))?.email ?? null

  let workflow: ContextoResumoOperacional['workflow'] = null
  if (campanha.workflow_id) {
    const { data, error } = await admin
      .from('workflows')
      .select('id, nome, status, versao_atual_id, rascunho_definicao')
      .eq('organizacao_id', org)
      .eq('id', campanha.workflow_id)
      .maybeSingle()
    if (error) throw error
    const wf = data as {
      id: string
      nome: string
      status: string
      versao_atual_id: string | null
      rascunho_definicao: DefinicaoWorkflow | null
    } | null

    if (wf) {
      let definicao = wf.rascunho_definicao
      if (wf.versao_atual_id) {
        const { data: versao, error: versaoError } = await admin
          .from('workflow_versoes')
          .select('definicao')
          .eq('organizacao_id', org)
          .eq('workflow_id', wf.id)
          .eq('id', wf.versao_atual_id)
          .maybeSingle()
        if (versaoError) throw versaoError
        definicao = (versao as { definicao?: DefinicaoWorkflow } | null)?.definicao ?? null
      }
      workflow = { id: wf.id, nome: wf.nome, status: wf.status, definicao }
    }
  }

  return { remetente, responsavel, workflow }
}
