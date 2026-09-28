// Resolução SERVER-SIDE do responsável de um lead: dado um usuário de AUTH
// (membro da equipe escolhido no seletor, ou o próprio usuário logado no cadastro
// manual), descobre a linha de `usuarios` que vai em leads.responsavel_id.
//
// Usa o bridge PURO de ./responsavel (e-mail exato > nome único; ambíguo PARA).
// Aqui só monta o "roster" (equipe) e a lista de `usuarios` da organização a
// partir do client admin (service role) e chama o bridge. Nunca é importado no
// browser — depende do admin client.
import type { SupabaseClient } from '@supabase/supabase-js'
import { membroDoUsuario, vincularResponsavel, type MembroEquipe, type UsuarioRef, type VinculoResponsavel } from './responsavel'

// Carrega os membros de AUTH da organização (mesma composição do
// /api/equipe/listar: usuários de auth cujo perfil pertence à org).
async function carregarEquipe(admin: SupabaseClient, organizacaoId: string): Promise<MembroEquipe[]> {
  const { data: perfis } = await admin
    .from('perfis').select('id, nome').eq('organizacao_id', organizacaoId)
  const idsDaOrg = new Map((perfis ?? []).map((p) => [p.id as string, (p.nome as string | null) ?? null]))

  const { data: authData, error } = await admin.auth.admin.listUsers()
  if (error) throw error
  return authData.users
    .filter((u) => idsDaOrg.has(u.id))
    .map((u) => ({ authId: u.id, email: u.email ?? null, nome: idsDaOrg.get(u.id) ?? null }))
}

async function carregarUsuarios(admin: SupabaseClient, organizacaoId: string): Promise<UsuarioRef[]> {
  const { data } = await admin
    .from('usuarios').select('id, nome, email').eq('organizacao_id', organizacaoId).eq('ativo', true)
  return (data ?? []).map((u) => ({
    id: u.id as string, nome: (u.nome as string | null) ?? null, email: (u.email as string | null) ?? null,
  }))
}

/**
 * Resolve o `authId` (membro escolhido / usuário logado) para um `usuarios`.
 * Devolve o mesmo VinculoResponsavel do bridge — a rota decide o que fazer com
 * `ambiguo`/`nao_encontrado` (hoje: bloqueia e avisa).
 */
export async function resolverResponsavelPorAuthId(
  admin: SupabaseClient,
  organizacaoId: string,
  authId: string,
): Promise<VinculoResponsavel> {
  const [equipe, usuarios] = await Promise.all([
    carregarEquipe(admin, organizacaoId),
    carregarUsuarios(admin, organizacaoId),
  ])
  const alvo = equipe.find((m) => m.authId === authId)
  if (!alvo) return { ok: false, motivo: 'nao_encontrado' }
  return vincularResponsavel(alvo, usuarios, equipe)
}

/**
 * Inverso de `resolverResponsavelPorAuthId`: o `usuarios` de
 * leads.responsavel_id → o authId (= perfis.id) do membro da equipe. null quando
 * nenhum ou mais de um membro corresponde.
 */
export async function resolverAuthIdDoResponsavel(
  admin: SupabaseClient,
  organizacaoId: string,
  usuarioId: string,
): Promise<string | null> {
  const [equipe, usuarios] = await Promise.all([
    carregarEquipe(admin, organizacaoId),
    carregarUsuarios(admin, organizacaoId),
  ])
  return membroDoUsuario(usuarioId, usuarios, equipe)?.authId ?? null
}
