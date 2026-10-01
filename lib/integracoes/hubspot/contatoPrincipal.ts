// Contato principal de uma empresa — regra determinística, sem IA. Não afirma
// que alguém é "decisor": só ordena os contatos associados pela evidência que
// existe no HubSpot (e-mail, cargo informado, último contato).
//
// Ordem (primeiro critério que desempatar):
//   1. tem e-mail preenchido;
//   2. nível do cargo por palavra-chave:
//        3 = sócio, proprietário, dono, fundador, CEO, presidente, diretor e afins
//        2 = gerente, gestor, head, coordenador, supervisor, administrador, compras
//        1 = qualquer outro cargo informado
//        0 = sem cargo
//      "assistente", "analista", "auxiliar", "estagiário" nunca passam de 1;
//   3. último contato (notes_last_contacted) mais recente;
//   4. menor ID do contato (estável).

export interface ContatoLido {
  id: string
  nome: string
  email: string | null
  cargo: string | null
  ultimoContato: string | null // notes_last_contacted (ISO)
  ownerId: string | null
}

// Palavras inteiras (siglas e termos curtos/ambíguos: "coo" não pode casar
// "coordenador", "socia" não pode casar "social").
const NIVEL_3 = ['socio', 'socia', 'socios', 'dono', 'dona', 'fundador', 'fundadora', 'founder', 'cofounder', 'ceo', 'cfo', 'coo', 'cto', 'presidente', 'president', 'diretor', 'diretora', 'director', 'owner', 'partner']
const NIVEL_2 = ['gerente', 'gestor', 'gestora', 'manager', 'head', 'coordenador', 'coordenadora', 'supervisor', 'supervisora', 'administrador', 'administradora', 'superintendente', 'compras', 'comprador', 'compradora', 'procurement', 'purchasing']
const TETO_1 = ['assistente', 'analista', 'auxiliar', 'trainee', 'assistant', 'analyst', 'intern']
// Radicais longos e seguros (casam por prefixo).
const PREFIXO_3 = ['proprietari']
const PREFIXO_1 = ['estagiari']

const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const palavrasDe = (texto: string) => normalizar(texto).split(/[^a-z0-9]+/).filter(Boolean)
const temPalavra = (palavras: string[], inteiras: string[], prefixos: string[] = []) =>
  palavras.some((p) => inteiras.includes(p) || prefixos.some((k) => p.startsWith(k)))

export function nivelCargo(cargo: string | null | undefined): 0 | 1 | 2 | 3 {
  const c = (cargo ?? '').trim()
  if (!c) return 0
  const p = palavrasDe(c)
  if (temPalavra(p, TETO_1, PREFIXO_1)) return 1
  if (temPalavra(p, NIVEL_3, PREFIXO_3)) return 3
  if (temPalavra(p, NIVEL_2)) return 2
  return 1
}

const tempo = (iso: string | null) => {
  const t = iso ? Date.parse(iso) : NaN
  return Number.isFinite(t) ? t : -Infinity
}
const idNum = (id: string) => {
  const n = Number(id)
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER
}

export function escolherContatoPrincipal(contatos: readonly ContatoLido[]): ContatoLido | null {
  if (!contatos.length) return null
  return [...contatos].sort((a, b) =>
    Number(!!b.email) - Number(!!a.email)
    || nivelCargo(b.cargo) - nivelCargo(a.cargo)
    || tempo(b.ultimoContato) - tempo(a.ultimoContato)
    || idNum(a.id) - idNum(b.id)
    || a.id.localeCompare(b.id),
  )[0]
}
