import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Publico } from '@/components/automacao/tiposCampanha'
import { lerConfigZapi } from '@/lib/whatsapp/zapi'
import { lerWhatsappDoPerfil, lerWhatsappResponsavel } from '@/lib/comercial/avisosResposta/composicao'
import { numeroWhatsappAvisos } from '@/lib/comercial/avisosResposta/numero'
import { canaisRetornoCampanha } from './configuracaoGuiada'

// Pré-condição do "Somente WhatsApp" na campanha: sem Z-API ou sem o número de
// avisos de quem recebe o retorno, a resposta do cliente não chegaria a
// ninguém (o e-mail de retorno está desligado nesse modo). A campanha não
// começa assim — o wizard mostra o mesmo bloqueio antes, para o responsável
// geral; na carteira os donos dos leads só são conhecidos com o público.

const LOTE_LEADS = 300

export interface PendenciasWhatsappRetorno {
  provedorConfigurado: boolean
  // Quem receberia o retorno e não tem o WhatsApp de avisos ligado.
  semNumero: string[]
}

export async function verificarWhatsappRetorno(
  admin: SupabaseClient,
  org: string,
  publico: Publico,
  leadIds: string[],
): Promise<PendenciasWhatsappRetorno> {
  const semNumero: string[] = []
  // Mesma escolha de pessoa do aviso (avisoPedidoPelaCampanha): carteira =
  // dono de cada lead, com o responsável da campanha para lead sem dono.
  let usaResponsavelDaCampanha = publico.retornoPara !== 'lead'
  if (publico.retornoPara === 'lead') {
    const donos = new Set<string>()
    for (let i = 0; i < leadIds.length; i += LOTE_LEADS) {
      const { data, error } = await admin
        .from('leads')
        .select('responsavel_id')
        .eq('organizacao_id', org)
        .in('id', leadIds.slice(i, i + LOTE_LEADS))
      if (error) throw new Error(error.message)
      for (const lead of data ?? []) {
        if (lead.responsavel_id) donos.add(lead.responsavel_id as string)
        else usaResponsavelDaCampanha = true
      }
    }
    if (donos.size) {
      const { data: usuarios, error } = await admin
        .from('usuarios').select('id, nome').eq('organizacao_id', org).in('id', [...donos])
      if (error) throw new Error(error.message)
      const nomes = new Map((usuarios ?? []).map((u) => [u.id as string, (u.nome as string | null)?.trim() ?? '']))
      for (const id of donos) {
        if (!await lerWhatsappResponsavel(admin, org, id)) semNumero.push(nomes.get(id) || 'responsável sem nome')
      }
    }
  }
  if (usaResponsavelDaCampanha) {
    const perfilId = publico.responsavel_id
    if (!perfilId) {
      semNumero.push('responsável da campanha (não definido)')
    } else if (!await lerWhatsappDoPerfil(admin, org, perfilId)) {
      const { data, error } = await admin
        .from('perfis').select('nome').eq('organizacao_id', org).eq('id', perfilId).maybeSingle()
      if (error) throw new Error(error.message)
      semNumero.push((data?.nome as string | null)?.trim() || 'responsável da campanha')
    }
  }
  return { provedorConfigurado: lerConfigZapi() !== null, semNumero: [...new Set(semNumero)] }
}

export async function exigirWhatsappRetornoPronto(
  admin: SupabaseClient,
  org: string,
  publico: Publico,
  leadIds: string[],
): Promise<void> {
  if (canaisRetornoCampanha(publico) !== 'whatsapp') return
  const p = await verificarWhatsappRetorno(admin, org, publico, leadIds)
  if (!p.provedorConfigurado) {
    throw new Error('"Somente WhatsApp" precisa do WhatsApp (Z-API) configurado no servidor. Escolha "E-mail e WhatsApp" ou configure a Z-API antes de iniciar.')
  }
  if (p.semNumero.length) {
    const quem = p.semNumero.join(', ')
    throw new Error(`"Somente WhatsApp": ${quem} ainda não ${p.semNumero.length === 1 ? 'ligou' : 'ligaram'} o WhatsApp de avisos (Meu perfil > Avisos no WhatsApp) — as respostas não chegariam a ninguém. Peça o cadastro ou escolha "E-mail e WhatsApp".`)
  }
}

// Perfis da organização com WhatsApp de avisos ligado e número válido (para o
// wizard mostrar a situação do responsável). null = não foi possível ler.
export async function perfisComWhatsappAvisos(admin: SupabaseClient, org: string): Promise<string[] | null> {
  const { data, error } = await admin
    .from('perfis')
    .select('id, whatsapp_avisos')
    .eq('organizacao_id', org)
    .eq('avisos_whatsapp_ativo', true)
  if (error) return null
  return (data ?? [])
    .filter((p) => numeroWhatsappAvisos(p.whatsapp_avisos as string | null))
    .map((p) => p.id as string)
}
