import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface ResumoExecucoesCampanha {
  total: number
  emAndamento: number
  aguardando: number
  // Pendentes que ainda NÃO receberam o 1º e-mail (passo 0). O restante de
  // emAndamento+aguardando já recebeu e espera o próximo follow-up.
  aguardandoPrimeiroEnvio: number
  // Execuções que já passaram do 1º passo (o 1º e-mail saiu ou foi tentado).
  jaContatados: number
  concluidas: number
  canceladas: number
  // Canceladas cujo lead está marcado como devolvido (bounce). O restante das
  // canceladas saiu por resposta, descadastro ou cancelamento manual.
  devolvidos: number
  erros: number
  // Mensagens que SAÍRAM (evento `email_enviado` com `enviado: true`). Conta
  // cada passo de envio — numa cadência com follow-up passa de `total`. Ensaio
  // grava `enviado: false` e não entra aqui.
  emailsEnviados: number
  respostas: number
}

const vazio = (): ResumoExecucoesCampanha => ({
  total: 0, emAndamento: 0, aguardando: 0, aguardandoPrimeiroEnvio: 0, jaContatados: 0, concluidas: 0,
  canceladas: 0, devolvidos: 0, erros: 0, emailsEnviados: 0, respostas: 0,
})

// O PostgREST devolve no máximo 1000 linhas por consulta: sem paginar, campanha
// grande teria envios e respostas cortados em silêncio. IDs vão em lotes para o
// `in(...)` não estourar o tamanho da URL.
const PAGINA = 1000
const LOTE_IDS = 150

type Pagina<T> = PromiseLike<{ data: T[] | null; error: unknown }>

async function lerTodas<T>(consulta: (de: number, ate: number) => Pagina<T>): Promise<T[]> {
  const linhas: T[] = []
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await consulta(de, de + PAGINA - 1)
    if (error) throw error
    linhas.push(...(data ?? []))
    if (!data || data.length < PAGINA) return linhas
  }
}

async function lerEmLotes<T>(ids: string[], consulta: (lote: string[], de: number, ate: number) => Pagina<T>): Promise<T[]> {
  const lotes: string[][] = []
  for (let i = 0; i < ids.length; i += LOTE_IDS) lotes.push(ids.slice(i, i + LOTE_IDS))
  const resultados = await Promise.all(lotes.map((lote) => lerTodas<T>((de, ate) => consulta(lote, de, ate))))
  return resultados.flat()
}

