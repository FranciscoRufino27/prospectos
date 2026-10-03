// Enriquecimento pago do decisor: Crustdata (quem decide) + Anymail (e-mail).
// Cobre o corpo enviado, a leitura das respostas, as falhas honestas, a regra
// de custo (não paga de novo o que já tem) e o isolamento por organização.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BancoFalso } from '@/lib/templates/__tests__/bancoFalso'
import {
  buscarDecisoresCrustdata, buscarEmailAnymail, corpoPessoasCrustdata, emailDoDecisor, lerEnriquecimento, mapearPessoa,
  titulosDeDecisao, type Enriquecimento,
} from '@/lib/prospeccao/enriquecimento'

const estado = vi.hoisted(() => ({ usuarioId: null as string | null, banco: null as unknown }))

vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: estado.usuarioId ? { id: estado.usuarioId } : null } }) },
  }),
}))
vi.mock('@/lib/supabase-admin', () => ({
  createSupabaseAdminClient: () => (estado.banco as BancoFalso).cliente(),
}))

import { POST as POST_DECISOR } from '@/app/api/prospeccao/decisor-crustdata/route'
import { POST as POST_EMAIL } from '@/app/api/prospeccao/email-decisor/route'

const resposta = (status: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } })

const PESSOA = {
  crustdata_person_id: 1,
  basic_profile: { name: 'Ana Souza', current_title: 'CEO', location: { raw: 'São Paulo, Brazil' } },
  social_handles: { professional_network_identifier: { profile_url: 'https://www.linkedin.com/in/ana-souza' } },
}

describe('titulosDeDecisao', () => {
  it('usa os cargos-alvo do perfil; sem perfil, todos', () => {
    expect(titulosDeDecisao(['gerente'])).toEqual(['Gerente', 'Manager', 'Head'])
    expect(titulosDeDecisao(undefined)).toEqual(expect.arrayContaining(['CEO', 'Sócio', 'Founder', 'Proprietário', 'Gerente']))
  })
})

describe('corpoPessoasCrustdata', () => {
  it('filtra pelo domínio da empresa atual e por OU de títulos', () => {
    const corpo = corpoPessoasCrustdata('hotelmar.com.br', ['CEO', 'Diretor']) as { filters: { conditions: unknown[] }; limit: number }
    expect(corpo.filters.conditions).toEqual([
      { field: 'experience.employment_details.current.company_website_domain', type: '=', value: 'hotelmar.com.br' },
      {
        op: 'or',
        conditions: [
          { field: 'experience.employment_details.current.title', type: '[.]', value: 'CEO' },
          { field: 'experience.employment_details.current.title', type: '(.)', value: 'Diretor' },
        ],
      },
    ])
    expect(corpo.limit).toBe(5)
  })
})

describe('mapearPessoa', () => {
  it('lê nome, cargo, local e LinkedIn', () => {
    expect(mapearPessoa(PESSOA, 'hotelmar.com.br')).toEqual({
      nome: 'Ana Souza', cargo: 'CEO', local: 'São Paulo, Brazil', linkedin: 'https://www.linkedin.com/in/ana-souza',
    })
  })

  it('descarta a "pessoa" que é a própria empresa e LinkedIn de outro site', () => {
    expect(mapearPessoa({ basic_profile: { name: 'Inovacode .', current_title: 'CEO' } }, 'inovacode.com.br')).toBeNull()
    expect(mapearPessoa({ basic_profile: { name: 'Ana' } }, 'x.com')).toBeNull()
    const p = mapearPessoa({ ...PESSOA, social_handles: { professional_network_identifier: { profile_url: 'https://evil.com/in/x' } } }, 'x.com')
    expect(p?.linkedin).toBeNull()
  })
})

