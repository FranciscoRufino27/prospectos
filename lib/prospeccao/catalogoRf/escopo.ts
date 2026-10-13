// Escopo da carga do catálogo: a união dos perfis de busca e dos nichos
// criados de todas as organizações. O catálogo é global, então carrega o que ALGUMA org pediu —
// a busca de cada org filtra depois pelo próprio perfil.

import { parseWorkspaceConfig } from '@/lib/config/workspaceConfig'

export interface EscopoCarga {
  cnaes: string[]
  cnaesSecundarios: string[]
  organizacoes: number
}

export function escopoDosPerfis(configuracoes: unknown[]): EscopoCarga {
  const cnaes = new Set<string>()
  const secundarios = new Set<string>()
  let organizacoes = 0
  for (const bruto of configuracoes) {
    const config = parseWorkspaceConfig(bruto)
    const perfil = config.prospeccao
    // Nichos criados pela org entram mesmo fora do perfil: a carga mensal
    // mantém atualizado o que a tela oferece (e o pedido de carga já trouxe).
    const dosNichos = (config.prospeccaoNichos ?? []).flatMap((n) => n.cnaes)
    if (!perfil?.cnaes?.length && !dosNichos.length) continue
    organizacoes++
    for (const c of perfil?.cnaes ?? []) {
      cnaes.add(c)
      if (perfil?.incluirCnaesSecundarios) secundarios.add(c)
    }
    for (const c of dosNichos) cnaes.add(c)
  }
  return { cnaes: [...cnaes].sort(), cnaesSecundarios: [...secundarios].sort(), organizacoes }
}
