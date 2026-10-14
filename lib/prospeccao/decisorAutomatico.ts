// Decisor automático da Prospecção: a busca já entrega cada empresa com o
// decisor e o e-mail dele, sem o passo manual de "analisar".
//   1. OpenCNPJ (grátis) só aponta QUEM é o decisor: o sócio sugerido;
//   2. Anymail Finder acha o e-mail desse sócio no domínio da empresa;
//   3. Crustdata traz LinkedIn e cargo atual dele (só depois do e-mail válido,
//      para não pagar por empresa que não vai entrar na lista).
// Empresa sem domínio próprio, sem sócio ou sem e-mail válido não fica
// "completa": a tela pula e tenta a próxima. Tudo que já foi consultado pela
// organização é reaproveitado (prospeccao_decisores), sem nova cobrança.

import type { ProspeccaoConfig } from '@/lib/config/workspaceConfig'
import { avaliarDecisor } from './adequacaoDecisor'
import type { AnaliseSalva, ConsultaSocios, Decisor } from './decisores'
import { dominioDaEmpresa } from './dominioEmpresa'
import { donoDoEmail, soLetras } from './emailNominal'
import {
  nomeParaBuscaDePessoas,
  titulosDeDecisao,
  type AlvoPessoas,
  type CandidatoDecisor,
  type EmailDecisor,
  type Enriquecimento,
  type FalhaEnriquecimento,
} from './enriquecimento'
import type { Socio } from './socios'

/** Teto dos testes: a busca com decisor entrega no máximo 10 empresas. */
export const META_MAXIMA_DECISOR = 10
/** Empresas tentadas por busca, no máximo, para não gastar crédito sem fim. */
export const TETO_TENTATIVAS_DECISOR = 25

export interface EmpresaParaDecisor {
  cnpj: string
  porte: string | null
  mei: boolean | null
  email: string | null
  razao_social: string | null
  nome_fantasia: string | null
}

/** sem_decisor: só na busca internacional (ninguém com cargo-alvo na Crustdata). */
/** bloqueado_*: a fonte paga necessária está bloqueada (travas de custo, chave ou crédito) — a busca em lote SEGUE. */
export type MotivoIncompleto = 'sem_dominio' | 'sem_socio' | 'sem_decisor' | 'sem_email' | 'bloqueado_crustdata' | 'bloqueado_anymail'

/** Por que a fonte paga não foi chamada para esta empresa. */
export interface BloqueioFonte {
  fonte: 'crustdata' | 'anymail'
  motivo: FalhaEnriquecimento
  mensagem: string
}

// Bloqueio da FONTE (não da busca): desligada, sem orçamento, sem chave ou sem
// crédito. No lote a empresa fica incompleta e as outras continuam; só a ação
// paga direta do usuário (rotas manuais) responde 402/503. Limite de
// requisições (429) e instabilidade seguem como falha.
const BLOQUEIOS_DA_FONTE: readonly FalhaEnriquecimento[] = ['pago_desligado', 'orcamento_esgotado', 'sem_chave', 'sem_credito']
export const ehBloqueioDaFonte = (motivo: FalhaEnriquecimento) => BLOQUEIOS_DA_FONTE.includes(motivo)

export type ResultadoDecisorAutomatico =
  | { status: 'completo'; decisor: Decisor; email: string; consulta: ConsultaSocios; enriquecimento: Enriquecimento }
  | { status: 'incompleto'; motivo: MotivoIncompleto; consulta: ConsultaSocios | null; enriquecimento: Enriquecimento | null; bloqueio?: BloqueioFonte }
  | { status: 'falha'; erro: string; httpStatus: number }

export interface DependenciasDecisor {
  consultarSocios(cnpj: string): Promise<{ ok: true; socios: Socio[] } | { ok: false; motivo: 'nao_encontrado' | 'indisponivel' }>
  buscarEmail(nome: string, dominio: string): Promise<{ ok: true; resultado: EmailDecisor } | { ok: false; motivo: FalhaEnriquecimento; detalhe?: string }>
  buscarPessoas(alvo: AlvoPessoas, titulos: string[]): Promise<{ ok: true; candidatos: CandidatoDecisor[] } | { ok: false; motivo: FalhaEnriquecimento; detalhe?: string }>
  /** Persistência por organização (a rota amarra a org da sessão). */
  salvarConsulta(consulta: ConsultaSocios): Promise<void>
  salvarEnriquecimento(parte: Enriquecimento): Promise<void>
  salvarDecisor(decisor: Decisor): Promise<void>
}

const PARTICULAS = new Set(['da', 'de', 'do', 'das', 'dos', 'e'])
const partesDoNome = (nome: string) => nome.split(/\s+/).map(soLetras).filter((p) => p && !PARTICULAS.has(p))

