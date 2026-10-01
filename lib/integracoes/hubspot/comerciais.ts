import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ProprietarioHubspot } from './owners'

// Mapeamento de comerciais: hubspot_owner_id → usuarios.id por organização
// (tabela hubspot_owners_mapeamento, migration 0055).
//
// Regras:
//   - NUNCA mapear por nome. A sugestão automática é só por e-mail idêntico
//     (case-insensitive) com exatamente UM usuário ativo da organização.
//   - Sugestão não grava nada: só vira mapeamento quando alguém salva.
//   - Sem mapeamento = "Não mapeado" (ausência de linha); nada é atribuído.
//   - O usuário precisa pertencer à MESMA organização (validado aqui — a FK
//     sozinha não garante o tenant).

export interface UsuarioProspectos {
  id: string
  nome: string
  email: string
  ativo: boolean
}

export interface MapeamentoOwner {
  hubspotOwnerId: string
  usuarioId: string
  ativo: boolean
}

export type Sugestao =
  | { tipo: 'email'; usuarioId: string }
  | { tipo: 'ambigua'; candidatos: number }
  | { tipo: 'nenhuma' }

const normalizarEmail = (e: string | null | undefined) => (e ?? '').trim().toLowerCase()

export function sugerirUsuario(owner: ProprietarioHubspot, usuarios: readonly UsuarioProspectos[]): Sugestao {
  const email = normalizarEmail(owner.email)
  if (!email) return { tipo: 'nenhuma' }
  const candidatos = usuarios.filter((u) => u.ativo && normalizarEmail(u.email) === email)
  if (candidatos.length === 1) return { tipo: 'email', usuarioId: candidatos[0].id }
  if (candidatos.length > 1) return { tipo: 'ambigua', candidatos: candidatos.length }
  return { tipo: 'nenhuma' }
}

export async function listarUsuariosOrganizacao(admin: SupabaseClient, org: string): Promise<UsuarioProspectos[]> {
  const { data } = await admin
    .from('usuarios')
    .select('id, nome, email, ativo')
    .eq('organizacao_id', org)
    .order('nome')
  return (data ?? []).map((u) => ({
    id: String(u.id),
    nome: String(u.nome ?? ''),
    email: String(u.email ?? ''),
    ativo: u.ativo !== false,
  }))
}

export async function listarMapeamentos(admin: SupabaseClient, org: string): Promise<MapeamentoOwner[]> {
  const { data } = await admin
    .from('hubspot_owners_mapeamento')
    .select('hubspot_owner_id, usuario_id, ativo')
    .eq('organizacao_id', org)
  return (data ?? []).map((m) => ({
    hubspotOwnerId: String(m.hubspot_owner_id),
    usuarioId: String(m.usuario_id),
    ativo: m.ativo !== false,
  }))
}

// hubspot_owner_id → usuario_id, só dos mapeamentos ATIVOS.
export async function mapaResponsaveis(admin: SupabaseClient, org: string): Promise<Map<string, string>> {
  const lista = await listarMapeamentos(admin, org)
  return new Map(lista.filter((m) => m.ativo).map((m) => [m.hubspotOwnerId, m.usuarioId]))
}

export type ResultadoSalvarMapeamento =
  | { ok: true; removido: boolean }
  | { ok: false; motivo: 'owner_invalido' | 'usuario_invalido' | 'erro_banco'; mensagem: string }

const OWNER_ID = /^\d{1,20}$/

export async function salvarMapeamento(
  admin: SupabaseClient,
  org: string,
  perfilId: string,
  entrada: { hubspotOwnerId: unknown; usuarioId: unknown; ativo?: unknown },
): Promise<ResultadoSalvarMapeamento> {
  const ownerId = typeof entrada.hubspotOwnerId === 'string' ? entrada.hubspotOwnerId.trim() : ''
  if (!OWNER_ID.test(ownerId)) return { ok: false, motivo: 'owner_invalido', mensagem: 'hubspot_owner_id inválido' }

  // null/'' = voltar para "Não mapeado".
  if (entrada.usuarioId === null || entrada.usuarioId === '') {
    const { error } = await admin
      .from('hubspot_owners_mapeamento')
      .delete()
      .eq('organizacao_id', org)
      .eq('hubspot_owner_id', ownerId)
    if (error) return { ok: false, motivo: 'erro_banco', mensagem: error.message }
    return { ok: true, removido: true }
  }

  const usuarioId = typeof entrada.usuarioId === 'string' ? entrada.usuarioId.trim() : ''
  if (!usuarioId) return { ok: false, motivo: 'usuario_invalido', mensagem: 'usuario_id inválido' }

  const { data: usuario } = await admin
    .from('usuarios')
    .select('id, ativo')
    .eq('organizacao_id', org)
    .eq('id', usuarioId)
    .maybeSingle()
  if (!usuario || usuario.ativo === false) {
    return { ok: false, motivo: 'usuario_invalido', mensagem: 'Usuário não encontrado nesta organização' }
  }

  const { error } = await admin.from('hubspot_owners_mapeamento').upsert(
    {
      organizacao_id: org,
      hubspot_owner_id: ownerId,
      usuario_id: usuarioId,
      ativo: entrada.ativo !== false,
      atualizado_por: perfilId,
    },
    { onConflict: 'organizacao_id,hubspot_owner_id' },
  )
  if (error) return { ok: false, motivo: 'erro_banco', mensagem: error.message }
  return { ok: true, removido: false }
}
