import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { recalcularNotas } from '@/lib/prospeccao/catalogoRf/recalcularNotas'

const linha = (cnpj: string, email: string | null, atual: { qualidade_email: string | null; nota: number | null }) => ({
  cnpj, email, telefone: null, razao_social: 'HOTEL MARAJO LTDA', nome_fantasia: null, ...atual,
})

function adminFake(paginas: unknown[][]) {
  const updates: { valores: unknown; cnpjs: string[] }[] = []
  let chamada = 0
  const admin = {
    from: () => ({
      select: () => ({ gt: () => ({ order: () => ({ limit: async () => ({ data: paginas[chamada++] ?? [], error: null }) }) }) }),
      update: (valores: unknown) => ({
        in: async (_col: string, cnpjs: string[]) => { updates.push({ valores, cnpjs }); return { error: null } },
      }),
    }),
  } as unknown as SupabaseClient
  return { admin, updates }
}

describe('recalcularNotas', () => {
  const pagina = [
    linha('10000000000001', 'joao@hotelmarajo.com.br', { qualidade_email: null, nota: null }),
    linha('10000000000002', 'ana@hotelmarajo.com.br', { qualidade_email: null, nota: null }),
    linha('10000000000003', 'x@gmail.com', { qualidade_email: 'pessoal', nota: 20 }), // já certa
  ]

  it('ensaio conta e não grava', async () => {
    const { admin, updates } = adminFake([pagina])
    const r = await recalcularNotas(admin, { gravar: false, tamanhoLote: 10 })
    expect(r).toEqual({ lidas: 3, alteradas: 2, porNota: { 50: 2, 20: 1 } })
    expect(updates).toEqual([])
  })

  it('grava agrupado e pula linha já correta', async () => {
    const { admin, updates } = adminFake([pagina])
    await recalcularNotas(admin, { gravar: true, tamanhoLote: 10 })
    expect(updates).toEqual([
      { valores: { qualidade_email: 'corporativo', nota: 50 }, cnpjs: ['10000000000001', '10000000000002'] },
    ])
  })

  it('pagina até o lote vir incompleto', async () => {
    const { admin } = adminFake([pagina.slice(0, 2), pagina.slice(2)])
    const aoProgredir = vi.fn()
    const r = await recalcularNotas(admin, { gravar: false, tamanhoLote: 2, aoProgredir })
    expect(r.lidas).toBe(3)
    expect(aoProgredir).toHaveBeenCalledTimes(2)
  })
})
