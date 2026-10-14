import { describe, expect, it, vi } from 'vitest'
import { mesmaPessoa, resolverDecisorAutomatico, type DependenciasDecisor, type EmpresaParaDecisor } from '../decisorAutomatico'
import type { AnaliseSalva } from '../decisores'
import type { ProspeccaoConfig } from '@/lib/config/workspaceConfig'

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
  it('sócio serve como decisor: e-mail pela Anymail e a Crustdata NÃO é chamada', async () => {
    const d = deps()
    const r = await resolverDecisorAutomatico(EMPRESA, undefined, null, d)
    expect(r).toMatchObject({
      status: 'completo',
      email: 'joao@hotelsol.com.br',
      decisor: { nome: 'Joao Carlos da Silva Souza', cargo: 'Sócio-Administrador' },
    })
    expect(r.status === 'completo' && r.decisor.linkedin).toBeFalsy()
    expect(d.buscarPessoas).not.toHaveBeenCalled()
    expect(d.buscarEmail).toHaveBeenCalledWith('Joao Carlos da Silva Souza', 'hotelsol.com.br')
    expect(d.salvarConsulta).toHaveBeenCalledOnce()
    expect(d.salvarEnriquecimento).toHaveBeenCalledTimes(1)
    expect(d.salvarDecisor).toHaveBeenCalledWith(expect.objectContaining({ nome: 'Joao Carlos da Silva Souza', cargo: 'Sócio-Administrador' }))
  })

  it('e-mail da Receita já é do decisor (nominal): nem Anymail nem Crustdata', async () => {
    const d = deps()
    const r = await resolverDecisorAutomatico({ ...EMPRESA, email: 'joao.souza@hotelsol.com.br' }, undefined, null, d)
    expect(r).toMatchObject({ status: 'completo', email: 'joao.souza@hotelsol.com.br', decisor: { nome: 'Joao Carlos da Silva Souza' } })
    expect(d.buscarEmail).not.toHaveBeenCalled()
    expect(d.buscarPessoas).not.toHaveBeenCalled()
  })

  it('sócio fora do perfil (porte): Crustdata acha o decisor, Anymail o e-mail dele', async () => {
    const perfil = { cnaes: ['5510801'], porteOutroDecisor: 'pequeno' } as ProspeccaoConfig
    const d = deps()
    const r = await resolverDecisorAutomatico(EMPRESA, perfil, null, d)
    expect(d.buscarPessoas).toHaveBeenCalledOnce()
    expect(d.buscarEmail).toHaveBeenCalledWith('Maria Lima', 'hotelsol.com.br')
    expect(r).toMatchObject({ status: 'completo', decisor: { nome: 'Maria Lima', cargo: 'Gerente', linkedin: 'https://www.linkedin.com/in/maria' } })
  })

  it('Crustdata bloqueada pelo orçamento: SÓ esta empresa fica incompleta (bloqueado_crustdata), sem falha', async () => {
    const perfil = { cnaes: ['5510801'], porteOutroDecisor: 'pequeno' } as ProspeccaoConfig
    const d = deps({ buscarPessoas: vi.fn(async () => ({ ok: false as const, motivo: 'orcamento_esgotado' as const, detalhe: 'orçamento mensal de Crustdata esgotado: 10 de 10 créditos usados' })) })
    const r = await resolverDecisorAutomatico(EMPRESA, perfil, null, d)
    expect(r).toMatchObject({ status: 'incompleto', motivo: 'bloqueado_crustdata', bloqueio: { fonte: 'crustdata', motivo: 'orcamento_esgotado' } })
    expect(r.status === 'incompleto' && r.bloqueio?.mensagem).toMatch(/10 de 10 créditos/)
    expect(d.buscarEmail).not.toHaveBeenCalled()
  })

  it('Anymail desligada: decisor achado de graça, empresa incompleta (bloqueado_anymail), sem falha', async () => {
    const d = deps({ buscarEmail: vi.fn(async () => ({ ok: false as const, motivo: 'pago_desligado' as const })) })
    const r = await resolverDecisorAutomatico(EMPRESA, undefined, null, d)
    expect(r).toMatchObject({ status: 'incompleto', motivo: 'bloqueado_anymail', bloqueio: { fonte: 'anymail', motivo: 'pago_desligado' } })
    expect(r.status === 'incompleto' && r.bloqueio?.mensagem).toMatch(/desligado/)
    expect(r.status === 'incompleto' && r.consulta?.sugerido?.nome).toBe('Joao Carlos da Silva Souza')
    expect(d.buscarPessoas).not.toHaveBeenCalled()
  })

  it('sem domínio próprio não chama nenhuma API', async () => {
    const d = deps()
    const r = await resolverDecisorAutomatico({ ...EMPRESA, email: 'hotelsol@gmail.com' }, undefined, null, d)
    expect(r).toMatchObject({ status: 'incompleto', motivo: 'sem_dominio' })
    expect(d.consultarSocios).not.toHaveBeenCalled()
    expect(d.buscarEmail).not.toHaveBeenCalled()
  })

  it('sem sócio na Receita: Crustdata acha o decisor; sem ninguém, incompleto sem gastar Anymail', async () => {
    const semSocio = { consultarSocios: vi.fn(async () => ({ ok: true as const, socios: [] })) }
    const d = deps(semSocio)
    const r = await resolverDecisorAutomatico(EMPRESA, undefined, null, d)
    expect(d.buscarPessoas).toHaveBeenCalledOnce()
    expect(r).toMatchObject({ status: 'completo', decisor: { nome: 'Maria Lima' } })

    const vazio = deps({ ...semSocio, buscarPessoas: vi.fn(async () => ({ ok: true as const, candidatos: [] })) })
    const r2 = await resolverDecisorAutomatico(EMPRESA, undefined, null, vazio)
    expect(r2).toMatchObject({ status: 'incompleto', motivo: 'sem_socio' })
    expect(vazio.buscarEmail).not.toHaveBeenCalled()
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

  it('Crustdata fora do ar quando ela é necessária: falha honesta, sem inventar decisor', async () => {
    const d = deps({
      consultarSocios: vi.fn(async () => ({ ok: true as const, socios: [] })),
      buscarPessoas: vi.fn(async () => ({ ok: false as const, motivo: 'indisponivel' as const })),
    })
    const r = await resolverDecisorAutomatico(EMPRESA, undefined, null, d)
    expect(r).toMatchObject({ status: 'falha', httpStatus: 502 })
    expect(d.buscarEmail).not.toHaveBeenCalled()
  })

  it('Anymail sem crédito ou sem chave: bloqueio da fonte (incompleta), não da busca', async () => {
    for (const motivo of ['sem_credito', 'sem_chave'] as const) {
      const d = deps({ buscarEmail: vi.fn(async () => ({ ok: false as const, motivo })) })
      expect(await resolverDecisorAutomatico(EMPRESA, undefined, null, d)).toMatchObject({ status: 'incompleto', motivo: 'bloqueado_anymail', bloqueio: { motivo } })
    }
  })

  it('limite de requisições (429) continua sendo falha técnica (a tela para a busca)', async () => {
    const d = deps({ buscarEmail: vi.fn(async () => ({ ok: false as const, motivo: 'limite' as const })) })
    expect(await resolverDecisorAutomatico(EMPRESA, undefined, null, d)).toMatchObject({ status: 'falha', httpStatus: 429 })
  })
})