describe('buscarDecisoresCrustdata', () => {
  it('sem chave não chama a API', async () => {
    const f = vi.fn()
    expect(await buscarDecisoresCrustdata('x.com', ['CEO'], undefined, f as unknown as typeof fetch)).toEqual({ ok: false, motivo: 'sem_chave' })
    expect(f).not.toHaveBeenCalled()
  })

  it('manda a chave e devolve os candidatos', async () => {
    const f = vi.fn(async () => resposta(200, { profiles: [PESSOA, { lixo: 1 }] }))
    const r = await buscarDecisoresCrustdata('hotelmar.com.br', ['CEO'], 'cd_k', f as unknown as typeof fetch)
    expect(r.ok && r.candidatos.map((c) => c.nome)).toEqual(['Ana Souza'])
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.crustdata.com/person/search')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer cd_k')
  })

  it('ordena por nível do cargo: CEO/sócio/diretor antes de gerente', async () => {
    const pessoa = (name: string, current_title: string) => ({ basic_profile: { name, current_title } })
    const f = vi.fn(async () => resposta(200, { profiles: [
      pessoa('Flavia Bispo', 'Gerente de recepção'),
      pessoa('Ricardo Correia', 'CFO - Diretor Administrativo Financeiro'),
      pessoa('Ana Souza', 'CEO'),
    ] }))
    const r = await buscarDecisoresCrustdata('x.com.br', ['CEO'], 'k', f as unknown as typeof fetch)
    expect(r.ok && r.candidatos.map((c) => c.nome)).toEqual(['Ana Souza', 'Ricardo Correia', 'Flavia Bispo'])
  })

  it.each([[401, 'sem_chave'], [403, 'sem_credito'], [429, 'limite'], [500, 'indisponivel']])('HTTP %i → %s', async (status, motivo) => {
    const f = vi.fn(async () => resposta(status, {}))
    expect(await buscarDecisoresCrustdata('x.com', ['CEO'], 'k', f as unknown as typeof fetch)).toEqual({ ok: false, motivo })
  })
})

describe('buscarEmailAnymail', () => {
  const agora = new Date('2026-10-01T12:00:00Z')
  const chamar = (corpo: unknown, status = 200) =>
    buscarEmailAnymail('Ana Souza', 'hotelmar.com.br', 'am_k', vi.fn(async () => resposta(status, corpo)) as unknown as typeof fetch, agora)

  it('valid → válido, risky → arriscado, resto → não encontrado (sem e-mail)', async () => {
    expect(await chamar({ email: 'ANA@hotelmar.com.br', email_status: 'valid' })).toEqual({
      ok: true,
      resultado: { nome: 'Ana Souza', dominio: 'hotelmar.com.br', status: 'valido', email: 'ana@hotelmar.com.br', consultadoEm: agora.toISOString() },
    })
    const arriscado = await chamar({ email: 'ana@hotelmar.com.br', email_status: 'risky' })
    expect(arriscado.ok && arriscado.resultado.status).toBe('arriscado')
    const nada = await chamar({ email: null, email_status: 'not_found' })
    expect(nada.ok && [nada.resultado.status, nada.resultado.email]).toEqual(['nao_encontrado', null])
    const lixo = await chamar({ email: 'sem-arroba', email_status: 'valid' })
    expect(lixo.ok && lixo.resultado.status).toBe('nao_encontrado')
  })

  it('envia nome + domínio com a chave no Authorization', async () => {
    const f = vi.fn(async () => resposta(200, { email: null, email_status: 'not_found' }))
    await buscarEmailAnymail('Ana Souza', 'hotelmar.com.br', 'am_k', f as unknown as typeof fetch)
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.anymailfinder.com/v5.1/find-email/person')
    expect((init.headers as Record<string, string>).Authorization).toBe('am_k')
    expect(JSON.parse(init.body as string)).toEqual({ domain: 'hotelmar.com.br', full_name: 'Ana Souza' })
  })

  it('falhas honestas', async () => {
    expect(await buscarEmailAnymail('Ana Souza', 'x.com', '', vi.fn() as unknown as typeof fetch)).toEqual({ ok: false, motivo: 'sem_chave' })
    expect((await chamar({}, 402))).toEqual({ ok: false, motivo: 'sem_credito' })
    const rede = await buscarEmailAnymail('Ana Souza', 'x.com', 'k', vi.fn(async () => { throw new Error('timeout') }) as unknown as typeof fetch)
    expect(rede).toEqual({ ok: false, motivo: 'indisponivel' })
  })
})

