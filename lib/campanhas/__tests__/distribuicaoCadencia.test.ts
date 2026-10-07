// Distribuição da cadência: etapas lidas da definição REAL (quantidade variável
// de follow-ups), cada contato em uma só etapa, "aguardando 1º contato" nunca
// misturado com "em follow-up", e leitura sempre presa à organização da sessão.
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { BancoFalso } from '@/lib/templates/__tests__/bancoFalso'
import {
  emFollowupDaDistribuicao,
  etapaDaExecucao,
  mensagensAntesDoPasso,
  montarDistribuicaoCadencia,
  type AcaoCadencia,
} from '../distribuicaoCadencia'
import { buscarContatosDaEtapa, buscarDistribuicaoCadencia } from '../distribuicaoCadenciaServidor'

// e-mail, espera, e-mail, espera, ... — `followups` follow-ups depois do 1º contato.
function cadencia(followups: number): AcaoCadencia[] {
  const acoes: AcaoCadencia[] = [{ tipo: 'enviar_email' }]
  for (let i = 0; i < followups; i++) acoes.push({ tipo: 'esperar' }, { tipo: 'enviar_email' })
  return acoes
}
const ex = (id: string, status: string, passo: number, versao = 'v1', lead: string | null = `lead-${id}`) =>
  ({ id, lead_id: lead, status, passo_atual: passo, versao_id: versao })
const ids = (d: { etapas: { id: string }[] }) => d.etapas.map((e) => e.id)

describe('etapa de cada execução', () => {
  const seis = cadencia(6)
  it('conta as mensagens antes do passo atual', () => {
    expect(mensagensAntesDoPasso(seis, 0)).toBe(0)
    expect(mensagensAntesDoPasso(seis, 2)).toBe(1) // depois do 1º e-mail + espera
    expect(mensagensAntesDoPasso(seis, 4)).toBe(2)
  })
  it('aguardando 1º contato ≠ follow-up; finais pelo status e pelos sinais do lead', () => {
    const nada = { devolvido: false, respondeu: false }
    expect(etapaDaExecucao(ex('a', 'aguardando', 0), seis, nada)).toBe('primeiro_contato')
    expect(etapaDaExecucao(ex('b', 'aguardando', 2), seis, nada)).toBe('followup_1')
    expect(etapaDaExecucao(ex('c', 'em_andamento', 6), seis, nada)).toBe('followup_3')
    expect(etapaDaExecucao(ex('d', 'aguardando', 13), seis, nada)).toBe('cadencia_enviada')
    expect(etapaDaExecucao(ex('e', 'cancelado', 2), seis, { devolvido: true, respondeu: true })).toBe('devolvido')
    expect(etapaDaExecucao(ex('f', 'cancelado', 2), seis, { devolvido: false, respondeu: true })).toBe('respondeu')
    expect(etapaDaExecucao(ex('g', 'cancelado', 2), seis, nada)).toBe('saiu')
    expect(etapaDaExecucao(ex('h', 'concluido', 13), seis, nada)).toBe('concluido')
    expect(etapaDaExecucao(ex('i', 'erro', 2), seis, nada)).toBe('erro')
    expect(etapaDaExecucao(ex('j', 'aguardando', 2), null, nada)).toBe('indefinida')
  })
})

