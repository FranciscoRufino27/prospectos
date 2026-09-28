// Serviço do aviso de resposta do cliente. Regras aqui; dados no repository;
// leitura de configuração e transporte injetados (Supabase/Z-API em produção,
// fakes nos testes).
//
// Invariantes:
//   - modo ausente na organização = desligado: nada é registrado nem enviado;
//   - um aviso por (resposta, destino): a mesma resposta nunca avisa duas vezes;
//   - no máximo um aviso por lead por JANELA_ANTISPAM_MIN (cliente de WhatsApp
//     costuma mandar várias mensagens seguidas);
//   - só quem vence o compare-and-swap pendente→enviando chama o provedor;
//   - 'enviando' preso nunca é reenviado aqui (reenviar poderia duplicar);
//   - falta de configuração (Z-API, grupo, número do responsável) não consome
//     tentativa: o aviso sai quando a configuração existir (dentro da janela
//     de reprocessamento).
import { extrairTrecho, montarMensagemAviso } from './mensagem'
import type { AvisoRespostaRepository } from './repository'
import type {
  AvisoResposta, DadosAvisoResposta, DestinoAvisoResposta, EntradaAvisoResposta, EnviadorAviso, ModoAvisoResposta,
} from './types'

export const MAX_TENTATIVAS_AVISO = 5
export const JANELA_ANTISPAM_MIN = 1
// Pendência mais velha que isto não é mais tentada: aviso de ontem só atrapalha.
export const JANELA_REPROCESSAMENTO_HORAS = 24

export interface ContextoLeadAviso {
  empresa: string
  contato: string
  // id null = lead legado só com responsavel_nome: o nome vai no aviso do
  // grupo, mas não há de quem ler o WhatsApp pessoal.
  responsavel: { id: string | null; nome: string } | null
}

export interface DepsAvisoResposta {
  repo: AvisoRespostaRepository
  lerModo: (organizacaoId: string) => Promise<ModoAvisoResposta | null>
  lerGrupoId: (organizacaoId: string) => Promise<string | null>
  lerContextoLead: (organizacaoId: string, leadId: string) => Promise<ContextoLeadAviso | null>
  // Número (dígitos) do responsável (id de `usuarios`, como em
  // leads.responsavel_id), só se o perfil dele ligou os avisos; senão null.
  lerWhatsappResponsavel: (organizacaoId: string, usuarioId: string) => Promise<string | null>
  enviarIndividual: EnviadorAviso
  enviarGrupo: EnviadorAviso
  // Z-API configurada no servidor? Sem ela o aviso fica em
  // configuracao_ausente sem gastar tentativa.
  provedorConfigurado?: () => boolean
  linkLead?: (leadId: string) => string | null
  agora?: () => Date
}

export type ResultadoProcessamentoAviso =
  | { tipo: 'enviada'; aviso: AvisoResposta }
  | { tipo: 'ja_enviada'; aviso: AvisoResposta }
  | { tipo: 'falhou'; aviso: AvisoResposta; erro: string }
  | { tipo: 'configuracao_ausente'; aviso: AvisoResposta; motivo: string }
  | { tipo: 'esgotada'; aviso: AvisoResposta }
  | { tipo: 'incerta'; aviso: AvisoResposta }
  | { tipo: 'concorrente' }
  | { tipo: 'nao_encontrada' }

export type ResultadoAvisoResposta =
  | { tipo: 'desligado' }
  | { tipo: 'lead_nao_encontrado' }
  | { tipo: 'agrupado' } // já houve aviso deste lead na janela anti-spam
  | { tipo: 'sem_destino' } // ex.: só grupo, e o grupo já foi avisado pelo handoff
  | { tipo: 'processado'; resultados: ResultadoProcessamentoAviso[] }

function destinosDoModo(modo: ModoAvisoResposta): DestinoAvisoResposta[] {
  if (modo === 'ambos') return ['responsavel', 'grupo']
  return [modo]
}

/** Registra (idempotente) e tenta entregar os avisos de UMA resposta. */
export async function avisarRespostaCliente(
  deps: DepsAvisoResposta,
  entrada: EntradaAvisoResposta,
): Promise<ResultadoAvisoResposta> {
  const org = entrada.organizacaoId
  const modo = await deps.lerModo(org)
  if (!modo) return { tipo: 'desligado' }

  // Retentativa da mesma resposta: reaproveita o que já foi registrado.
  let avisos = await deps.repo.listarPorEvento(org, entrada.eventoId)
  if (avisos.length === 0) {
    const agora = (deps.agora ?? (() => new Date()))()
    const desde = new Date(agora.getTime() - JANELA_ANTISPAM_MIN * 60_000).toISOString()
    if (await deps.repo.existeDesde(org, entrada.leadId, desde)) return { tipo: 'agrupado' }

    const ctx = await deps.lerContextoLead(org, entrada.leadId)
    if (!ctx) return { tipo: 'lead_nao_encontrado' }

    const destinos = destinosDoModo(modo).filter((d) => !(d === 'grupo' && entrada.grupoJaAvisado))
    if (destinos.length === 0) return { tipo: 'sem_destino' }

    const dados: DadosAvisoResposta = {
      empresa: ctx.empresa,
      contato: ctx.contato,
      canal: entrada.canal,
      classificacao: entrada.classificacao,
      trecho: extrairTrecho(entrada.texto),
      responsavelId: ctx.responsavel?.id ?? null,
      responsavelNome: ctx.responsavel?.nome ?? '',
      link: deps.linkLead?.(entrada.leadId) ?? null,
    }
    avisos = []
    for (const destinoTipo of destinos) {
      avisos.push(await deps.repo.registrar(org, { leadId: entrada.leadId, eventoId: entrada.eventoId, destinoTipo, dados }))
    }
  }

  const resultados: ResultadoProcessamentoAviso[] = []
  for (const a of avisos) resultados.push(await processarAvisoResposta(deps, org, a.id))
  return { tipo: 'processado', resultados }
}