/**
 * O perfil da Crustdata é a mesma pessoa do quadro societário? A Receita traz
 * o nome completo ("Joao Carlos da Silva Souza") e o LinkedIn costuma trazer
 * só primeiro e último ("João Souza"): mesmo primeiro nome e todo sobrenome do
 * perfil presente no nome da Receita.
 */
export function mesmaPessoa(nomeReceita: string, nomePerfil: string): boolean {
  const receita = partesDoNome(nomeReceita)
  const perfil = partesDoNome(nomePerfil)
  if (receita.length < 2 || perfil.length < 2 || receita[0] !== perfil[0]) return false
  return perfil.slice(1).every((p) => receita.slice(1).includes(p))
}

function mensagemFalha(falha: { motivo: FalhaEnriquecimento; detalhe?: string }, fonte: string): { erro: string; httpStatus: number } {
  // 402/429/503 fazem a busca automática parar (a tela trata como fatal).
  const textos: Record<FalhaEnriquecimento, [string, number]> = {
    sem_chave: ['integração não configurada (chave ausente ou inválida).', 503],
    sem_credito: ['a conta está sem crédito.', 402],
    limite: ['muitas consultas seguidas; aguarde um minuto.', 429],
    indisponivel: ['serviço indisponível no momento.', 502],
    pago_desligado: ['enriquecimento pago desligado para esta organização.', 503],
    orcamento_esgotado: ['orçamento do enriquecimento pago esgotado.', 402],
  }
  const [texto, httpStatus] = textos[falha.motivo]
  const detalhe = falha.detalhe && falha.motivo === 'orcamento_esgotado' ? ` (${falha.detalhe})` : ''
  return { erro: `${fonte}: ${texto}${detalhe}`, httpStatus }
}

function bloqueioDe(falha: { motivo: FalhaEnriquecimento; detalhe?: string }, fonte: BloqueioFonte['fonte']): BloqueioFonte {
  return { fonte, motivo: falha.motivo, mensagem: mensagemFalha(falha, fonte === 'crustdata' ? 'Crustdata' : 'Anymail').erro }
}

/**
 * Brasil, do mais barato ao mais caro:
 *   1. decisor grátis: escolha salva da org > sócio (OpenCNPJ, via cache) que
 *      serve pelo perfil (cargos-alvo + porte). Achou → Crustdata NÃO é chamada;
 *   2. Crustdata SÓ quando falta decisor (sem sócio, ou sócio fora do perfil):
 *      a pessoa de cargo mais alto no domínio;
 *   3. e-mail: o da Receita, se for nominal do decisor; senão o já consultado
 *      pela org; só então Anymail (decisor existe e falta e-mail).
 * Toda chamada externa passa pelo cache de inteligência e pelas travas de
 * custo (as dependências injetadas pela rota).
 */
