// FLUXO 2 — DETECTAR RESPOSTA
// Lê a caixa do Gmail. Quando um lead responde DE VERDADE:
//  - ignora auto-respostas (férias, fora do escritório, devolvido/bounce)
//  - casa a mensagem ao lead por e-mail EXATO ou por DOMÍNIO (encaminhamento)
//  - ENCERRA a cadência do lead (sai da esteira de follow-up) — para TODA
//    resposta humana, qualquer que seja a classificação
//  - resposta de PROSPECÇÃO é classificada (Fase 2 do handoff comercial):
//      positivo      → 'interessado' + handoff (lib/comercial) + Fluxo 3
//      negativo      → 'perdido' (sem handoff, sem closer)
//      neutro/indet. → 'respondeu' (pendente de tratamento; sem handoff, sem closer)
//    Sem os hooks (scripts locais/testes antigos) toda resposta vale como interesse.
//  - avisa a equipe no WhatsApp (responsável/grupo, conforme a org) de TODA
//    resposta humana registrada — lib/comercial/avisosResposta
// Quando um BOUNCE SMTP é detectado (migration 0027):
//  - marca o lead como bounced=true
//  - cancela todas as workflow_execucoes ativas do lead
import { OWNER_ENGINE } from '../config'
import { log } from '../logger'
import { ESTAGIOS_EM_CADENCIA, dominioDoLead } from '../templates'
import { calcularScore, horasEntre } from '../scoring'
import type { EmailProvider } from '../email/provider'
import type { Store } from '../store/store'
import type { Queue } from '../queue'
import type { ContextoCampanhaResposta, MensagemRecebida, Lead, UsuarioBasico } from '../types'
import type { RespostaParaClassificar, ResultadoClassificacao } from '@/lib/comercial/respostas/classificarResposta'
import type { EntradaGatilhoProspeccao, ResultadoGatilhoProspeccao } from '@/lib/comercial/handoff/gatilhoProspeccao'
import type { ClassificacaoAviso, EntradaAvisoResposta } from '@/lib/comercial/avisosResposta/types'
import { ehCicloDeRetornoHandoff } from '@/lib/comercial/followup/retornoFollowup'

// Heurística de auto-resposta: além da dica do provedor (msg.automatica),
// reconhece os padrões clássicos de férias/ausência/devolução.
const PADROES_AUTO = [
  'fora do escrit', 'out of office', 'automatic reply', 'auto-reply', 'autoreply',
  'resposta autom', 'de férias', 'em férias', 'estou ausente', 'ausência do escrit',
  'delivery status notification', 'mail delivery', 'returned mail', 'undeliverable',
  'não foi possível entregar', 'devolvido', 'mailer-daemon', 'postmaster',
]

// Padrões que indicam especificamente BOUNCE SMTP (falha de entrega permanente).
// Subconjunto de PADROES_AUTO: toda bounce é auto-resposta, mas não o contrário.
// Remetente mailer-daemon/postmaster OU assunto com padrões canônicos de bounce.
const PADROES_BOUNCE_REMETENTE = ['mailer-daemon@', 'postmaster@']
const PADROES_BOUNCE_ASSUNTO = [
  'undeliverable', 'delivery status notification', 'mail delivery failed',
  'returned mail', 'delivery failure', 'não foi possível entregar',
  'failure notice', 'message not delivered',
]

export function ehAutoResposta(msg: MensagemRecebida): boolean {
  if (msg.automatica) return true
  const alvo = `${msg.assunto}\n${msg.corpo}\n${msg.de}`.toLowerCase()
  return PADROES_AUTO.some((p) => alvo.includes(p))
}

// Bounce SMTP: falha permanente de entrega — o email não existe ou o servidor
// rejeitou definitivamente. Distingue de auto-reply de ausência (recuperável).
export function ehBounce(msg: MensagemRecebida): boolean {
  const de = msg.de.toLowerCase()
  if (PADROES_BOUNCE_REMETENTE.some((p) => de.includes(p))) return true
  const assunto = msg.assunto.toLowerCase()
  return PADROES_BOUNCE_ASSUNTO.some((p) => assunto.includes(p))
}

// Prefixo-marcador da nota de sugestão (item 7). O LeadPanel reconhece este
// início para destacar a interação como "Contato alternativo sugerido".
export const MARCADOR_CONTATO_ALT = 'Contato alternativo sugerido (ausência):'