describe('montarDistribuicaoCadencia', () => {
  const vazio = new Set<string>()

  it('números reais da PROSPECÇÃO 06/10 (1º contato + 6 follow-ups): soma = base', () => {
    const execucoes = [
      ...Array.from({ length: 117 }, (_, i) => ex(`p${i}`, 'aguardando', 0)),
      ...Array.from({ length: 85 }, (_, i) => ex(`f${i}`, 'aguardando', 2)),
      ...Array.from({ length: 14 }, (_, i) => ex(`c${i}`, 'cancelado', 2)),
    ]
    const d = montarDistribuicaoCadencia({
      execucoes, acoesPorVersao: new Map([['v1', cadencia(6)]]), acoesReferencia: cadencia(6),
      leadsDevolvidos: new Set(execucoes.filter((e) => e.id.startsWith('c')).map((e) => e.lead_id!)),
      leadsQueResponderam: vazio,
    })
    expect(d.totalFollowups).toBe(6)
    expect(ids(d)).toEqual(['primeiro_contato', 'followup_1', 'followup_2', 'followup_3', 'followup_4', 'followup_5', 'followup_6', 'respondeu', 'devolvido'])
    const q = Object.fromEntries(d.etapas.map((e) => [e.id, e.quantidade]))
    expect(q).toMatchObject({ primeiro_contato: 117, followup_1: 85, followup_2: 0, respondeu: 0, devolvido: 14 })
    expect(d.etapas.reduce((s, e) => s + e.quantidade, 0)).toBe(216)
    expect(d.etapas.find((e) => e.id === 'primeiro_contato')!.percentual).toBeCloseTo(117 / 216)
    expect(emFollowupDaDistribuicao(d)).toBe(85) // os 117 da fila NÃO entram
  })

  it('quantidade de follow-ups segue a cadência: 3 mostra 3, sem inventar etapas', () => {
    const d = montarDistribuicaoCadencia({
      execucoes: [ex('a', 'aguardando', 2)], acoesPorVersao: new Map([['v1', cadencia(3)]]), acoesReferencia: cadencia(3),
      leadsDevolvidos: vazio, leadsQueResponderam: vazio,
    })
    expect(d.totalFollowups).toBe(3)
    expect(ids(d)).toEqual(['primeiro_contato', 'followup_1', 'followup_2', 'followup_3', 'respondeu', 'devolvido'])
  })

  it('disparo único (1 mensagem) não tem follow-up; finais só aparecem quando existem', () => {
    const d = montarDistribuicaoCadencia({
      execucoes: [ex('a', 'concluido', 1), ex('b', 'erro', 0)], acoesPorVersao: new Map([['v1', cadencia(0)]]), acoesReferencia: cadencia(0),
      leadsDevolvidos: vazio, leadsQueResponderam: vazio,
    })
    expect(d.totalFollowups).toBe(0)
    expect(ids(d)).toEqual(['primeiro_contato', 'respondeu', 'devolvido', 'concluido', 'erro'])
  })

  it('execuções em versões diferentes: cada uma lida pela própria definição', () => {
    const d = montarDistribuicaoCadencia({
      execucoes: [ex('a', 'aguardando', 2, 'v1'), ex('b', 'aguardando', 6, 'v2'), ex('c', 'aguardando', 2, 'v-sumiu')],
      acoesPorVersao: new Map([['v1', cadencia(2)], ['v2', cadencia(4)]]), acoesReferencia: cadencia(2),
      leadsDevolvidos: vazio, leadsQueResponderam: vazio,
    })
    expect(d.totalFollowups).toBe(4)
    const q = Object.fromEntries(d.etapas.map((e) => [e.id, e.quantidade]))
    expect(q).toMatchObject({ followup_1: 1, followup_3: 1, indefinida: 1 })
  })
})

