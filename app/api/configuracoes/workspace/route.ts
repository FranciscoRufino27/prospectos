// Configuração do workspace (Fase 9): lê/grava organizacoes.configuracoes via o
// ÚNICO ponto de escrita (mesclar/serialize). GET p/ qualquer sessão; PUT exige
// workspace.configure. Sempre org-scoped (organizacoes where id = org da sessão).
import { NextResponse } from 'next/server'
import { resolverAcesso, exigirPermissao } from '@/lib/rbac/servidor'
import { parseWorkspaceConfig, mesclarWorkspaceConfig, type WorkspaceConfigEditavel } from '@/lib/config/workspaceConfig'
import { statusRemetenteProspeccaoDeConfig } from '@/lib/campanhas/opcoesServidor'

export const runtime = 'nodejs'

export async function GET() {
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  const { admin, org } = acc.acesso
  const { data } = await admin.from('organizacoes').select('nome, configuracoes').eq('id', org).maybeSingle()
  const config = parseWorkspaceConfig(data?.configuracoes)
  return NextResponse.json({
    config,
    // Nome da organização: é o fallback de {nome_servico} no envio real
    // (lib/workflows/ambiente.ts). A Central precisa dele para materializar a
    // variável exatamente como o motor materializaria.
    organizacao: { nome: typeof data?.nome === 'string' ? data.nome : '' },
    podeEditar: acc.acesso.permissoes.has('workspace.configure'),
    // Status do remetente dedicado (Configurações > E-mail de prospecção).
    remetenteProspeccao: statusRemetenteProspeccaoDeConfig(config),
  })
}

export async function PUT(req: Request) {
  const acc = await exigirPermissao('workspace.configure')
  if ('erro' in acc) return acc.erro
  const { admin, org } = acc.acesso
  const b = (await req.json()) as WorkspaceConfigEditavel
  const { data } = await admin.from('organizacoes').select('configuracoes').eq('id', org).maybeSingle()
  const atual = parseWorkspaceConfig(data?.configuracoes)
  const novo = mesclarWorkspaceConfig(atual, {
    nomenclaturas: b.nomenclaturas && typeof b.nomenclaturas === 'object' ? b.nomenclaturas : undefined,
    modulos: b.modulos && typeof b.modulos === 'object' ? b.modulos : undefined,
    renovacaoAntecedenciaDias: typeof b.renovacaoAntecedenciaDias === 'number' ? b.renovacaoAntecedenciaDias : undefined,
    roiCustoMensal: typeof b.roiCustoMensal === 'number' ? b.roiCustoMensal : undefined,
    // string limpa/define; null limpa; ausente não toca.
    comercialGrupoWhatsappId: typeof b.comercialGrupoWhatsappId === 'string' || b.comercialGrupoWhatsappId === null
      ? b.comercialGrupoWhatsappId
      : undefined,
    // Janela do check-in em minutos; null volta ao padrão (7 dias).
    comercialHandoffRevisaoMinutos: typeof b.comercialHandoffRevisaoMinutos === 'number' || b.comercialHandoffRevisaoMinutos === null
      ? b.comercialHandoffRevisaoMinutos
      : undefined,
    // Campanha de follow-up de retorno (Fase 4); null limpa.
    comercialCampanhaRetornoId: typeof b.comercialCampanhaRetornoId === 'string' || b.comercialCampanhaRetornoId === null
      ? b.comercialCampanhaRetornoId
      : undefined,
    // Rodízio automático do handoff; false/null volta ao padrão (desligado).
    comercialRodizioHandoff: typeof b.comercialRodizioHandoff === 'boolean' || b.comercialRodizioHandoff === null
      ? b.comercialRodizioHandoff
      : undefined,
    // Aviso de resposta do cliente no WhatsApp; null desliga (validado na mescla).
    comercialAvisoResposta: typeof b.comercialAvisoResposta === 'string' || b.comercialAvisoResposta === null
      ? b.comercialAvisoResposta
      : undefined,
    // Grupos do WhatsApp salvos com nome: lista substitui (validada no parse); null limpa.
    comercialGruposWhatsapp: Array.isArray(b.comercialGruposWhatsapp) || b.comercialGruposWhatsapp === null
      ? b.comercialGruposWhatsapp
      : undefined,
    camposUI: Array.isArray(b.camposUI) ? b.camposUI : undefined,
    operacao: b.operacao && typeof b.operacao === 'object' ? b.operacao : undefined,
    // Perfil de busca da prospecção: objeto substitui (validado no parse); null limpa.
    prospeccao: b.prospeccao === null || (b.prospeccao && typeof b.prospeccao === 'object') ? b.prospeccao : undefined,
    // Travas de custo do enriquecimento pago (validadas no parse); null desliga.
    enriquecimentoPago: b.enriquecimentoPago === null || (b.enriquecimentoPago && typeof b.enriquecimentoPago === 'object') ? b.enriquecimentoPago : undefined,
  })
  // Um grupo comercial pertence a NO MÁXIMO uma organização: o callback de
  // grupo resolve a org pelo grupo, então a ambiguidade tem de ser barrada
  // aqui (e pelo índice único da migration 0044, que é o backstop).
  const grupoNovo = novo.comercial?.grupoWhatsappId ?? null
  if (grupoNovo && grupoNovo !== atual.comercial?.grupoWhatsappId) {
    const { data: donos } = await admin
      .from('organizacoes').select('id').eq('configuracoes->comercial->>grupoWhatsappId', grupoNovo).neq('id', org).limit(1)
    if ((donos?.length ?? 0) > 0) {
      return NextResponse.json({ erro: 'Este grupo já está configurado em outra organização.' }, { status: 409 })
    }
  }
  const { error } = await admin.from('organizacoes').update({ configuracoes: novo }).eq('id', org)
  if (error) {
    const conflito = error.message.includes('uniq_organizacoes_grupo_comercial')
    return NextResponse.json({ erro: conflito ? 'Este grupo já está configurado em outra organização.' : error.message }, { status: conflito ? 409 : 400 })
  }
  return NextResponse.json({ ok: true, config: novo, remetenteProspeccao: statusRemetenteProspeccaoDeConfig(novo) })
}
