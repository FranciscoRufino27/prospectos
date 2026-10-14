import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { restaurarLeadImportadoForaDoMotor, transferirLeadImportadoParaMotor } from './carteiraServidor'
import { inscreverLeadManual, type SupabaseWorkflowStore } from '@/lib/workflows'

export interface ResultadoInscricaoLeads {
  inscritos: number
  ja_inscritos: number
  falhas: number
  execucoes_criadas: string[]
}

// Inscreve leads já validados no workflow da campanha. Idempotente por lead
// (inscreverLeadManual devolve jaInscrito) e, se a inscrição de um lead falhar,
// devolve o owner dele para fora do motor sem afetar os demais.
export async function inscreverLeadsNoWorkflow(
  admin: SupabaseClient,
  org: string,
  store: SupabaseWorkflowStore,
  workflowId: string,
  campanhaId: string,
  leadIds: string[],
): Promise<ResultadoInscricaoLeads> {
  let inscritos = 0
  let jaInscritos = 0
  let falhas = 0
  const execucoes: string[] = []
  for (const leadId of leadIds) {
    let assumidoPelaCampanha = false
    try {
      // Leads importados ficam fora do motor (`n8n`) até este ponto. A ação
      // explícita e numericamente confirmada do gestor transfere somente os
      // selecionados desta campanha para o motor.
      assumidoPelaCampanha = await transferirLeadImportadoParaMotor(admin, org, leadId)
      const resultado = await inscreverLeadManual(store, workflowId, leadId, campanhaId)
      if (resultado.jaInscrito) jaInscritos += 1
      else inscritos += 1
      if (resultado.execucaoId) execucoes.push(resultado.execucaoId)
    } catch {
      falhas += 1
      if (assumidoPelaCampanha) await restaurarLeadImportadoForaDoMotor(admin, org, leadId)
    }
  }
  return { inscritos, ja_inscritos: jaInscritos, falhas, execucoes_criadas: execucoes }
}
