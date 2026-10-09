// Central de Respostas: o template é MATERIALIZADO com os dados do lead aberto
// (mesmo `preencher` do envio real) e o envio fica bloqueado enquanto sobrar
// variável. A lista vem da API multi-tenant (provada em rotas.test.ts).
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Lead } from '@/lib/engine/types'
import {
  MENSAGEM_BIBLIOTECA_SEM_PERMISSAO,
  conteudoParaComposer,
  materializarTemplateParaLead,
  mensagemVariaveisPendentes,
  templatesDoCanal,
  variaveisPendentes,
} from '../central'
import type { TemplateBiblioteca } from '../tipos'

const template = (parcial: Partial<TemplateBiblioteca> = {}): TemplateBiblioteca => ({
  id: 'id-1',
  nome: 'Retomada',
  canal: 'email',
  formato: 'texto',
  tipo: 'reativacao_1',
  nicho: null,
  assunto: 'Retomando, {{nome}}',
  corpo: 'Olá {{nome}}, da {{empresa}}',
  html: null,
  ativo: true,
  somenteLeitura: false,
  criadoEm: null,
  atualizadoEm: null,
  ...parcial,
})

const lead = (parcial: Record<string, unknown> = {}): Lead => ({
  id: 'lead-1',
  empresa: 'Brinquedos Alegria',
  contato_nome: 'Geiza Martins',
  contato_email: 'geiza@alegria.com.br',
  segmento: 'Hotelaria',
  cidade: 'Campinas',
  responsavel_nome: 'Aline',
  data_validade: '2026-10-30',
  ...parcial,
} as unknown as Lead)

const DADOS = { lead: lead(), nomeServico: 'Laudo Técnico' }

const TODAS = '{{nome}} | {{empresa}} | {{segmento}} | {{cidade}} | {{responsavel_comercial}} | {{data_validade}} | {{nome_servico}}'

const FONTE_CENTRAL = readFileSync(
  path.join(process.cwd(), 'components', 'pipeline', 'respostas', 'CentralRespostasView.tsx'),
  'utf-8',
)

describe('lista por canal', () => {
  const lista = [
    template({ id: 'email-ativo' }),
    template({ id: 'email-inativo', ativo: false }),
    template({ id: 'whats-ativo', canal: 'whatsapp', assunto: null, corpo: 'Oi {{nome}}' }),
    template({ id: 'whats-inativo', canal: 'whatsapp', ativo: false }),
    template({ id: 'linkedin', canal: 'linkedin' }),
  ]

  it('e-mail e WhatsApp mostram só o próprio canal, e só o que está ativo', () => {
    expect(templatesDoCanal(lista, 'email').map((t) => t.id)).toEqual(['email-ativo'])
    expect(templatesDoCanal(lista, 'whatsapp').map((t) => t.id)).toEqual(['whats-ativo'])
  })

  it('template de outro canal, desativado ou ausente não vira conteúdo', () => {
    expect(conteudoParaComposer(template({ canal: 'whatsapp' }), 'email')).toBeNull()
    expect(conteudoParaComposer(template({ ativo: false }), 'email')).toBeNull()
    expect(conteudoParaComposer(null, 'email')).toBeNull()
    expect(materializarTemplateParaLead(undefined, 'whatsapp', DADOS)).toBeNull()
  })
})

