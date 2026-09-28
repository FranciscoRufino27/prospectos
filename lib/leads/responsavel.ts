// Resolve um MEMBRO da equipe (usuário de AUTH/perfil) para a linha da tabela
// `usuarios` que deve ir em leads.responsavel_id (FK real p/ usuarios).
//
// Por que isso existe (ver /api/equipe/listar e /api/perfil): a "equipe" são
// usuários de AUTH (perfis), cujos ids NÃO são os ids de `usuarios`. O CC do
// follow-up automático (lib/engine/flows/followUp.ts) depende de responsavel_id
// ser um usuarios.id REAL com e-mail válido — então a ligação tem que ser
// confiável, não um chute.
//
// Regra (decidida com o Chico): E-MAIL EXATO tem prioridade absoluta. O fallback
// por PREFIXO DE NOME ("Francisco" ⊂ "Francisco Rufino") só vale quando é
// INEQUÍVOCO — um único usuarios casa E esse usuarios não é também alvo (por
// nome) de outro membro da equipe. Qualquer ambiguidade PARA e devolve
// motivo='ambiguo' em vez de assumir um destino silenciosamente (era o bug que
// fazia o admin "Francisco Rufs" cair no CC do "Francisco Rufino").

export interface MembroEquipe {
  authId: string
  email: string | null
  nome: string | null
}

export interface UsuarioRef {
  id: string
  nome: string | null
  email: string | null
}

export type VinculoResponsavel =
  | { ok: true; usuario: UsuarioRef; via: 'email' | 'nome' }
  | { ok: false; motivo: 'nao_encontrado' }
  | { ok: false; motivo: 'ambiguo'; detalhe: string }

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()

// usuarios cujo e-mail bate EXATO (case-insensitive) com o do membro.
function porEmail(membro: MembroEquipe, usuarios: UsuarioRef[]): UsuarioRef[] {
  const e = norm(membro.email)
  if (!e) return []
  return usuarios.filter((u) => norm(u.email) === e)
}

// usuarios cujo NOME é prefixo do nome do membro ("Francisco" ⊂ "Francisco Rufino").
function porNome(membro: MembroEquipe, usuarios: UsuarioRef[]): UsuarioRef[] {
  const n = norm(membro.nome)
  if (!n) return []
  return usuarios.filter((u) => {
    const un = norm(u.nome)
    return !!un && n.startsWith(un)
  })
}

// Um membro "resolve por e-mail" quando exatamente um usuarios bate por e-mail —
// esses NÃO dependem do nome, então não contam para a colisão de prefixo.
function resolvePorEmail(membro: MembroEquipe, usuarios: UsuarioRef[]): boolean {
  return porEmail(membro, usuarios).length === 1
}

/**
 * Vincula `alvo` (o membro escolhido no seletor / o usuário logado) a um
 * `usuarios`. `equipe` é o time inteiro da organização — necessário só para
 * detectar a colisão reversa (dois membros caindo no mesmo prefixo).
 */
export function vincularResponsavel(
  alvo: MembroEquipe,
  usuarios: UsuarioRef[],
  equipe: MembroEquipe[],
): VinculoResponsavel {
  // 1) E-mail exato tem prioridade absoluta.
  const emails = porEmail(alvo, usuarios)
  if (emails.length === 1) return { ok: true, usuario: emails[0], via: 'email' }
  if (emails.length > 1) {
    return { ok: false, motivo: 'ambiguo', detalhe: `E-mail "${alvo.email}" casa com ${emails.length} usuários.` }
  }

  // 2) Fallback por nome — só quando inequívoco nas DUAS direções.
  const nomes = porNome(alvo, usuarios)
  if (nomes.length === 0) return { ok: false, motivo: 'nao_encontrado' }
  if (nomes.length > 1) {
    return { ok: false, motivo: 'ambiguo', detalhe: `Nome "${alvo.nome}" casa com ${nomes.length} usuários por prefixo.` }
  }
  const alvoUsuario = nomes[0]

  // Reverse: outro membro que TAMBÉM depende de nome cairia no mesmo usuarios?
  const concorrentes = equipe.filter(
    (m) =>
      m.authId !== alvo.authId &&
      !resolvePorEmail(m, usuarios) &&
      porNome(m, usuarios).length === 1 &&
      porNome(m, usuarios)[0].id === alvoUsuario.id,
  )
  if (concorrentes.length > 0) {
    const quem = concorrentes.map((m) => m.nome ?? m.email ?? m.authId).join(', ')
    return {
      ok: false,
      motivo: 'ambiguo',
      detalhe:
        `Usuário "${alvoUsuario.nome}" também é prefixo do nome de: ${quem}. ` +
        `Cadastre uma linha própria em usuarios (com e-mail) para desambiguar.`,
    }
  }

  return { ok: true, usuario: alvoUsuario, via: 'nome' }
}

