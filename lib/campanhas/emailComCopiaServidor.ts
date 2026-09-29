import 'server-only'
import type { EmailProvider } from '@/lib/engine/email/provider'
import type { UsuarioBasico } from '@/lib/engine/types'

interface ResponsaveisPossiveis {
  responsavelCampanha?: UsuarioBasico | null
  responsavelLead?: UsuarioBasico | null
  preferirResponsavelDoLead?: boolean
}

// Quem assina e recebe cópia do e-mail da campanha. Exportado porque a
// assinatura do corpo (montarEmailCampanhaHtml) tem de usar exatamente a mesma
// pessoa que vai no CC — decidir isso em dois lugares foi o que deixou o
// remetente da assinatura divergir do destinatário da resposta.
export function escolherResponsavelCampanha(dados: ResponsaveisPossiveis): UsuarioBasico | null {
  const daCampanha = dados.responsavelCampanha?.email?.trim() ? dados.responsavelCampanha : null
  const doLead = dados.responsavelLead?.email?.trim() ? dados.responsavelLead : null
  return dados.preferirResponsavelDoLead ? doLead ?? daCampanha : daCampanha ?? doLead
}

export async function enviarEmailCampanhaComCopia(
  provider: EmailProvider,
  mensagem: {
    para: string
    assunto: string
    corpo: string
    html?: string
    remetenteEmail?: string | null
    responsavelCampanha?: UsuarioBasico | null
    responsavelLead?: UsuarioBasico | null
    // Campanha no modo carteira (publico.retornoPara='lead'): quem assina e
    // recebe cópia é o responsável do PRÓPRIO lead, com o responsável geral da
    // campanha como fallback. Mesma precedência do aviso de retorno — o cliente
    // não pode receber e-mail assinado por uma pessoa e cair na caixa de outra.
    preferirResponsavelDoLead?: boolean
    // false = campanha em "somente as respostas": o responsável continua
    // assinando e recebendo o retorno, mas não vai em cópia de cada envio.
    copiarResponsavel?: boolean
  },
): Promise<UsuarioBasico> {
  const responsavel = escolherResponsavelCampanha(mensagem)
  // Exigido mesmo sem cópia: é quem assina e quem recebe o retorno.
  if (!responsavel) {
    throw new Error('Envio bloqueado: o responsável comercial não possui e-mail para receber a cópia.')
  }
  const cc = mensagem.copiarResponsavel === false
    || responsavel.email.trim().toLowerCase() === mensagem.remetenteEmail?.trim().toLowerCase()
    ? undefined
    : responsavel.email.trim()
  await provider.enviar(
    mensagem.para,
    mensagem.assunto,
    mensagem.corpo,
    mensagem.html,
    cc,
  )
  return responsavel
}