describe('materialização com os dados do lead aberto', () => {
  it('substitui todas as variáveis suportadas', () => {
    const r = materializarTemplateParaLead(template({ assunto: null, corpo: TODAS }), 'email', DADOS)!
    expect(r.texto).toBe('Geiza | Brinquedos Alegria | Hotelaria | Campinas | Aline | 30/10/2026 | Laudo Técnico')
    expect(r.pendentes).toEqual([])
  })

  it('materializa o assunto do e-mail', () => {
    const r = materializarTemplateParaLead(template(), 'email', DADOS)!
    expect(r.assunto).toBe('Retomando, Geiza')
    expect(r.texto).toBe('Olá Geiza, da Brinquedos Alegria')
  })

  it('e-mail HTML: materializa o HTML e marca como HTML', () => {
    const r = materializarTemplateParaLead(
      template({ formato: 'html', html: '<p>Olá <strong>{{nome}}</strong>, validade {{data_validade}}</p>' }),
      'email',
      DADOS,
    )!
    expect(r.texto).toBe('<p>Olá <strong>Geiza</strong>, validade 30/10/2026</p>')
    expect(r.html).toBe(true)
    expect(r.assunto).toBe('Retomando, Geiza')
  })

  it('WhatsApp: materializa o texto e nunca recebe HTML', () => {
    const r = materializarTemplateParaLead(
      template({ canal: 'whatsapp', assunto: 'ignorado', corpo: 'Oi {{nome}}, sobre {{nome_servico}}', html: '<p>não</p>' }),
      'whatsapp',
      DADOS,
    )!
    expect(r).toMatchObject({ assunto: null, texto: 'Oi Geiza, sobre Laudo Técnico', html: false, pendentes: [] })
  })

  it('materializa {{frase_validade}} e {{saudacao_renovacao}} como no envio automático (sem travar por variável pendente)', () => {
    const r = materializarTemplateParaLead(
      template({ assunto: null, corpo: '{{saudacao_renovacao}} O laudo {{frase_validade}} {{data_validade}}.' }),
      'email',
      DADOS,
    )!
    expect(r.texto).toBe('Olá, Geiza, tudo bem? O laudo está com vencimento previsto para 30/10/2026.')
    expect(r.pendentes).toEqual([])
  })

  it('{{saudacao_renovacao}} cai no fallback sem nome, sem vírgula sobrando', () => {
    const semNome = { lead: lead({ contato_nome: null }), nomeServico: 'Laudo Técnico' }
    const r = materializarTemplateParaLead(template({ assunto: null, corpo: '{{saudacao_renovacao}}' }), 'email', semNome)!
    expect(r.texto).toBe('Olá, tudo bem?')
  })

  it('usa os fallbacks do renderizador quando o dado falta — nunca undefined/null', () => {
    const semDados = { lead: lead({ contato_nome: null, empresa: null, segmento: null, cidade: null, responsavel_nome: null, data_validade: null }), nomeServico: '' }
    const r = materializarTemplateParaLead(template({ assunto: null, corpo: TODAS }), 'email', semDados)!
    expect(r.texto).not.toMatch(/undefined|null|\[object Object\]/)
    expect(r.texto).toContain('sua empresa')
    expect(r.texto).toContain('seu setor')
    // Sem nome_servico configurado a variável fica pendente e trava o envio.
    expect(r.pendentes).toEqual(['nome_servico'])
  })

  it('trocar de template recalcula; trocar de lead não reaproveita o anterior', () => {
    const outro = materializarTemplateParaLead(template({ corpo: 'Seu laudo vence em {{data_validade}}' }), 'email', DADOS)!
    expect(outro.texto).toBe('Seu laudo vence em 30/10/2026')

    const outroLead = { lead: lead({ contato_nome: 'Paulo Dias', empresa: 'Parque Feliz', data_validade: '2026-12-01' }), nomeServico: 'Laudo Técnico' }
    const r = materializarTemplateParaLead(template(), 'email', outroLead)!
    expect(r.texto).toBe('Olá Paulo, da Parque Feliz')
    expect(r.texto).not.toContain('Geiza')
    expect(r.assunto).toBe('Retomando, Paulo')
  })

  it('não altera o template da biblioteca', () => {
    const original = template({ formato: 'html', html: '<p>Olá {{nome}}</p>' })
    const copia = JSON.parse(JSON.stringify(original))
    materializarTemplateParaLead(original, 'email', DADOS)
    expect(original).toEqual(copia)
  })
})

describe('variáveis pendentes bloqueiam o envio', () => {
  it('variável desconhecida continua detectada depois da materialização', () => {
    const r = materializarTemplateParaLead(template({ assunto: 'Oi {{nome_cliente}}', corpo: 'Olá {{nome}}' }), 'email', DADOS)!
    expect(r.pendentes).toEqual(['nome_cliente'])
    expect(mensagemVariaveisPendentes(r.pendentes)).toContain('{{nome_cliente}}')
    expect(mensagemVariaveisPendentes(r.pendentes)).toContain('bloqueado')
  })

  it('tudo resolvido libera o envio', () => {
    const r = materializarTemplateParaLead(template(), 'email', DADOS)!
    expect(r.pendentes).toEqual([])
    expect(mensagemVariaveisPendentes(r.pendentes)).toBeNull()
  })

  it('chave simples conta em texto puro, mas CSS/JS em HTML não bloqueia', () => {
    expect(variaveisPendentes(null, 'Olá {fulano}')).toEqual(['fulano'])
    const html = '<style>p{margin:0}.a{padding:2px}</style><p>Olá Geiza</p>'
    expect(variaveisPendentes(null, html, { htmlNoTexto: true })).toEqual([])
    expect(variaveisPendentes(null, `${html}<p>{{faltando}}</p>`, { htmlNoTexto: true })).toEqual(['faltando'])
  })

  it('pega variável digitada à mão no assunto e no texto, sem repetir', () => {
    expect(variaveisPendentes('Sobre {{x}}', 'Texto {{x}} e {{y}}')).toEqual(['x', 'y'])
  })
})

describe('a Central usa a API e não mudou o envio', () => {
  it('carrega templates pela API multi-tenant, sem leitura direta da tabela', () => {
    expect(FONTE_CENTRAL).toContain('listarTemplatesBiblioteca(')
    expect(FONTE_CENTRAL).not.toContain('getTemplates(')
    expect(FONTE_CENTRAL).not.toMatch(/from\(['"]templates['"]\)/)
    expect(MENSAGEM_BIBLIOTECA_SEM_PERMISSAO).toContain('templates.view')
  })

  it('materializa pelo renderizador do envio e bloqueia com variável pendente', () => {
    expect(FONTE_CENTRAL).toContain('materializarTemplateParaLead(')
    expect(FONTE_CENTRAL).toContain('variaveisNaoResolvidas.length === 0')
  })

  it('WhatsApp continua enviando só { lead_id, message } — nenhum templateId vai ao provedor', () => {
    expect(FONTE_CENTRAL).toContain('JSON.stringify({ lead_id: leadId, message: texto })')
    expect(FONTE_CENTRAL).not.toMatch(/body: JSON\.stringify\([^)]*templateId/)
  })

  it('e-mail continua enviando { leadId, assunto, texto } pela mesma rota', () => {
    expect(FONTE_CENTRAL).toContain("fetch('/api/email/enviar'")
    expect(FONTE_CENTRAL).toContain('JSON.stringify({ leadId, assunto, texto })')
  })

  it('a Central não escreve em nenhuma tabela pelo navegador (inclui whatsapp_mensagens)', () => {
    expect(FONTE_CENTRAL).not.toMatch(/\.(insert|upsert|update|delete)\(/)
  })
})
