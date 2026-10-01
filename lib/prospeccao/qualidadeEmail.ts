// Classificação HEURÍSTICA do e-mail cadastral da Receita. Serve para o
// humano revisar antes de importar — não é verificação de entrega. Muitos
// cadastros trazem o e-mail do escritório de contabilidade que abriu a empresa.

export type QualidadeEmail = 'corporativo' | 'generico' | 'pessoal' | 'contabilidade' | 'digitacao' | 'sem_email'

export const PROVEDORES_PESSOAIS: ReadonlySet<string> = new Set([
  'gmail.com', 'hotmail.com', 'hotmail.com.br', 'outlook.com', 'outlook.com.br', 'live.com',
  'yahoo.com', 'yahoo.com.br', 'icloud.com', 'bol.com.br', 'uol.com.br', 'terra.com.br',
  'ig.com.br', 'globo.com', 'msn.com', 'r7.com',
  // Webmails que apareceram como "corporativo" no catálogo de teste.
  'superig.com.br', 'zipmail.com.br', 'ibest.com.br', 'click21.com.br', 'pop.com.br', 'oi.com.br',
  'aol.com', 'protonmail.com', 'proton.me', 'gmx.net', 'gmx.de', 'bluewin.ch', '163.com', '126.com', 'qq.com',
])

// Provedores grandes o bastante para um typo ser reconhecível ("hotmal.com",
// "gmial.com"). Nomes curtos (bol, uol, ig) ficam de fora: a 1–2 letras de
// distância há domínios legítimos demais — e "terra"/"globo" também, por
// ficarem a uma letra de palavras comuns em nome de hotel (serra, globe).
const PROVEDORES_ALVO_DE_TYPO = [
  'gmail.com', 'hotmail.com', 'hotmail.com.br', 'outlook.com', 'outlook.com.br',
  'yahoo.com', 'yahoo.com.br', 'icloud.com',
]
// Provedores reais que ficam perto demais de um alvo acima.
const PROVEDORES_REAIS_PARECIDOS = new Set([
  'email.com', 'mail.com', 'gmx.com', 'ymail.com', 'rocketmail.com', 'yahoo.com.ar', 'yahoo.com.mx', 'yahoo.es',
])

function distancia(a: string, b: string): number {
  const linha = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let anterior = linha[0]
    linha[0] = i
    for (let j = 1; j <= b.length; j++) {
      const guardado = linha[j]
      linha[j] = Math.min(linha[j] + 1, linha[j - 1] + 1, anterior + (a[i - 1] === b[j - 1] ? 0 : 1))
      anterior = guardado
    }
  }
  return linha[b.length]
}

/** "hotmal.com" → "hotmail.com". null quando o domínio não parece typo de provedor. */
export function provedorPretendido(dominio: string): string | null {
  const d = dominio.trim().toLowerCase()
  if (PROVEDORES_PESSOAIS.has(d) || PROVEDORES_REAIS_PARECIDOS.has(d)) return null
  // O mais próximo vence: "homail.com" está a 1 de hotmail e a 2 de gmail.
  let melhor: { alvo: string; dist: number } | null = null
  for (const alvo of PROVEDORES_ALVO_DE_TYPO) {
    const dist = distancia(d, alvo)
    if (dist > 0 && dist <= 2 && (!melhor || dist < melhor.dist)) melhor = { alvo, dist }
  }
  return melhor?.alvo ?? null
}

const SINAIS_CONTABILIDADE = /contab|contador|contadores|escritorio|assessoria|fiscal|tributar|cont[aá]bil/

const CAIXAS_GENERICAS = new Set([
  'contato', 'atendimento', 'reservas', 'reserva', 'financeiro', 'adm', 'administracao',
  'administrativo', 'comercial', 'vendas', 'recepcao', 'sac', 'info', 'faleconosco',
  'hotel', 'pousada', 'gerencia', 'geral', 'compras', 'rh',
])

export const ROTULO_QUALIDADE: Record<QualidadeEmail, string> = {
  corporativo: 'Corporativo',
  generico: 'Caixa genérica',
  pessoal: 'Provedor pessoal',
  contabilidade: 'Provável contador',
  digitacao: 'Erro de digitação',
  sem_email: 'Sem e-mail',
}

export function classificarEmail(email: string | null | undefined): QualidadeEmail {
  const e = (email ?? '').trim().toLowerCase()
  const at = e.lastIndexOf('@')
  if (at <= 0 || at === e.length - 1) return 'sem_email'
  const local = e.slice(0, at)
  const dominio = e.slice(at + 1)
  if (SINAIS_CONTABILIDADE.test(dominio) || SINAIS_CONTABILIDADE.test(local)) return 'contabilidade'
  if (PROVEDORES_PESSOAIS.has(dominio)) return 'pessoal'
  // Typo de provedor: o e-mail como está não existe — não entregaria nada.
  if (provedorPretendido(dominio)) return 'digitacao'
  if (CAIXAS_GENERICAS.has(local.replace(/[^a-z]/g, ''))) return 'generico'
  return 'corporativo'
}
