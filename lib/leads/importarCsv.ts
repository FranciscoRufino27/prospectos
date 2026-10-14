// Parsing + validação + dedupe COMPARTILHADOS entre o script de import do HubSpot
// (scripts/importar-hubspot.ts) e a tela "Importar leads" (app/base-leads +
// /api/leads/importar). Fonte ÚNICA — não reimplementar parseCSV/validação/dedupe
// em outro lugar. Módulo PURO (sem fs, sem client Supabase embutido): roda no
// browser, na rota server-side e nos scripts de terminal.
//
// `mapearLead` do HubSpot NÃO vive aqui (é específico do CSV de lá, com colunas
// tipo "Associated Company"): ele continua no próprio script. Aqui mora o
// mapeamento do TEMPLATE PADRÃO desta tela. Nome, e-mail, empresa e responsável
// são obrigatórios; nicho, origem e demais dados são opcionais.
import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizarNicho } from '@/lib/nichos/normalizar'

// Parser CSV que respeita aspas: um campo entre aspas pode conter o delimitador,
// quebras de linha e aspas escapadas (""). `delimitador` default ';' (formato BR
// do HubSpot, já testado); a tela detecta o delimitador do arquivo enviado.
export function parseCSV(content: string, delimitador = ';'): Record<string, string>[] {
  const text = content.replace(/^﻿/, '').replace(/\r\n?/g, '\n') // sem BOM, LF normalizado
  const rows: string[][] = []
  let row: string[] = [], field = '', inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } // "" → aspas literal
        else inQuotes = false
      } else field += c
    } else if (c === '"') {
      inQuotes = true
    } else if (c === delimitador) {
      row.push(field); field = ''
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = ''
    } else {
      field += c
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row) }

  const headers = (rows.shift() ?? []).map((h) => h.trim())
  return rows
    .filter((r) => r.some((v) => v && v.trim()))
    .map((r) => {
      const obj: Record<string, string> = {}
      headers.forEach((h, i) => { obj[h] = (r[i] ?? '').trim() })
      return obj
    })
}

