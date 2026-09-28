// Texto do aviso de resposta do cliente. PURO: só formata os dados congelados.
import type { ClassificacaoAviso, DadosAvisoResposta, DestinoAvisoResposta } from './types'

export const TAMANHO_TRECHO = 280

const ROTULO_CLASSIFICACAO: Record<Exclude<ClassificacaoAviso, null>, string> = {
  positivo: 'com interesse',
  negativo: 'sem interesse',
  neutro: 'sem sinal claro de interesse',
  indeterminado: 'não foi possível classificar',
}

// Linhas que começam o histórico citado de um e-mail ("Em 10/09, Fulano
// escreveu:", "On ... wrote:", "-----Original Message-----", "De: ...").
const INICIO_CITACAO = [
  /^em .{3,200}escreveu:?\s*$/i,
  /^on .{3,200}wrote:?\s*$/i,
  /^-{2,}\s*(original message|mensagem original)/i,
  /^_{5,}\s*$/,
  /^(de|from):\s.+/i,
]

/** Primeiras palavras do que o cliente escreveu, sem o histórico citado. */
export function extrairTrecho(texto: string, limite = TAMANHO_TRECHO): string {
  const proprias: string[] = []
  for (const linha of (texto ?? '').split(/\r?\n/)) {
    const l = linha.trim()
    if (l.startsWith('>')) break
    if (INICIO_CITACAO.some((re) => re.test(l))) break
    proprias.push(l)
  }
  const corrido = proprias.join(' ').replace(/\s+/g, ' ').trim()
  if (corrido.length <= limite) return corrido
  return corrido.slice(0, limite).replace(/\s+\S*$/, '') + '…'
}

const ou = (v: string | null | undefined, padrao: string) => (v && v.trim() ? v.trim() : padrao)

export function montarMensagemAviso(d: DadosAvisoResposta, destino: DestinoAvisoResposta): string {
  const empresa = ou(d.empresa, '')
  const contato = ou(d.contato, '')
  const quem = empresa || contato || 'Um cliente'
  const canal = d.canal === 'whatsapp' ? 'WhatsApp' : 'e-mail'
  const linhas = ['CLIENTE RESPONDEU — ProspectOS', '']
  // No grupo, a menção diz de quem é o lead; no privado, o aviso já é dele.
  if (destino === 'grupo') linhas.push(`@${ou(d.responsavelNome, 'Sem responsável')}, ${quem} respondeu por ${canal}.`)
  else linhas.push(`${quem} respondeu por ${canal}.`)
  linhas.push('')
  if (empresa) linhas.push(`Empresa: ${empresa}`)
  linhas.push(`Contato: ${contato || 'não informado'}`)
  if (d.classificacao) linhas.push(`Leitura automática: ${ROTULO_CLASSIFICACAO[d.classificacao]}`)
  if (destino === 'grupo') linhas.push(`Responsável: ${ou(d.responsavelNome, 'sem responsável')}`)
  if (d.trecho) linhas.push('', `"${d.trecho}"`)
  if (d.link) linhas.push('', `Abrir: ${d.link}`)
  return linhas.join('\n')
}