export async function resolverDecisorAutomatico(
  empresa: EmpresaParaDecisor,
  perfil: ProspeccaoConfig | undefined,
  salvo: AnaliseSalva | null,
  deps: DependenciasDecisor,
): Promise<ResultadoDecisorAutomatico> {
  const dominio = dominioDaEmpresa(empresa.email, [empresa.nome_fantasia, empresa.razao_social])?.dominio ?? null
  // Sem domínio próprio nenhuma fonte paga acha o e-mail: nem consulta.
  if (!dominio) return { status: 'incompleto', motivo: 'sem_dominio', consulta: salvo?.consulta ?? null, enriquecimento: salvo?.enriquecimento ?? null }

  // 1. Sócios (grátis).
  let consulta = salvo?.consulta ?? null
  if (!consulta) {
    const r = await deps.consultarSocios(empresa.cnpj)
    if (!r.ok && r.motivo === 'indisponivel') return { status: 'falha', erro: 'OpenCNPJ indisponível no momento.', httpStatus: 502 }
    const socios = r.ok ? r.socios : []
    const dono = donoDoEmail(empresa.email, socios)
    const avaliacao = avaliarDecisor(socios, empresa, perfil, dono)
    consulta = { socios: avaliacao.socios, sugerido: avaliacao.sugerido, status: avaliacao.status, motivo: avaliacao.motivo, emailNominalDe: dono?.nome ?? null }
    if (r.ok) await deps.salvarConsulta(consulta).catch((e) => console.error('[prospeccao/decisor-automatico] não salvou a consulta:', e))
  }

  let enriquecimento: Enriquecimento = { ...(salvo?.enriquecimento ?? {}) }
  const socioServe = consulta.status !== 'precisa_outro_decisor' && !!consulta.sugerido
  let nome = salvo?.decisor?.nome ?? (socioServe ? consulta.sugerido!.nome : null)
  let cargo = salvo?.decisor?.nome === nome ? salvo?.decisor?.cargo ?? '' : (socioServe && consulta.sugerido?.nome === nome ? consulta.sugerido!.qualificacao : '')
  let linkedin = salvo?.decisor?.nome === nome ? salvo?.decisor?.linkedin ?? null : null
  let dominioEmail = dominio

  // 2. Crustdata só quando falta decisor.
  if (!nome) {
    let crustdata = enriquecimento.crustdata?.dominio === dominio ? enriquecimento.crustdata : undefined
    if (!crustdata) {
      const r = await deps.buscarPessoas(dominio, titulosDeDecisao(perfil?.cargosAlvo))
      if (!r.ok && ehBloqueioDaFonte(r.motivo)) return { status: 'incompleto', motivo: 'bloqueado_crustdata', consulta, enriquecimento, bloqueio: bloqueioDe(r, 'crustdata') }
      if (!r.ok) return { status: 'falha', ...mensagemFalha(r, 'Crustdata') }
      crustdata = { dominio, candidatos: r.candidatos, consultadoEm: new Date().toISOString() }
      enriquecimento = { ...enriquecimento, crustdata }
      await deps.salvarEnriquecimento({ crustdata }).catch((e) => console.error('[prospeccao/decisor-automatico] não salvou a Crustdata:', e))
    }
    const pessoa = crustdata.candidatos[0]
    if (!pessoa) return { status: 'incompleto', motivo: consulta.socios.length ? 'sem_decisor' : 'sem_socio', consulta, enriquecimento }
    nome = pessoa.nome
    cargo = pessoa.cargo
    linkedin = pessoa.linkedin
    dominioEmail = pessoa.dominio ?? dominio
  }

  // 3. E-mail: Receita nominal do decisor > já consultado pela org > Anymail.
  let email: string | null = null
  const nominal = consulta.emailNominalDe && soLetras(consulta.emailNominalDe) === soLetras(nome) ? empresa.email : null
  if (nominal) {
    email = nominal.trim().toLowerCase()
  } else {
    const anterior = enriquecimento.anymail
    let anymail: EmailDecisor
    if (anterior && anterior.dominio === dominioEmail && soLetras(anterior.nome) === soLetras(nome)) {
      anymail = anterior
    } else {
      const r = await deps.buscarEmail(nome, dominioEmail)
      if (!r.ok && ehBloqueioDaFonte(r.motivo)) return { status: 'incompleto', motivo: 'bloqueado_anymail', consulta, enriquecimento, bloqueio: bloqueioDe(r, 'anymail') }
      if (!r.ok) return { status: 'falha', ...mensagemFalha(r, 'Anymail') }
      anymail = r.resultado
      enriquecimento = { ...enriquecimento, anymail }
      await deps.salvarEnriquecimento({ anymail }).catch((e) => console.error('[prospeccao/decisor-automatico] não salvou o e-mail:', e))
    }
    if (anymail.status !== 'valido' || !anymail.email) return { status: 'incompleto', motivo: 'sem_email', consulta, enriquecimento }
    email = anymail.email
  }

  const decisor: Decisor = { nome, cargo: cargo ?? '', ...(linkedin ? { linkedin } : {}) }
  const escolhido = salvo?.decisor ?? null
  const mudou = !escolhido || escolhido.nome !== decisor.nome || escolhido.cargo !== decisor.cargo || (escolhido.linkedin ?? null) !== (decisor.linkedin ?? null)
  if (mudou) await deps.salvarDecisor(decisor).catch((e) => console.error('[prospeccao/decisor-automatico] não salvou o decisor:', e))

  return { status: 'completo', decisor, email, consulta, enriquecimento }
}

// ---------------------------------------------------------------------------
// Busca internacional: empresa sem CNPJ nem quadro societário. O decisor é
// quem a Crustdata acha com cargo-alvo no domínio (ordem: quem decide mais
// primeiro) e o e-mail vem da Anymail. Tenta até 2 pessoas: "não encontrado"
// não é cobrado, então vale tentar a segunda antes de pular a empresa.
// ---------------------------------------------------------------------------

/** Pessoas tentadas na Anymail por empresa. */
export const CANDIDATOS_EMAIL_INTERNACIONAL = 3

/** O que a org já consultou para o domínio (tabela da migration 0063). */
export interface SalvoInternacional {
  candidatos: CandidatoDecisor[] | null
  /** Uma consulta Anymail por pessoa tentada. */
  anymail: EmailDecisor[]
}

