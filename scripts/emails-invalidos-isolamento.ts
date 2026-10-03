/**
 * Teste de ISOLAMENTO da lista `emails_invalidos` e do trigger que marca o lead
 * (migration 0062) — end-to-end e EFÊMERO, no padrão de
 * scripts/templates-isolamento.ts.
 *
 * Cria 2 organizações fake, 2 usuários admin e prova que:
 *   - o endereço inválido da org A marca como bounced o lead que ENTRA na A com
 *     ele (insert, inclusive com maiúsculas/espaços) e o que PASSA a usá-lo
 *     (update do e-mail);
 *   - o MESMO endereço na org B não marca nada (o trigger não cruza orgs);
 *   - pela sessão, A lê só a própria lista e B não vê a lista da A;
 *   - nenhuma sessão grava/altera/apaga a lista (escrita só via service_role).
 *
 * No fim (sempre, mesmo em falha) apaga tudo o que criou.
 *
 *   npx tsx scripts/emails-invalidos-isolamento.ts --confirmar
 *
 * NÃO envia nada, NÃO roda motor e NÃO toca em linha existente: só cria e
 * apaga linhas próprias, carimbadas com o run desta execução.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'
import { exigirConfirmacao } from './_guarda'

for (const linha of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8').split(/\r?\n/)) {
  const i = linha.indexOf('=')
  if (i <= 0 || linha.trim().startsWith('#')) continue
  const k = linha.slice(0, i).trim()
  if (!(k in process.env)) process.env[k] = linha.slice(i + 1).trim().replace(/^["']|["']$/g, '')
}

const C = { dim: '\x1b[2m', b: '\x1b[1m', grn: '\x1b[32m', red: '\x1b[31m', r: '\x1b[0m' }
const ok = (s: string) => console.log(`${C.grn}✓${C.r} ${s}`)
const no = (s: string) => console.log(`${C.red}✗${C.r} ${s}`)
const RUN = Date.now().toString(36)

let falhas = 0
const checa = (cond: boolean, desc: string) => { cond ? ok(desc) : (no(desc), falhas++) }

exigirConfirmacao({
  nome: 'Isolamento de emails_invalidos + trigger (0062) — efêmero',
  alvo: 'Supabase de produção: cria e apaga 2 organizações, 2 usuários, leads e e-mails de teste',
  efeitos: [
    'cria 2 organizações fake, 2 usuários admin e leads de teste',
    'grava um e-mail inválido na org A e confere o trigger nas duas orgs',
    'loga como cada usuário e tenta ler/alterar a lista da outra organização',
    'apaga tudo o que criou no fim, mesmo em caso de falha',
  ],
})

async function main() {
  const { createClient } = await import('@supabase/supabase-js')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const sk = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!sk || sk.includes('sua_')) { no('SUPABASE_SERVICE_ROLE_KEY ausente/placeholder.'); process.exit(1) }
  if (!anon || anon.includes('sua_')) { no('NEXT_PUBLIC_SUPABASE_ANON_KEY ausente/placeholder.'); process.exit(1) }
  const admin = createClient(url, sk, { auth: { persistSession: false, autoRefreshToken: false } })

  console.log(`\n${C.b}== Isolamento de emails_invalidos — run=${RUN} ==${C.r}\n`)
  const criado = { orgs: [] as string[], users: [] as string[] }
  const invalido = `iso-${RUN}@invalido.test`

  try {
    const { data: orgs, error: orgErr } = await admin.from('organizacoes').insert([
      { nome: `Org EmInv A ${RUN}`, slug: `eminv-a-${RUN}` },
      { nome: `Org EmInv B ${RUN}`, slug: `eminv-b-${RUN}` },
    ]).select('id, slug')
    if (orgErr || orgs?.length !== 2) throw new Error('Falha criando organizações: ' + (orgErr?.message ?? '?'))
    const orgA = orgs.find((o) => o.slug === `eminv-a-${RUN}`)!.id as string
    const orgB = orgs.find((o) => o.slug === `eminv-b-${RUN}`)!.id as string
    criado.orgs.push(orgA, orgB)

    const senha = `EmInv!${RUN}Aa1`
    async function novoUser(tag: string) {
      const email = `eminv-${tag}-${RUN}@iso.test`
      const { data, error } = await admin.auth.admin.createUser({ email, password: senha, email_confirm: true })
      if (error || !data.user) throw new Error(`Falha criando user ${tag}: ${error?.message ?? '?'}`)
      criado.users.push(data.user.id)
      return { id: data.user.id, email }
    }
    const userA = await novoUser('a')
    const userB = await novoUser('b')
    const { error: perfErr } = await admin.from('perfis').insert([
      { id: userA.id, nome: 'EmInv A', role: 'admin', organizacao_id: orgA },
      { id: userB.id, nome: 'EmInv B', role: 'admin', organizacao_id: orgB },
    ])
    if (perfErr) throw new Error('Falha criando perfis: ' + perfErr.message)

    const { error: listaErr } = await admin.from('emails_invalidos').insert({ organizacao_id: orgA, email: invalido, motivo: '5.1.1' })
    if (listaErr) throw new Error('Falha gravando e-mail inválido (migration 0062 aplicada?): ' + listaErr.message)
    ok('cenário montado (2 orgs, 2 usuários, 1 e-mail inválido na org A).')

    async function novoLead(org: string, email: string) {
      const { data, error } = await admin.from('leads')
        .insert({ organizacao_id: org, empresa: `ISO ${RUN}`, contato_nome: 'Teste', contato_email: email, owner: 'n8n', estagio: 'novos_leads' })
        .select('id, bounced, bounced_em').single()
      if (error || !data) throw new Error('Falha criando lead: ' + (error?.message ?? '?'))
      return data as { id: string; bounced: boolean; bounced_em: string | null }
    }

    console.log(`\n${C.b}[teste] trigger${C.r}`)
    const entraNaA = await novoLead(orgA, `  ${invalido.toUpperCase()} `)
    checa(entraNaA.bounced === true && !!entraNaA.bounced_em, 'lead que ENTRA na org A com o e-mail inválido nasce bounced')
    const entraNaB = await novoLead(orgB, invalido)
    checa(entraNaB.bounced === false, 'o MESMO e-mail na org B não marca nada (trigger não cruza orgs)')
    const validoNaA = await novoLead(orgA, `valido-${RUN}@iso.test`)
    checa(validoNaA.bounced === false, 'lead da org A com e-mail válido segue sem bounce')
    const { data: trocou } = await admin.from('leads').update({ contato_email: invalido })
      .eq('organizacao_id', orgA).eq('id', validoNaA.id).select('bounced').single()
    checa(trocou?.bounced === true, 'lead da org A que PASSA a usar o e-mail inválido fica bounced')

    async function comoUsuario(email: string): Promise<SupabaseClient> {
      const c = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
      const { error } = await c.auth.signInWithPassword({ email, password: senha })
      if (error) throw new Error(`Login falhou (${email}): ${error.message}`)
      return c
    }

    console.log(`\n${C.b}[teste] RLS da lista${C.r}`)
    const cliA = await comoUsuario(userA.email)
    const vistosA = await cliA.from('emails_invalidos').select('organizacao_id, email')
    checa(!vistosA.error && vistosA.data?.length === 1 && vistosA.data[0].organizacao_id === orgA,
      `A lê só a própria lista (${vistosA.data?.length ?? 0} linha)`)
    const insA = await cliA.from('emails_invalidos').insert({ organizacao_id: orgA, email: `plantado-${RUN}@iso.test` }).select('email')
    checa(!!insA.error || (insA.data?.length ?? 0) === 0, 'A não grava na própria lista pela sessão (só service_role)')

    const cliB = await comoUsuario(userB.email)
    const vistosB = await cliB.from('emails_invalidos').select('email')
    checa(!vistosB.error && (vistosB.data?.length ?? 0) === 0, 'B não vê a lista da A')
    const insB = await cliB.from('emails_invalidos').insert({ organizacao_id: orgA, email: `plantado-b-${RUN}@iso.test` }).select('email')
    checa(!!insB.error || (insB.data?.length ?? 0) === 0, 'B não grava na lista da A')
    const updB = await cliB.from('emails_invalidos').update({ motivo: 'INVADIDO' }).eq('organizacao_id', orgA).select('email')
    checa(!updB.error && (updB.data?.length ?? 0) === 0, 'UPDATE de B na lista da A → 0 linhas')
    const delB = await cliB.from('emails_invalidos').delete().eq('organizacao_id', orgA).select('email')
    checa(!delB.error && (delB.data?.length ?? 0) === 0, 'DELETE de B na lista da A → 0 linhas')

    const intacta = await admin.from('emails_invalidos').select('email, motivo').eq('organizacao_id', orgA)
    checa(intacta.data?.length === 1 && intacta.data[0].motivo === '5.1.1', 'lista da A intacta depois das tentativas')
  } finally {
    console.log(`\n${C.b}[limpeza]${C.r}`)
    if (criado.orgs.length) {
      await admin.from('leads').delete().in('organizacao_id', criado.orgs)
      await admin.from('contatos').delete().in('organizacao_id', criado.orgs)
      await admin.from('empresas').delete().in('organizacao_id', criado.orgs)
      await admin.from('emails_invalidos').delete().in('organizacao_id', criado.orgs)
      await admin.from('perfil_permissoes').delete().in('organizacao_id', criado.orgs)
      await admin.from('perfis').delete().in('organizacao_id', criado.orgs)
    }
    for (const id of criado.users) {
      const { error } = await admin.auth.admin.deleteUser(id)
      if (error) { no(`usuário ${id} não removido: ${error.message}`); falhas++ }
    }
    if (criado.orgs.length) {
      const { error } = await admin.from('organizacoes').delete().in('id', criado.orgs)
      checa(!error, `organizações de teste removidas (${criado.orgs.length})${error ? `: ${error.message}` : ''}`)
    }
    const sobras = await admin.from('organizacoes').select('id').like('slug', `eminv-%-${RUN}`)
    checa((sobras.data?.length ?? 0) === 0, 'nenhuma organização temporária sobrando')
  }

  console.log(falhas ? `\n${C.red}${falhas} FALHA(S)${C.r}` : `\n${C.grn}ISOLAMENTO OK${C.r}`)
  process.exit(falhas ? 1 : 0)
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
