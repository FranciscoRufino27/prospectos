// Planejamento do job que atende os pedidos de carga (migration 0068). Puro:
// o script scripts/catalogo-rf-pedidos.ts lê/grava; aqui só decide.

export interface PedidoAberto {
  id: string
  organizacao_id: string
  cnaes: string[]
  status: 'pendente' | 'em_andamento'
  iniciado_em: string | null
}

export interface PlanoAtendimento {
  /** Atividades a carregar (fora do catálogo), em ordem. */
  cnaes: string[]
  /** Pedidos que esta execução assume (carga necessária). */
  aCarregar: PedidoAberto[]
  /** Pedidos já cobertos pelo catálogo: só fecham como concluídos. */
  jaAtendidos: PedidoAberto[]
  /** Em andamento há tempo demais (execução que morreu): voltam para a fila. */
  abandonados: PedidoAberto[]
}

// O workflow tem timeout de 5 h; passou disso, ninguém mais está rodando o pedido.
export const LIMITE_EM_ANDAMENTO_MS = 6 * 60 * 60 * 1000

export function planejarAtendimento(
  abertos: readonly PedidoAberto[],
  catalogoCnaes: readonly string[],
  agora: Date,
): PlanoAtendimento {
  const noCatalogo = new Set(catalogoCnaes)
  const abandonados = abertos.filter(
    (p) => p.status === 'em_andamento' && (!p.iniciado_em || agora.getTime() - Date.parse(p.iniciado_em) > LIMITE_EM_ANDAMENTO_MS),
  )
  const fila = [...abertos.filter((p) => p.status === 'pendente'), ...abandonados]
  const jaAtendidos = fila.filter((p) => p.cnaes.every((c) => noCatalogo.has(c)))
  const aCarregar = fila.filter((p) => !jaAtendidos.includes(p))
  const cnaes = [...new Set(aCarregar.flatMap((p) => p.cnaes).filter((c) => !noCatalogo.has(c)))].sort()
  return { cnaes, aCarregar, jaAtendidos, abandonados }
}