export type ResultadoDecisorInternacional =
  | { status: 'completo'; decisor: Decisor; email: string; candidatos: CandidatoDecisor[] }
  | { status: 'incompleto'; motivo: Extract<MotivoIncompleto, 'sem_decisor' | 'sem_email' | 'bloqueado_crustdata' | 'bloqueado_anymail'>; candidatos: CandidatoDecisor[]; bloqueio?: BloqueioFonte }
  | { status: 'falha'; erro: string; httpStatus: number }

export interface DependenciasInternacional {
  buscarEmail: DependenciasDecisor['buscarEmail']
  buscarPessoas: DependenciasDecisor['buscarPessoas']
  salvar(parte: { candidatos?: CandidatoDecisor[]; anymail?: EmailDecisor[]; decisor?: Decisor }): Promise<void>
}

export async function resolverDecisorInternacional(
  dominio: string,
  perfil: ProspeccaoConfig | undefined,
  salvo: SalvoInternacional | null,
  deps: DependenciasInternacional,
  /** Nome da empresa: 2ª tentativa quando ninguém aparece no domínio (cadastro duplicado). */
  nomeEmpresa: string | null = null,
): Promise<ResultadoDecisorInternacional> {
  const aviso = (e: unknown) => console.error('[prospeccao/decisor-internacional] não salvou:', e)

  // 1. Quem decide: pessoas com cargo-alvo no domínio (salvas = sem nova cobrança).
  // A mesma empresa pode ter mais de um cadastro na Crustdata (o site de um
  // não é o dos funcionários): sem ninguém no domínio, procura pelo nome do
  // empregador atual.
  let candidatos = salvo?.candidatos?.length ? salvo.candidatos : null
  if (!candidatos) {
    const titulos = titulosDeDecisao(perfil?.cargosAlvo)
    const r = await deps.buscarPessoas(dominio, titulos)
    if (!r.ok && ehBloqueioDaFonte(r.motivo)) return { status: 'incompleto', motivo: 'bloqueado_crustdata', candidatos: [], bloqueio: bloqueioDe(r, 'crustdata') }
    if (!r.ok) return { status: 'falha', ...mensagemFalha(r, 'Crustdata') }
    candidatos = r.candidatos
    const nomeBusca = nomeEmpresa ? nomeParaBuscaDePessoas(nomeEmpresa) : ''
    if (candidatos.length === 0 && nomeBusca.length >= 3) {
      const porNome = await deps.buscarPessoas({ nomeEmpresa: nomeBusca, dominioEmpresa: dominio }, titulos)
      if (!porNome.ok && ehBloqueioDaFonte(porNome.motivo)) return { status: 'incompleto', motivo: 'bloqueado_crustdata', candidatos: [], bloqueio: bloqueioDe(porNome, 'crustdata') }
      if (!porNome.ok) return { status: 'falha', ...mensagemFalha(porNome, 'Crustdata') }
      candidatos = porNome.candidatos
    }
    // Lista vazia não custou nada (a Crustdata cobra por pessoa devolvida):
    // não guarda, para a próxima busca tentar de novo.
    if (candidatos.length) await deps.salvar({ candidatos }).catch(aviso)
  }
  if (candidatos.length === 0) return { status: 'incompleto', motivo: 'sem_decisor', candidatos }

  // 2. E-mail: a primeira pessoa com e-mail válido vira o decisor.
  const consultas = [...(salvo?.anymail ?? [])]
  for (const pessoa of candidatos.slice(0, CANDIDATOS_EMAIL_INTERNACIONAL)) {
    // Achada pelo nome: o e-mail é no domínio do empregador real dela.
    const dominioEmail = pessoa.dominio ?? dominio
    let resultado = consultas.find((a) => a.dominio === dominioEmail && soLetras(a.nome) === soLetras(pessoa.nome))
    if (!resultado) {
      const r = await deps.buscarEmail(pessoa.nome, dominioEmail)
      if (!r.ok && ehBloqueioDaFonte(r.motivo)) return { status: 'incompleto', motivo: 'bloqueado_anymail', candidatos, bloqueio: bloqueioDe(r, 'anymail') }
      if (!r.ok) return { status: 'falha', ...mensagemFalha(r, 'Anymail') }
      resultado = r.resultado
      consultas.push(resultado)
      await deps.salvar({ anymail: consultas }).catch(aviso)
    }
    if (resultado.status === 'valido' && resultado.email) {
      const decisor: Decisor = { nome: pessoa.nome, cargo: pessoa.cargo, ...(pessoa.linkedin ? { linkedin: pessoa.linkedin } : {}) }
      await deps.salvar({ decisor }).catch(aviso)
      return { status: 'completo', decisor, email: resultado.email, candidatos }
    }
  }
  return { status: 'incompleto', motivo: 'sem_email', candidatos }
}
