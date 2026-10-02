import { describe, expect, it, vi } from 'vitest'
import { mesmaPessoa, resolverDecisorAutomatico, type DependenciasDecisor, type EmpresaParaDecisor } from '../decisorAutomatico'
import type { AnaliseSalva } from '../decisores'

const EMPRESA: EmpresaParaDecisor = {
  cnpj: '12345678000199', porte: 'pequeno', mei: false,
  email: 'contato@hotelsol.com.br', razao_social: 'HOTEL SOL LTDA', nome_fantasia: 'HOTEL SOL',
}
const SOCIOS = [{ nome: 'Joao Carlos da Silva Souza', qualificacao: 'Sócio-Administrador', desde: null }]

function deps(extra: Partial<DependenciasDecisor> = {}) {
  const d = {
    consultarSocios: vi.fn(async () => ({ ok: true as const, socios: SOCIOS })),
    buscarEmail: vi.fn(async (nome: string, dominio: string) => ({
      ok: true as const,
      resultado: { nome, dominio, status: 'valido' as const, email: 'joao@hotelsol.com.br', consultadoEm: '2026-10-02T00:00:00Z' },
    })),
    buscarPessoas: vi.fn(async () => ({
      ok: true as const,
      candidatos: [
        { nome: 'Maria Lima', cargo: 'Gerente', linkedin: 'https://www.linkedin.com/in/maria', local: null },
        { nome: 'João Souza', cargo: 'CEO', linkedin: 'https://www.linkedin.com/in/joaosouza', local: null },
      ],
    })),
    salvarConsulta: vi.fn(async () => {}),
    salvarEnriquecimento: vi.fn(async () => {}),
    salvarDecisor: vi.fn(async () => {}),
    ...extra,
  }
  return d
}

describe('mesmaPessoa', () => {
  it('casa nome completo da Receita com primeiro + último do LinkedIn', () => {
    expect(mesmaPessoa('Joao Carlos da Silva Souza', 'João Souza')).toBe(true)
    expect(mesmaPessoa('Joao Carlos da Silva Souza', 'João Carlos Silva')).toBe(true)
  })
  it('não casa primeiro nome diferente, sobrenome ausente ou nome solto', () => {
    expect(mesmaPessoa('Joao Carlos da Silva Souza', 'Pedro Souza')).toBe(false)
    expect(mesmaPessoa('Joao Carlos da Silva Souza', 'João Pereira')).toBe(false)
    expect(mesmaPessoa('Joao Carlos da Silva Souza', 'João')).toBe(false)
  })
})

