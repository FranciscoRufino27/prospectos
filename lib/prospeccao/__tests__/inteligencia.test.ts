// Cache de inteligência (global): consulta antes de qualquer API, guarda o
// "achou" e o "não achou" com validade, registra custo e quem disparou, e não
// guarda o que não é fato sobre a empresa (sem chave/crédito/limite).
import { describe, expect, it, vi } from 'vitest'
import { BancoFalso } from '@/lib/templates/__tests__/bancoFalso'
import {
  buscarEmailComCache, buscarPessoasComCache, chaveEmail, chavePessoas, consultarOpenCnpjComCache, consultarSociosComCache,
  CUSTO_PESSOA_CRUSTDATA, type ContextoInteligencia,
} from '../inteligencia'
import type { CandidatoDecisor, EmailDecisor } from '../enriquecimento'

const ORG_A = 'aaaaaaaa-0000-4000-8000-000000000001'
const ORG_B = 'bbbbbbbb-0000-4000-8000-000000000002'
const DIA = 86_400_000
const T0 = Date.UTC(2026, 9, 3)

function contexto(banco: BancoFalso, org: string, agora = T0): ContextoInteligencia {
  return { admin: banco.cliente(), organizacaoId: org, agora: () => agora }
}

const emailValido = (nome: string): EmailDecisor => ({ nome, dominio: 'hotelsol.com.br', status: 'valido', email: 'maria@hotelsol.com.br', consultadoEm: 'x' })
const naoAchou = (nome: string): EmailDecisor => ({ nome, dominio: 'hotelsol.com.br', status: 'nao_encontrado', email: null, consultadoEm: 'x' })
const pessoa: CandidatoDecisor = { nome: 'Maria Lima', cargo: 'CEO', linkedin: null, local: null }

describe('chaves', () => {
  it('e-mail: domínio minúsculo + nome sem acento, espaço nem pontuação', () => {
    expect(chaveEmail('Maria  Souza-Lima', 'HotelSol.com.br')).toBe(chaveEmail('MARIA SOUZA LIMA', 'hotelsol.com.br'))
    expect(chaveEmail('João', 'x.com')).toBe('x.com#joao')
  })
  it('pessoas: cargos sem ordem nem caixa; alvo e limite diferenciam', () => {
    expect(chavePessoas('Sol.com', ['CEO', 'Diretor'], 5)).toBe(chavePessoas('sol.com', ['diretor', 'ceo', 'CEO'], 5))
    expect(chavePessoas('sol.com', ['ceo'], 5)).not.toBe(chavePessoas('sol.com', ['ceo'], 3))
    expect(chavePessoas({ nomeEmpresa: 'Sol' }, ['ceo'], 5)).not.toBe(chavePessoas('sol', ['ceo'], 5))
  })
})

describe('buscarEmailComCache', () => {
  it('primeira consulta chama a API e grava fato, custo e quem pagou; outra org reaproveita sem chamar', async () => {
    const banco = new BancoFalso({})
    const api = vi.fn(async () => ({ ok: true as const, resultado: emailValido('Maria Souza Lima') }))
    const a = await buscarEmailComCache(contexto(banco, ORG_A), 'Maria Souza Lima', 'hotelsol.com.br', api)
    expect(a).toMatchObject({ ok: true, resultado: { email: 'maria@hotelsol.com.br' } })
    const [linha] = banco.linhas('enriquecimento_cache')
    expect(linha).toMatchObject({ tipo: 'anymail_email', chave: 'hotelsol.com.br#mariasouzalima', status: 'ok', custo: 1, pago_por_organizacao: ORG_A })

    const b = await buscarEmailComCache(contexto(banco, ORG_B), 'MARIA SOUZA LIMA', 'hotelsol.com.br', api)
    expect(b).toMatchObject({ ok: true, resultado: { email: 'maria@hotelsol.com.br' } })
    expect(api).toHaveBeenCalledTimes(1)
  })

  it('"não achou" é guardado: não chama de novo por 60 dias; depois tenta de novo', async () => {
    const banco = new BancoFalso({})
    const api = vi.fn(async () => ({ ok: true as const, resultado: naoAchou('Maria') }))
    await buscarEmailComCache(contexto(banco, ORG_A), 'Maria', 'hotelsol.com.br', api)
    expect(banco.linhas('enriquecimento_cache')[0]).toMatchObject({ status: 'nao_encontrado', custo: 0 })

    const dentro = await buscarEmailComCache(contexto(banco, ORG_B, T0 + 59 * DIA), 'Maria', 'hotelsol.com.br', api)
    expect(dentro).toMatchObject({ ok: true, resultado: { status: 'nao_encontrado', email: null } })
    expect(api).toHaveBeenCalledTimes(1)

    await buscarEmailComCache(contexto(banco, ORG_B, T0 + 61 * DIA), 'Maria', 'hotelsol.com.br', api)
    expect(api).toHaveBeenCalledTimes(2)
  })

  it('sem crédito, sem chave e limite não viram cache; instabilidade vira falha de 10 min', async () => {
    const banco = new BancoFalso({})
    const semCredito = vi.fn(async () => ({ ok: false as const, motivo: 'sem_credito' as const }))
    expect(await buscarEmailComCache(contexto(banco, ORG_A), 'Maria', 'hotelsol.com.br', semCredito)).toEqual({ ok: false, motivo: 'sem_credito' })
    expect(banco.linhas('enriquecimento_cache')).toHaveLength(0)

    const instavel = vi.fn(async () => ({ ok: false as const, motivo: 'indisponivel' as const }))
    await buscarEmailComCache(contexto(banco, ORG_A), 'Maria', 'hotelsol.com.br', instavel)
    expect(banco.linhas('enriquecimento_cache')[0]).toMatchObject({ status: 'falha' })
    expect(await buscarEmailComCache(contexto(banco, ORG_A, T0 + 5 * 60_000), 'Maria', 'hotelsol.com.br', instavel)).toEqual({ ok: false, motivo: 'indisponivel' })
    expect(instavel).toHaveBeenCalledTimes(1)
    await buscarEmailComCache(contexto(banco, ORG_A, T0 + 11 * 60_000), 'Maria', 'hotelsol.com.br', instavel)
    expect(instavel).toHaveBeenCalledTimes(2)
  })

  it('cache fora do ar não bloqueia: consulta a API normalmente', async () => {
    const quebrado = { from: () => { throw new Error('tabela inexistente') } } as unknown as ContextoInteligencia['admin']
    const api = vi.fn(async () => ({ ok: true as const, resultado: emailValido('Maria') }))
    const r = await buscarEmailComCache({ admin: quebrado, organizacaoId: ORG_A, agora: () => T0 }, 'Maria', 'hotelsol.com.br', api)
    expect(r.ok).toBe(true)
    expect(api).toHaveBeenCalledTimes(1)
  })
})

