// Cards do topo da tela de Campanhas: 5 indicadores com dado real da
// organização da sessão, a partir do mesmo resumo da lista.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BancoFalso } from '@/lib/templates/__tests__/bancoFalso'

const estado = vi.hoisted(() => ({ usuarioId: null as string | null, banco: null as unknown }))
vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: estado.usuarioId ? { id: estado.usuarioId } : null } }) },
  }),
}))
vi.mock('@/lib/supabase-admin', () => ({ createSupabaseAdminClient: () => (estado.banco as BancoFalso).cliente() }))

import { GET } from '@/app/api/campanhas/metricas/route'

const ORG = 'org-a'
const ex = (id: string, org: string, campanha: string, status: string, passo: number, lead: string) =>
  ({ id, organizacao_id: org, campanha_id: campanha, lead_id: lead, status, passo_atual: passo, iniciado_em: '2026-10-06T19:00:00Z' })

beforeEach(() => {
  estado.usuarioId = 'u-admin'
  estado.banco = new BancoFalso({
    perfis: [{ id: 'u-admin', organizacao_id: ORG, role: 'admin' }],
    perfil_permissoes: [],
    campanhas: [
      { id: 'c1', organizacao_id: ORG, status: 'pausada' },
      { id: 'c2', organizacao_id: ORG, status: 'ativa' },
      { id: 'cb', organizacao_id: 'org-b', status: 'ativa' },
    ],
    workflow_execucoes: [
      ex('e1', ORG, 'c1', 'aguardando', 0, 'l1'),   // fila do 1º contato
      ex('e2', ORG, 'c1', 'aguardando', 0, 'l2'),   // fila do 1º contato
      ex('e3', ORG, 'c1', 'aguardando', 2, 'l3'),   // em follow-up
      ex('e4', ORG, 'c1', 'cancelado', 2, 'l4'),    // devolvido
      ex('e5', ORG, 'c2', 'em_andamento', 4, 'l5'), // em follow-up
      ex('e6', ORG, 'c2', 'cancelado', 2, 'l6'),    // respondeu
      ex('e9', 'org-b', 'cb', 'aguardando', 2, 'l9'),
    ],
    workflow_execucao_eventos: [
      { id: 'v1', organizacao_id: ORG, execucao_id: 'e3', tipo: 'email_enviado', detalhe: { enviado: true } },
      { id: 'v2', organizacao_id: ORG, execucao_id: 'e4', tipo: 'email_enviado', detalhe: { enviado: true } },
      { id: 'v3', organizacao_id: ORG, execucao_id: 'e5', tipo: 'email_enviado', detalhe: { enviado: true } },
      { id: 'v4', organizacao_id: ORG, execucao_id: 'e5', tipo: 'email_enviado', detalhe: { enviado: true } },
      { id: 'v5', organizacao_id: ORG, execucao_id: 'e6', tipo: 'email_enviado', detalhe: { enviado: true } },
      { id: 'v6', organizacao_id: ORG, execucao_id: 'e3', tipo: 'email_enviado', detalhe: { enviado: false } }, // ensaio não conta
      { id: 'v9', organizacao_id: 'org-b', execucao_id: 'e9', tipo: 'email_enviado', detalhe: { enviado: true } },
    ],
    leads: [
      { id: 'l4', organizacao_id: ORG, bounced: true },
      { id: 'l6', organizacao_id: ORG, bounced: false },
    ],
    interacoes: [{ id: 'i1', organizacao_id: ORG, lead_id: 'l6', tipo: 'resposta', created_at: '2026-10-07T10:00:00Z' }],
  })
})

describe('GET /api/campanhas/metricas', () => {
  it('5 indicadores da org da sessão; fila do 1º contato não conta como follow-up', async () => {
    const r = await (await GET()).json()
    expect(r).toEqual({
      campanhasAtivas: 1,
      mensagensEnviadas: 5,
      emFollowup: 2,
      aguardando1oEnvio: 2,
      respostas: 1,
      devolucoes: 1,
      contatados: 4,
    })
  })

  it('sem sessão: 401', async () => {
    estado.usuarioId = null
    expect((await GET()).status).toBe(401)
  })
})
