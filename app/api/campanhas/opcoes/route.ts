import { NextResponse } from 'next/server'
import { resolverAcesso } from '@/lib/rbac/servidor'
import { buscarRemetenteCampanha, statusRemetenteProspeccao } from '@/lib/campanhas/opcoesServidor'
import { listarTemplates } from '@/lib/templates/repository'
import { engineConfig } from '@/lib/engine/config'
import { perfisComWhatsappAvisos } from '@/lib/campanhas/retornoWhatsappServidor'
import { lerConfigZapi } from '@/lib/whatsapp/zapi'
import { lerGrupoComercialDaOrg } from '@/lib/comercial/handoff/composicao'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  if (!acc.acesso.permissoes.has('campaigns.view')) {
    return NextResponse.json({ erro: 'Sem permissão' }, { status: 403 })
  }

  const { admin, org } = acc.acesso
  // Prospecção nunca herda o fallback 'followup'/conta global: só o remetente
  // DEDICADO desta organização conta como configurado. Demais tipos (e
  // chamadas sem `tipo`) preservam o comportamento anterior.
  const tipo = new URL(req.url).searchParams.get('tipo')
  try {
    const remetentePromise = tipo === 'prospeccao'
      ? statusRemetenteProspeccao(admin, org).then((s) => (s.conectado ? { conta: s.contaKey as string, email: s.email as string } : null))
      : buscarRemetenteCampanha(admin, org)
    const [templates, { data: leads, error: leadsError }, remetente, perfisWhatsapp, grupoConta] = await Promise.all([
      // Mesma biblioteca da tela de Templates: só e-mail ativo da organização e
      // sem as cópias `campanha_*` geradas por outras campanhas.
      listarTemplates(admin, org, { canal: 'email', ativo: 'ativos' }),
      admin
        .from('leads')
        .select('segmento')
        .eq('organizacao_id', org)
        .not('segmento', 'is', null)
        .neq('segmento', '')
        .order('segmento', { ascending: true })
        .limit(2000),
      remetentePromise,
      perfisComWhatsappAvisos(admin, org),
      lerGrupoComercialDaOrg(admin, org),
    ])
    if (leadsError) throw leadsError
    const nichosPorChave = new Map<string, string>()
    for (const lead of leads ?? []) {
      const nicho = typeof lead.segmento === 'string' ? lead.segmento.trim() : ''
      if (nicho && !nichosPorChave.has(nicho.toLocaleLowerCase('pt-BR'))) {
        nichosPorChave.set(nicho.toLocaleLowerCase('pt-BR'), nicho)
      }
    }
    const nichos = [...nichosPorChave.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'))
    return NextResponse.json({
      remetente,
      templates: templates.map((template) => ({
        id: template.id,
        nome: template.nome,
        tipo: template.tipo,
        assunto: template.assunto,
        corpo: template.corpo,
        html: template.html,
        formato: template.formato,
        nicho: template.nicho,
      })),
      nichos,
      testeEmailDisponivel: !!remetente && !engineConfig.modoEnsaio,
      envioRealDisponivel: !!remetente && !engineConfig.modoEnsaio,
      // Situação do aviso de resposta no WhatsApp: só ids de perfil (nunca o
      // número). perfisComNumero null = não deu para ler.
      whatsappRetorno: {
        provedorConfigurado: lerConfigZapi() !== null,
        perfisComNumero: perfisWhatsapp,
        // Grupo cadastrado em Configurações > Distribuição (padrão do aviso no grupo).
        grupoConta,
      },
    })
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : 'Erro' }, { status: 400 })
  }
}