// Delimitador provável do CSV enviado pela tela: ';' (BR/Excel), ',' (padrão) ou
// TAB. Decide pela 1ª linha não vazia — a que aparecer mais vezes vence.
export function detectarDelimitador(content: string): ';' | ',' | '\t' {
  const primeira = content.replace(/^﻿/, '').split(/\r?\n/).find((l) => l.trim()) ?? ''
  const cont = (d: string) => primeira.split(d).length - 1
  const candidatos: Array<[';' | ',' | '\t', number]> = [[';', cont(';')], [',', cont(',')], ['\t', cont('\t')]]
  candidatos.sort((a, b) => b[1] - a[1])
  return candidatos[0][1] > 0 ? candidatos[0][0] : ','
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export function emailValido(email: string): boolean {
  return EMAIL_RE.test(email)
}

// --- TEMPLATE PADRÃO DA TELA (campos de 2.1) --------------------------------

export interface LeadPadrao {
  contato_nome: string
  contato_email: string
  empresa: string
  // Opcional NA IMPORTAÇÃO — planilha de origem externa raramente traz nicho, e
  // recusar a linha por isso jogava fora um contato válido. O cadastro MANUAL
  // continua exigindo, porque ali a pessoa tem a informação à mão.
  // Sem segmento o motor não escolhe template e não faz o primeiro contato:
  // o lead entra na base, mas fica parado até alguém classificar. A prévia
  // avisa quantos estão nessa situação (`semSegmento` em ResultadoPlanilha).
  segmento: string | null
  // OBRIGATÓRIO: quem é o dono deste lead na carteira. Texto cru da planilha
  // (nome ou e-mail do comercial) — quem resolve para uma linha de `usuarios` é
  // o servidor, que tem a lista da organização. Sem isso a campanha no modo
  // "responsável de cada lead" não tem para onde rotear o retorno, e era o que
  // fazia a importação carimbar o usuário logado em todas as linhas.
  responsavel: string
  origem: string
  contato_telefone: string | null
  contato_cargo: string | null
  cidade: string | null
  estado: string | null
  // Opcional. Data de validade do laudo (migration 0025), já em ISO
  // `AAAA-MM-DD` — é o formato da coluna `date` e o que o motor de renovação
  // compara. Planilha sem a coluna, célula vazia ou data que não dá para ler
  // viram null: o lead entra igual, só sem validade.
  data_validade: string | null
}

export type MotivoPulo = 'sem_nome' | 'sem_email' | 'email_invalido' | 'sem_empresa' | 'sem_responsavel'
export interface LinhaPulada { linha: number; motivo: MotivoPulo }
export interface ResultadoPlanilha {
  validos: LeadPadrao[]
  pulados: LinhaPulada[]
  // Quantos dos válidos entram sem segmento. Não impede a importação — existe
  // para a prévia dizer na cara que esses ficarão parados até serem
  // classificados, em vez de sumirem silenciosamente da esteira.
  semSegmento: number
  // Linhas válidas cuja célula de validade estava preenchida mas não foi
  // reconhecida como data. Entram sem validade; a prévia avisa para a pessoa
  // não descobrir só quando a renovação não disparar.
  validadeInvalida: number
  totalLinhas: number
}

// Rótulo de origem gravado quando a planilha não traz a coluna Origem preenchida.
// (Origem é obrigatória em 2.1, mas o critério de PULO de 2.2 é só nome/e-mail/
// empresa — então não descartamos a linha por falta de origem; damos um rótulo.)
export const ORIGEM_PADRAO_IMPORT = 'Importação em lote'

// Cabeçalhos aceitos (case- e acento-insensível). Só o essencial de 2.1.
const ALIASES: Record<keyof Omit<LeadPadrao, never>, string[]> = {
  contato_nome: ['nome', 'name', 'contato', 'nome do contato', 'nome completo'],
  contato_email: ['email', 'e-mail', 'e mail', 'mail'],
  empresa: ['empresa', 'company', 'organizacao', 'razao social', 'associated company'],
  // 'nicho/segmento' cobre o header composto que o próprio modal anuncia como
  // coluna opcional aceita (ImportarLeadsModal.tsx) — sem isso, o casamento
  // exato de mapearColunas não batia com nenhum alias isolado e a coluna
  // chegava sempre vazia.
  segmento: ['nicho', 'segmento', 'nicho/segmento', 'setor', 'industry', 'mercado'],
  // 'contact owner'/'lead owner' cobrem a exportação do HubSpot sem renomear
  // coluna na mão; 'proprietario' é como o HubSpot BR traduz.
  responsavel: [
    'responsavel', 'responsavel comercial', 'comercial', 'dono', 'vendedor',
    'proprietario', 'owner', 'contact owner', 'lead owner', 'hubspot owner',
  ],
  origem: ['origem', 'source', 'canal', 'origem do lead', 'fonte'],
  contato_telefone: ['telefone', 'phone', 'celular', 'fone', 'numero de telefone', 'whatsapp'],
  contato_cargo: ['cargo', 'title', 'role', 'posicao', 'funcao', 'job title'],
  cidade: ['cidade', 'city', 'municipio'],
  estado: ['estado', 'uf', 'state'],
  data_validade: [
    'validade', 'data de validade', 'data validade', 'validade do laudo',
    'vencimento', 'data de vencimento', 'vencimento do laudo',
    'valid until', 'expiration', 'expiry', 'expiration date',
  ],
}

const semAcento = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

// Data de validade da planilha → ISO `AAAA-MM-DD`, ou null se não der para ler.
// Aceita o que planilha brasileira traz na prática: `DD/MM/AAAA` (também com
// `-` ou `.`) e o ISO `AAAA-MM-DD`. Ano de 2 dígitos NÃO é aceito — é ambíguo
// e a validade de um laudo não pode ser chutada. Valida que a data existe de
// verdade (31/02 → null) usando UTC, para o dia não escorregar por fuso.
export function parseDataValidade(bruto: string): string | null {
  const s = (bruto ?? '').trim()
  if (!s) return null
  let ano: number, mes: number, dia: number
  let m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/.exec(s)
  if (m) { dia = +m[1]; mes = +m[2]; ano = +m[3] }
  else {
    m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
    if (!m) return null
    ano = +m[1]; mes = +m[2]; dia = +m[3]
  }
  const d = new Date(Date.UTC(ano, mes - 1, dia))
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null
  return d.toISOString().slice(0, 10)
}

// Resolve, para cada campo canônico, qual cabeçalho da planilha o representa.
function mapearColunas(headers: string[]): Partial<Record<keyof LeadPadrao, string>> {
  const norm = headers.map((h) => [h, semAcento(h)] as const)
  const mapa: Partial<Record<keyof LeadPadrao, string>> = {}
  for (const campo of Object.keys(ALIASES) as (keyof LeadPadrao)[]) {
    const alvos = ALIASES[campo].map(semAcento)
    const achado = norm.find(([, n]) => alvos.includes(n))
    if (achado) mapa[campo] = achado[0]
  }
  return mapa
}

// Uma linha do CSV padrão → lead válido OU motivo de pulo. Pula quem não tem
// nome, e-mail VÁLIDO ou empresa. Segmento ausente NÃO pula: entra como null.
export function mapearLeadPadrao(
  row: Record<string, string>,
  colunas: Partial<Record<keyof LeadPadrao, string>>,
): { lead: LeadPadrao } | { motivo: MotivoPulo } {
  const get = (campo: keyof LeadPadrao) => {
    const col = colunas[campo]
    return col ? (row[col] ?? '').trim() : ''
  }

  const nome = get('contato_nome')
  if (!nome) return { motivo: 'sem_nome' }

  const email = get('contato_email').toLowerCase()
  if (!email) return { motivo: 'sem_email' }
  if (!emailValido(email)) return { motivo: 'email_invalido' }

  const empresa = get('empresa')
  if (!empresa) return { motivo: 'sem_empresa' }

  // Obrigatório. A conferência de que o valor corresponde a um comercial da
  // organização é do servidor; aqui só garantimos que a célula veio preenchida.
  const responsavel = get('responsavel')
  if (!responsavel) return { motivo: 'sem_responsavel' }

  // Ausente é aceito: vira null e o lead entra sem classificação.
  const segmento = normalizarNicho(get('segmento'))

  const telefone = get('contato_telefone').replace(/[^\d+]/g, '') || null

  return {
    lead: {
      contato_nome: nome,
      contato_email: email,
      empresa,
      segmento,
      responsavel,
      origem: get('origem') || ORIGEM_PADRAO_IMPORT,
      contato_telefone: telefone,
      contato_cargo: get('contato_cargo') || null,
      cidade: get('cidade') || null,
      estado: get('estado') || null,
      data_validade: parseDataValidade(get('data_validade')),
    },
  }
}

export interface ResumoNichoImportacao {
  nicho: string
  leads: number
  templateAtivo: boolean
}

export function resumirNichosImportacao(
  leads: Pick<LeadPadrao, 'segmento'>[],
  nichosComTemplate: Iterable<string>,
): ResumoNichoImportacao[] {
  const templates = new Set(
    [...nichosComTemplate]
      .map((nicho) => normalizarNicho(nicho))
      .filter((nicho): nicho is string => !!nicho),
  )
  const contagem = new Map<string, number>()
  for (const lead of leads) {
    const nicho = normalizarNicho(lead.segmento)
    if (!nicho) continue
    contagem.set(nicho, (contagem.get(nicho) ?? 0) + 1)
  }
  return [...contagem.entries()]
    .map(([nicho, total]) => ({ nicho, leads: total, templateAtivo: templates.has(nicho) }))
    .sort((a, b) => a.nicho.localeCompare(b.nicho, 'pt-BR'))
}

// Planilha inteira (texto do CSV) → válidos + pulados contados por linha.
export function processarPlanilhaPadrao(content: string): ResultadoPlanilha {
  const delimitador = detectarDelimitador(content)
  const rows = parseCSV(content, delimitador)
  const colunas = mapearColunas(Object.keys(rows[0] ?? {}))

  const validos: LeadPadrao[] = []
  const pulados: LinhaPulada[] = []
  let validadeInvalida = 0
  const colValidade = colunas.data_validade
  rows.forEach((row, i) => {
    const r = mapearLeadPadrao(row, colunas)
    // +2: a linha 1 é o cabeçalho e o índice é 0-based (nº "de planilha" real).
    if ('lead' in r) {
      validos.push(r.lead)
      // Célula preenchida que virou null = data que não reconhecemos.
      if (colValidade && (row[colValidade] ?? '').trim() && !r.lead.data_validade) validadeInvalida++
    } else {
      pulados.push({ linha: i + 2, motivo: r.motivo })
    }
  })
  const semSegmento = validos.filter((lead) => !lead.segmento).length
  return { validos, pulados, semSegmento, validadeInvalida, totalLinhas: rows.length }
}

// Dedupe interna do arquivo por e-mail (o 1º ganha). Genérica: serve tanto pro
// template padrão quanto pro lead mapeado do HubSpot (ambos têm contato_email).
export function dedupeInternaPorEmail<T extends { contato_email: string }>(
  leads: T[],
): { unicos: T[]; duplicados: number } {
  const vistos = new Set<string>()
  const unicos: T[] = []
  for (const l of leads) {
    const e = l.contato_email.toLowerCase()
    if (vistos.has(e)) continue
    vistos.add(e)
    unicos.push(l)
  }
  return { unicos, duplicados: leads.length - unicos.length }
}

// Dedupe contra o banco: Set de contato_email (lowercase) já existentes na
// organização. Pagina a tabela toda. Recebe um client Supabase (service role na
// rota; nunca embute chave aqui). SCOPED por organizacao_id — o service role
// bypassa RLS, então o filtro é obrigatório.
export async function buscarEmailsExistentes(
  supabase: SupabaseClient,
  organizacaoId: string,
): Promise<Set<string>> {
  const existentes = new Set<string>()
  const PAGE = 1000
  let from = 0
  for (;;) {
    const { data, error } = await supabase
      .from('leads')
      .select('contato_email')
      .eq('organizacao_id', organizacaoId)
      .range(from, from + PAGE - 1)
    if (error) throw error
    const rows = data ?? []
    for (const r of rows) {
      const e = (r as { contato_email: string | null }).contato_email
      if (e) existentes.add(e.toLowerCase())
    }
    if (rows.length < PAGE) break
    from += PAGE
  }
  return existentes
}
