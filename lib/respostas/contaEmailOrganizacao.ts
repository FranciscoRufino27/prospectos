import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { EmailProvider } from '@/lib/engine/email/provider'
import { GmailProvider, lerCredenciaisGmail, type GmailCredenciais } from '@/lib/engine/email/gmailProvider'
import { parseWorkspaceConfig } from '@/lib/config/workspaceConfig'
import { situacaoRemetenteOrganizacao } from '@/lib/email/remetenteOrganizacao'

// Conta de e-mail de uma organização para envios HUMANOS a um lead (resposta
// pela Central, proposta ao cliente). Regra única — antes vivia inline em
// enviarEmailCentral, idêntica ao fluxo de campanha:
//   conta conectada pela org (ou chave legada) → essa conta
//   (lib/email/remetenteOrganizacao);
//   configurada mas inutilizável → bloqueia (nunca cai na conta padrão de
//   outra operação);
//   nenhuma → provedor padrão do motor.
// `organizacaoId` vem sempre da sessão; a leitura filtra pelo id da organização.

export type ContaEmailOrganizacao =
  | { ok: true; provider: EmailProvider; nomeServico: string }
  | { ok: false; codigo: 'credencial_ausente'; mensagem: string }

export async function resolverContaEmailOrganizacao(
  db: SupabaseClient,
  organizacaoId: string,
  providerPadrao: EmailProvider,
  lerCredenciais: (chave: string) => GmailCredenciais | null = lerCredenciaisGmail,
): Promise<ContaEmailOrganizacao> {
  const { data: orgRow } = await db
    .from('organizacoes')
    .select('nome, configuracoes')
    .eq('id', organizacaoId)
    .maybeSingle()
  const orgData = orgRow as { nome?: string; configuracoes?: Record<string, unknown> } | null
  const nomenclaturas = orgData?.configuracoes?.['nomenclaturas'] as Record<string, string> | undefined
  const nomeServico = nomenclaturas?.['nome_servico'] ?? orgData?.nome ?? ''
  const situacao = await situacaoRemetenteOrganizacao(db, organizacaoId, {
    lerCredenciais,
    config: parseWorkspaceConfig(orgData?.configuracoes),
  })
  if (situacao.estado === 'incompleto') {
    return { ok: false, codigo: 'credencial_ausente', mensagem: situacao.mensagem }
  }
  const provider = situacao.estado === 'pronto' ? new GmailProvider(situacao.remetente.credenciais) : providerPadrao
  return { ok: true, provider, nomeServico }
}
