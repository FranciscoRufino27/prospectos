import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Publico } from '@/components/automacao/tiposCampanha'
import { lerConfigZapi } from '@/lib/whatsapp/zapi'
import { lerWhatsappDoPerfil, lerWhatsappResponsavel } from '@/lib/comercial/avisosResposta/composicao'
import { numeroWhatsappAvisos } from '@/lib/comercial/avisosResposta/numero'
import { lerGrupoComercialDaOrg } from '@/lib/comercial/handoff/composicao'
import { avisoEnvioCampanha, avisoRetornoCampanha } from './configuracaoGuiada'

// Pré-condições do aviso de resposta escolhido na campanha, conferidas antes
// de sair do ensaio. O wizard mostra os mesmos bloqueios antes, no que dá para
// saber lá (Z-API, grupo, número do responsável geral); na carteira os donos
// dos leads só são conhecidos com o público.
//   - grupo marcado sem grupo (nem da campanha, nem da conta) → bloqueia;
//   - sem e-mail, a resposta precisa chegar a alguém pelo WhatsApp: Z-API
//     configurada E (grupo disponível OU todos os responsáveis com número).

const LOTE_LEADS = 300

// Quem receberia o retorno no WhatsApp individual e não tem o número de avisos
// ligado. Mesma escolha de pessoa do aviso (avisoPedidoPelaCampanha): carteira
// = dono de cada lead, com o responsável da campanha para lead sem dono.
export async function responsaveisSemWhatsapp(
  admin: SupabaseClient,
  org: string,
  publico: Publico,
  leadIds: string[],
): Promise<string[]> {
  const semNumero: string[] = []
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
  return [...new Set(semNumero)]
}

export async function exigirAvisoRetornoPronto(
  admin: SupabaseClient,
  org: string,
  publico: Publico,
  leadIds: string[],
): Promise<void> {
  const aviso = avisoRetornoCampanha(publico)
  if (!aviso) return
  if (!aviso.email && !aviso.whatsapp.length) {
    throw new Error('Escolha ao menos um canal para o aviso de resposta (e-mail ou WhatsApp).')
  }
  const querGrupo = aviso.whatsapp.includes('grupo')
  const grupo = querGrupo ? aviso.grupoWhatsappId || await lerGrupoComercialDaOrg(admin, org) : null
  if (querGrupo && !grupo) {
    throw new Error('O aviso no grupo do WhatsApp está marcado, mas não há grupo: informe o grupo na campanha ou cadastre em Configurações > Distribuição.')
  }
  if (aviso.email) return

  // Sem e-mail: o WhatsApp é o único caminho da resposta até a equipe.
  if (!lerConfigZapi()) {
    throw new Error('Aviso só por WhatsApp precisa do WhatsApp (Z-API) configurado no servidor. Marque também o e-mail ou configure a Z-API antes de iniciar.')
  }
  if (grupo) return
  const semNumero = await responsaveisSemWhatsapp(admin, org, publico, leadIds)
  if (semNumero.length) {
    const quem = semNumero.join(', ')
    throw new Error(`Aviso só por WhatsApp: ${quem} ainda não ${semNumero.length === 1 ? 'ligou' : 'ligaram'} o WhatsApp de avisos (Meu perfil > Avisos no WhatsApp) — as respostas não chegariam a ninguém. Peça o cadastro, marque o grupo ou marque também o e-mail.`)
  }
}

// Aviso a cada envio marcado na campanha: sem Z-API, sem grupo ou sem o
// número do responsável, a mensagem nunca sairia — bloqueia antes do envio real.
export async function exigirAvisoEnvioPronto(
  admin: SupabaseClient,
  org: string,
  publico: Publico,
  leadIds: string[],
): Promise<void> {
  const aviso = avisoEnvioCampanha(publico)
  if (!aviso) return
  if (!lerConfigZapi()) {
    throw new Error('O aviso de envio no WhatsApp precisa do WhatsApp (Z-API) configurado no servidor. Desmarque o aviso ou configure a Z-API antes de iniciar.')
  }
  if (aviso.whatsapp.includes('grupo') && !(aviso.grupoWhatsappId || await lerGrupoComercialDaOrg(admin, org))) {
    throw new Error('O aviso de envio no grupo está marcado, mas não há grupo: informe o grupo na campanha ou cadastre em Configurações > Distribuição.')
  }
  if (aviso.whatsapp.includes('responsavel')) {
    const semNumero = await responsaveisSemWhatsapp(admin, org, publico, leadIds)
    if (semNumero.length) {
      throw new Error(`Aviso de envio no WhatsApp: ${semNumero.join(', ')} ainda não ${semNumero.length === 1 ? 'ligou' : 'ligaram'} o WhatsApp de avisos (Meu perfil > Avisos no WhatsApp). Peça o cadastro ou desmarque o responsável.`)
    }
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
