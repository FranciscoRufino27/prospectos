import 'server-only'
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { MensagemCampanha, Publico } from '@/components/automacao/tiposCampanha'
import { atualizarCampanha } from './repository'
import {
  corpoComLink,
  montarDefinicaoCampanha,
  normalizarPublicoCampanha,
  tipoTemplateCampanha,
} from './configuracaoGuiada'
import { extrairAcaoIdsPublicados, mensagensNaOrdem, resolverAcaoIds } from './acaoId'
import { criarWorkflow, salvarRascunho, SupabaseWorkflowStore } from '@/lib/workflows'
import { buscarRemetenteDoTipo } from './opcoesServidor'
import { exigirTemplatesDaOrganizacao } from './templatesCampanha'

interface Materializacao {
  publico: Publico
  workflowId: string | null
}

async function materializarTemplate(
  admin: SupabaseClient,
  org: string,
  campanhaId: string,
  campanhaNome: string,
  mensagem: MensagemCampanha,
  indice: number,
): Promise<MensagemCampanha> {
  if (!mensagem.assunto?.trim() || !mensagem.corpo?.trim()) return mensagem

  const tipo = tipoTemplateCampanha(campanhaId, indice)
  const valores = {
    nome: `${campanhaNome} — mensagem ${indice + 1}`,
    tipo,
    canal: 'email',
    nicho: null,
    assunto: mensagem.assunto.trim(),
    corpo: corpoComLink(mensagem),
    ativo: true,
  }

  let templateId: string | null = null
  if (mensagem.templateId) {
    const { data, error } = await admin
      .from('templates')
      .update(valores)
      .eq('organizacao_id', org)
      .eq('id', mensagem.templateId)
      .select('id')
      .maybeSingle()
    if (error) throw error
    templateId = (data as { id?: string } | null)?.id ?? null
  }

  if (!templateId) {
    const { data: existente, error: buscaErro } = await admin
      .from('templates')
      .select('id')
      .eq('organizacao_id', org)
      .eq('canal', 'email')
      .eq('tipo', tipo)
      .is('nicho', null)
      .limit(1)
      .maybeSingle()
    if (buscaErro) throw buscaErro

    if (existente?.id) {
      const { error } = await admin
        .from('templates')
        .update(valores)
        .eq('organizacao_id', org)
        .eq('id', existente.id)
      if (error) throw error
      templateId = existente.id as string
    } else {
      const { data, error } = await admin
        .from('templates')
        .insert({ ...valores, organizacao_id: org })
        .select('id')
        .single()
      if (error) throw error
      templateId = data.id as string
    }
  }

  return { ...mensagem, templateId, templateTipo: tipo }
}

// Transforma a edição amigável em templates e rascunho versionável. Só toca no
// workflow criado para esta campanha; workflows escolhidos no modo avançado não
// são reinterpretados nem sobrescritos.
export async function materializarCampanhaGuiada(
  admin: SupabaseClient,
  org: string,
  campanhaId: string,
  campanhaNome: string,
  bruto: unknown,
  tipoCampanha?: string | null,
): Promise<Materializacao> {
  const normalizado = normalizarPublicoCampanha(bruto)
  // Antes de qualquer escrita: todo template referenciado é desta organização.
  await exigirTemplatesDaOrganizacao(admin, org, normalizado)
  // Prospecção reflete o remetente DEDICADO da organização (ou nenhum, se não
  // configurado) — nunca o fallback 'followup'/conta global que
  // `buscarRemetenteCampanha` usa para os demais tipos (preservado como
  // estava). Ver lib/campanhas/opcoesServidor.ts.
  const remetente = await buscarRemetenteDoTipo(admin, org, tipoCampanha)
  const publico: Publico = {
    ...normalizado,
    operacao: {
      ...normalizado.operacao,
      remetenteConta: remetente?.conta,
      remetenteEmail: remetente?.email,
    },
  }
  const inicial = publico.operacao?.mensagemInicial
  if (!inicial?.assunto || !inicial.corpo) {
    await atualizarCampanha(admin, org, campanhaId, { publico })
    return { publico, workflowId: null }
  }

  // Resolve o workflow ANTES de tocar nas mensagens: se já existe uma versão
  // publicada, é dela que uma campanha legada herda o `acaoId` de cada
  // mensagem (ver lib/campanhas/acaoId.ts) — sem isso, uma campanha publicada
  // antes desta migração ganharia UUIDs novos, divergentes do `acoes[].id` já
  // gravado em workflow_execucoes/interacoes históricos.
  const store = new SupabaseWorkflowStore(org, admin)
  const workflowGerenciadoId = publico.operacao?.workflowGerenciadoId
  let workflowId: string
  let idsPublicados: string[] = []
  if (workflowGerenciadoId) {
    const existente = await store.buscarWorkflow(workflowGerenciadoId)
    if (!existente) throw new Error('O workflow gerenciado desta campanha não foi encontrado.')
    workflowId = existente.id
    if (existente.versao_atual_id) {
      const versaoPublicada = await store.buscarVersao(existente.versao_atual_id)
      idsPublicados = extrairAcaoIdsPublicados(versaoPublicada?.definicao)
    }
  } else {
    const novo = await criarWorkflow(store, { nome: `Campanha — ${campanhaNome}` })
    workflowId = novo.id
  }

  const mensagens = resolverAcaoIds(
    mensagensNaOrdem(inicial, publico.operacao?.followups),
    idsPublicados,
    randomUUID,
  )
  const materializadas: MensagemCampanha[] = []
  for (const [indice, mensagem] of mensagens.entries()) {
    materializadas.push(await materializarTemplate(admin, org, campanhaId, campanhaNome, mensagem, indice))
  }

  const materializado: Publico = {
    ...publico,
    operacao: {
      ...publico.operacao,
      mensagemInicial: materializadas[0],
      followups: materializadas.slice(1).map((mensagem, indice) => ({
        ...mensagem,
        diasApos: publico.operacao?.followups?.[indice]?.diasApos,
      })),
      workflowGerenciadoId: workflowId,
    },
  }
  await salvarRascunho(store, workflowId, montarDefinicaoCampanha(materializado))
  await atualizarCampanha(admin, org, campanhaId, { publico: materializado, workflow_id: workflowId })
  return { publico: materializado, workflowId }
}
