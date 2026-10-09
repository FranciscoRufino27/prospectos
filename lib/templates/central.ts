// Como a Central de Respostas escolhe, MATERIALIZA e aplica um template no
// composer. Puro e client-safe: a tela só desenha o que estas funções decidem —
// a biblioteca vem da API multi-tenant, nunca de leitura direta da tabela.
//
// A substituição de variáveis é a MESMA do envio real: `preencher`
// (lib/engine/mensagem.ts), que campanhas, workflows e o motor já usam, com os
// mesmos fallbacks. Nada aqui altera template, lead ou banco: a materialização
// acontece só no texto do composer, que a pessoa revisa antes de enviar.
import { preencher } from '@/lib/engine/mensagem'
import type { Lead } from '@/lib/engine/types'
import { fraseValidadeRenovacao, saudacaoRenovacao } from '@/lib/renovacao/emailArtLaudos'
import type { CanalTemplate, TemplateBiblioteca } from './tipos'

export type CanalComposer = 'email' | 'whatsapp'

// Só o canal do composer, e só o que está ativo. A API já entrega apenas a
// organização da sessão e sem as cópias de campanha.
export function templatesDoCanal(
  templates: readonly TemplateBiblioteca[],
  canal: CanalComposer,
): TemplateBiblioteca[] {
  return templates.filter((template) => template.canal === (canal as CanalTemplate) && template.ativo)
}

export interface ConteudoTemplate {
  // Só e-mail tem assunto; no WhatsApp o composer não mexe nele.
  assunto: string | null
  texto: string
  // O texto é HTML? (template de e-mail com HTML próprio.)
  html: boolean
}

// Qual conteúdo do template vai para o composer, antes de materializar.
// Devolve null quando o template não pode ser aplicado (sumiu da lista, foi
// desativado ou é de outro canal): a tela então não altera nada.
export function conteudoParaComposer(
  template: TemplateBiblioteca | null | undefined,
  canal: CanalComposer,
): ConteudoTemplate | null {
  if (!template || !template.ativo || template.canal !== (canal as CanalTemplate)) return null
  if (canal === 'whatsapp') {
    // WhatsApp é texto puro: HTML nunca entra no composer.
    return { assunto: null, texto: template.corpo, html: false }
  }
  // Template HTML entra como HTML no composer — o envio já detecta e manda
  // html + texto alternativo (lib/respostas/enviarEmailServidor.ts).
  const html = template.html?.trim()
  return { assunto: template.assunto?.trim() || null, texto: html || template.corpo, html: !!html }
}

// Variável do ProspectOS em chave DUPLA, o formato canônico dos templates.
const VARIAVEL_DUPLA = /\{\{\s*(\w+)\s*\}\}/g
// Chave simples só é considerada variável em texto puro: em HTML, `{...}` é
// quase sempre CSS/JS e não pode bloquear um envio legítimo.
const VARIAVEL_SIMPLES = /(?:^|[^{])\{(\w+)\}/g

export interface OpcoesPendentes {
  // O texto do composer é HTML? Então só chave dupla conta como variável.
  htmlNoTexto?: boolean
}

// O que sobrou DEPOIS da materialização: variável que o renderizador real não
// soube preencher para este lead. É o que bloqueia o envio.
export function variaveisPendentes(
  assunto: string | null | undefined,
  texto: string | null | undefined,
  opcoes: OpcoesPendentes = {},
): string[] {
  const pendentes = new Set<string>()
  const coletar = (conteudo: string | null | undefined, incluirChaveSimples: boolean) => {
    const valor = conteudo ?? ''
    for (const [, nome] of valor.matchAll(VARIAVEL_DUPLA)) pendentes.add(nome)
    if (!incluirChaveSimples) return
    for (const [, nome] of valor.matchAll(VARIAVEL_SIMPLES)) pendentes.add(nome)
  }
  coletar(assunto, true)
  coletar(texto, !opcoes.htmlNoTexto)
  return [...pendentes]
}

export interface DadosDoLead {
  // Lead da conversa ABERTA — os dados reais de quem vai receber.
  lead: Lead
  // nomenclaturas.nome_servico || nome da organização, igual ao envio real.
  nomeServico: string
}

export interface TemplateMaterializado {
  assunto: string | null
  texto: string
  html: boolean
  pendentes: string[]
}

export function materializarTemplateParaLead(
  template: TemplateBiblioteca | null | undefined,
  canal: CanalComposer,
  dados: DadosDoLead,
): TemplateMaterializado | null {
  const conteudo = conteudoParaComposer(template, canal)
  if (!conteudo) return null
  // Mesmas extras do envio automático (lib/workflows/ambiente.ts), senão um
  // template de renovação que usa {{frase_validade}}/{{saudacao_renovacao}}
  // fica com variável "pendente" só aqui e trava o envio manual à toa.
  const extras: Record<string, string> = {
    ...(dados.nomeServico ? { nome_servico: dados.nomeServico } : {}),
    frase_validade: fraseValidadeRenovacao(dados.lead.data_validade),
    saudacao_renovacao: saudacaoRenovacao(dados.lead.contato_nome),
  }
  const assunto = conteudo.assunto ? preencher(conteudo.assunto, dados.lead, extras) : null
  const texto = preencher(conteudo.texto, dados.lead, extras)
  return {
    assunto,
    texto,
    html: conteudo.html,
    pendentes: variaveisPendentes(assunto, texto, { htmlNoTexto: conteudo.html }),
  }
}

export function mensagemVariaveisPendentes(pendentes: readonly string[]): string | null {
  if (pendentes.length === 0) return null
  return `Não foi possível preencher ${pendentes.map((v) => `{{${v}}}`).join(', ')} com os dados deste lead. `
    + 'Edite o texto antes de enviar — o envio fica bloqueado enquanto houver variável pendente.'
}

export const MENSAGEM_BIBLIOTECA_SEM_PERMISSAO = 'Biblioteca de templates indisponível (requer templates.view). Você pode escrever a mensagem normalmente.'
export const MENSAGEM_TEMPLATE_INDISPONIVEL = 'Este template não está mais disponível. Atualize a página ou escreva a mensagem manualmente.'
export const MENSAGEM_SEM_CONVERSA = 'Abra uma conversa para aplicar um template: as variáveis são preenchidas com os dados do lead.'
