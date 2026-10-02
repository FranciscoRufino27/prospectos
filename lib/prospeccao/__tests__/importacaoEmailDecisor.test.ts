// Importação: o e-mail do lead é sempre o do decisor, verificado e salvo pela
// própria org — nunca o cadastral da Receita nem o que o cliente mandou.
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { BancoFalso } from '@/lib/templates/__tests__/bancoFalso'
import { separarPorEmailDoDecisor, type ItemImportacao } from '../importacaoServidor'

const ORG_A = 'aaaaaaaa-0000-4000-8000-000000000001'
const ORG_B = 'bbbbbbbb-0000-4000-8000-000000000002'
const CNPJ_1 = '11111111000111'
const CNPJ_2 = '22222222000122'

const anymail = (nome: string, email: string, status = 'valido') => ({ anymail: { nome, dominio: 'hotel.com.br', status, email, consultadoEm: 'x' } })

function banco() {
  return new BancoFalso({
    prospeccao_decisores: [
      { organizacao_id: ORG_A, cnpj: CNPJ_1, nome: 'Maria Souza', cargo: 'Sócia', linkedin: null, consulta: null, enriquecimento: anymail('Maria Souza', 'maria@hotel.com.br') },
      // Só a org B pagou o e-mail do CNPJ_2: não vale para a org A.
      { organizacao_id: ORG_B, cnpj: CNPJ_2, nome: 'Joao Lima', cargo: 'Sócio', linkedin: null, consulta: null, enriquecimento: anymail('Joao Lima', 'joao@hotel.com.br') },
    ],
  }).cliente() as unknown as SupabaseClient
}

const item = (cnpj: string, contato_nome: string | null, email: string | null): ItemImportacao =>
  ({ cnpj, email, contato_nome, contato_cargo: null, contato_linkedin: null })

describe('separarPorEmailDoDecisor', () => {
  it('troca o e-mail enviado pelo e-mail verificado do decisor', async () => {
    const r = await separarPorEmailDoDecisor(banco(), ORG_A, [item(CNPJ_1, 'Maria Souza', 'reservas@hotel.com.br')])
    expect(r.comEmail).toEqual([expect.objectContaining({ cnpj: CNPJ_1, email: 'maria@hotel.com.br' })])
    expect(r.semEmail).toEqual([])
  })

  it('decisor trocado para outra pessoa: o e-mail achado não vale, empresa fica sem e-mail', async () => {
    const r = await separarPorEmailDoDecisor(banco(), ORG_A, [item(CNPJ_1, 'Pedro Alves', 'maria@hotel.com.br')])
    expect(r.comEmail).toEqual([])
    expect(r.semEmail).toEqual([{ cnpj: CNPJ_1, status: 'sem_email', lead_id: null }])
  })

  it('não usa o e-mail que outra organização pagou', async () => {
    const r = await separarPorEmailDoDecisor(banco(), ORG_A, [item(CNPJ_2, 'Joao Lima', 'joao@hotel.com.br')])
    expect(r.comEmail).toEqual([])
    expect(r.semEmail).toEqual([{ cnpj: CNPJ_2, status: 'sem_email', lead_id: null }])
  })

  it('sem decisor: nunca cai no e-mail cadastral', async () => {
    const r = await separarPorEmailDoDecisor(banco(), ORG_A, [item(CNPJ_1, null, 'contato@hotel.com.br')])
    expect(r.comEmail).toEqual([])
    expect(r.semEmail).toHaveLength(1)
  })
})
