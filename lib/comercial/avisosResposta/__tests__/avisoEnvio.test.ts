import { describe, it, expect, beforeEach } from 'vitest'
import { MemoryAvisoRespostaRepository } from './memoryRepository'
import { avisarEnvioCampanha, avisarRespostaCliente, type DepsAvisoResposta } from '../servico'
import { montarMensagemAvisoEnvio } from '../mensagem'
import { mapearAviso } from '../supabaseRepository'
import type { EntradaAvisoEnvio, ResultadoEnvioAviso } from '../types'

const ORG = 'org-a'

function montar() {
  const repo = new MemoryAvisoRespostaRepository()
  const enviados: { tipo: 'individual' | 'grupo'; destino: string; mensagem: string }[] = []
  const estado = { grupoConta: '120363000000000001-group' as string | null, falhar: false }
  const resultado = (): ResultadoEnvioAviso => (estado.falhar ? { ok: false, codigo: 'erro', mensagem: 'Z-API 500' } : { ok: true, providerMessageId: 'z1' })
  const deps: DepsAvisoResposta = {
    repo,
    lerModo: async () => 'ambos',
    lerGrupoId: async () => estado.grupoConta,
    lerContextoLead: async (org, leadId) =>
      org === ORG && leadId === 'lead-1' ? { empresa: 'ACME', contato: 'Ana', responsavel: { id: 'bruno', nome: 'Bruno' } } : null,
    lerWhatsappResponsavel: async (_org, id) => (id === 'bruno' ? '5511999998888' : null),
    lerWhatsappPerfil: async (_org, id) => (id === 'perfil-aline' ? '5521988887777' : null),
    enviarIndividual: async (destino, mensagem) => { enviados.push({ tipo: 'individual', destino, mensagem }); return resultado() },
    enviarGrupo: async (destino, mensagem) => { enviados.push({ tipo: 'grupo', destino, mensagem }); return resultado() },
    provedorConfigurado: () => true,
    linkLead: (id) => `https://app.exemplo/leads/${id}`,
    agora: () => new Date('2026-09-28T12:00:00Z'),
  }
  return { repo, deps, enviados, estado }
}

const entrada = (over: Partial<EntradaAvisoEnvio> = {}): EntradaAvisoEnvio => ({
  organizacaoId: ORG,
  leadId: 'lead-1',
  eventoId: 'envio:ex-1:bloco-1',
  destinos: ['grupo'],
  campanhaNome: 'CAMPANHA INICIAL',
  etapa: 'follow-up 1',
  assunto: 'Renovação do Laudo – ACME',
  ...over,
})

