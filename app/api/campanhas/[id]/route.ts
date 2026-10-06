// Lê / atualiza / transiciona / apaga uma campanha (Fase 7). GET requer
// campaigns.view; PATCH e DELETE requerem campaigns.manage.
import { NextResponse } from 'next/server'
import { exigirPermissao, resolverAcesso } from '@/lib/rbac/servidor'
import { atualizarCampanha, buscarCampanha } from '@/lib/campanhas/repository'
import { buscarContextoResumoOperacional } from '@/lib/campanhas/resumoOperacionalServidor'
import { materializarCampanhaGuiada } from '@/lib/campanhas/materializarServidor'
import {
  aplicarRegraPublicoPorTipo,
  campanhaEhDisparoUnico,
  normalizarPublicoCampanha,
  podeUsarTipoCampanha,
} from '@/lib/campanhas/configuracaoGuiada'
import { buscarPreviaPublicoCampanha, previaParaCliente } from '@/lib/campanhas/publicoServidor'
import { engineConfig } from '@/lib/engine/config'
import { buscarResumoExecucoesCampanha } from '@/lib/campanhas/resumoExecucoesServidor'
import { apagarCampanha, ErroExclusaoCampanha } from '@/lib/campanhas/exclusaoServidor'
import { ErroTemplateCampanha } from '@/lib/campanhas/templatesCampanha'
import { reagendarPrimeirosEnviosAoRetomar } from '@/lib/campanhas/filaDisparoServidor'
import { janelaDoPublico } from '@/lib/campanhas/agenda'
import { SupabaseWorkflowStore } from '@/lib/workflows'

