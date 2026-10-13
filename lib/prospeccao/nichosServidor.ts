// Leitura/escrita dos nichos da organização e do estado de carga deles.
// `org` vem SEMPRE da sessão; a gravação passa por mesclarWorkspaceConfig.
import type { SupabaseClient } from '@supabase/supabase-js'
import { mesclarWorkspaceConfig, type NichoPersonalizado, type WorkspaceConfig } from '@/lib/config/workspaceConfig'
import { statusCatalogo } from './buscaServidor'
import { pedidosDaOrg, type PedidoCarga } from './catalogoRf/pedidos'
import type { Nicho } from './nichos'
import { paraNicho } from './nichosPersonalizados'
import { descricaoCnae, descricoesCnae } from './referenciaIbge'

export interface RespostaNichos {
  nichos: Nicho[]
  /** Atividades já carregadas no catálogo (união das cargas concluídas). */
  catalogoCnaes: string[]
  pedidos: PedidoCarga[]
  podeEditar: boolean
  /** Nome IBGE das atividades dos pedidos (a tela não tem a tabela inteira). */
  nomesAtividades: Record<string, string>
}

export async function gravarNichos(
  admin: SupabaseClient,
  org: string,
  atual: WorkspaceConfig,
  lista: NichoPersonalizado[],
  /** Atividades a tirar do perfil salvo (as do nicho excluído). */
  tirarDoPerfil: readonly string[] = [],
): Promise<NichoPersonalizado[]> {
  const perfil = atual.prospeccao
  const tirar = new Set(tirarDoPerfil)
  const mudaPerfil = !!perfil?.cnaes?.some((c) => tirar.has(c))
  const novo = mesclarWorkspaceConfig(atual, {
    prospeccaoNichos: lista,
    ...(mudaPerfil ? { prospeccao: { ...perfil, cnaes: perfil!.cnaes!.filter((c) => !tirar.has(c)) } } : {}),
  })
  const { error } = await admin.from('organizacoes').update({ configuracoes: novo }).eq('id', org)
  if (error) throw new Error(`Falha ao salvar os nichos: ${error.message}`)
  return novo.prospeccaoNichos ?? []
}

export async function respostaNichos(
  admin: SupabaseClient,
  org: string,
  lista: readonly NichoPersonalizado[],
  podeEditar: boolean,
): Promise<RespostaNichos> {
  const [catalogo, pedidos] = await Promise.all([statusCatalogo(admin), pedidosDaOrg(admin, org)])
  return {
    nichos: lista.map((n) => paraNicho(n, descricaoCnae)),
    catalogoCnaes: catalogo?.cnaes ?? [],
    pedidos,
    podeEditar,
    nomesAtividades: descricoesCnae(pedidos.flatMap((p) => p.cnaes)),
  }
}