describe('servidor: distribuição e contatos da etapa', () => {
  const ORG = 'org-a'
  function banco() {
    const execucao = (id: string, org: string, status: string, passo: number, lead: string, extra: Record<string, unknown> = {}) => ({
      id, organizacao_id: org, campanha_id: 'camp-1', workflow_id: 'wf-1', versao_id: 'v1', lead_id: lead, status, passo_atual: passo,
      iniciado_em: '2026-10-06T19:40:00Z', proxima_verificacao_em: null, ...extra,
    })
    return new BancoFalso({
      campanhas: [{ id: 'camp-1', organizacao_id: ORG, workflow_id: 'wf-1' }, { id: 'camp-b', organizacao_id: 'org-b', workflow_id: 'wf-1' }],
      workflows: [{ id: 'wf-1', organizacao_id: ORG, versao_atual_id: 'v1' }],
      workflow_versoes: [{ id: 'v1', organizacao_id: ORG, definicao: { acoes: cadencia(2) } }],
      workflow_execucoes: [
        execucao('e1', ORG, 'aguardando', 0, 'l1', { proxima_verificacao_em: '2026-10-07T11:00:00Z' }),
        execucao('e2', ORG, 'aguardando', 2, 'l2', { proxima_verificacao_em: '2026-10-09T12:00:00Z' }),
        execucao('e3', ORG, 'cancelado', 2, 'l3'),
        execucao('e4', ORG, 'cancelado', 2, 'l4'),
        // Mesma campanha, outra organização: nunca entra.
        execucao('e9', 'org-b', 'aguardando', 0, 'l9'),
      ],
      leads: [
        { id: 'l1', organizacao_id: ORG, empresa: 'Acme', contato_nome: 'Ana', contato_email: 'ana@acme.com', estagio: 'novo', bounced: false },
        { id: 'l2', organizacao_id: ORG, empresa: 'Beta', contato_nome: 'Bia', contato_email: 'bia@beta.com', estagio: 'primeiro_contato', bounced: false },
        { id: 'l3', organizacao_id: ORG, empresa: 'Gama', contato_nome: 'Gil', contato_email: 'gil@gama.com', estagio: 'primeiro_contato', bounced: true },
        { id: 'l4', organizacao_id: ORG, empresa: 'Delta', contato_nome: 'Dani', contato_email: 'dani@delta.com', estagio: 'respondeu', bounced: false },
      ],
      interacoes: [{ id: 'i1', organizacao_id: ORG, lead_id: 'l4', tipo: 'resposta', created_at: '2026-10-07T13:00:00Z' }],
      workflow_execucao_eventos: [
        { id: 'ev1', organizacao_id: ORG, execucao_id: 'e2', tipo: 'email_enviado', criado_em: '2026-10-06T19:45:00Z', detalhe: { enviado: true } },
        { id: 'ev2', organizacao_id: ORG, execucao_id: 'e2', tipo: 'email_enviado', criado_em: '2026-10-06T19:50:00Z', detalhe: { enviado: false } },
      ],
    })
  }

  it('distribui só as execuções da organização, com devolução e resposta pelos sinais reais', async () => {
    const admin = banco().cliente() as unknown as SupabaseClient
    const d = (await buscarDistribuicaoCadencia(admin, ORG, 'camp-1'))!
    const q = Object.fromEntries(d.etapas.map((e) => [e.id, e.quantidade]))
    expect(d.total).toBe(4)
    expect(q).toMatchObject({ primeiro_contato: 1, followup_1: 1, followup_2: 0, devolvido: 1, respondeu: 1 })
    expect(await buscarDistribuicaoCadencia(admin, ORG, 'camp-b')).toBeNull()
  })

  it('contatos da etapa: dados do lead, último envio real, próximo envio e data prevista', async () => {
    const admin = banco().cliente() as unknown as SupabaseClient
    const r = (await buscarContatosDaEtapa(admin, ORG, 'camp-1', 'followup_1'))!
    expect(r.total).toBe(1)
    expect(r.contatos[0]).toEqual({
      leadId: 'l2', empresa: 'Beta', contato: 'Bia', email: 'bia@beta.com', estagioLead: 'primeiro_contato',
      ultimoEnvioEm: '2026-10-06T19:45:00Z', proximoEnvio: 'Follow-up 1', dataPrevista: '2026-10-09T12:00:00Z', statusExecucao: 'aguardando',
    })
    const fila = (await buscarContatosDaEtapa(admin, ORG, 'camp-1', 'primeiro_contato'))!
    expect(fila.contatos.map((c) => [c.empresa, c.proximoEnvio])).toEqual([['Acme', '1º contato']])
    const devolvidos = (await buscarContatosDaEtapa(admin, ORG, 'camp-1', 'devolvido'))!
    expect(devolvidos.contatos[0]).toMatchObject({ empresa: 'Gama', proximoEnvio: null, dataPrevista: null })
  })
})

// Rota: permissão e validação da etapa.
const estado = vi.hoisted(() => ({ usuarioId: null as string | null }))
vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: estado.usuarioId ? { id: estado.usuarioId } : null } }) },
  }),
}))
vi.mock('@/lib/supabase-admin', () => ({
  createSupabaseAdminClient: () => new BancoFalso({
    perfis: [{ id: 'u-admin', organizacao_id: 'org-a', role: 'admin' }],
    perfil_permissoes: [],
    campanhas: [],
  }).cliente(),
}))

describe('GET /api/campanhas/[id]/cadencia', () => {
  it('sem sessão 401; etapa inválida 400; campanha de outra org 404', async () => {
    const { GET } = await import('@/app/api/campanhas/[id]/cadencia/route')
    const chamar = (q = '') => GET(new Request(`http://localhost/api/campanhas/camp-1/cadencia${q}`), { params: Promise.resolve({ id: 'camp-1' }) })
    estado.usuarioId = null
    expect((await chamar()).status).toBe(401)
    estado.usuarioId = 'u-admin'
    expect((await chamar('?etapa=qualquer')).status).toBe(400)
    expect((await chamar()).status).toBe(404)
    expect((await chamar('?etapa=followup_2')).status).toBe(404)
  })
})
