// Regras PURAS de gestão de membros (testáveis sem banco). O invariante central:
// uma organização NUNCA pode ficar sem administrador. Por isso remover ou
// rebaixar o ÚLTIMO admin é bloqueado — independentemente de ser o próprio
// usuário ou outro. Também bloqueia auto-remoção (comportamento já existente).

export type ResultadoRegra = { ok: true } | { ok: false; status: number; erro: string }

const SEM_ULTIMO_ADMIN =
  'Não é possível remover o acesso do último administrador da organização. Promova outro admin antes.'

// Alterar o role de um membro (admin↔usuario). Bloqueia rebaixar o último admin.
export function podeAlterarRole(r: {
  alvoRole: string
  novoRole: string
  totalAdmins: number
}): ResultadoRegra {
  const rebaixandoAdmin = r.alvoRole === 'admin' && r.novoRole !== 'admin'
  if (rebaixandoAdmin && r.totalAdmins <= 1) {
    return { ok: false, status: 400, erro: SEM_ULTIMO_ADMIN }
  }
  return { ok: true }
}

// Remover um membro da organização. Bloqueia auto-remoção e remoção do último admin.
export function podeRemoverMembro(r: {
  alvoId: string
  alvoRole: string
  chamadorId: string
  totalAdmins: number
}): ResultadoRegra {
  if (r.alvoId === r.chamadorId) {
    return { ok: false, status: 400, erro: 'Você não pode remover a si mesmo.' }
  }
  if (r.alvoRole === 'admin' && r.totalAdmins <= 1) {
    return { ok: false, status: 400, erro: SEM_ULTIMO_ADMIN }
  }
  return { ok: true }
}

// Bloquear o login de um membro (sem apagar a conta). Bloqueia o auto-bloqueio
// e o bloqueio do último admin ATIVO — admin já bloqueado não conta, senão a
// organização ficaria sem ninguém que consiga entrar para desbloquear.
export function podeBloquearMembro(r: {
  alvoId: string
  alvoRole: string
  chamadorId: string
  adminsAtivos: number
}): ResultadoRegra {
  if (r.alvoId === r.chamadorId) {
    return { ok: false, status: 400, erro: 'Você não pode bloquear o seu próprio acesso.' }
  }
  if (r.alvoRole === 'admin' && r.adminsAtivos <= 1) {
    return {
      ok: false,
      status: 400,
      erro: 'Não é possível bloquear o último administrador ativo da organização. Promova ou desbloqueie outro admin antes.',
    }
  }
  return { ok: true }
}