describe('lerEnriquecimento / emailDoDecisor', () => {
  const enr: Enriquecimento = {
    anymail: { nome: 'Ana Souza', dominio: 'x.com', status: 'valido', email: 'ana@x.com', consultadoEm: '2026-10-01T00:00:00Z' },
  }

  it('lê só o que tem a forma esperada', () => {
    expect(lerEnriquecimento(null)).toBeNull()
    expect(lerEnriquecimento({ anymail: { nome: 'x' } })).toBeNull()
    expect(lerEnriquecimento(enr)).toEqual(enr)
  })

  it('e-mail só vale se válido e da mesma pessoa (ignora acento e caixa)', () => {
    expect(emailDoDecisor(enr, 'ANA SOUZA')).toBe('ana@x.com')
    expect(emailDoDecisor(enr, 'Bruno Lima')).toBeNull()
    expect(emailDoDecisor({ anymail: { ...enr.anymail!, status: 'arriscado' } }, 'Ana Souza')).toBeNull()
    expect(emailDoDecisor(null, 'Ana Souza')).toBeNull()
  })
})

describe('rotas de enriquecimento', () => {
  const ORG_A = 'aaaaaaaa-0000-4000-8000-000000000001'
  const ORG_B = 'bbbbbbbb-0000-4000-8000-000000000002'
  const USUARIO_A = 'aaaaaaaa-1111-4111-8111-00000000000c'
  const CNPJ = '12345678000199'
  const CNPJ_SEM_DOMINIO = '98765432000188'
  const SALVO_B: Enriquecimento = {
    crustdata: { dominio: 'hotelmar.com.br', candidatos: [{ nome: 'Da Org B', cargo: 'CEO', linkedin: null, local: null }], consultadoEm: '2026-09-01T00:00:00Z' },
  }
  const fetchOriginal = globalThis.fetch
  const json = (corpo: unknown) => ({ method: 'POST', body: JSON.stringify(corpo), headers: { 'Content-Type': 'application/json' } })
  const decisor = (corpo: unknown) => POST_DECISOR(new Request('http://localhost/api/prospeccao/decisor-crustdata', json(corpo)))
  const email = (corpo: unknown) => POST_EMAIL(new Request('http://localhost/api/prospeccao/email-decisor', json(corpo)))
  const linhaDa = (org: string) => (estado.banco as BancoFalso).linhas('prospeccao_decisores').find((l) => l.organizacao_id === org && l.cnpj === CNPJ)

  beforeEach(() => {
    estado.banco = new BancoFalso({
      perfis: [{ id: USUARIO_A, organizacao_id: ORG_A, role: 'usuario' }],
      perfil_permissoes: [],
      organizacoes: [
        { id: ORG_A, configuracoes: { _schema_version: 6, prospeccao: { cnaes: ['5510801'], cargosAlvo: ['diretor'] } } },
        { id: ORG_B, configuracoes: {} },
      ],
      catalogo_estabelecimentos: [
        { cnpj: CNPJ, email: 'reservas@hotelmar.com.br', nome_fantasia: 'HOTEL MAR', razao_social: 'MAR HOTELARIA LTDA' },
        { cnpj: CNPJ_SEM_DOMINIO, email: 'fulano@gmail.com', nome_fantasia: 'POUSADA X', razao_social: 'X LTDA' },
      ],
      prospeccao_decisores: [{ organizacao_id: ORG_B, cnpj: CNPJ, nome: 'Da Org B', enriquecimento: SALVO_B }],
    })
    estado.usuarioId = USUARIO_A
    vi.stubEnv('CRUSTDATA_API_KEY', 'cd_k')
    vi.stubEnv('ANYMAILFINDER_API_KEY', 'am_k')
  })
  afterEach(() => {
    globalThis.fetch = fetchOriginal
    vi.unstubAllEnvs()
  })

  it('sem sessão: 401 e nenhuma API paga chamada', async () => {
    estado.usuarioId = null
    const f = vi.fn()
    globalThis.fetch = f as unknown as typeof fetch
    expect((await decisor({ cnpj: CNPJ })).status).toBe(401)
    expect((await email({ cnpj: CNPJ, nome: 'Ana Souza' })).status).toBe(401)
    expect(f).not.toHaveBeenCalled()
  })

  it('fora do catálogo ou sem domínio próprio: recusa sem gastar crédito', async () => {
    const f = vi.fn()
    globalThis.fetch = f as unknown as typeof fetch
    expect((await decisor({ cnpj: '11111111000111' })).status).toBe(404)
    const semDominio = await decisor({ cnpj: CNPJ_SEM_DOMINIO })
    expect(semDominio.status).toBe(422)
    expect((await semDominio.json()).erro).toMatch(/domínio próprio/)
    expect((await email({ cnpj: CNPJ, nome: 'Ana' })).status).toBe(400)
    expect(f).not.toHaveBeenCalled()
  })

  it('Crustdata: usa os cargos do perfil, salva na org da sessão e não toca a org B', async () => {
    const f = vi.fn(async () => resposta(200, { profiles: [PESSOA] }))
    globalThis.fetch = f as unknown as typeof fetch
    const res = await decisor({ cnpj: CNPJ })
    expect(res.status).toBe(200)
    expect((await res.json()).candidatos[0].nome).toBe('Ana Souza')
    const corpo = JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
    expect(corpo.filters.conditions[0].value).toBe('hotelmar.com.br')
    expect(corpo.filters.conditions[1].conditions.map((c: { value: string }) => c.value)).toContain('CEO')
    expect(corpo.filters.conditions[1].conditions.map((c: { value: string }) => c.value)).not.toContain('Gerente')
    expect((linhaDa(ORG_A)?.enriquecimento as Enriquecimento).crustdata?.candidatos[0].nome).toBe('Ana Souza')
    expect(linhaDa(ORG_B)?.enriquecimento).toEqual(SALVO_B)
  })

  it('Crustdata: já pago para o domínio volta do salvo, sem nova chamada', async () => {
    globalThis.fetch = vi.fn(async () => resposta(200, { profiles: [PESSOA] })) as unknown as typeof fetch
    await decisor({ cnpj: CNPJ })
    const f = vi.fn()
    globalThis.fetch = f as unknown as typeof fetch
    const segunda = await decisor({ cnpj: CNPJ })
    expect((await segunda.json()).reaproveitado).toBe(true)
    expect(f).not.toHaveBeenCalled()
  })

  it('Anymail: salva sem apagar a Crustdata; "não achou" fica guardado; válido não é pago de novo', async () => {
    globalThis.fetch = vi.fn(async () => resposta(200, { profiles: [PESSOA] })) as unknown as typeof fetch
    await decisor({ cnpj: CNPJ })

    globalThis.fetch = vi.fn(async () => resposta(200, { email: null, email_status: 'not_found' })) as unknown as typeof fetch
    expect((await (await email({ cnpj: CNPJ, nome: 'Ana Souza' })).json()).status).toBe('nao_encontrado')

    // Cache de inteligência: o "não achou" da mesma pessoa vale 60 dias, sem nova consulta.
    const repete = vi.fn(async () => resposta(200, { email: 'ana@hotelmar.com.br', email_status: 'valid' }))
    globalThis.fetch = repete as unknown as typeof fetch
    expect((await (await email({ cnpj: CNPJ, nome: 'Ana Souza' })).json()).status).toBe('nao_encontrado')
    expect(repete).not.toHaveBeenCalled()

    const achou = vi.fn(async () => resposta(200, { email: 'bruno@hotelmar.com.br', email_status: 'valid' }))
    globalThis.fetch = achou as unknown as typeof fetch
    expect((await (await email({ cnpj: CNPJ, nome: 'Bruno Lima' })).json()).email).toBe('bruno@hotelmar.com.br')
    expect(achou).toHaveBeenCalledTimes(1)

    const salvo = linhaDa(ORG_A)?.enriquecimento as Enriquecimento
    expect(salvo.crustdata?.candidatos).toHaveLength(1)
    expect(salvo.anymail?.email).toBe('bruno@hotelmar.com.br')

    const f = vi.fn()
    globalThis.fetch = f as unknown as typeof fetch
    expect((await (await email({ cnpj: CNPJ, nome: 'bruno lima' })).json()).reaproveitado).toBe(true)
    expect(f).not.toHaveBeenCalled()
  })

  it('falha da API vira erro honesto e nada é salvo', async () => {
    globalThis.fetch = vi.fn(async () => resposta(402, {})) as unknown as typeof fetch
    const res = await email({ cnpj: CNPJ, nome: 'Ana Souza' })
    expect(res.status).toBe(402)
    expect((await res.json()).erro).toMatch(/Anymail/)
    expect(linhaDa(ORG_A)).toBeUndefined()
  })
})
