import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { campanhaEhDisparoUnico } from './configuracaoGuiada'

export interface ControleExecucaoCampanha {
  status: string
  diasSemana: unknown
  disparoUnico: boolean
  // Opcional só por retrocompat dos ambientes falsos de teste (não implementam
  // o campo). O executor real sempre preenche a partir de campanhas.tipo — é o
  // que permite ao motor restringir efeitos (ex.: modo de teste da espera) a um
  // tipo específico de campanha sem reconsultar o banco por bloco.
  tipo?: string | null
  // Horário da agenda (Brasília). Opcional pelo mesmo motivo de `tipo`.
  horarioInicio?: unknown
  horarioFim?: unknown
}

// Leitura mínima usada pelo processador antes de qualquer ação externa. Como o
// client real usa service_role, organização e id são filtros obrigatórios.
export async function buscarControleExecucaoCampanha(
  admin: SupabaseClient,
  organizacaoId: string,
  campanhaId: string,
): Promise<ControleExecucaoCampanha | null> {
  const { data, error } = await admin
    .from('campanhas')
    .select('status, tipo, publico')
    .eq('organizacao_id', organizacaoId)
    .eq('id', campanhaId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const publico = data.publico && typeof data.publico === 'object' && !Array.isArray(data.publico)
    ? data.publico as Record<string, unknown>
    : null
  const agenda = publico?.agenda && typeof publico.agenda === 'object' && !Array.isArray(publico.agenda)
    ? publico.agenda as Record<string, unknown>
    : null
  const operacao = publico?.operacao && typeof publico.operacao === 'object' && !Array.isArray(publico.operacao)
    ? publico.operacao as Record<string, unknown>
    : null
  return {
    status: typeof data.status === 'string' ? data.status : '',
    diasSemana: agenda?.diasSemana,
    horarioInicio: agenda?.horarioInicio,
    horarioFim: agenda?.horarioFim,
    disparoUnico: operacao?.modoEnvio === 'disparo_unico'
      || campanhaEhDisparoUnico(typeof data.tipo === 'string' ? data.tipo : null),
    tipo: typeof data.tipo === 'string' ? data.tipo : null,
  }
}
