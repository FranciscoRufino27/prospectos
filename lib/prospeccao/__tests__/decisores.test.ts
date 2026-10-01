import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { analiseDaLinha, validarDecisorSalvo, type ConsultaSocios } from '@/lib/prospeccao/decisores'
import { carregarAnalises, salvarConsulta, salvarDecisor } from '@/lib/prospeccao/decisoresServidor'

const CNPJ = '12345678000199'
const consulta: ConsultaSocios = {
  socios: [{ nome: 'Ana Souza', qualificacao: 'Sócio-Administrador', desde: null, adequado: true }],
  sugerido: { nome: 'Ana Souza', qualificacao: 'Sócio-Administrador', desde: null },
  status: 'socio_serve',
  motivo: null,
  emailNominalDe: null,
}

describe('validarDecisorSalvo', () => {
  it('normaliza CNPJ e corta os textos', () => {
    expect(validarDecisorSalvo({ cnpj: '12.345.678/0001-99', nome: ' Ana ', cargo: 'Sócia', linkedin: ' linkedin.com/in/ana ' }))
      .toEqual({ ok: true, cnpj: CNPJ, nome: 'Ana', cargo: 'Sócia', linkedin: 'linkedin.com/in/ana' })
    const longo = validarDecisorSalvo({ cnpj: CNPJ, nome: 'x'.repeat(500), linkedin: 'y'.repeat(900) })
    expect(longo.ok && [longo.nome?.length, longo.linkedin?.length]).toEqual([120, 400])
  })

  it('sem nome é "nenhum decisor": zera cargo e LinkedIn', () => {
    expect(validarDecisorSalvo({ cnpj: CNPJ, nome: '  ', cargo: 'Sócia', linkedin: 'x' }))
      .toEqual({ ok: true, cnpj: CNPJ, nome: null, cargo: null, linkedin: null })
  })

  it('recusa CNPJ inválido e corpo vazio', () => {
    expect(validarDecisorSalvo({ cnpj: '123' })).toMatchObject({ ok: false })
    expect(validarDecisorSalvo(null)).toMatchObject({ ok: false })
  })
})

describe('analiseDaLinha', () => {
  it('monta decisor e consulta da linha salva', () => {
    expect(analiseDaLinha({ nome: 'Ana', cargo: null, linkedin: 'linkedin.com/in/ana', consulta })).toEqual({
      decisor: { nome: 'Ana', cargo: '', linkedin: 'linkedin.com/in/ana' },
      consulta,
    })
  })

  it('linha só com consulta, ou consulta malformada', () => {
    expect(analiseDaLinha({ nome: null, cargo: null, linkedin: null, consulta })).toEqual({ decisor: null, consulta })
    expect(analiseDaLinha({ nome: 'Ana', cargo: 'Sócia', linkedin: null, consulta: { x: 1 } }).consulta).toBeNull()
  })
})

// Fake do client admin que registra filtros e payloads de prospeccao_decisores.
function adminFake(linhas: unknown[] = []) {
  const chamadas: { metodo: string; args: unknown[] }[] = []
  const builder: Record<string, (...args: unknown[]) => unknown> = {}
  for (const metodo of ['select', 'eq', 'in']) {
    builder[metodo] = (...args: unknown[]) => { chamadas.push({ metodo, args }); return builder }
  }
  builder.upsert = (...args: unknown[]) => { chamadas.push({ metodo: 'upsert', args }); return Promise.resolve({ error: null }) }
  ;(builder as { then?: unknown }).then = (ok: (v: unknown) => void) => ok({ data: linhas, error: null })
  const from = vi.fn(() => builder)
  return { admin: { from } as unknown as SupabaseClient, chamadas, from }
}

describe('isolamento por organização (service_role ignora RLS)', () => {
  it('leitura filtra pela org da sessão e pelos CNPJs da página', async () => {
    const { admin, chamadas, from } = adminFake([{ cnpj: CNPJ, nome: 'Ana', cargo: 'Sócia', linkedin: null, consulta: null }])
    const r = await carregarAnalises(admin, 'org-a', [CNPJ])
    expect(from).toHaveBeenCalledWith('prospeccao_decisores')
    expect(chamadas).toContainEqual({ metodo: 'eq', args: ['organizacao_id', 'org-a'] })
    expect(chamadas).toContainEqual({ metodo: 'in', args: ['cnpj', [CNPJ]] })
    expect(r[CNPJ]?.decisor?.nome).toBe('Ana')
  })

  it('lista vazia não consulta o banco', async () => {
    const { admin, from } = adminFake()
    expect(await carregarAnalises(admin, 'org-a', [])).toEqual({})
    expect(from).not.toHaveBeenCalled()
  })

  it('salvar decisor grava a org recebida e não toca na consulta', async () => {
    const { admin, chamadas } = adminFake()
    await salvarDecisor(admin, 'org-a', 'user-1', { cnpj: CNPJ, nome: 'Ana', cargo: 'Sócia', linkedin: null })
    const [linha, opcoes] = chamadas.find((c) => c.metodo === 'upsert')!.args as [Record<string, unknown>, unknown]
    expect(linha).toMatchObject({ organizacao_id: 'org-a', cnpj: CNPJ, nome: 'Ana', atualizado_por: 'user-1' })
    expect(linha).not.toHaveProperty('consulta')
    expect(opcoes).toEqual({ onConflict: 'organizacao_id,cnpj' })
  })

  it('salvar consulta grava a org recebida e não toca na escolha do usuário', async () => {
    const { admin, chamadas } = adminFake()
    await salvarConsulta(admin, 'org-b', CNPJ, consulta)
    const [linha] = chamadas.find((c) => c.metodo === 'upsert')!.args as [Record<string, unknown>]
    expect(linha).toMatchObject({ organizacao_id: 'org-b', cnpj: CNPJ, consulta })
    expect(linha).not.toHaveProperty('nome')
    expect(linha).not.toHaveProperty('linkedin')
  })
})