describe('avisarEnvioCampanha', () => {
  let t: ReturnType<typeof montar>
  beforeEach(() => { t = montar() })

  it('sem destinos = desligado: nada registrado nem enviado', async () => {
    expect(await avisarEnvioCampanha(t.deps, entrada({ destinos: [] }))).toEqual({ tipo: 'desligado' })
    expect(t.repo.linhas).toHaveLength(0)
  })

  it('registra tipo "envio" no grupo da campanha com campanha, etapa, empresa e assunto', async () => {
    const r = await avisarEnvioCampanha(t.deps, entrada({ grupoIdCampanha: '120363000000000099-group' }))
    expect(r.tipo).toBe('processado')
    expect(t.repo.linhas).toHaveLength(1)
    expect(t.repo.linhas[0]).toMatchObject({ tipo: 'envio', destinoTipo: 'grupo', status: 'enviada' })
    expect(t.enviados).toHaveLength(1)
    expect(t.enviados[0].destino).toBe('120363000000000099-group')
    const msg = t.enviados[0].mensagem
    expect(msg).toContain('E-MAIL ENVIADO — ProspectOS')
    expect(msg).toContain('Campanha: CAMPANHA INICIAL (follow-up 1)')
    expect(msg).toContain('Empresa: ACME')
    expect(msg).toContain('Assunto: Renovação do Laudo – ACME')
    expect(msg).toContain('Responsável: Bruno')
    expect(msg).toContain('Abrir: https://app.exemplo/leads/lead-1')
  })

  it('sem grupo na campanha usa o grupo da conta', async () => {
    await avisarEnvioCampanha(t.deps, entrada())
    expect(t.enviados[0].destino).toBe('120363000000000001-group')
  })

  it('o mesmo envio nunca avisa duas vezes', async () => {
    await avisarEnvioCampanha(t.deps, entrada())
    await avisarEnvioCampanha(t.deps, entrada())
    expect(t.repo.linhas).toHaveLength(1)
    expect(t.enviados).toHaveLength(1)
  })

  it('responsável da campanha recebe no número do perfil dele, sem menção', async () => {
    await avisarEnvioCampanha(t.deps, entrada({ destinos: ['responsavel'], responsavelPerfil: { id: 'perfil-aline', nome: 'Aline' } }))
    expect(t.enviados).toEqual([expect.objectContaining({ tipo: 'individual', destino: '5521988887777' })])
    expect(t.enviados[0].mensagem).not.toContain('Responsável:')
  })

  it('aviso de envio não aciona o anti-spam do aviso de resposta', async () => {
    await avisarEnvioCampanha(t.deps, entrada())
    const r = await avisarRespostaCliente(t.deps, {
      organizacaoId: ORG, leadId: 'lead-1', eventoId: 'email:<r1>', canal: 'email', classificacao: null, texto: 'Pode ligar',
    })
    expect(r.tipo).toBe('processado')
  })

  it('falha no provedor fica registrada para reprocessar', async () => {
    t.estado.falhar = true
    await avisarEnvioCampanha(t.deps, entrada())
    expect(t.repo.linhas[0]).toMatchObject({ status: 'falhou', tipo: 'envio' })
  })
})

describe('montarMensagemAvisoEnvio', () => {
  it('omite o que não existe e só menciona o responsável no grupo', () => {
    const base = {
      empresa: '', contato: '', canal: 'email' as const, classificacao: null, trecho: '', responsavelId: null,
      responsavelNome: '', link: null, campanhaNome: 'Teste', etapa: 'mensagem inicial', assunto: null,
    }
    const individual = montarMensagemAvisoEnvio(base, 'responsavel')
    expect(individual).toContain('Campanha: Teste (mensagem inicial)')
    expect(individual).toContain('Contato: não informado')
    expect(individual).not.toContain('Empresa:')
    expect(individual).not.toContain('Assunto:')
    expect(individual).not.toContain('Responsável:')
  })
})

describe('mapearAviso', () => {
  it('preserva o grupo e o responsável escolhidos na campanha e o tipo', () => {
    const a = mapearAviso({
      id: 'a1', organizacao_id: ORG, lead_id: 'l1', evento_id: 'envio:x', tipo: 'envio', destino_tipo: 'grupo',
      status: 'pendente', tentativas: 0, ultimo_erro: null,
      dados: { empresa: 'ACME', contato: 'Ana', responsavelPerfilId: 'perfil-aline', grupoId: '1203-group', campanhaNome: 'C', etapa: 'follow-up 2', assunto: 'S' },
      destino: null, provider_message_id: null, enviado_em: null, criado_em: '2026-09-28T00:00:00Z',
    })
    expect(a.tipo).toBe('envio')
    expect(a.dados).toMatchObject({ responsavelPerfilId: 'perfil-aline', grupoId: '1203-group', campanhaNome: 'C', etapa: 'follow-up 2', assunto: 'S' })
  })

  it('linha sem tipo (anterior à 0067) é aviso de resposta', () => {
    const a = mapearAviso({
      id: 'a1', organizacao_id: ORG, lead_id: 'l1', evento_id: 'email:<m>', destino_tipo: 'grupo', status: 'pendente',
      tentativas: 0, ultimo_erro: null, dados: null, destino: null, provider_message_id: null, enviado_em: null,
      criado_em: '2026-09-28T00:00:00Z',
    })
    expect(a.tipo).toBe('resposta')
  })
})