// Contato alternativo extraído de um auto-reply de férias/ausência.
export interface ContatoAlternativoExtraido {
  nome: string
  email: string
}

export interface DetectarRespostaOpts {
  // Extrator de contato alternativo (item 7). Injetado nos pontos de produção
  // (usa IA); ausente nos testes/ensaio, quando a extração é simplesmente pulada.
  extrairContatos?: (corpo: string) => Promise<ContatoAlternativoExtraido[]>
  // Orquestradores reais adiam o \Seen até a notificação ao responsável
  // terminar. Chamadas isoladas preservam o comportamento auto-contido.
  adiarConfirmacaoLeitura?: boolean
  // HANDOFF COMERCIAL (Fase 2). Os dois juntos ligam o gatilho: a resposta de
  // PROSPECÇÃO é classificada e, só quando POSITIVA, o lead é entregue ao
  // comercial (lib/comercial/handoff) e o grupo é avisado. Ausentes (testes,
  // scripts locais) → o motor se comporta como antes: pausa e avisa o closer.
  classificarResposta?: (resposta: RespostaParaClassificar) => Promise<ResultadoClassificacao>
  handoffProspeccao?: (entrada: EntradaGatilhoProspeccao) => Promise<ResultadoGatilhoProspeccao>
  // AVISO DE RESPOSTA (migration 0053): avisa o responsável/grupo no WhatsApp
  // de QUALQUER resposta humana registrada. Best-effort — falhar aqui nunca
  // interrompe a detecção (a resposta já está persistida).
  avisarResposta?: (entrada: EntradaAvisoResposta) => Promise<unknown>
}

// Chama o aviso sem deixar a falha escapar: o aviso é efeito secundário e
// tem outbox próprio para reprocessar.
async function avisarRespostaSemFalhar(opts: DetectarRespostaOpts, entrada: EntradaAvisoResposta): Promise<void> {
  if (!opts.avisarResposta || !entrada.organizacaoId) return
  try {
    await opts.avisarResposta(entrada)
  } catch (e) {
    log.aviso('Falha ao avisar a resposta no WhatsApp da equipe.', {
      leadId: entrada.leadId, erro: e instanceof Error ? e.message : String(e),
    })
  }
}

// Campanha que escolheu o aviso de resposta (publico.operacao.resposta.aviso):
// os destinos de WhatsApp dela (responsável e/ou grupo) valem no lugar da
// regra da organização. "Responsável" é a MESMA pessoa do e-mail de retorno
// (Fluxo 3): no modo carteira o dono do lead (o responsável da campanha só
// quando o lead não tem dono); fora dele, o responsável da campanha. Com
// handoff, o sorteado já está gravado no lead e prevalece. Campanha antiga
// (sem a escolha) não muda nada: só a regra da organização vale.
export function avisoPedidoPelaCampanha(
  contextoCampanha: ContextoCampanhaResposta | null,
  lead: Pick<Lead, 'responsavel_id'>,
  responsavelHandoff: UsuarioBasico | null,
): Pick<EntradaAvisoResposta, 'destinosCampanha' | 'responsavelPerfil' | 'grupoIdCampanha'> {
  const aviso = contextoCampanha?.avisoRetorno
  if (!contextoCampanha || !aviso) return {}
  const daCampanha = contextoCampanha.responsavel
    ? { id: contextoCampanha.responsavel.id, nome: contextoCampanha.responsavel.nome }
    : null
  const usarDaCampanha = !responsavelHandoff
    && (!contextoCampanha.retornoParaResponsavelDoLead || !lead.responsavel_id)
  return {
    destinosCampanha: [...aviso.whatsapp],
    responsavelPerfil: usarDaCampanha ? daCampanha : null,
    grupoIdCampanha: aviso.grupoWhatsappId ?? null,
  }
}

