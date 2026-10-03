// Busca com decisor: percorre a fonte (catálogo da Receita por nota, ou a
// Crustdata lá fora) e resolve o decisor empresa a empresa até juntar `meta`
// empresas completas (decisor + e-mail válido dele). Com `aceitaIncompletas`
// ("decisor obrigatório" desligado), empresa sem decisor/e-mail também entra
// na lista e conta para a meta. Pura e sem rede: a tela injeta a paginação e
// a resolução.
//
// Regras de custo:
//   - empresa já na base ou sem domínio próprio é pulada sem chamar nada;
//   - nunca há mais resoluções em andamento do que faltam para a meta;
//   - no máximo `teto` resoluções por busca, completas ou não;
//   - falha fatal (sem crédito, chave ausente, limite) para tudo na hora.

import type { MotivoIncompleto } from './decisorAutomatico'

export interface CandidatoComDecisor {
  /** Só o catálogo da Receita sabe; ausente = não está na base. */
  ja_na_base?: boolean
  dominio: unknown | null
}

const MOTIVOS_INCOMPLETA: ReadonlySet<MotivoPulo> = new Set<MotivoIncompleto>(['sem_dominio', 'sem_socio', 'sem_decisor', 'sem_email'])

/** O desfecho põe a empresa na lista? Completa sempre; incompleta só se aceita. */
export function entraNaLista<C>(d: Exclude<Desfecho<C>, { tipo: 'falha' }>, aceitaIncompletas: boolean): boolean {
  return d.tipo === 'completo' || (aceitaIncompletas && MOTIVOS_INCOMPLETA.has(d.motivo))
}

export type MotivoPulo = MotivoIncompleto | 'ja_na_base' | 'erro'

/** Por que a empresa ficou sem decisor/e-mail (ou fora da lista). */
export const ROTULO_PULO: Record<MotivoPulo, string> = {
  sem_dominio: 'sem domínio próprio da empresa',
  sem_socio: 'sem sócio pessoa física na Receita',
  sem_decisor: 'ninguém com cargo-alvo encontrado',
  sem_email: 'e-mail do decisor não encontrado',
  ja_na_base: 'já na base',
  erro: 'falha na consulta',
}

export type Desfecho<C> =
  | { tipo: 'completo'; dados: C }
  | { tipo: 'pulado'; motivo: MotivoPulo; erro?: string }
  | { tipo: 'falha'; erro: string; fatal: boolean }

export type MotivoParada = 'meta' | 'teto' | 'fim' | 'cancelado' | 'falha'

export interface OpcoesBuscaComDecisor<T extends CandidatoComDecisor, C> {
  meta: number
  teto: number
  concorrencia: number
  /** "Decisor obrigatório" desligado: incompleta também entra e conta na meta. */
  aceitaIncompletas?: boolean
  proximaPagina(): Promise<{ itens: T[]; fim: boolean }>
  resolver(item: T): Promise<Desfecho<C>>
  /** Cada empresa resolvida ou pulada, na ordem em que termina. */
  aoDesfecho(item: T, desfecho: Exclude<Desfecho<C>, { tipo: 'falha' }>): void
  aoProgresso?(p: { completos: number; tentativas: number }): void
  cancelado(): boolean
}

export interface ResumoBuscaComDecisor {
  /** Empresas que entraram na lista (completas, ou também incompletas se aceitas). */
  completos: number
  tentativas: number
  parada: MotivoParada
  erro: string | null
}

export async function buscarComDecisor<T extends CandidatoComDecisor, C>(o: OpcoesBuscaComDecisor<T, C>): Promise<ResumoBuscaComDecisor> {
  const fila: T[] = []
  let fimDoCatalogo = false
  let pagina: Promise<void> | null = null
  let completos = 0
  let tentativas = 0
  let emAndamento = 0
  let parada: MotivoParada | null = null
  let erro: string | null = null
  // Quem espera vaga (meta "reservada" por resoluções em andamento) acorda
  // quando uma delas termina: se ficou incompleta, a vaga volta.
  let acordar: (() => void)[] = []
  const aceita = o.aceitaIncompletas === true
  // Pulada sem custo (já na base / sem domínio): conta na meta se entrar na lista.
  const registrar = (item: T, d: Exclude<Desfecho<C>, { tipo: 'falha' }>) => {
    if (entraNaLista(d, aceita)) completos++
    o.aoDesfecho(item, d)
  }
  const liberar = () => { const a = acordar; acordar = []; a.forEach((f) => f()) }

  function parar(motivo: MotivoParada, mensagem: string | null = null) {
    if (!parada) { parada = motivo; erro = mensagem }
    liberar()
  }

  /** Próximo candidato que vale consultar; null = catálogo acabou. */
  async function proximo(): Promise<T | null> {
    for (;;) {
      if (parada) return null
      const item = fila.shift()
      if (item) {
        if (item.ja_na_base) { registrar(item, { tipo: 'pulado', motivo: 'ja_na_base' }); continue }
        if (!item.dominio) {
          // Meta já cheia: não entra mais ninguém, nem a sem custo.
          if (aceita && completos + emAndamento >= o.meta) { fila.unshift(item); return null }
          registrar(item, { tipo: 'pulado', motivo: 'sem_dominio' })
          continue
        }
        return item
      }
      if (fimDoCatalogo) return null
      pagina ??= o.proximaPagina()
        .then((p) => { fila.push(...p.itens); fimDoCatalogo = p.fim || p.itens.length === 0 })
        .finally(() => { pagina = null })
      await pagina
    }
  }

  async function trabalhador() {
    for (;;) {
      if (o.cancelado()) parar('cancelado')
      if (parada) return
      if (completos >= o.meta) return parar('meta')
      if (completos + emAndamento >= o.meta) {
        await new Promise<void>((r) => acordar.push(r))
        continue
      }
      if (tentativas >= o.teto) {
        if (emAndamento === 0) return parar('teto')
        await new Promise<void>((r) => acordar.push(r))
        continue
      }
      let item: T | null
      try {
        item = await proximo()
      } catch (e) {
        return parar('falha', e instanceof Error ? e.message : 'Falha na busca.')
      }
      if (!item) {
        if (emAndamento === 0 && !parada) parar(completos >= o.meta ? 'meta' : 'fim')
        // Ainda há resoluções em andamento: elas decidem a parada.
        if (!parada) await new Promise<void>((r) => acordar.push(r))
        if (parada) return
        continue
      }
      // Enquanto a página carregava, outro trabalhador pode ter parado a busca
      // ou ocupado a última vaga: devolve o item e reavalia.
      if (parada || o.cancelado() || completos + emAndamento >= o.meta || tentativas >= o.teto) {
        fila.unshift(item)
        continue
      }

      emAndamento++
      tentativas++
      let desfecho: Desfecho<C>
      try {
        desfecho = await o.resolver(item)
      } catch (e) {
        desfecho = { tipo: 'falha', erro: e instanceof Error ? e.message : 'Falha ao buscar o decisor.', fatal: false }
      }
      emAndamento--
      if (o.cancelado()) { parar('cancelado'); return }
      if (desfecho.tipo === 'falha') {
        if (desfecho.fatal) { parar('falha', desfecho.erro); return }
        o.aoDesfecho(item, { tipo: 'pulado', motivo: 'erro', erro: desfecho.erro })
      } else {
        registrar(item, desfecho)
      }
      o.aoProgresso?.({ completos, tentativas })
      liberar()
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, Math.min(o.concorrencia, o.meta)) }, trabalhador))
  return { completos, tentativas, parada: parada ?? (completos >= o.meta ? 'meta' : 'fim'), erro }
}
