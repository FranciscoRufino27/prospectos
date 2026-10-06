import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolverContaEmailOrganizacao } from '../contaEmailOrganizacao'
import { GmailProvider } from '@/lib/engine/email/gmailProvider'
import { SimulatedProvider } from '@/lib/engine/email/simulatedProvider'

// Regra única da conta de e-mail por organização (Central e proposta ao
// cliente): chave dedicada sem credencial BLOQUEIA, nunca cai na conta padrão.

const ORG = 'org-A'

function dbFake(org: unknown) {
  const eqs: Array<[string, unknown]> = []
  const q = {
    select: () => q,
    eq: (col: string, v: unknown) => { eqs.push([col, v]); return q },
    maybeSingle: async () => ({ data: org, error: null }),
  }
  // Conta conectada pela tela (0066): nenhuma nestes casos — vale a chave legada.
  const eqsRemetente: Array<[string, unknown]> = []
  const qRemetente = {
    select: () => qRemetente,
    eq: (col: string, v: unknown) => { eqsRemetente.push([col, v]); return qRemetente },
    maybeSingle: async () => ({ data: null, error: null }),
  }
  const client = {
    from: (t: string) => {
      if (t === 'organizacao_remetentes_email') return qRemetente
      if (t !== 'organizacoes') throw new Error('tabela inesperada: ' + t)
      return q
    },
  } as unknown as SupabaseClient
  return { client, eqs, eqsRemetente }
}

describe('resolverContaEmailOrganizacao', () => {
  it('sem email_conta_key → provedor padrão; nome do serviço cai no nome da org; filtra pela org', async () => {
    const padrao = new SimulatedProvider()
    const db = dbFake({ nome: 'Laudos', configuracoes: {} })
    const r = await resolverContaEmailOrganizacao(db.client, ORG, padrao, () => null)
    expect(r).toEqual({ ok: true, provider: padrao, nomeServico: 'Laudos' })
    expect(db.eqs).toEqual([['id', ORG]])
  })

  it('chave com credencial → GmailProvider dedicado; nome_servico das nomenclaturas', async () => {
    const ler = vi.fn(() => ({ user: 'laudo@x.com', appPassword: 'senha' }))
    const db = dbFake({ nome: 'Org', configuracoes: { nomenclaturas: { email_conta_key: 'LAUDO', nome_servico: 'Base Laudos' } } })
    const r = await resolverContaEmailOrganizacao(db.client, ORG, new SimulatedProvider(), ler)
    expect(ler).toHaveBeenCalledWith('LAUDO')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.provider).toBeInstanceOf(GmailProvider)
      expect(r.nomeServico).toBe('Base Laudos')
    }
  })

  it('chave SEM credencial → credencial_ausente (não cai na conta padrão)', async () => {
    const db = dbFake({ nome: 'Org', configuracoes: { nomenclaturas: { email_conta_key: 'LAUDO' } } })
    const r = await resolverContaEmailOrganizacao(db.client, ORG, new SimulatedProvider(), () => null)
    expect(r).toEqual({
      ok: false,
      codigo: 'credencial_ausente',
      mensagem: "Envio bloqueado: credencial Gmail dedicada 'LAUDO' não configurada.",
    })
  })
})