// Origem da resposta é PROSPECÇÃO (entra no handoff)? Usa o contexto REAL da
// execução, e o contexto de CAMPANHA tem precedência sobre o estágio: um lead
// importado só para follow-up pode estar num estágio de cadência e ainda assim
// pertencer a uma campanha 'followup' — e esse NUNCA entra no handoff.
//   campanha de prospecção            → sim
//   execução de RETORNO do handoff    → sim (ciclo 'handoff_retorno:…', Fase 4)
//   outra campanha (followup importado, reativação, renovação, comunicado) → não
//   sem campanha: cadência legada do motor é prospecção por construção;
//   `foraDaCadenciaLegada` = retomada de aviso pendente OU lead pendente de
//   tratamento, que sem campanha só chegam aqui pela cadência legada.
export function respostaVemDeProspeccao(
  emCadencia: boolean,
  contextoCampanha: ContextoCampanhaResposta | null,
  foraDaCadenciaLegada: boolean,
): boolean {
  if (contextoCampanha) return contextoCampanha.tipo === 'prospeccao' || ehCicloDeRetornoHandoff(contextoCampanha.cicloChave)
  if (emCadencia) return true
  return foraDaCadenciaLegada
}

// "primeiro contato" / "follow-up N" / 'campanha "X"' — texto do aviso ao grupo.
export function descreverEtapaCadencia(
  followupsEnviados: number,
  contextoCampanha: ContextoCampanhaResposta | null,
  emCadencia: boolean,
): string {
  if (contextoCampanha && ehCicloDeRetornoHandoff(contextoCampanha.cicloChave)) return 'follow-up de retorno'
  if (contextoCampanha && !emCadencia) return `campanha "${contextoCampanha.nome}"`
  return followupsEnviados <= 0 ? 'primeiro contato' : `follow-up ${followupsEnviados}`
}

// Estados EXISTENTES usados conforme a classificação da resposta (nenhum novo):
//   'interessado' — positivo (rótulo "Respondeu"; catálogo "Interessado")
//   'perdido'     — negativo, com a flag/motivo do "Marcar como perdido"
//   'respondeu'   — neutro/indeterminado: resposta recebida, pendente de
//                   tratamento humano (rótulo "Respondeu"; catálogo "Respondeu")
export const ESTAGIO_RESPONDEU_PENDENTE = 'respondeu'
export const MOTIVO_PERDIDO_RESPOSTA_NEGATIVA = 'resposta negativa (classificação automática)'

function descreverRespostaSemInteresse(c: ResultadoClassificacao): string {
  switch (c.classificacao) {
    case 'negativo':
      return 'Resposta negativa (classificação automática): cadência encerrada e lead marcado como perdido. Sem handoff comercial.'
    case 'neutro':
      return 'Resposta recebida sem sinal claro de interesse (classificação automática): cadência encerrada; pendente de tratamento humano. Sem handoff comercial.'
    default:
      return `Resposta recebida, mas não foi possível classificar automaticamente (${c.motivo ?? 'sem motivo'}): cadência encerrada; revisar manualmente e decidir o handoff comercial.`
  }
}

function descreverResultadoHandoff(r: ResultadoGatilhoProspeccao, etapa: string): string | null {
  const aviso = (() => {
    const n = r.notificacao
    if (!n) return ''
    if (n.tipo === 'enviada' || n.tipo === 'ja_enviada') return ' Aviso ao grupo comercial enviado.'
    if (n.tipo === 'configuracao_ausente') return ' Aviso ao grupo pendente: grupo de avisos não configurado.'
    if (n.tipo === 'falhou') return ` Aviso ao grupo pendente (falhou: ${n.erro}).`
    return ' Aviso ao grupo pendente.'
  })()
  switch (r.handoff.tipo) {
    case 'atribuido':
      return r.handoff.motivo === 'reativacao'
        ? `Handoff comercial: lead voltou a responder (${etapa}) e retorna ao mesmo responsável, ${r.handoff.responsavel.nome}.${aviso}`
        : `Handoff comercial: lead direcionado a ${r.handoff.responsavel.nome} pelo rodízio (respondeu ao ${etapa}).${aviso}`
    case 'aguardando_distribuicao':
      return `Handoff comercial: nenhum comercial participa do rodízio — lead aguardando distribuição (respondeu ao ${etapa}).`
    default:
      return null
  }
}

