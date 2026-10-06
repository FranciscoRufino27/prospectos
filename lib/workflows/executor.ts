// Executor do motor de workflows (Fase 3). Duas responsabilidades:
//
//  1) ENROLLMENT: para cada workflow publicado, avalia o gatilho e inscreve os
//     leads-alvo que ainda não têm execução (idempotente).
//  2) STEPPING: avança cada execução pendente. Gate de condições (AND) no início;
//     depois roda as ações em ordem. A ação 'esperar' SUSPENDE a execução
//     (status='aguardando' + proxima_verificacao_em). Para prospecção a espera
//     cria uma geração e publica um despertar durável; Renovação segue no poll.
import type { WorkflowStore } from './store/store'
import type { CtxExec, RegistroWorkflows } from './registro'
import type { AmbienteWorkflow } from './ambiente'
import { ErroEnvioIncerto } from './ambiente'
import type { DefinicaoWorkflow } from './types'
import type { EnfileirarRetomada } from './retomadaProspeccao'
import { agendaPermiteProcessar, encaixarNaJanela, type JanelaCampanha } from '@/lib/campanhas/agenda'

function ctxDe(
  store: WorkflowStore,
  registro: RegistroWorkflows,
  ambiente: AmbienteWorkflow,
  execucao: import('./types').WorkflowExecucao,
  config: Record<string, unknown>,
  blocoId?: string,
  campanhaTipo?: string | null,
): CtxExec {
  return {
    ambiente,
    store,
    registro,
    execucao,
    leadId: execucao.lead_id,
    config,
    // Id do bloco na definição — estável e único na versão. Junto com a
    // execução, forma a chave que impede reenviar o mesmo passo se a fila
    // repetir a ação (o executor é at-least-once por desenho).
    blocoId,
    campanhaTipo: campanhaTipo ?? null,
    log: (tipo, detalhe) => store.registrarEvento({ execucao_id: execucao.id, tipo, detalhe: detalhe ?? null }),
  }
}

async function definicaoDaExecucao(store: WorkflowStore, versaoId: string): Promise<DefinicaoWorkflow> {
  const versao = await store.buscarVersao(versaoId)
  if (!versao) throw new Error(`versão ${versaoId} da execução não encontrada`)
  return versao.definicao
}

