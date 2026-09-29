/**
 * Importa os templates de e-mail (HTML) de
 * `templates/templates laudos/templates/laudos/` para a biblioteca de templates
 * da organização Laudos (LAUDO DE BRINQUEDOS).
 *
 * O manifest.json da pasta dá nome (title) e assunto (subject) de cada arquivo;
 * canal/nicho/tipo (chave estável usada por workflows e pelo motor) são fixados
 * aqui, um por arquivo, em CHAVES_POR_ARQUIVO.
 *
 * O HTML de cada arquivo é gravado tal como está na coluna `html` — sem passar
 * pela sanitização da API (`sanitizarHtmlEmail`), que removeria a estrutura
 * <html>/<head>/<body>. `corpo` (texto puro, NOT NULL) é só um fallback
 * derivado do HTML, nunca o conteúdo final visto pelo destinatário.
 *
 * Idempotente: casa por (canal, nicho, tipo) — a mesma chave usada em
 * lib/templates/seed.ts. Template já existente é ATUALIZADO (nome/assunto/
 * html/corpo); nunca duplicado. Nunca apaga. Nunca toca outra organização.
 *
 *   npx tsx scripts/importar-templates-laudos.ts               # ensaio (padrão)
 *   npx tsx scripts/importar-templates-laudos.ts --confirmar   # grava
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { anunciarModo } from './_guarda'
import { extrairTextoHtmlEmail } from '../lib/campanhas/emailCampanha'

for (const linha of readFileSync('.env.local', 'utf-8').split(/\r?\n/)) {
  const i = linha.indexOf('=')
  if (i > 0 && !linha.trim().startsWith('#')) {
    const k = linha.slice(0, i).trim()
    if (!process.env[k]) process.env[k] = linha.slice(i + 1).trim().replace(/^["']|["']$/g, '')
  }
}

const PASTA = path.join(
  process.cwd(), 'templates', 'templates laudos', 'templates', 'laudos',
)
const ORGANIZACAO_NOME = 'LAUDO DE BRINQUEDOS'

interface ChaveTemplate {
  canal: 'email'
  nicho: string | null
  tipo: string
}

const CHAVES_POR_ARQUIVO: Record<string, ChaveTemplate> = {
  'renovacao-primeiro-contato.html': { canal: 'email', nicho: null, tipo: 'renovacao_primeiro_contato' },
  'renovacao-follow-up-1.html': { canal: 'email', nicho: null, tipo: 'renovacao_follow_up_1' },
  'prospeccao-buffet-primeiro-contato.html': { canal: 'email', nicho: 'buffet', tipo: 'primeiro_contato' },
  'prospeccao-buffet-follow-up-1.html': { canal: 'email', nicho: 'buffet', tipo: 'follow_up_1' },
  'prospeccao-buffet-follow-up-2.html': { canal: 'email', nicho: 'buffet', tipo: 'follow_up_2' },
}

interface ManifestItem {
  title: string
  subject: string
  file: string
  type: string
}

interface ItemImportar extends ChaveTemplate {
  nome: string
  assunto: string
  html: string
  corpo: string
}

const chaveDe = (t: ChaveTemplate): string => `${t.canal}|${t.nicho ?? ''}|${t.tipo}`

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const chaveServico = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !chaveServico || chaveServico.includes('sua_')) {
    console.error('SUPABASE_SERVICE_ROLE_KEY real é obrigatória; não há fallback para a anon key.')
    process.exit(1)
  }

  const manifest: ManifestItem[] = JSON.parse(readFileSync(path.join(PASTA, 'manifest.json'), 'utf-8'))

  const itens: ItemImportar[] = manifest.map((m) => {
    const chaveArquivo = CHAVES_POR_ARQUIVO[m.file]
    if (!chaveArquivo) {
      throw new Error(`Sem canal/nicho/tipo definido para o arquivo "${m.file}" — adicione em CHAVES_POR_ARQUIVO.`)
    }
    const html = readFileSync(path.join(PASTA, m.file), 'utf-8')
    const corpo = extrairTextoHtmlEmail(html) || m.title
    return { ...chaveArquivo, nome: m.title, assunto: m.subject, html, corpo }
  })

  const confirmar = anunciarModo({
    nome: 'Importação dos templates de e-mail — Laudos',
    alvo: `organização ${ORGANIZACAO_NOME}`,
    efeitos: [
      `grava ${itens.length} template(s) de e-mail (HTML) na biblioteca da organização Laudos`,
      'template já existente (mesmo canal+nicho+tipo) é ATUALIZADO (nome/assunto/html/corpo), nunca duplicado',
      'HTML gravado tal como está no arquivo, sem sanitização nem alteração de conteúdo',
      'não toca nenhuma outra organização',
    ],
  })

  const client = createClient(url, chaveServico, { auth: { persistSession: false, autoRefreshToken: false } })

  const { data: organizacao, error: erroOrg } = await client
    .from('organizacoes')
    .select('id, nome')
    .ilike('nome', ORGANIZACAO_NOME)
    .maybeSingle()
  if (erroOrg) throw new Error(`Falha ao buscar a organização: ${erroOrg.message}`)
  if (!organizacao) throw new Error(`Organização "${ORGANIZACAO_NOME}" não encontrada; nada foi executado.`)
  const org = organizacao.id as string

  const { data: existentes, error: erroExistentes } = await client
    .from('templates')
    .select('id, canal, nicho, tipo, nome')
    .eq('organizacao_id', org)
  if (erroExistentes) throw new Error(`Falha ao ler templates existentes: ${erroExistentes.message}`)

  const porChave = new Map((existentes ?? []).map((t) => [chaveDe(t as ChaveTemplate), t]))

  console.log(`\nOrganização: ${organizacao.nome} (${org})`)
  let totalAtualizar = 0
  let totalInserir = 0
  for (const item of itens) {
    const existente = porChave.get(chaveDe(item))
    if (existente) {
      totalAtualizar++
      console.log(`  • ATUALIZA [${item.canal}/${item.nicho ?? 'genérico'}/${item.tipo}] "${(existente as { nome: string }).nome}" → "${item.nome}"`)
    } else {
      totalInserir++
      console.log(`  • INSERE  [${item.canal}/${item.nicho ?? 'genérico'}/${item.tipo}] "${item.nome}"`)
    }
  }
  console.log(`\nTotal: ${totalAtualizar} atualização(ões), ${totalInserir} inserção(ões).`)

  if (!confirmar) {
    console.log('\nEnsaio concluído: nenhuma escrita realizada. Use --confirmar para gravar.')
    return
  }

  for (const item of itens) {
    const existente = porChave.get(chaveDe(item))
    if (existente) {
      const { error } = await client
        .from('templates')
        .update({ nome: item.nome, assunto: item.assunto, html: item.html, corpo: item.corpo, ativo: true })
        .eq('id', (existente as { id: string }).id)
        .eq('organizacao_id', org)
      if (error) throw new Error(`Falha ao atualizar "${item.nome}": ${error.message}`)
    } else {
      const { error } = await client.from('templates').insert({
        organizacao_id: org,
        canal: item.canal,
        nicho: item.nicho,
        tipo: item.tipo,
        nome: item.nome,
        assunto: item.assunto,
        html: item.html,
        corpo: item.corpo,
        ativo: true,
        taxa_resposta: 0,
      })
      if (error) throw new Error(`Falha ao inserir "${item.nome}": ${error.message}`)
    }
  }
  console.log('\n✔ Importação concluída.')
}

main().catch((erro) => {
  console.error(erro instanceof Error ? erro.message : erro)
  process.exit(1)
})
