// Estado de acesso de um membro (puro — usado nas rotas e nos testes).

/** Login bloqueado pelo admin: `banned_until` do Supabase ainda no futuro. */
export function estaBloqueado(bannedUntil: string | null | undefined, agora = Date.now()): boolean {
  if (!bannedUntil) return false
  const ate = Date.parse(bannedUntil)
  return Number.isFinite(ate) && ate > agora
}