// Avança UMA execução o quanto der até concluir ou bater numa espera.
export async function processarExecucao(
  store: WorkflowStore,
  registro: RegistroWorkflows,
  ambiente: AmbienteWorkflow,
  execucaoId: string,
  agoraISO: string = new Date().toISOString(),
  opcoes: { propagarErro?: boolean; permitirRetryErro?: boolean; ignorarAgendaCampanha?: boolean; claimToken?: string; enfileirarRetomada?: EnfileirarRetomada } = {},
): Promise<void> {
  const ex = await store.buscarExecucao(execucaoId)
  if (!ex) return
  if (ex.status === 'concluido' || ex.status === 'cancelado') return
  if (ex.status === 'erro' && !opcoes.permitirRetryErro) return
  if (ex.status === 'erro') {
    await store.atualizarExecucao(ex.id, { status: 'em_andamento', atualizado_em: agoraISO })
  }
  // Espera ainda não venceu → não toca.
  if (ex.status === 'aguardando') {
    if (!ex.proxima_verificacao_em || new Date(ex.proxima_verificacao_em).getTime() > new Date(agoraISO).getTime()) return
  }

  const log = (tipo: string, detalhe?: Record<string, unknown>) =>
    store.registrarEvento({ execucao_id: ex.id, tipo, detalhe: detalhe ?? null })

  try {
    // Execuções originadas por campanha obedecem o ciclo de vida e os dias da
    // agenda ATUAL da campanha. Isso permite ajustar uma campanha ativa sem
    // trocar a versão imutável do workflow nem recriar/duplicar execuções.
    // Pausada ou ausente = falha segura, sem avançar passo nem disparar efeito.
    // Concluída = não inscreve novos leads (gate no enrollment), mas deixa
    // execuções já existentes terminarem — "concluir" encerra novas entradas,
    // não corta cadências em andamento.
    let campanhaTipo: string | null = null
    // Janela de envio da campanha: as esperas (follow-ups) terminam dentro dela.
    let janela: JanelaCampanha | null = null
    if (ex.campanha_id) {
      const controle = await ambiente.buscarControleExecucaoCampanha(ex.campanha_id)
      if (!controle || controle.status === 'pausada') return
      if (!controle.disparoUnico) {
        janela = { diasSemana: controle.diasSemana, horarioInicio: controle.horarioInicio, horarioFim: controle.horarioFim }
      }
      if (controle.status !== 'ativa' && controle.status !== 'concluida') return
      if (
        !controle.disparoUnico
        && !opcoes.ignorarAgendaCampanha
        && !agendaPermiteProcessar(controle.diasSemana, agoraISO)
      ) return
      campanhaTipo = controle.tipo ?? null
      if (campanhaTipo === 'prospeccao' && ex.claim_token
        && ex.claim_expira_em && new Date(ex.claim_expira_em).getTime() > Date.now()
        && ex.claim_token !== opcoes.claimToken) return
      // O poll diário e callbacks antigos não podem executar o mesmo passo de
      // prospecção que pertence ao worker com claim atômico.
      if (campanhaTipo === 'prospeccao' && store.organizacaoId && ex.status === 'aguardando'
        && (!opcoes.claimToken || ex.claim_token !== opcoes.claimToken)) return
    }

    // Janela de envio (dias + horário de Brasília): chegou a hora fora dela —
    // inclusive retomadas/filas agendadas antes desta regra — não executa nada
    // e adia para a próxima abertura, espalhado nas primeiras horas (sem rajada).
    if (janela) {
      const agora = new Date(agoraISO)
      const abertura = encaixarNaJanela(agora, janela)
      if (abertura.getTime() > agora.getTime()) {
        const ate = new Date(abertura.getTime() + espalhamentoNaAbertura(ex.id)).toISOString()
        if (campanhaTipo === 'prospeccao' && store.organizacaoId) {
          if (!opcoes.claimToken || !store.agendarEsperaProspeccao) return
          const adiada = await store.agendarEsperaProspeccao(ex.id, ex.passo_atual, ex.passo_atual, ate, opcoes.claimToken)
          if (!adiada) return
          await log('adiado_fora_da_janela', { ate, geracao: adiada.agendamento_geracao })
          try {
            const { publicarRetomadaProspeccao } = await import('./retomadaProspeccao')
            await publicarRetomadaProspeccao(store, adiada, { enfileirar: opcoes.enfileirarRetomada })
          } catch (erro) {
            await log('retomada_publicacao_falhou', {
              geracao: adiada.agendamento_geracao,
              mensagem: erro instanceof Error ? erro.message : String(erro),
            })
          }
          return
        }
        await store.atualizarExecucao(ex.id, { status: 'aguardando', proxima_verificacao_em: ate, atualizado_em: agoraISO })
        await log('adiado_fora_da_janela', { ate })
        return
      }
    }

    const def = await definicaoDaExecucao(store, ex.versao_id)

    // Gate de condições — só na primeira passada (passo_atual === 0), antes de
    // qualquer ação. Em resume (passo > 0) as condições não são reavaliadas.
    if (ex.passo_atual === 0) {
      for (const cond of def.condicoes ?? []) {
        const passou = await registro.obterCondicao(cond.tipo).avaliar(ctxDe(store, registro, ambiente, ex, cond.config ?? {}, undefined, campanhaTipo))
        if (!passou) {
          await log('condicoes_nao_satisfeitas', { condicao: cond.tipo })
          await store.atualizarExecucao(ex.id, { status: 'concluido', atualizado_em: agoraISO })
          return
        }
      }
    }

    // Pipeline de ações. `passo_atual` NÃO é só +1: uma ação pode saltar
    // (ramificação) ou encerrar. Trava anti-laço: um salto para trás sem espera
    // no meio geraria loop infinito dentro de um único tick — o contador corta.
    const totalAcoes = def.acoes?.length ?? 0
    const MAX_PASSOS = totalAcoes * 100 + 100
    let passo = ex.passo_atual
    let voltas = 0
    while (passo < totalAcoes) {
      if (voltas++ > MAX_PASSOS)
        throw new Error(`limite de passos excedido (${MAX_PASSOS}) — possível laço de ramificação`)

      const bloco = def.acoes[passo]
      if (opcoes.claimToken) {
        const atual = await store.buscarExecucao(ex.id)
        if (!atual || atual.status === 'cancelado' || atual.claim_token !== opcoes.claimToken) return
      }
      const res = await registro.obterAcao(bloco.tipo).executar(ctxDe(store, registro, ambiente, ex, bloco.config ?? {}, bloco.id, campanhaTipo))
      await log('acao_executada', { passo, acao: bloco.tipo })

      if (res.tipo === 'esperar') {
        const ate = janela ? encaixarNaJanela(new Date(res.ate), janela).toISOString() : res.ate
        if (campanhaTipo === 'prospeccao' && store.organizacaoId) {
          if (!store.agendarEsperaProspeccao) throw new Error('Store sem agendamento durável de prospecção.')
          const agendada = await store.agendarEsperaProspeccao(ex.id, passo, passo + 1, ate, opcoes.claimToken)
          if (!agendada) return // cancelamento ou claim perdido venceu a corrida
          await log('aguardando', { ate, geracao: agendada.agendamento_geracao })
          try {
            const { publicarRetomadaProspeccao } = await import('./retomadaProspeccao')
            await publicarRetomadaProspeccao(store, agendada, { enfileirar: opcoes.enfileirarRetomada })
          } catch (erro) {
            // A intenção já foi persistida. O cron diário irá republicá-la.
            await log('retomada_publicacao_falhou', {
              geracao: agendada.agendamento_geracao,
              mensagem: erro instanceof Error ? erro.message : String(erro),
            })
          }
          return
        }
        await store.atualizarExecucao(ex.id, {
          passo_atual: passo + 1, status: 'aguardando',
          proxima_verificacao_em: ate, atualizado_em: agoraISO,
        })
        await log('aguardando', { ate })
        return
      }

      if (res.tipo === 'encerrar') {
        await store.atualizarExecucao(ex.id, { status: 'concluido', atualizado_em: agoraISO })
        await log('encerrado', { passo })
        return
      }

      // saltar: resolve o id do passo alvo → índice ATUAL (referência estável a
      // reordenar/remover). continuar: próximo passo. Persiste passo_atual sempre,
      // para o resume (at-least-once) retomar do lugar certo se cair aqui.
      if (res.tipo === 'saltar') {
        const alvo = (def.acoes ?? []).findIndex((a) => a.id === res.destinoId)
        if (alvo < 0) throw new Error(`saltar_se: passo destino '${res.destinoId}' não existe na definição`)
        passo = alvo
        await log('saltou', { destinoId: res.destinoId, para: alvo })
      } else {
        passo += 1
      }
      // Enquanto o claim da retomada está ativo, manter 'aguardando' permite
      // que retry/watchdog recuperem o passo após uma queda entre ações.
      await store.atualizarExecucao(ex.id, {
        passo_atual: passo, status: opcoes.claimToken ? 'aguardando' : 'em_andamento', atualizado_em: agoraISO,
      })
    }

    await store.atualizarExecucao(ex.id, { status: 'concluido', atualizado_em: agoraISO })
    await log('concluido')
  } catch (e) {
    // O worker de retomada deixa a execução aguardando para retry da fila;
    // marcar erro aqui tornaria o claim seguinte inelegível.
    if (!opcoes.claimToken || e instanceof ErroEnvioIncerto)
      await store.atualizarExecucao(ex.id, { status: 'erro', atualizado_em: agoraISO })
    const mensagem = e instanceof Error ? e.message : String(e)
    await log('erro', { mensagem })
    try {
      await ambiente.notificarFalhaExecucao?.(ex, mensagem)
    } catch {
      // O alerta é best-effort: a falha original continua registrada no evento
      // e não pode ser mascarada por uma indisponibilidade das notificações.
    }
    if (opcoes.propagarErro) throw e
  }
}

