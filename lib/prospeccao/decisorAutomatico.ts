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
export type MotivoIncompleto = 'sem_dominio' | 'sem_socio' | 'sem_decisor' | 'sem_email'

export type ResultadoDecisorAutomatico =
  | { status: 'completo'; decisor: Decisor; email: string; consulta: ConsultaSocios; enriquecimento: Enriquecimento }
  | { status: 'incompleto'; motivo: MotivoIncompleto; consulta: ConsultaSocios | null; enriquecimento: Enriquecimento | null }
  | { status: 'falha'; erro: string; httpStatus: number }

export interface DependenciasDecisor {
  consultarSocios(cnpj: string): Promise<{ ok: true; socios: Socio[] } | { ok: false; motivo: 'nao_encontrado' | 'indisponivel' }>
  buscarEmail(nome: string, dominio: string): Promise<{ ok: true; resultado: EmailDecisor } | { ok: false; motivo: FalhaEnriquecimento }>
  buscarPessoas(alvo: AlvoPessoas, titulos: string[]): Promise<{ ok: true; candidatos: CandidatoDecisor[] } | { ok: false; motivo: FalhaEnriquecimento }>
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

function mensagemFalha(motivo: FalhaEnriquecimento, fonte: string): { erro: string; httpStatus: number } {
  const textos: Record<FalhaEnriquecimento, [string, number]> = {
    sem_chave: ['integração não configurada (chave ausente ou inválida).', 503],
    sem_credito: ['a conta está sem crédito.', 402],
    limite: ['muitas consultas seguidas; aguarde um minuto.', 429],
    indisponivel: ['serviço indisponível no momento.', 502],
  }
  const [texto, httpStatus] = textos[motivo]
  return { erro: `${fonte}: ${texto}`, httpStatus }
}

export async function resolverDecisorAutomatico(
  empresa: EmpresaParaDecisor,
  perfil: ProspeccaoConfig | undefined,
  salvo: AnaliseSalva | null,
  deps: DependenciasDecisor,
): Promise<ResultadoDecisorAutomatico> {
  const dominio = dominioDaEmpresa(empresa.email, [empresa.nome_fantasia, empresa.razao_social])?.dominio ?? null
  // Sem domínio próprio nenhuma fonte paga acha o e-mail: nem consulta.
  if (!dominio) return { status: 'incompleto', motivo: 'sem_dominio', consulta: salvo?.consulta ?? null, enriquecimento: salvo?.enriquecimento ?? null }

  // 1. Quem é o decisor: escolha já salva pela org vence; senão o sócio sugerido.
  let consulta = salvo?.consulta ?? null
  if (!consulta) {
    const r = await deps.consultarSocios(empresa.cnpj)
    if (!r.ok) {
      if (r.motivo === 'nao_encontrado') return { status: 'incompleto', motivo: 'sem_socio', consulta: null, enriquecimento: salvo?.enriquecimento ?? null }
      return { status: 'falha', erro: 'OpenCNPJ indisponível no momento.', httpStatus: 502 }
    }
    const dono = donoDoEmail(empresa.email, r.socios)
    const avaliacao = avaliarDecisor(r.socios, empresa, perfil, dono)
    consulta = { socios: avaliacao.socios, sugerido: avaliacao.sugerido, status: avaliacao.status, motivo: avaliacao.motivo, emailNominalDe: dono?.nome ?? null }
    await deps.salvarConsulta(consulta).catch((e) => console.error('[prospeccao/decisor-automatico] não salvou a consulta:', e))
  }
  const nome = salvo?.decisor?.nome ?? consulta.sugerido?.nome ?? null
  if (!nome) return { status: 'incompleto', motivo: 'sem_socio', consulta, enriquecimento: salvo?.enriquecimento ?? null }

  // 2. E-mail do decisor. Resultado salvo para a mesma pessoa e domínio volta
  // sem nova consulta (inclusive "não encontrado": a busca automática não
  // insiste; o botão manual do detalhe ainda pode tentar de novo).
  let enriquecimento: Enriquecimento = { ...(salvo?.enriquecimento ?? {}) }
  const anterior = enriquecimento.anymail
  let anymail: EmailDecisor
  if (anterior && anterior.dominio === dominio && soLetras(anterior.nome) === soLetras(nome)) {
    anymail = anterior
  } else {
    const r = await deps.buscarEmail(nome, dominio)
    if (!r.ok) return { status: 'falha', ...mensagemFalha(r.motivo, 'Anymail') }
    anymail = r.resultado
    enriquecimento = { ...enriquecimento, anymail }
    await deps.salvarEnriquecimento({ anymail }).catch((e) => console.error('[prospeccao/decisor-automatico] não salvou o e-mail:', e))
  }
  if (anymail.status !== 'valido' || !anymail.email) return { status: 'incompleto', motivo: 'sem_email', consulta, enriquecimento }

  // 3. LinkedIn e cargo atual do mesmo decisor. Opcional: sem perfil, a
  // empresa continua completa com o cargo da Receita.
  let crustdata = enriquecimento.crustdata?.dominio === dominio ? enriquecimento.crustdata : undefined
  if (!crustdata) {
    const r = await deps.buscarPessoas(dominio, titulosDeDecisao(perfil?.cargosAlvo))
    if (r.ok) {
      crustdata = { dominio, candidatos: r.candidatos, consultadoEm: new Date().toISOString() }
      enriquecimento = { ...enriquecimento, crustdata }
      await deps.salvarEnriquecimento({ crustdata }).catch((e) => console.error('[prospeccao/decisor-automatico] não salvou a Crustdata:', e))
    } else {
      console.error('[prospeccao/decisor-automatico] Crustdata falhou:', r.motivo)
    }
  }
  const perfilPessoa = crustdata?.candidatos.find((c) => mesmaPessoa(nome, c.nome)) ?? null

  const escolhido = salvo?.decisor?.nome === nome ? salvo.decisor : null
  const socio = consulta.sugerido?.nome === nome ? consulta.sugerido : null
  const decisor: Decisor = {
    nome,
    cargo: perfilPessoa?.cargo ?? escolhido?.cargo ?? socio?.qualificacao ?? '',
    ...(perfilPessoa?.linkedin ?? escolhido?.linkedin ? { linkedin: (perfilPessoa?.linkedin ?? escolhido?.linkedin)! } : {}),
  }
  const mudou = !escolhido || escolhido.cargo !== decisor.cargo || (escolhido.linkedin ?? null) !== (decisor.linkedin ?? null)
  if (mudou) await deps.salvarDecisor(decisor).catch((e) => console.error('[prospeccao/decisor-automatico] não salvou o decisor:', e))

  return { status: 'completo', decisor, email: anymail.email, consulta, enriquecimento }
}

// ---------------------------------------------------------------------------
// Busca internacional: empresa sem CNPJ nem quadro societário. O decisor é
// quem a Crustdata acha com cargo-alvo no domínio (ordem: quem decide mais
// primeiro) e o e-mail vem da Anymail. Tenta até 2 pessoas: "não encontrado"
// não é cobrado, então vale tentar a segunda antes de pular a empresa.
// ---------------------------------------------------------------------------

/** Pessoas tentadas na Anymail por empresa. */
export const CANDIDATOS_EMAIL_INTERNACIONAL = 3

/** O que a org já consultou para o domínio (tabela da migration 0061). */
export interface SalvoInternacional {
  candidatos: CandidatoDecisor[] | null
  /** Uma consulta Anymail por pessoa tentada. */
  anymail: EmailDecisor[]
}

export type ResultadoDecisorInternacional =
  | { status: 'completo'; decisor: Decisor; email: string; candidatos: CandidatoDecisor[] }
  | { status: 'incompleto'; motivo: Extract<MotivoIncompleto, 'sem_decisor' | 'sem_email'>; candidatos: CandidatoDecisor[] }
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
    if (!r.ok) return { status: 'falha', ...mensagemFalha(r.motivo, 'Crustdata') }
    candidatos = r.candidatos
    const nomeBusca = nomeEmpresa ? nomeParaBuscaDePessoas(nomeEmpresa) : ''
    if (candidatos.length === 0 && nomeBusca.length >= 3) {
      const porNome = await deps.buscarPessoas({ nomeEmpresa: nomeBusca, dominioEmpresa: dominio }, titulos)
      if (!porNome.ok) return { status: 'falha', ...mensagemFalha(porNome.motivo, 'Crustdata') }
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
      if (!r.ok) return { status: 'falha', ...mensagemFalha(r.motivo, 'Anymail') }
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
