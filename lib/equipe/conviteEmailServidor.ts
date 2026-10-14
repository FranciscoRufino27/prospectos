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
  entrada: { email: string; actionLink: string | null },
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
  const corpoTexto = `Você foi convidado para acessar a plataforma ${nomeServico}.\n\nAcesse o link abaixo para definir sua senha e ativar seu acesso:\n${link}\n\nSe você não esperava este convite, ignore este e-mail.`
  const htmlPersonalizado = `
      <p>Você foi convidado para acessar a plataforma <strong>${nomeServico}</strong>.</p>
      <p>Clique no botão abaixo para definir sua senha e ativar seu acesso:</p>
      <p><a href="${link}" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;">Definir senha e acessar</a></p>
      <p style="color:#64748b;font-size:12px;">Se o botão não funcionar, copie e cole este link no navegador:<br>${link}</p>
      <p style="color:#64748b;font-size:12px;">Se você não esperava este convite, ignore este e-mail.</p>
    `
  const html = montarEmailCampanhaHtml(corpoTexto, { nomeServico }, htmlPersonalizado)

  try {
    await new GmailProvider(credenciais).enviar(entrada.email, `Convite para acessar ${nomeServico}`, corpoTexto, html)
  } catch (e) {
    console.error('[equipe/convidar] falha ao enviar e-mail de convite:', e)
    return { emailEnviado: false, simulado: false, motivo: 'falha_envio', remetente: remetente.email }
  }

  return { emailEnviado: true, simulado: false, remetente: remetente.email }
}