// Inscreve leads-alvo dos workflows publicados (idempotente).
export async function processarEnrollment(
  store: WorkflowStore,
  registro: RegistroWorkflows,
  ambiente: AmbienteWorkflow,
): Promise<number> {
  let inscritos = 0
  for (const wf of await store.workflowsPublicados()) {
    if (!wf.versao_atual_id) continue
    const versao = await store.buscarVersao(wf.versao_atual_id)
    if (!versao) continue
    const gatilho = versao.definicao.gatilho
    const alvos = await registro.obterGatilho(gatilho.tipo).selecionarAlvos({ ambiente, config: gatilho.config ?? {} })
    for (const leadId of alvos) {
      if (await store.existeExecucaoParaLead(wf.id, leadId)) continue
      const ex = await store.criarExecucao({ workflow_id: wf.id, versao_id: wf.versao_atual_id, lead_id: leadId })
      await store.registrarEvento({
        execucao_id: ex.id,
        tipo: 'execucao_iniciada',
        detalhe: { versao_id: ex.versao_id, lead_id: leadId, via: 'enrollment' },
      })
      inscritos += 1
    }
  }
  return inscritos
}

// Inscreve UM lead específico num workflow SOB DEMANDA (gatilho 'manual' ou botão
// "Inscrever agora"), sem esperar o poll. Mesma lógica de processarEnrollment
// (criarExecucao + evento execucao_iniciada), idempotente por lead. O stepping
// segue sendo do poll. Exige workflow publicado (fixa a versão vigente).
// campanhaId: quando o enrollment vem de uma campanha, grava o vínculo na execução
// (usado pelo ambiente para verificar campanhas.dry_run antes de enviar e-mail).
export async function inscreverLeadManual(
  store: WorkflowStore,
  workflowId: string,
  leadId: string,
  campanhaId?: string | null,
  contexto: { cicloChave?: string | null; servicoId?: string | null } = {},
): Promise<{ jaInscrito: boolean; execucaoId?: string }> {
  const wf = await store.buscarWorkflow(workflowId)
  if (!wf) throw new Error(`workflow ${workflowId} não encontrado`)
  if (wf.status !== 'publicado' || !wf.versao_atual_id)
    throw new Error('workflow precisa estar publicado para inscrever um lead manualmente.')
  const existente = contexto.cicloChave
    ? await store.buscarExecucaoParaCiclo(workflowId, leadId, contexto.cicloChave)
    : await store.buscarExecucaoParaLead(workflowId, leadId)
  if (existente) return { jaInscrito: true, execucaoId: existente.id }
  const ex = await store.criarExecucao({
    workflow_id: workflowId,
    versao_id: wf.versao_atual_id,
    lead_id: leadId,
    campanha_id: campanhaId ?? null,
    ciclo_chave: contexto.cicloChave ?? null,
    servico_id: contexto.servicoId ?? null,
  })
  await store.registrarEvento({
    execucao_id: ex.id,
    tipo: 'execucao_iniciada',
    detalhe: {
      versao_id: ex.versao_id,
      lead_id: leadId,
      via: campanhaId ? 'campanha' : 'manual',
      ciclo_chave: contexto.cicloChave ?? null,
      servico_id: contexto.servicoId ?? null,
    },
  })
  return { jaInscrito: false, execucaoId: ex.id }
}

