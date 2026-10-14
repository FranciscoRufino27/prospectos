import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { parseWorkspaceConfig } from '@/lib/config/workspaceConfig'
import { engineConfig } from '@/lib/engine/config'
import { GmailProvider } from '@/lib/engine/email/gmailProvider'
import { montarEmailCampanhaHtml } from '@/lib/campanhas/emailCampanha'
import { buscarRemetenteCampanha } from '@/lib/campanhas/opcoesServidor'

// E-mail de convite de membro da equipe.
//
// O remetente é a conta Gmail DO WORKSPACE de quem convida — a mesma que
// campanhas, Central e envio de teste usam (`buscarRemetenteCampanha`: conta
// conectada pela org, chave legada, ou a padrão quando a org não tem nenhuma).
// Nunca a conta padrão fixa: isso fazia um convite da Laudos sair pela conta da
// Inovacode (e o mailer do Supabase, antes, mandava tudo por um remetente só).
// Chave dedicada sem credencial BLOQUEIA o envio; não cai na conta de outra org.
//
// Falha aqui nunca desfaz o convite: o usuário já existe e a rota devolve o
// link para repasse manual.
//
// O mesmo envio serve à redefinição de senha pedida por um admin
// (`tipo: 'redefinicao'`, rota /api/equipe/[id]/acesso): muda só o texto.

export type ResultadoEmailConvite =
  | { emailEnviado: true; simulado: false; remetente: string }
  | { emailEnviado: false; simulado: true; remetente: string }
  | {
      emailEnviado: false
      simulado: false
      motivo: 'sem_link' | 'credencial_ausente' | 'falha_envio'
      remetente: string | null
    }

export async function enviarEmailConvite(
  admin: SupabaseClient,
  org: string,
  entrada: { email: string; actionLink: string | null; tipo?: 'convite' | 'redefinicao' },
): Promise<ResultadoEmailConvite> {
  if (!entrada.actionLink) {
    return { emailEnviado: false, simulado: false, motivo: 'sem_link', remetente: null }
  }

  let remetente: Awaited<ReturnType<typeof buscarRemetenteCampanha>>
  let nomeServico = 'ProspectOS'
  try {
    remetente = await buscarRemetenteCampanha(admin, org)
    const { data: orgRow } = await admin
      .from('organizacoes')
      .select('nome, configuracoes')
      .eq('id', org)
      .maybeSingle()
    const orgData = orgRow as { nome?: string; configuracoes?: unknown } | null
    nomeServico = parseWorkspaceConfig(orgData?.configuracoes).nomenclaturas?.nome_servico?.trim()
      || orgData?.nome
      || nomeServico
  } catch (e) {
    console.error('[equipe/convidar] falha ao resolver remetente do workspace:', e)
    return { emailEnviado: false, simulado: false, motivo: 'falha_envio', remetente: null }
  }

  const credenciais = remetente?.credenciais ?? null
  if (!remetente || !credenciais || credenciais.user.toLowerCase() !== remetente.email.toLowerCase()) {
    console.error('[equipe/convidar] conta Gmail do workspace sem credencial — convite criado, e-mail não enviado.', {
      org,
      conta: remetente?.conta ?? null,
    })
    return { emailEnviado: false, simulado: false, motivo: 'credencial_ausente', remetente: null }
  }

  // MODO_ENSAIO: o GmailProvider já não envia, mas paramos antes para a
  // resposta não afirmar um envio que não saiu.
  if (engineConfig.modoEnsaio) {
    return { emailEnviado: false, simulado: true, remetente: remetente.email }
  }

  const link = entrada.actionLink
  const redefinicao = entrada.tipo === 'redefinicao'
  const assunto = redefinicao ? `Redefinição de senha — ${nomeServico}` : `Convite para acessar ${nomeServico}`
  const abertura = redefinicao
    ? 'Um administrador pediu a redefinição da sua senha na plataforma'
    : 'Você foi convidado para acessar a plataforma'
  const instrucao = redefinicao ? 'criar uma senha nova' : 'definir sua senha e ativar seu acesso'
  const rotuloBotao = redefinicao ? 'Criar senha nova' : 'Definir senha e acessar'
  const rodape = redefinicao
    ? 'Se você não esperava esta mensagem, avise o administrador da sua equipe.'
    : 'Se você não esperava este convite, ignore este e-mail.'

  const corpoTexto = `${abertura} ${nomeServico}.\n\nAcesse o link abaixo para ${instrucao}:\n${link}\n\n${rodape}`
  const htmlPersonalizado = `
      <p>${abertura} <strong>${nomeServico}</strong>.</p>
      <p>Clique no botão abaixo para ${instrucao}:</p>
      <p><a href="${link}" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;">${rotuloBotao}</a></p>
      <p style="color:#64748b;font-size:12px;">Se o botão não funcionar, copie e cole este link no navegador:<br>${link}</p>
      <p style="color:#64748b;font-size:12px;">${rodape}</p>
    `
  const html = montarEmailCampanhaHtml(corpoTexto, { nomeServico }, htmlPersonalizado)

  try {
    await new GmailProvider(credenciais).enviar(entrada.email, assunto, corpoTexto, html)
  } catch (e) {
    console.error('[equipe/convidar] falha ao enviar e-mail de convite:', e)
    return { emailEnviado: false, simulado: false, motivo: 'falha_envio', remetente: remetente.email }
  }

  return { emailEnviado: true, simulado: false, remetente: remetente.email }
}