export async function detectarResposta(
  store: Store,
  email: EmailProvider,
  fila: Queue,
  opts: DetectarRespostaOpts = {},
): Promise<{ respostas: number; ignoradas: number; contatosAlternativos: number; bounces: number }> {
  const mensagens = await email.lerCaixaEntrada()
  if (mensagens.length === 0) {
    log.info('Caixa de entrada: nenhuma mensagem nova.')
    return { respostas: 0, ignoradas: 0, contatosAlternativos: 0, bounces: 0 }
  }

  // Um encaminhamento ao closer por lead POR PASSADA. Sem isto, várias
  // mensagens antigas distintas do mesmo lead no mesmo lote viram várias
  // notificações — foi assim que o responsável recebeu 15 avisos do mesmo
  // contato em 07/09/2026. As respostas seguem todas registradas no histórico;
  // o que deduplicamos é só o aviso. A primeira do lote é a que notifica.
  const closerEnfileirado = new Set<string>()
  let respostas = 0
  let ignoradas = 0
  let contatosAlternativos = 0
  let bounces = 0

  for (const msg of mensagens) {
    // IDEMPOTÊNCIA POR MENSAGEM (migration 0030). A caixa é varrida por
    // janela de dias e sem depender do Seen, então a mesma mensagem volta em
    // toda passada do monitor. Reivindicar antes de qualquer efeito é o que
    // impede reprocessar o passado: bounce regravado, resposta antiga tratada
    // como nova e notificação repetida ao closer nasciam todos daqui.
    const chaveMensagem = msg.mensagemId ?? msg.idRecebimento ?? ''
    if (chaveMensagem) {
      const primeiraVez = await store.reivindicarMensagem(chaveMensagem)
      if (!primeiraVez) {
        log.info('Mensagem já processada numa passada anterior. Ignorada.', { de: msg.de })
        ignoradas++
        continue
      }
    }

    try {
      // 1) Auto-resposta: verifica se é bounce antes de tratar como férias/ausência.
      if (ehAutoResposta(msg)) {
        if (ehBounce(msg)) {
          // Bounce SMTP: marcar lead, cancelar cadência, registrar nota.
          const bouncou = await tratarBounce(store, msg)
          if (bouncou) bounces++
          else log.aviso('Bounce não casou com nenhum lead. Ignorado.', { de: msg.de })
          ignoradas++
          continue
        }
        // Auto-reply de ausência: tentar extrair contato alternativo.
        const sugeriu = await tratarAutoResposta(store, msg, opts)
        if (sugeriu) contatosAlternativos++
        else log.aviso('Ignorado (auto-resposta).', { de: msg.de, assunto: msg.assunto })
        ignoradas++
        continue
      }

      // 2) Casar com um lead: primeiro pelo e-mail exato; senão pelo domínio.
      const lead = await casarLead(store, msg.de)
      if (!lead) {
        log.aviso('Resposta não casa com nenhum lead do motor. Ignorada.', { de: msg.de })
        ignoradas++
        continue
      }

      // 3) Resolve o contexto antes do gate de estágio. Campanhas de comunicado
      // podem enviar sem mover o lead para a cadência tradicional; ainda assim a
      // resposta precisa ser reconhecida e encaminhada ao responsável escolhido.
      let responsavelCampanha: UsuarioBasico | null = null
      let contextoCampanha: ContextoCampanhaResposta | null = null
      try {
        if (store.buscarContextoCampanhaAtiva) {
          contextoCampanha = await store.buscarContextoCampanhaAtiva(lead.id)
          responsavelCampanha = contextoCampanha?.responsavel ?? null
        } else {
          responsavelCampanha = store.buscarResponsavelCampanhaAtiva
            ? await store.buscarResponsavelCampanhaAtiva(lead.id)
            : null
        }
      } catch (e) {
        log.aviso('Não foi possível resolver o responsável da campanha; usando o responsável do lead.', {
          leadId: lead.id,
          erro: e instanceof Error ? e.message : String(e),
        })
      }

      // 3.1) Gate de DATA. A busca varre uma janela de dias e não depende da flag
      // \Seen, então mensagens antigas voltam em toda passada. Sem este gate, uma
      // resposta de semanas atrás é reprocessada como se fosse nova: numa campanha
      // recém-iniciada o contador de "já respondeu neste ciclo" começa zerado, o
      // lead é encaminhado ao closer de novo e a execução pendente é cancelada
      // ANTES do e-mail sair — foi o que barrou 2 dos 5 envios em 05/09/2026.
      //
      // Regra: uma resposta não pode ser anterior ao que ela responde. A
      // referência é o início do ciclo da campanha e, fora dela, o último contato
      // enviado ao lead. Sem nenhuma das duas não há o que comparar, e aí seguimos
      // processando — perder resposta legítima é pior que reprocessar.
      const inicioDoCiclo = contextoCampanha?.iniciadoEm ?? lead.ultimo_contato ?? null
      if (inicioDoCiclo && msg.em) {
        const chegada = new Date(msg.em).getTime()
        const referencia = new Date(inicioDoCiclo).getTime()
        if (Number.isFinite(chegada) && Number.isFinite(referencia) && chegada < referencia) {
          log.info('Mensagem anterior ao início do ciclo — não é resposta a ele. Ignorada.', {
            leadId: lead.id,
            mensagemEm: new Date(msg.em).toISOString(),
            cicloDesde: new Date(inicioDoCiclo).toISOString(),
          })
          ignoradas++
          continue
        }
      }

      // 4) Idempotência: uma tentativa anterior pode já ter persistido a resposta
      // e ainda estar aguardando a notificação ao closer. Fora da cadência, só
      // aceitamos um lead ligado a campanha e sem resposta já registrada — ou um
      // lead PENDENTE DE TRATAMENTO (estagio='respondeu': resposta anterior
      // neutra/indeterminada), cuja nova resposta pode ser reclassificada.
      const retomandoEncaminhamento = lead.proxima_acao === 'aguardando_closer'
      const emCadencia = ESTAGIOS_EM_CADENCIA.includes(lead.estagio as never)
      const pendenteDeTratamento = lead.estagio === ESTAGIO_RESPONDEU_PENDENTE
      const respostasNesteCiclo = contextoCampanha?.iniciadoEm
        ? await store.contarInteracoesDesde(lead.id, 'resposta', contextoCampanha.iniciadoEm)
        : await store.contarInteracoes(lead.id, 'resposta')
      const respostaCampanhaPendente = !emCadencia
        && !retomandoEncaminhamento
        && !!contextoCampanha
        && respostasNesteCiclo === 0
      if (!emCadencia && !retomandoEncaminhamento && !respostaCampanhaPendente && !pendenteDeTratamento) {
        log.info('Lead já havia respondido/saído da esteira. Sem nova ação.', {
          leadId: lead.id,
          estagio: lead.estagio,
        })
        ignoradas++
        continue
      }

      // 5) Resposta real → registrar e CLASSIFICAR antes de mover o estágio.
      // Registra antes de mudar o estágio: se a persistência falhar, a mensagem
      // continua não lida e uma nova tentativa não perde o conteúdo da resposta.
      if (!retomandoEncaminhamento) {
        await store.registrarInteracao({
          lead_id: lead.id,
          tipo: 'resposta',
          canal: 'email',
          descricao: msg.corpo.slice(0, 2000),
          origem_acao: 'ia',
          responsavel_id: lead.responsavel_id ?? null,
        })
      }

      // Classificação (Fase 2) só para resposta de PROSPECÇÃO com o
      // classificador ligado. Fora disso (renovação/comunicado, scripts sem
      // hooks) vale a semântica antiga: toda resposta humana é tratada como
      // interesse. No retry (proxima_acao='aguardando_closer') a decisão
      // anterior já foi "positivo" — não reclassifica (a IA poderia divergir e
      // mover o lead).
      //
      // NÃO depende de `handoffProspeccao`: com o rodízio desligado o motor
      // continua separando positivo/negativo/neutro — quem some é só a
      // distribuição automática, não a leitura da resposta.
      const deProspeccao = respostaVemDeProspeccao(emCadencia, contextoCampanha, retomandoEncaminhamento || pendenteDeTratamento)
      let classificacao: ResultadoClassificacao = { classificacao: 'positivo', via: 'regra', motivo: 'sem classificador' }
      let classificou = false
      if (opts.classificarResposta && deProspeccao && !retomandoEncaminhamento) {
        classificacao = await opts.classificarResposta({ assunto: msg.assunto, corpo: msg.corpo })
        classificou = true
      }
      const positiva = classificacao.classificacao === 'positivo'
      // Identidade estável desta resposta (handoff e aviso são idempotentes por ela).
      const eventoResposta = chaveMensagem
        ? `email:${chaveMensagem}`
        : `email:${lead.id}:${new Date(msg.em).toISOString()}`
      // O aviso só diz a classificação quando ela foi de fato feita agora — o
      // "positivo" padrão de quem não classifica não é leitura da resposta.
      const avisoDaResposta = (grupoJaAvisado: boolean, responsavelHandoff: UsuarioBasico | null = null): EntradaAvisoResposta => ({
        organizacaoId: store.organizacaoId ?? '',
        leadId: lead.id,
        eventoId: eventoResposta,
        canal: 'email',
        classificacao: classificou ? (classificacao.classificacao as ClassificacaoAviso) : null,
        texto: msg.corpo,
        grupoJaAvisado,
        ...avisoPedidoPelaCampanha(contextoCampanha, lead, responsavelHandoff),
      })

      // Estado do lead conforme a classificação — SEMPRE fora da cadência:
      //   positivo      → 'interessado' + aguardando_closer (Fluxo 3 + handoff)
      //   negativo      → 'perdido' (+ flag/motivo, como o "Marcar como perdido")
      //   neutro/indet. → 'respondeu' (resposta recebida, pendente de tratamento)
      if (!retomandoEncaminhamento) {
        const horas = horasEntre(lead.ultimo_contato, msg.em)
        const score = calcularScore({ respondeu: true, horasAteResposta: horas })
        if (positiva) {
          await store.atualizarLead(lead.id, {
            estagio: 'interessado', proxima_acao: 'aguardando_closer', proxima_acao_data: null, score,
          })
        } else if (classificacao.classificacao === 'negativo') {
          await store.atualizarLead(lead.id, {
            estagio: 'perdido', perdido: true, perdido_motivo: MOTIVO_PERDIDO_RESPOSTA_NEGATIVA,
            proxima_acao: null, proxima_acao_data: null,
          })
        } else {
          await store.atualizarLead(lead.id, {
            estagio: ESTAGIO_RESPONDEU_PENDENTE, proxima_acao: null, proxima_acao_data: null, score,
          })
        }
        respostas++
      } else {
        log.info('Retomando notificação pendente ao closer.', { leadId: lead.id })
      }
      // O estágio tira o lead da cadência legada; o cancelamento explícito faz o
      // mesmo para workflows persistentes. Também é repetido no retry, pois é
      // idempotente e pode ter sido o ponto da falha anterior. Vale para TODA
      // resposta humana: não fazer handoff nunca significa continuar a cadência.
      await store.cancelarExecucoesWorkflow(lead.id)
      log.ok('RESPOSTA detectada — cadência encerrada.', {
        leadId: lead.id,
        empresa: lead.empresa,
        classificacao: classificacao.classificacao,
      })

      if (!positiva) {
        // Negativo/neutro/indeterminado: histórico preservado (interação +
        // nota), mas NÃO é oportunidade — sem handoff, sem rodízio, sem
        // Fluxo 3. Só o aviso de resposta (se a org ligou) sai.
        await store.registrarInteracao({
          lead_id: lead.id, tipo: 'nota', canal: 'sistema', origem_acao: 'ia',
          descricao: descreverRespostaSemInteresse(classificacao),
          responsavel_id: lead.responsavel_id ?? null,
        })
        log.info('Resposta de prospecção sem interesse positivo — sem handoff nem closer.', {
          leadId: lead.id, classificacao: classificacao.classificacao, via: classificacao.via,
        })
        // O responsável é avisado mesmo assim (se a org ligou o aviso): quem
        // decide o que fazer com a resposta é ele.
        await avisarRespostaSemFalhar(opts, avisoDaResposta(false))
        continue
      }

      // 5.1) HANDOFF COMERCIAL (Fase 2) — só resposta POSITIVA de PROSPECÇÃO.
      // Roda DEPOIS de a cadência estar encerrada e ANTES de qualquer aviso:
      // o handoff no banco é a fonte da verdade; o aviso ao grupo é efeito
      // recuperável (outbox). No retry (mensagem liberada), repete idempotente
      // pelo eventoId = identidade estável da mensagem.
      let responsavelHandoff: UsuarioBasico | null = null
      if (opts.handoffProspeccao && deProspeccao) {
        const eventoId = eventoResposta
        const etapa = descreverEtapaCadencia(
          await store.contarInteracoes(lead.id, 'follow_up'), contextoCampanha, emCadencia,
        )
        const r = await opts.handoffProspeccao({
          organizacaoId: store.organizacaoId ?? '',
          leadId: lead.id,
          eventoId,
          empresa: lead.empresa ?? '',
          contatoNome: lead.contato_nome ?? '',
          etapaCadencia: etapa,
        })
        if (r.responsavel?.email) {
          responsavelHandoff = { id: r.responsavel.id, nome: r.responsavel.nome, email: r.responsavel.email }
        }
        const nota = descreverResultadoHandoff(r, etapa)
        if (nota) {
          await store.registrarInteracao({
            lead_id: lead.id, tipo: 'nota', canal: 'sistema', descricao: nota, origem_acao: 'ia',
            responsavel_id: r.responsavel?.id ?? lead.responsavel_id ?? null,
          })
        }
        if (r.handoff.tipo === 'conflito_concorrencia') {
          log.erro('Handoff comercial não confirmou por concorrência persistente.', { leadId: lead.id, eventoId })
        } else {
          log.ok('Handoff comercial processado.', {
            leadId: lead.id, resultado: r.handoff.tipo, notificacao: r.notificacao?.tipo ?? null,
          })
        }
      }

      // 5.2) Aviso no WhatsApp da equipe. Depois do handoff, para já nomear o
      // responsável sorteado. Com handoff, o grupo já recebeu o aviso dele.
      await avisarRespostaSemFalhar(opts, avisoDaResposta(!!opts.handoffProspeccao && deProspeccao, responsavelHandoff))

      // 6) Enfileirar o Fluxo 3 (direcionar ao closer), uma vez por lead — SÓ
      // para resposta positiva. Se o handoff atribuiu um comercial, o aviso vai
      // para ELE (prevalece sobre o responsável fixo da campanha e sobre o
      // responsável antigo do lead).
      //
      // Sem handoff, a campanha decide: no modo 'lead' (carteira importada) o
      // responsável do próprio lead passa na frente do responsável fixo. Com
      // handoff o flag fica desligado de propósito — o rodízio acabou de gravar
      // leads.responsavel_id, e reordenar aqui só criaria uma segunda leitura
      // do mesmo dado com chance de divergir.
      if (closerEnfileirado.has(lead.id)) {
        log.info('Closer já avisado deste lead nesta passada; não duplico o aviso.', { leadId: lead.id })
      } else {
        closerEnfileirado.add(lead.id)
        fila.enfileirar('direcionar_closer', {
          leadId: lead.id,
          textoResposta: msg.corpo,
          responsavelCampanha: responsavelHandoff ?? responsavelCampanha,
          preferirResponsavelDoLead: !responsavelHandoff
            && contextoCampanha?.retornoParaResponsavelDoLead === true,
          contextoCampanha,
        })
      }
    } catch (erro) {
      // Falha no meio do processamento: devolve a mensagem para a próxima
      // passada, senão ela ficaria marcada como tratada sem ter sido.
      if (chaveMensagem) await store.liberarMensagem(chaveMensagem)
      throw erro
    }
  }

  // Só confirma a leitura depois que todas as alterações do lote terminaram.
  // Se qualquer persistência falhar, a mensagem continua não lida e a fila
  // durável poderá tentar novamente. A idempotência por estágio evita duplicar
  // uma resposta que já tenha sido registrada antes da falha.
  if (!opts.adiarConfirmacaoLeitura) await email.confirmarLeitura?.(mensagens)

  return { respostas, ignoradas, contatosAlternativos, bounces }
}

