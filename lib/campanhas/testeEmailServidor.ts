import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { engineConfig } from '@/lib/engine/config'
import { GmailProvider } from '@/lib/engine/email/gmailProvider'
import { LIMITE_HTML_CAMPANHA } from './configuracaoGuiada'
import { montarEmailCampanhaHtml } from './emailCampanha'
import { buscarRemetenteCampanha, buscarRemetenteProspeccao, type RemetenteOrganizacao } from './opcoesServidor'

const LIMITE_ASSUNTO_TESTE = 200
const LIMITE_CORPO_TESTE = 50_000

export interface DadosTesteEmailCampanha {
  assunto?: unknown
  corpo?: unknown
  html?: unknown
  responsavelNome?: unknown
  // Tipo da campanha sendo composta no wizard (ainda não necessariamente
  // salva, por isso não há campanhaId aqui). Só 'prospeccao' muda o resolvedor
  // de remetente (ver `resolverRemetenteTeste` abaixo); demais tipos/ausência
  // preservam o comportamento anterior.
  tipo?: unknown
}

// MESMO resolvedor/gate da ativação e do envio real de prospecção (ver
// lib/campanhas/opcoesServidor.ts, lib/workflows/ambiente.ts) — sem
// campanhaId aqui (o teste roda sobre um rascunho ainda não salvo), então
// não dá para reusar `exigirEnvioRealCampanhaDisponivel` (que busca o tipo
// pela campanha persistida); a checagem em si é a mesma `buscarRemetenteProspeccao`.
async function resolverRemetenteTeste(
  admin: SupabaseClient,
  org: string,
  tipoCampanha: string | null,
): Promise<RemetenteOrganizacao> {
  if (tipoCampanha === 'prospeccao') {
    const dedicado = await buscarRemetenteProspeccao(admin, org)
    if (!dedicado) {
      throw new Error('Configure um remetente em Configurações antes de iniciar a campanha.')
    }
    return dedicado
  }
  const remetente = await buscarRemetenteCampanha(admin, org)
  if (!remetente) throw new Error('Configure uma conta remetente no workspace antes de enviar o teste.')
  return remetente
}

function textoObrigatorio(valor: unknown, campo: string, limite: number): string {
  if (typeof valor !== 'string' || !valor.trim()) throw new Error(`Informe ${campo}.`)
  const texto = valor.trim()
  if (texto.length > limite) throw new Error(`${campo} excede o limite de ${limite} caracteres.`)
  return texto
}

function textoOpcional(valor: unknown, limite: number, campo: string): string | undefined {
  if (typeof valor !== 'string' || !valor.trim()) return undefined
  const texto = valor.trim()
  if (texto.length > limite) throw new Error(`${campo} excede o limite permitido.`)
  return texto
}

// Envio deliberadamente restrito à própria conta remetente do workspace. Não
// aceita destinatário do cliente, não persiste campanha e não cria execução.
// A trava global MODO_ENSAIO continua soberana e nunca é contornada pelo teste.
export async function enviarTesteEmailCampanha(
  admin: SupabaseClient,
  org: string,
  dados: DadosTesteEmailCampanha,
): Promise<{ destinatario: string; assunto: string }> {
  const assunto = textoObrigatorio(dados.assunto, 'o assunto da mensagem', LIMITE_ASSUNTO_TESTE)
  const corpo = textoObrigatorio(dados.corpo, 'o conteúdo da mensagem', LIMITE_CORPO_TESTE)
  const html = textoOpcional(dados.html, LIMITE_HTML_CAMPANHA, 'O HTML da mensagem')
  const responsavelNome = textoOpcional(dados.responsavelNome, 200, 'O nome do responsável')

  if (engineConfig.modoEnsaio) {
    throw new Error('O motor está em modo ensaio; nenhum e-mail de teste foi enviado.')
  }

  const tipoCampanha = typeof dados.tipo === 'string' ? dados.tipo : null
  const remetente = await resolverRemetenteTeste(admin, org, tipoCampanha)

  const { credenciais } = remetente
  if (credenciais.user.toLowerCase() !== remetente.email.toLowerCase()) {
    throw new Error('As credenciais da conta remetente não estão disponíveis.')
  }

  const assuntoTeste = `[TESTE] ${assunto}`
  const htmlFinal = montarEmailCampanhaHtml(corpo, { responsavelNome }, html)
  await new GmailProvider(credenciais).enviar(remetente.email, assuntoTeste, corpo, htmlFinal)

  return { destinatario: remetente.email, assunto: assuntoTeste }
}