describe('buscarPessoasComCache', () => {
  it('custo = pessoas devolvidas × 0,13; lista vazia vira "não achou" por 30 dias', async () => {
    const banco = new BancoFalso({})
    const comPessoas = vi.fn(async () => ({ ok: true as const, candidatos: [pessoa, { ...pessoa, nome: 'Joao' }] }))
    await buscarPessoasComCache(contexto(banco, ORG_A), 'hotelsol.com.br', ['ceo'], 5, comPessoas)
    expect(banco.linhas('enriquecimento_cache')[0]).toMatchObject({ tipo: 'crustdata_pessoas', status: 'ok', custo: 2 * CUSTO_PESSOA_CRUSTDATA })
    expect((await buscarPessoasComCache(contexto(banco, ORG_B), 'hotelsol.com.br', ['CEO'], 5, comPessoas))).toMatchObject({ ok: true, candidatos: [{ nome: 'Maria Lima' }, { nome: 'Joao' }] })
    expect(comPessoas).toHaveBeenCalledTimes(1)

    const vazio = vi.fn(async () => ({ ok: true as const, candidatos: [] }))
    await buscarPessoasComCache(contexto(banco, ORG_A), 'outra.com', ['ceo'], 5, vazio)
    await buscarPessoasComCache(contexto(banco, ORG_B, T0 + 29 * DIA), 'outra.com', ['ceo'], 5, vazio)
    expect(vazio).toHaveBeenCalledTimes(1)
    await buscarPessoasComCache(contexto(banco, ORG_B, T0 + 31 * DIA), 'outra.com', ['ceo'], 5, vazio)
    expect(vazio).toHaveBeenCalledTimes(2)
  })
})

describe('OpenCNPJ com cache (compartilhado com a Central HubSpot)', () => {
  const CNPJ = '12345678000199'
  const fetchOpenCnpj = () => vi.fn(async () => Response.json({
    razao_social: 'HOTEL SOL LTDA', QSA: [{ nome_socio: 'MARIA SOUZA LIMA', qualificacao_socio: 'Sócio-Administrador', identificador_socio: 'Pessoa Física' }],
  })) as unknown as typeof fetch & { mock: { calls: unknown[] } }

  it('uma consulta guarda cadastro + sócios; a segunda (outra org) não chama', async () => {
    const banco = new BancoFalso({})
    const f = fetchOpenCnpj()
    const a = await consultarSociosComCache(contexto(banco, ORG_A), CNPJ, f)
    expect(a).toEqual({ ok: true, socios: [{ nome: 'Maria Souza Lima', qualificacao: 'Sócio-Administrador', desde: null }] })
    expect(await consultarSociosComCache(contexto(banco, ORG_B), CNPJ, f)).toEqual(a)
    expect(f.mock.calls).toHaveLength(1)
    expect(banco.linhas('enriquecimento_cache')[0]).toMatchObject({ tipo: 'opencnpj', chave: CNPJ, status: 'ok', custo: 0 })
  })

  it('entrada antiga da Central HubSpot (sem sócios) é reconsultada só por quem precisa dos sócios', async () => {
    const banco = new BancoFalso({ enriquecimento_cache: [{
      tipo: 'opencnpj', chave: CNPJ, status: 'ok', resultado: { cnpj: CNPJ, razao_social: 'HOTEL SOL LTDA' },
      consultado_em: new Date(T0).toISOString(), expira_em: new Date(T0 + 30 * DIA).toISOString(),
    }] })
    const f = fetchOpenCnpj()
    expect(await consultarOpenCnpjComCache(contexto(banco, ORG_A), CNPJ, { fetch: f })).toMatchObject({ status: 'ok' })
    expect(f.mock.calls).toHaveLength(0)
    const s = await consultarSociosComCache(contexto(banco, ORG_A), CNPJ, f)
    expect(s.ok && s.socios).toHaveLength(1)
    expect(f.mock.calls).toHaveLength(1)
  })

  it('CNPJ inexistente fica em cache negativo', async () => {
    const banco = new BancoFalso({})
    const f = vi.fn(async () => new Response('', { status: 404 })) as unknown as typeof fetch & { mock: { calls: unknown[] } }
    expect(await consultarSociosComCache(contexto(banco, ORG_A), CNPJ, f)).toEqual({ ok: false, motivo: 'nao_encontrado' })
    expect(await consultarSociosComCache(contexto(banco, ORG_B, T0 + DIA), CNPJ, f)).toEqual({ ok: false, motivo: 'nao_encontrado' })
    expect(f.mock.calls).toHaveLength(1)
  })
})
