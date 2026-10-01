/**
 * Teste de isolamento multi-tenant da prospecção (migrations 0050/0051/0057).
 *
 *   npx tsx scripts/prospeccao-isolamento.ts
 *
 * Roda TUDO numa transação e SEMPRE termina em ROLLBACK: cria duas
 * organizações e CNPJs fictícios, exercita busca, descarte e importação, e
 * desfaz. Nada persiste. Exige DATABASE_URL (conexão de banco de TESTE).
 *
 * Prova que:
 *   - descarte de uma org não esconde a empresa da outra;
 *   - "já na base" é por organização;
 *   - importação simulada não grava nada;
 *   - importação real cria empresa+lead+contato ligados, fora do motor;
 *   - reimportar é idempotente por (org, cnpj);
 *   - anon/authenticated não executam as RPCs nem leem o catálogo.
 */
import { bootstrapEnv } from './_bootstrap'
import pg from 'pg'

bootstrapEnv()

const C = { grn: '\x1b[32m', red: '\x1b[31m', b: '\x1b[1m', r: '\x1b[0m' }
const MARCA = 'ISOLAMENTO-PROSPECCAO'
const CNPJ1 = '99999999000101'
const CNPJ2 = '99999999000102'
const CNPJ3 = '99999999000103'

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL ausente')
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await c.connect()
  const falhas: string[] = []
  const checar = (nome: string, ok: boolean) => {
    console.log(`${ok ? C.grn + '✓' : C.red + '✗'} ${nome}${C.r}`)
    if (!ok) falhas.push(nome)
  }
  const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await c.query(sql, p)).rows as T[]

  const filtros = (org: string) => [org, ['5510801'], false, [], [], [], false, false, MARCA]
  const buscar = (org: string) =>
    q<{ cnpj: string; ja_na_base: boolean }>(
      'select cnpj, ja_na_base from prospeccao_buscar($1,$2,$3,$4,$5,$6,$7,$8,$9,null,50)', filtros(org))
  const importar = (org: string, cnpj: string, simular: boolean) =>
    q<{ status: string; lead_id: string | null }>(
      'select status, lead_id from prospeccao_importar($1, null, null, $2, $3::jsonb, $4)',
      [org, 'hotelaria', JSON.stringify([{ cnpj, contato_nome: 'Ana Teste', contato_cargo: 'Sócia' }]), simular])

  try {
    await c.query('begin')
    const [{ id: orgA }] = await q<{ id: string }>(`insert into organizacoes (nome, slug) values ($1, $2) returning id`, [`${MARCA} A`, `iso-a-${Date.now()}`])
    const [{ id: orgB }] = await q<{ id: string }>(`insert into organizacoes (nome, slug) values ($1, $2) returning id`, [`${MARCA} B`, `iso-b-${Date.now()}`])
    for (const [cnpj, email] of [[CNPJ1, 'um@iso.test'], [CNPJ2, 'dois@iso.test'], [CNPJ3, null]]) {
      await q(
        `insert into catalogo_estabelecimentos (cnpj, cnpj_basico, razao_social, cnae_principal, uf, municipio, email, mes_rf)
         values ($1, left($1, 8), $2, '5510801', 'SP', 'SAO PAULO', $3, '2026-09')`,
        [cnpj, `${MARCA} ${cnpj}`, email])
    }

    // Descarte da org B não afeta a org A.
    await q(`insert into prospeccao_descartes (organizacao_id, cnpj) values ($1, $2)`, [orgB, CNPJ1])
    checar('descarte de B esconde o CNPJ só para B', !(await buscar(orgB)).some((r) => r.cnpj === CNPJ1))
    checar('A continua vendo o CNPJ descartado por B', (await buscar(orgA)).some((r) => r.cnpj === CNPJ1))

    // Simulação não grava.
    const sim = await importar(orgA, CNPJ2, true)
    checar('prévia devolve importavel', sim[0]?.status === 'importavel' && sim[0]?.lead_id === null)
    const [{ n: empresasAposSim }] = await q<{ n: number }>(`select count(*)::int n from empresas where organizacao_id = $1`, [orgA])
    const [{ n: leadsAposSim }] = await q<{ n: number }>(`select count(*)::int n from leads where organizacao_id = $1`, [orgA])
    checar('prévia não cria empresa nem lead', empresasAposSim === 0 && leadsAposSim === 0)

    // Importação real em A.
    const real = await importar(orgA, CNPJ2, false)
    checar('importação real devolve importado com lead', real[0]?.status === 'importado' && !!real[0]?.lead_id)
    const [lead] = await q<{ owner: string; estagio: string; empresa_id: string; contato_id: string; organizacao_id: string; origem: string }>(
      `select owner, estagio, empresa_id, contato_id, organizacao_id, origem from leads where id = $1`, [real[0]?.lead_id])
    checar('lead nasce fora do motor (owner=n8n, novos_leads)', lead?.owner === 'n8n' && lead?.estagio === 'novos_leads')
    checar('lead ligado a empresa e contato da própria org', !!lead?.empresa_id && !!lead?.contato_id && lead?.organizacao_id === orgA)
    const [emp] = await q<{ cnpj: string; organizacao_id: string }>(`select cnpj, organizacao_id from empresas where id = $1`, [lead?.empresa_id])
    checar('CNPJ gravado na empresa da org A', emp?.cnpj === CNPJ2 && emp?.organizacao_id === orgA)

    // "Já na base" é por organização.
    checar('A vê o CNPJ importado como já na base', (await buscar(orgA)).find((r) => r.cnpj === CNPJ2)?.ja_na_base === true)
    checar('B NÃO vê o CNPJ de A como já na base', (await buscar(orgB)).find((r) => r.cnpj === CNPJ2)?.ja_na_base === false)

    // Idempotência e independência.
    checar('reimportar em A é idempotente (ja_na_base)', (await importar(orgA, CNPJ2, false))[0]?.status === 'ja_na_base')
    checar('B pode importar o mesmo CNPJ na própria base', (await importar(orgB, CNPJ2, false))[0]?.status === 'importado')
    const [{ n: leadsA }] = await q<{ n: number }>(`select count(*)::int n from leads where organizacao_id = $1`, [orgA])
    checar('importação de B não criou nada em A', leadsA === 1)
    checar('CNPJ sem e-mail é recusado', (await importar(orgA, CNPJ3, false))[0]?.status === 'sem_email')

    // Decisor salvo (0057): mesma chave de CNPJ em duas orgs, sem vazamento.
    await q(`insert into prospeccao_decisores (organizacao_id, cnpj, nome) values ($1, $2, 'Ana de A'), ($3, $2, 'Bia de B')`, [orgA, CNPJ1, orgB])
    const decisorDe = async (org: string) =>
      (await q<{ nome: string }>(`select nome from prospeccao_decisores where organizacao_id = $1 and cnpj = $2`, [org, CNPJ1]))[0]?.nome
    checar('cada org lê só o próprio decisor do mesmo CNPJ', (await decisorDe(orgA)) === 'Ana de A' && (await decisorDe(orgB)) === 'Bia de B')
    await q(`update prospeccao_decisores set nome = 'Ana alterada' where organizacao_id = $1 and cnpj = $2`, [orgA, CNPJ1])
    checar('alterar o decisor de A não muda o de B', (await decisorDe(orgB)) === 'Bia de B')
    const [rls] = await q<{ rls: boolean }>(`select relrowsecurity as rls from pg_class where relname = 'prospeccao_decisores'`)
    checar('prospeccao_decisores com RLS ligada', rls?.rls === true)

    // Privilégios: o cliente não chega às funções nem ao catálogo.
    const [priv] = await q<Record<string, boolean>>(`select
      has_function_privilege('authenticated', 'prospeccao_importar(uuid, uuid, text, text, jsonb, boolean)', 'execute') as auth_importar,
      has_function_privilege('anon', 'prospeccao_buscar(uuid, text[], boolean, text[], text[], text[], boolean, boolean, text, text, integer)', 'execute') as anon_buscar,
      has_function_privilege('authenticated', 'prospeccao_contar(uuid, text[], boolean, text[], text[], text[], boolean, boolean, text)', 'execute') as auth_contar,
      has_table_privilege('authenticated', 'catalogo_estabelecimentos', 'select') as auth_catalogo,
      has_table_privilege('authenticated', 'prospeccao_descartes', 'insert') as auth_insere_descarte,
      has_table_privilege('authenticated', 'prospeccao_decisores', 'update') as auth_altera_decisor,
      has_table_privilege('anon', 'prospeccao_decisores', 'select') as anon_le_decisor,
      has_function_privilege('service_role', 'prospeccao_importar(uuid, uuid, text, text, jsonb, boolean)', 'execute') as service_importar`)
    checar('authenticated/anon sem EXECUTE nas RPCs', !priv.auth_importar && !priv.anon_buscar && !priv.auth_contar)
    checar('authenticated sem leitura do catálogo e sem escrita em descartes', !priv.auth_catalogo && !priv.auth_insere_descarte)
    checar('service_role executa a importação', priv.service_importar)
    checar('decisores: authenticated não escreve e anon não lê', !priv.auth_altera_decisor && !priv.anon_le_decisor)
  } finally {
    await c.query('rollback')
    await c.end()
  }

  console.log(falhas.length ? `\n${C.red}${C.b}${falhas.length} falha(s).${C.r} (rollback feito)` : `\n${C.grn}${C.b}Tudo isolado.${C.r} (rollback feito — nada persistiu)`)
  process.exit(falhas.length ? 1 : 0)
}

main().catch((e) => {
  console.error(`${C.red}✗ ${e instanceof Error ? e.message : e}${C.r}`)
  process.exit(1)
})