export async function buscarResumosExecucoesCampanhas(
  admin: SupabaseClient,
  organizacaoId: string,
  campanhaIds: string[],
): Promise<Record<string, ResumoExecucoesCampanha>> {
  const idsCampanha = [...new Set(campanhaIds.filter(Boolean))]
  if (!idsCampanha.length) return {}

  const execucoes = await lerTodas<{
    id: string; campanha_id: string; lead_id: string | null; status: string; iniciado_em: string; passo_atual: number | null
  }>((de, ate) => admin
    .from('workflow_execucoes')
    .select('id, campanha_id, lead_id, status, iniciado_em, passo_atual')
    .eq('organizacao_id', organizacaoId)
    .in('campanha_id', idsCampanha)
    .order('id')
    .range(de, ate))

  const resumos = Object.fromEntries(idsCampanha.map((id) => [id, vazio()]))
  const execucaoParaCampanha = new Map<string, string>()
  const inicios = new Map<string, string>()
  const leadsPorCampanha = new Map<string, Set<string>>()

  for (const execucao of execucoes) {
    const resumo = resumos[execucao.campanha_id] ?? (resumos[execucao.campanha_id] = vazio())
    resumo.total += 1
    if (execucao.status === 'em_andamento') resumo.emAndamento += 1
    if (execucao.status === 'aguardando') resumo.aguardando += 1
    if ((execucao.status === 'aguardando' || execucao.status === 'em_andamento') && (execucao.passo_atual ?? 0) === 0) {
      resumo.aguardandoPrimeiroEnvio += 1
    }
    if ((execucao.passo_atual ?? 0) > 0) resumo.jaContatados += 1
    if (execucao.status === 'concluido') resumo.concluidas += 1
    if (execucao.status === 'cancelado') resumo.canceladas += 1
    if (execucao.status === 'erro') resumo.erros += 1
    execucaoParaCampanha.set(execucao.id, execucao.campanha_id)
    const inicioAtual = inicios.get(execucao.campanha_id)
    if (!inicioAtual || execucao.iniciado_em < inicioAtual) inicios.set(execucao.campanha_id, execucao.iniciado_em)
    if (execucao.lead_id) {
      const leads = leadsPorCampanha.get(execucao.campanha_id) ?? new Set<string>()
      leads.add(execucao.lead_id)
      leadsPorCampanha.set(execucao.campanha_id, leads)
    }
  }

  const idsExecucao = execucoes.map((execucao) => execucao.id)
  if (idsExecucao.length) {
    const eventos = await lerEmLotes<{ execucao_id: string; detalhe?: Record<string, unknown> | null }>(
      idsExecucao,
      (lote, de, ate) => admin
        .from('workflow_execucao_eventos')
        .select('execucao_id, detalhe')
        .eq('organizacao_id', organizacaoId)
        .in('execucao_id', lote)
        .eq('tipo', 'email_enviado')
        .order('id')
        .range(de, ate),
    )
    for (const evento of eventos) {
      const campanhaId = execucaoParaCampanha.get(evento.execucao_id)
      if (campanhaId && evento.detalhe?.enviado === true) resumos[campanhaId].emailsEnviados += 1
    }
  }

  // Devolução: execução cancelada cujo lead ficou marcado como bounced.
  const canceladasComLead = execucoes.filter((execucao) => execucao.status === 'cancelado' && execucao.lead_id)
  if (canceladasComLead.length) {
    const devolvidos = await lerEmLotes<{ id: string }>(
      [...new Set(canceladasComLead.map((execucao) => execucao.lead_id as string))],
      (lote, de, ate) => admin
        .from('leads')
        .select('id')
        .eq('organizacao_id', organizacaoId)
        .in('id', lote)
        .eq('bounced', true)
        .order('id')
        .range(de, ate),
    )
    const leadsDevolvidos = new Set(devolvidos.map((lead) => lead.id))
    for (const execucao of canceladasComLead) {
      if (leadsDevolvidos.has(execucao.lead_id as string)) resumos[execucao.campanha_id].devolvidos += 1
    }
  }

  const todosLeadIds = [...new Set([...leadsPorCampanha.values()].flatMap((leads) => [...leads]))]
  const inicioGlobal = [...inicios.values()].sort()[0]
  if (todosLeadIds.length && inicioGlobal) {
    const interacoes = await lerEmLotes<{ lead_id: string; created_at: string }>(
      todosLeadIds,
      (lote, de, ate) => admin
        .from('interacoes')
        .select('lead_id, created_at')
        .eq('organizacao_id', organizacaoId)
        .in('lead_id', lote)
        .eq('tipo', 'resposta')
        .gte('created_at', inicioGlobal)
        .order('id')
        .range(de, ate),
    )
    for (const campanhaId of idsCampanha) {
      const leads = leadsPorCampanha.get(campanhaId)
      const inicio = inicios.get(campanhaId)
      if (!leads || !inicio) continue
      resumos[campanhaId].respostas = new Set(
        interacoes
          .filter((row) => leads.has(row.lead_id) && row.created_at >= inicio)
          .map((row) => row.lead_id),
      ).size
    }
  }

  return resumos
}

export async function buscarResumoExecucoesCampanha(
  admin: SupabaseClient,
  organizacaoId: string,
  campanhaId: string,
): Promise<ResumoExecucoesCampanha> {
  const resumos = await buscarResumosExecucoesCampanhas(admin, organizacaoId, [campanhaId])
  return resumos[campanhaId] ?? vazio()
}