// Um "tick" completo do poll para UMA organização (o store já é org-scoped):
// inscreve novos e avança todas as execuções pendentes.
export async function processarTudo(
  store: WorkflowStore,
  registro: RegistroWorkflows,
  ambiente: AmbienteWorkflow,
  agoraISO: string = new Date().toISOString(),
): Promise<{ inscritos: number; processadas: number }> {
  const inscritos = await processarEnrollment(store, registro, ambiente)
  const pendentes = await store.execucoesPendentes(agoraISO)
  for (const ex of pendentes) await processarExecucao(store, registro, ambiente, ex.id, agoraISO)
  for (const campanhaId of new Set(pendentes.map((ex) => ex.campanha_id).filter((id): id is string => !!id))) {
    await ambiente.sincronizarConclusaoCampanha(campanhaId)
  }
  return { inscritos, processadas: pendentes.length }
}

// Processa somente as execuções recém-criadas por uma campanha confirmada. É o
// caminho usado pelo wizard para não disparar o poll global de outras campanhas
// ou organizações depois de uma ativação.
export async function processarExecucoesCampanha(
  store: WorkflowStore,
  registro: RegistroWorkflows,
  ambiente: AmbienteWorkflow,
  campanhaId: string,
  execucaoIds: string[],
  agoraISO: string = new Date().toISOString(),
  opcoes: { propagarErro?: boolean; permitirRetryErro?: boolean; ignorarAgendaCampanha?: boolean; claimToken?: string; enfileirarRetomada?: EnfileirarRetomada } = {},
): Promise<number> {
  let processadas = 0
  for (const execucaoId of [...new Set(execucaoIds)]) {
    const execucao = await store.buscarExecucao(execucaoId)
    if (!execucao || execucao.campanha_id !== campanhaId) continue
    await processarExecucao(store, registro, ambiente, execucaoId, agoraISO, opcoes)
    processadas += 1
  }
  await ambiente.sincronizarConclusaoCampanha(campanhaId)
  return processadas
}

// Até 2h depois da abertura, determinístico por execução: quem foi adiado não
// sai todo no mesmo minuto quando a janela abre.
function espalhamentoNaAbertura(execucaoId: string): number {
  let h = 0
  for (let i = 0; i < execucaoId.length; i++) h = (h * 31 + execucaoId.charCodeAt(i)) >>> 0
  return (h % 120) * 60_000
}