// Casa uma mensagem a um lead do motor: e-mail EXATO primeiro, senão pelo
// DOMÍNIO (encaminhamento). Só retorna leads owner='engine'.
async function casarLead(store: Store, de: string): Promise<Lead | null> {
  let lead = await store.buscarLeadPorEmail(de)
  if (!lead) {
    const dominio = de.split('@')[1] ?? ''
    lead = await store.buscarLeadPorDominio(dominio)
    if (lead) {
      log.info('Casado por DOMÍNIO (encaminhamento).', {
        de,
        empresa: lead.empresa,
        dominio: dominioDoLead(lead),
      })
    }
  }
  if (!lead || lead.owner !== OWNER_ENGINE) return null
  return lead
}

// Bounce SMTP: casa o lead pelo DESTINATÁRIO (campo "To" não disponível na
// mensagem recebida — casamos pelo endereço no corpo do bounce ou por domínio).
// Como o bounce vem do mailer-daemon, o campo `de` não é o lead — precisa
// extrair o email original do assunto/corpo.
// Estratégia pragmática: busca qualquer lead que tenha sido o DESTINATÁRIO;
// o bounce geralmente inclui o endereço original no corpo ou no assunto.
async function tratarBounce(store: Store, msg: MensagemRecebida): Promise<boolean> {
  // Extrai endereço de e-mail do corpo/assunto do bounce.
  const alvo = `${msg.assunto} ${msg.corpo}`
  const match = alvo.match(/[\w.+%-]+@[\w.-]+\.[a-z]{2,}/i)
  if (!match) {
    log.aviso('Bounce sem e-mail identificável no corpo.', { de: msg.de, assunto: msg.assunto })
    return false
  }
  const emailOriginal = match[0].toLowerCase()
  const lead = await store.buscarLeadPorEmail(emailOriginal)
  if (!lead) {
    log.aviso('Bounce: e-mail não casa com nenhum lead.', { emailOriginal })
    return false
  }

  // Idempotência: a busca de mensagens varre uma JANELA de dias e não depende da
  // flag \Seen, então o mesmo bounce reaparece a cada passada do monitor (a cada
  // INTERVALO_MONITOR_RESPOSTAS_SEGUNDOS). Sem esta guarda, cada passada remarca
  // o lead e grava outra nota — foi assim que 3 leads acumularam ~2.400 notas
  // cada. Já tratado é sucesso: contabiliza como bounce, não escreve de novo.
  if (lead.bounced === true) {
    log.info('Bounce já tratado para este lead — ignorado (idempotência).', {
      leadId: lead.id,
      emailOriginal,
    })
    return true
  }

  // Marca o lead como bounced e cancela as execuções ativas.
  await store.atualizarLead(lead.id, {
    bounced: true,
    bounced_em: new Date().toISOString(),
    proxima_acao: null,
    proxima_acao_data: null,
  })
  await store.cancelarExecucoesWorkflow(lead.id)
  await store.registrarInteracao({
    lead_id: lead.id,
    tipo: 'nota',
    canal: 'sistema',
    descricao: `Bounce SMTP detectado: e-mail devolvido pelo servidor. Lead marcado como bounced — removido da cadência automática. Assunto original: "${msg.assunto}"`,
    origem_acao: 'ia',
    responsavel_id: lead.responsavel_id ?? null,
  })
  log.ok('BOUNCE detectado — lead marcado e cadência cancelada.', {
    leadId: lead.id,
    empresa: lead.empresa,
    emailOriginal,
  })
  return true
}