async function resolverDestino(deps: DepsAvisoResposta, a: AvisoResposta): Promise<{ destino: string } | { motivo: string }> {
  if (deps.provedorConfigurado && !deps.provedorConfigurado()) {
    return { motivo: 'Z-API não configurada no servidor (ZAPI_INSTANCE_ID, ZAPI_TOKEN, ZAPI_CLIENT_TOKEN).' }
  }
  if (a.destinoTipo === 'grupo') {
    const grupo = await deps.lerGrupoId(a.organizacaoId)
    return grupo ? { destino: grupo } : { motivo: 'Grupo comercial não configurado (Configurações > Processo comercial > Distribuição).' }
  }
  if (!a.dados.responsavelId) return { motivo: 'Lead sem responsável.' }
  const numero = await deps.lerWhatsappResponsavel(a.organizacaoId, a.dados.responsavelId)
  return numero ? { destino: numero } : { motivo: 'Responsável sem WhatsApp de avisos ligado (Meu perfil > Avisos no WhatsApp).' }
}

/** Tenta entregar UM aviso. Seguro para chamar várias vezes. */
export async function processarAvisoResposta(
  deps: DepsAvisoResposta,
  organizacaoId: string,
  id: string,
): Promise<ResultadoProcessamentoAviso> {
  const a = await deps.repo.buscar(organizacaoId, id)
  if (!a) return { tipo: 'nao_encontrada' }
  if (a.status === 'enviada') return { tipo: 'ja_enviada', aviso: a }
  if (a.status === 'enviando') return { tipo: 'incerta', aviso: a }
  if (a.tentativas >= MAX_TENTATIVAS_AVISO) return { tipo: 'esgotada', aviso: a }

  const alvo = await resolverDestino(deps, a)
  if ('motivo' in alvo) {
    await deps.repo.marcarConfiguracaoAusente(organizacaoId, id, alvo.motivo)
    return { tipo: 'configuracao_ausente', aviso: { ...a, status: 'configuracao_ausente' }, motivo: alvo.motivo }
  }

  const venceu = await deps.repo.reivindicarEnvio(organizacaoId, id, a.tentativas)
  if (!venceu) return { tipo: 'concorrente' }

  const mensagem = montarMensagemAviso(a.dados, a.destinoTipo)
  const enviar = a.destinoTipo === 'grupo' ? deps.enviarGrupo : deps.enviarIndividual
  let r
  try {
    r = await enviar(alvo.destino, mensagem)
  } catch (e) {
    r = { ok: false as const, codigo: 'excecao', mensagem: e instanceof Error ? e.message : String(e) }
  }
  if (r.ok) {
    await deps.repo.marcarEnviada(organizacaoId, id, { destino: alvo.destino, providerMessageId: r.providerMessageId })
    return { tipo: 'enviada', aviso: { ...a, status: 'enviada', tentativas: a.tentativas + 1 } }
  }
  await deps.repo.marcarFalha(organizacaoId, id, `${r.codigo}: ${r.mensagem}`)
  return { tipo: 'falhou', aviso: { ...a, status: 'falhou', tentativas: a.tentativas + 1 }, erro: r.mensagem }
}

/** Retoma os avisos que ficaram para trás (Z-API fora, config ausente). */
export async function reprocessarAvisosResposta(
  deps: DepsAvisoResposta,
  organizacaoId: string,
  limite = 20,
): Promise<{ tentados: number; enviados: number }> {
  const agora = (deps.agora ?? (() => new Date()))()
  const desde = new Date(agora.getTime() - JANELA_REPROCESSAMENTO_HORAS * 3_600_000).toISOString()
  const pendentes = await deps.repo.listarReprocessaveis(organizacaoId, MAX_TENTATIVAS_AVISO, desde, limite)
  let enviados = 0
  for (const a of pendentes) {
    const r = await processarAvisoResposta(deps, organizacaoId, a.id)
    if (r.tipo === 'enviada') enviados++
  }
  return { tentados: pendentes.length, enviados }
}