export const runtime = 'nodejs'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  if (!acc.acesso.permissoes.has('campaigns.view')) {
    return NextResponse.json({ erro: 'Sem permissão' }, { status: 403 })
  }
  const { admin, org } = acc.acesso
  try {
    const campanha = await buscarCampanha(admin, org, id)
    if (!campanha) return NextResponse.json({ erro: 'Campanha não encontrada' }, { status: 404 })
    const publicoBruto = campanha.publico && typeof campanha.publico === 'object'
      ? campanha.publico as Record<string, unknown>
      : {}
    const temSelecaoGuiada = publicoBruto.selecao && typeof publicoBruto.selecao === 'object'
    const [resumoOperacional, previaPublico, resumoExecucoes] = await Promise.all([
      buscarContextoResumoOperacional(admin, org, campanha),
      temSelecaoGuiada
        ? buscarPreviaPublicoCampanha(
            admin,
            org,
            aplicarRegraPublicoPorTipo(normalizarPublicoCampanha(campanha.publico), campanha.tipo),
            campanha.workflow_id,
          ).then(previaParaCliente)
        : Promise.resolve(null),
      buscarResumoExecucoesCampanha(admin, org, id),
    ])
    return NextResponse.json({
      campanha,
      resumoOperacional,
      previaPublico,
      resumoExecucoes,
      envioRealDisponivel: !!resumoOperacional.remetente && !engineConfig.modoEnsaio,
    })
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : 'Erro' }, { status: 400 })
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const acc = await exigirPermissao('campaigns.manage')
  if ('erro' in acc) return acc.erro
  const { admin, org } = acc.acesso
  const b = await req.json()
  try {
    const atual = await buscarCampanha(admin, org, id)
    if (!atual) return NextResponse.json({ erro: 'Campanha não encontrada' }, { status: 404 })

    if (b.status === 'concluida') {
      const resumo = await buscarResumoExecucoesCampanha(admin, org, id)
      const ativas = resumo.emAndamento + resumo.aguardando
      if (ativas > 0) {
        return NextResponse.json({ erro: `A campanha ainda possui ${ativas} execução(ões) pendente(s).` }, { status: 409 })
      }
      if (resumo.canceladas > 0 || resumo.erros > 0) {
        return NextResponse.json(
          { erro: `Resolva as execuções antes de concluir: ${resumo.canceladas} cancelada(s) e ${resumo.erros} com erro.` },
          { status: 409 },
        )
      }
      const publico = atual.publico && typeof atual.publico === 'object'
        ? atual.publico as Record<string, unknown>
        : {}
      const operacao = publico.operacao && typeof publico.operacao === 'object'
        ? publico.operacao as Record<string, unknown>
        : {}
      const disparoUnico = operacao.modoEnvio === 'disparo_unico' || campanhaEhDisparoUnico(atual.tipo)
      if (disparoUnico && resumo.total > 0 && resumo.respostas === 0) {
        return NextResponse.json(
          { erro: 'O disparo terminou, mas ainda não recebeu respostas. Mantenha a campanha em acompanhamento.' },
          { status: 409 },
        )
      }
    }

    if (b.publico && typeof b.publico === 'object') {
      if (atual.status !== 'rascunho') {
        return NextResponse.json(
          { erro: 'Campanha publicada não pode reabrir público ou mensagens. Use a edição restrita da agenda.' },
          { status: 409 },
        )
      }
      const tipo = typeof b.tipo === 'string' ? b.tipo : atual.tipo
      // `tipo` não é gravado por esta rota, mas ESCOLHE a regra de público
      // aplicada. Sem esta checagem, quem só pode comunicado mandaria
      // tipo='prospeccao' no corpo e herdaria a regra de público da prospecção.
      if (!podeUsarTipoCampanha(tipo, acc.acesso.permissoes.has('campaigns.tipos.avancados'))) {
        return NextResponse.json(
          { erro: 'Seu acesso permite apenas campanhas de comunicado.' },
          { status: 403 },
        )
      }
      const publico = aplicarRegraPublicoPorTipo(normalizarPublicoCampanha(b.publico), tipo)
      const materializada = await materializarCampanhaGuiada(
        admin,
        org,
        id,
        typeof b.nome === 'string' && b.nome.trim() ? b.nome.trim() : atual.nome,
        publico,
        tipo,
      )
      const restante = { ...b }
      delete restante.publico
      delete restante.workflow_id
      if (Object.keys(restante).length) await atualizarCampanha(admin, org, id, restante)
      return NextResponse.json({ ok: true, workflow_id: materializada.workflowId ?? atual.workflow_id })
    }

    await atualizarCampanha(admin, org, id, b)
    // Retomar: o que não saiu durante a pausa volta para a fila, dentro da janela.
    if (atual.status === 'pausada' && b.status === 'ativa') {
      const disparoUnico = campanhaEhDisparoUnico(atual.tipo)
      const fila = await reagendarPrimeirosEnviosAoRetomar(
        new SupabaseWorkflowStore(org, admin), admin, org, id,
        disparoUnico ? null : janelaDoPublico(atual.publico),
      )
      return NextResponse.json({ ok: true, workflow_id: atual.workflow_id, fila })
    }
    return NextResponse.json({ ok: true, workflow_id: atual.workflow_id })
  } catch (e) {
    // Template de outra organização responde como inexistente, sem gravar nada.
    if (e instanceof ErroTemplateCampanha) return NextResponse.json({ erro: e.message }, { status: e.status })
    return NextResponse.json({ erro: e instanceof Error ? e.message : 'Erro' }, { status: 400 })
  }
}

// Exclusão definitiva pelo botão da lista. Mesma régua de quem cria: sem
// `campaigns.tipos.avancados`, só comunicado. Travas e ordem das operações em
// lib/campanhas/exclusaoServidor.ts.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const acc = await exigirPermissao('campaigns.manage')
  if ('erro' in acc) return acc.erro
  const { admin, org } = acc.acesso
  try {
    const campanha = await buscarCampanha(admin, org, id)
    if (!campanha) return NextResponse.json({ erro: 'Campanha não encontrada' }, { status: 404 })
    if (!podeUsarTipoCampanha(campanha.tipo, acc.acesso.permissoes.has('campaigns.tipos.avancados'))) {
      return NextResponse.json({ erro: 'Seu acesso permite apagar apenas campanhas de comunicado.' }, { status: 403 })
    }
    const resultado = await apagarCampanha(admin, org, id)
    return NextResponse.json({ ok: true, ...resultado })
  } catch (e) {
    if (e instanceof ErroExclusaoCampanha) return NextResponse.json({ erro: e.message }, { status: e.status })
    return NextResponse.json({ erro: e instanceof Error ? e.message : 'Erro' }, { status: 400 })
  }
}