/**
 * Caminho INVERSO do bridge: dado um `usuarios` (o que está em
 * leads.responsavel_id), qual membro de auth/perfil ele é? Aplica a MESMA
 * regra de `vincularResponsavel` a cada membro e aceita só quando exatamente
 * um membro cai neste usuário — ambiguidade devolve null, nunca um chute.
 */
export function membroDoUsuario(
  usuarioId: string,
  usuarios: UsuarioRef[],
  equipe: MembroEquipe[],
): MembroEquipe | null {
  const donos = equipe.filter((m) => {
    const v = vincularResponsavel(m, usuarios, equipe)
    return v.ok && v.usuario.id === usuarioId
  })
  return donos.length === 1 ? donos[0] : null
}

// --- Responsável vindo de uma PLANILHA --------------------------------------
// Aqui a entrada não é um membro de auth: é texto cru de uma célula ("Aline
// Muller", "aline@empresa.com", "ALINE"). Mesma filosofia do bridge acima —
// e-mail exato manda, nome só quando inequívoco, e ambiguidade PARA em vez de
// escolher um destino silencioso. A diferença é que aqui o nome casa INTEIRO
// (não por prefixo): planilha não tem a garantia de curadoria que a tela de
// equipe tem, e "Bruno" com dois Brunos na organização não pode virar um chute.

export type VinculoPlanilha =
  | { ok: true; usuario: UsuarioRef; via: 'email' | 'nome' }
  | { ok: false; motivo: 'vazio' | 'nao_encontrado' }
  | { ok: false; motivo: 'ambiguo'; detalhe: string }

export function resolverResponsavelDaPlanilha(
  valorBruto: string | null | undefined,
  usuarios: UsuarioRef[],
): VinculoPlanilha {
  const valor = norm(valorBruto)
  if (!valor) return { ok: false, motivo: 'vazio' }

  const porEmailExato = usuarios.filter((u) => norm(u.email) === valor)
  if (porEmailExato.length === 1) return { ok: true, usuario: porEmailExato[0], via: 'email' }
  if (porEmailExato.length > 1) {
    return { ok: false, motivo: 'ambiguo', detalhe: `"${valorBruto}" casa com ${porEmailExato.length} usuários por e-mail.` }
  }

  const porNomeExato = usuarios.filter((u) => norm(u.nome) === valor)
  if (porNomeExato.length === 1) return { ok: true, usuario: porNomeExato[0], via: 'nome' }
  if (porNomeExato.length > 1) {
    return { ok: false, motivo: 'ambiguo', detalhe: `"${valorBruto}" casa com ${porNomeExato.length} usuários por nome.` }
  }

  return { ok: false, motivo: 'nao_encontrado' }
}

// Resolve a coluna inteira de uma vez. Devolve o mapa valor→usuário para as
// linhas que resolveram e a lista de valores que NÃO resolveram, com o motivo —
// é o que a prévia mostra para a pessoa corrigir a planilha antes de importar.
export interface ResolucaoColunaResponsavel {
  porValor: Map<string, UsuarioRef>
  naoResolvidos: { valor: string; motivo: 'nao_encontrado' | 'ambiguo'; detalhe?: string; linhas: number }[]
}

export function resolverColunaResponsavel(
  valores: string[],
  usuarios: UsuarioRef[],
): ResolucaoColunaResponsavel {
  const ocorrencias = new Map<string, number>()
  for (const v of valores) {
    const chave = norm(v)
    if (chave) ocorrencias.set(chave, (ocorrencias.get(chave) ?? 0) + 1)
  }
  const porValor = new Map<string, UsuarioRef>()
  const naoResolvidos: ResolucaoColunaResponsavel['naoResolvidos'] = []
  const originalDe = new Map<string, string>()
  for (const v of valores) {
    const chave = norm(v)
    if (chave && !originalDe.has(chave)) originalDe.set(chave, v.trim())
  }
  for (const [chave, linhas] of ocorrencias) {
    const r = resolverResponsavelDaPlanilha(originalDe.get(chave) ?? chave, usuarios)
    if (r.ok) porValor.set(chave, r.usuario)
    else if (r.motivo !== 'vazio') {
      naoResolvidos.push({
        valor: originalDe.get(chave) ?? chave,
        motivo: r.motivo,
        detalhe: 'detalhe' in r ? r.detalhe : undefined,
        linhas,
      })
    }
  }
  naoResolvidos.sort((a, b) => b.linhas - a.linhas)
  return { porValor, naoResolvidos }
}

// Chave de busca no mapa devolvido por resolverColunaResponsavel.
export function chaveResponsavelPlanilha(valor: string | null | undefined): string {
  return norm(valor)
}