describe('resolverDecisorAutomatico', () => {
  it('sócio sugerido → e-mail (Anymail) → LinkedIn e cargo (Crustdata), tudo salvo', async () => {
    const d = deps()
    const r = await resolverDecisorAutomatico(EMPRESA, undefined, null, d)
    expect(r).toMatchObject({
      status: 'completo',
      email: 'joao@hotelsol.com.br',
      decisor: { nome: 'Joao Carlos da Silva Souza', cargo: 'CEO', linkedin: 'https://www.linkedin.com/in/joaosouza' },
    })
    expect(d.buscarEmail).toHaveBeenCalledWith('Joao Carlos da Silva Souza', 'hotelsol.com.br')
    expect(d.salvarConsulta).toHaveBeenCalledOnce()
    expect(d.salvarEnriquecimento).toHaveBeenCalledTimes(2)
    expect(d.salvarDecisor).toHaveBeenCalledWith(expect.objectContaining({ nome: 'Joao Carlos da Silva Souza', cargo: 'CEO' }))
  })

  it('sem domínio próprio não chama nenhuma API', async () => {
    const d = deps()
    const r = await resolverDecisorAutomatico({ ...EMPRESA, email: 'hotelsol@gmail.com' }, undefined, null, d)
    expect(r).toMatchObject({ status: 'incompleto', motivo: 'sem_dominio' })
    expect(d.consultarSocios).not.toHaveBeenCalled()
    expect(d.buscarEmail).not.toHaveBeenCalled()
  })

  it('sem sócio na Receita: incompleto, sem gastar Anymail', async () => {
    const d = deps({ consultarSocios: vi.fn(async () => ({ ok: true as const, socios: [] })) })
    const r = await resolverDecisorAutomatico(EMPRESA, undefined, null, d)
    expect(r).toMatchObject({ status: 'incompleto', motivo: 'sem_socio' })
    expect(d.buscarEmail).not.toHaveBeenCalled()
  })

  it('e-mail não encontrado ou arriscado: incompleto, sem pagar Crustdata', async () => {
    for (const status of ['nao_encontrado', 'arriscado'] as const) {
      const d = deps({
        buscarEmail: vi.fn(async (nome: string, dominio: string) => ({
          ok: true as const, resultado: { nome, dominio, status, email: status === 'arriscado' ? 'j@hotelsol.com.br' : null, consultadoEm: 'x' },
        })),
      })
      const r = await resolverDecisorAutomatico(EMPRESA, undefined, null, d)
      expect(r).toMatchObject({ status: 'incompleto', motivo: 'sem_email' })
      expect(d.buscarPessoas).not.toHaveBeenCalled()
      expect(d.salvarDecisor).not.toHaveBeenCalled()
    }
  })

  it('reaproveita o que a org já consultou: nenhuma chamada paga de novo', async () => {
    const salvo: AnaliseSalva = {
      decisor: { nome: 'Joao Carlos da Silva Souza', cargo: 'CEO', linkedin: 'https://www.linkedin.com/in/joaosouza' },
      consulta: { socios: [], sugerido: SOCIOS[0], status: 'sem_criterio', motivo: null, emailNominalDe: null },
      enriquecimento: {
        anymail: { nome: 'Joao Carlos da Silva Souza', dominio: 'hotelsol.com.br', status: 'valido', email: 'joao@hotelsol.com.br', consultadoEm: 'x' },
        crustdata: { dominio: 'hotelsol.com.br', candidatos: [{ nome: 'João Souza', cargo: 'CEO', linkedin: 'https://www.linkedin.com/in/joaosouza', local: null }], consultadoEm: 'x' },
      },
    }
    const d = deps()
    const r = await resolverDecisorAutomatico(EMPRESA, undefined, salvo, d)
    expect(r.status).toBe('completo')
    expect(d.consultarSocios).not.toHaveBeenCalled()
    expect(d.buscarEmail).not.toHaveBeenCalled()
    expect(d.buscarPessoas).not.toHaveBeenCalled()
    expect(d.salvarDecisor).not.toHaveBeenCalled()
  })

  it('decisor escolhido pela org vence o sócio sugerido', async () => {
    const salvo: AnaliseSalva = {
      decisor: { nome: 'Ana Paula Ribeiro', cargo: 'Diretora' },
      consulta: { socios: [], sugerido: SOCIOS[0], status: 'sem_criterio', motivo: null, emailNominalDe: null },
      enriquecimento: null,
    }
    const d = deps()
    const r = await resolverDecisorAutomatico(EMPRESA, undefined, salvo, d)
    expect(d.buscarEmail).toHaveBeenCalledWith('Ana Paula Ribeiro', 'hotelsol.com.br')
    expect(r).toMatchObject({ status: 'completo', decisor: { nome: 'Ana Paula Ribeiro', cargo: 'Diretora' } })
  })

  it('Crustdata fora do ar não derruba: completa com o cargo da Receita', async () => {
    const d = deps({ buscarPessoas: vi.fn(async () => ({ ok: false as const, motivo: 'indisponivel' as const })) })
    const r = await resolverDecisorAutomatico(EMPRESA, undefined, null, d)
    expect(r).toMatchObject({ status: 'completo', decisor: { nome: 'Joao Carlos da Silva Souza', cargo: 'Sócio-Administrador' } })
    expect(r.status === 'completo' && r.decisor.linkedin).toBeFalsy()
  })

  it('Anymail sem crédito é falha (a tela para a busca)', async () => {
    const d = deps({ buscarEmail: vi.fn(async () => ({ ok: false as const, motivo: 'sem_credito' as const })) })
    const r = await resolverDecisorAutomatico(EMPRESA, undefined, null, d)
    expect(r).toMatchObject({ status: 'falha', httpStatus: 402 })
  })
})