// Item 7: trata um auto-reply de ausência. Se houver extrator injetado, casa o
// lead e tenta extrair contato(s) alternativo(s) do corpo; achando algum,
// registra uma nota de SUGESTÃO (não auto-cadastra — revisão humana na v1).
// Retorna true se registrou uma sugestão. Nunca lança (bônus, não pode derrubar
// a detecção de resposta).
async function tratarAutoResposta(
  store: Store,
  msg: MensagemRecebida,
  opts: DetectarRespostaOpts,
): Promise<boolean> {
  if (!opts.extrairContatos) return false
  try {
    const lead = await casarLead(store, msg.de)
    if (!lead) return false
    const contatos = await opts.extrairContatos(msg.corpo)
    if (contatos.length === 0) return false
    const lista = contatos.map((c) => `${c.nome} <${c.email}>`).join('; ')
    await store.registrarInteracao({
      lead_id: lead.id,
      tipo: 'nota',
      canal: 'sistema',
      descricao: `${MARCADOR_CONTATO_ALT} ${lista}. Confirme antes de cadastrar como contato do lead.`,
      origem_acao: 'ia',
      responsavel_id: lead.responsavel_id ?? null,
    })
    log.ok('Auto-resposta com contato alternativo — sugestão registrada.', {
      leadId: lead.id,
      empresa: lead.empresa,
      contatos: contatos.length,
    })
    return true
  } catch (e) {
    log.aviso('Falha ao extrair contato alternativo do auto-reply.', {
      de: msg.de,
      erro: e instanceof Error ? e.message : String(e),
    })
    return false
  }
}
