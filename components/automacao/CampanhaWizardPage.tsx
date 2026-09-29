'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BellRing,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  FileText,
  Maximize2,
  Loader2,
  Mail,
  Megaphone,
  MessageCircle,
  RefreshCcw,
  Save,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
} from 'lucide-react'
import {
  mensagemCampanhaVazia,
  type Campanha,
  type CanaisRetorno,
  type FollowupCampanha,
  type MensagemCampanha,
  type Publico,
  type ResponsavelRecebe,
} from './tiposCampanha'
import HtmlEmailEditor from './HtmlEmailEditor'
import {
  aplicarRegraPublicoPorTipo,
  campanhaEhDisparoUnico,
  GRUPOS_STATUS_PUBLICO,
  labelTipoCampanha,
  LIMITE_CONFIRMACAO_CAMPANHA,
  modeloEmailRespostaCampanha,
  normalizarPublicoCampanha,
  regraPublicoCampanha,
  podeUsarTipoCampanha,
  tiposCampanhaDisponiveis,
  VARIAVEIS_EMAIL_RESPOSTA,
  validarCampanhaGuiada,
} from '@/lib/campanhas/configuracaoGuiada'
import { montarEmailCampanhaHtml } from '@/lib/campanhas/emailCampanha'
import PreviaEmailModal from './PreviaEmailModal'
import ModeloEmailPicker from './ModeloEmailPicker'

interface TemplateOpcao {
  id: string
  nome: string
  tipo: string
  assunto: string | null
  corpo: string
  // Template HTML da biblioteca: entra como HTML da mensagem, com `corpo` de
  // texto alternativo. Vazio = template de texto simples.
  html: string | null
  formato: 'html' | 'texto'
  nicho: string | null
}

interface Membro {
  id: string
  nome: string | null
  email: string | null
}

interface WhatsappRetornoOpcoes {
  provedorConfigurado: boolean
  // Perfis com WhatsApp de avisos ligado; null = não foi possível verificar.
  perfisComNumero: string[] | null
}

interface PreviaPublico {
  totalSelecionado: number
  totalEmpresas: number
  totalEmpresasSelecionadas: number
  emailsValidos: number
  emailsAusentesOuInvalidos: number
  duplicados: number
  bloqueados: number
  semResponsavel: number
  incompativeis: number
  elegiveis: number
  truncado: boolean
  amostra: { id: string; empresa: string | null; contato: string | null }[]
  empresas: {
    chave: string
    nome: string
    segmento: string | null
    contatos: number
    elegiveis: number
    selecionada: boolean
  }[]
}

interface InicialCampanha {
  tipo?: string
  leadIds?: string[]
}

const PASSOS = [
  { titulo: 'Público', label: 'Quem receberá', Icon: Users },
  { titulo: 'Mensagem', label: 'O que será enviado', Icon: Mail },
  { titulo: 'Cadência', label: 'O que acontece depois', Icon: CalendarDays },
  { titulo: 'Revisão', label: 'Revisar e ativar', Icon: CheckCircle2 },
] as const

const ICONES_OBJETIVO = {
  prospeccao: Users,
  followup: RefreshCcw,
  reativacao: RefreshCcw,
  novidade_clientes: Megaphone,
  renovacao: CalendarDays,
} as const

const DIAS = [
  { id: 'seg', label: 'Seg' }, { id: 'ter', label: 'Ter' }, { id: 'qua', label: 'Qua' },
  { id: 'qui', label: 'Qui' }, { id: 'sex', label: 'Sex' }, { id: 'sab', label: 'Sáb' },
  { id: 'dom', label: 'Dom' },
]
const EMPRESAS_POR_PAGINA = 10

const input = 'w-full rounded-lg border border-[var(--border)] bg-[var(--bg-base)] px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none'
const label = 'mb-1.5 block text-xs font-medium text-slate-400'
const card = 'rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5'

function textoOuNaoConfigurado(valor: string | null | undefined) {
  return valor?.trim() || 'Não configurado'
}

function nomeMembro(membro: Membro | undefined) {
  return membro?.nome?.trim() || membro?.email?.trim() || 'Não configurado'
}

function mensagemVazia(): MensagemCampanha {
  return mensagemCampanhaVazia()
}

const OPCOES_RESPONSAVEL_RECEBE: { id: ResponsavelRecebe; titulo: string; descricao: string; Icone: typeof Mail }[] = [
  {
    id: 'envios_e_respostas',
    titulo: 'Mensagens e respostas',
    descricao: 'Vai em cópia de cada e-mail enviado ao cliente (primeiro contato e follow-ups) e é avisado quando ele responder.',
    Icone: Mail,
  },
  {
    id: 'somente_respostas',
    titulo: 'Somente as respostas',
    descricao: 'Os e-mails saem sem cópia. O responsável só é avisado quando o cliente responder.',
    Icone: BellRing,
  },
]

const OPCOES_CANAIS_RETORNO: { id: CanaisRetorno; titulo: string; descricao: string; Icone: typeof Mail }[] = [
  {
    id: 'email_whatsapp',
    titulo: 'E-mail e WhatsApp',
    descricao: 'WhatsApp de avisos a cada resposta, mais o e-mail de retorno configurado na etapa Cadência.',
    Icone: Mail,
  },
  {
    id: 'whatsapp',
    titulo: 'Somente WhatsApp',
    descricao: 'Só o WhatsApp de avisos, a cada resposta. O e-mail de retorno fica desligado.',
    Icone: MessageCircle,
  },
]

const ROTULO_RESPONSAVEL_RECEBE: Record<ResponsavelRecebe, string> = {
  envios_e_respostas: 'Mensagens e respostas (cópia de cada envio)',
  somente_respostas: 'Somente as respostas (envios sem cópia)',
}

const ROTULO_CANAIS_RETORNO: Record<CanaisRetorno, string> = {
  email_whatsapp: 'E-mail e WhatsApp',
  whatsapp: 'Somente WhatsApp',
}

function CartaoOpcao({ ativa, desabilitada, titulo, descricao, Icone, onClick }: {
  ativa: boolean
  desabilitada?: boolean
  titulo: string
  descricao: string
  Icone: typeof Mail
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={ativa}
      disabled={desabilitada}
      onClick={onClick}
      className={`flex items-start gap-3 rounded-xl border p-3 text-left transition-all disabled:cursor-not-allowed disabled:opacity-50 ${ativa ? 'border-indigo-400 bg-gradient-to-br from-indigo-500/20 to-violet-500/10' : 'border-[var(--border)] bg-[var(--bg-subtle)] hover:border-[var(--border-strong)]'}`}
    >
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${ativa ? 'bg-indigo-500 text-white' : 'bg-indigo-500/10 text-indigo-300'}`}>
        <Icone size={15} />
      </span>
      <span>
        <span className="block text-sm font-semibold text-slate-100">{titulo}</span>
        <span className="mt-1 block text-xs leading-5 text-slate-500">{descricao}</span>
      </span>
      {ativa && <CheckCircle2 size={16} className="ml-auto shrink-0 text-indigo-200" />}
    </button>
  )
}

export default function CampanhaWizardPage({
  campanha,
  inicial,
}: {
  campanha?: Campanha | null
  inicial?: InicialCampanha
}) {
  const router = useRouter()
  // `null` = ainda não sei. O grid de objetivos só aparece depois da resposta,
  // para a tela nunca oferecer um objetivo que a API recusaria.
  const [temTiposAvancados, setTemTiposAvancados] = useState<boolean | null>(null)
  const [previaCliente, setPreviaCliente] = useState(false)
  const [abaPreviaCliente, setAbaPreviaCliente] = useState<'visual' | 'codigo'>('visual')
  useEffect(() => {
    let cancelado = false
    fetch('/api/rbac/permissoes')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelado) return
        const minhas: string[] = Array.isArray(d?.minhas) ? d.minhas : []
        setTemTiposAvancados(minhas.includes('campaigns.tipos.avancados'))
      })
      .catch(() => { if (!cancelado) setTemTiposAvancados(false) })
    return () => { cancelado = true }
  }, [])

  const tipoInicial = campanha?.tipo ?? inicial?.tipo ?? 'prospeccao'
  const [etapa, setEtapa] = useState(0)
  const [campanhaId, setCampanhaId] = useState(campanha?.id ?? '')
  const [nome, setNome] = useState(campanha?.nome ?? '')
  const [tipo, setTipo] = useState(tipoInicial)
  const [descricao, setDescricao] = useState(campanha?.descricao ?? '')
  const [publico, setPublico] = useState<Publico>(() => {
    const bruto = campanha?.publico ?? {
      selecao: inicial?.leadIds?.length ? { modo: 'manual', leadIds: inicial.leadIds } : undefined,
    }
    const normalizado = aplicarRegraPublicoPorTipo(normalizarPublicoCampanha(bruto), tipoInicial)
    return {
      ...normalizado,
      operacao: {
        ...normalizado.operacao,
        mensagemInicial: normalizado.operacao?.mensagemInicial ?? mensagemVazia(),
      },
    }
  })
  const [templates, setTemplates] = useState<TemplateOpcao[]>([])
  const [nichos, setNichos] = useState<string[]>([])
  const [membros, setMembros] = useState<Membro[]>([])
  const [carregandoOpcoes, setCarregandoOpcoes] = useState(true)
  const [testeEmailDisponivel, setTesteEmailDisponivel] = useState(false)
  const [envioRealDisponivel, setEnvioRealDisponivel] = useState(false)
  const [previa, setPrevia] = useState<PreviaPublico | null>(null)
  const [carregandoPrevia, setCarregandoPrevia] = useState(false)
  const [salvando, setSalvando] = useState<'rascunho' | 'ativar' | 'iniciar' | false>(false)
  const [erro, setErro] = useState<string | null>(null)
  const [salvo, setSalvo] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [modoConfirmacao, setModoConfirmacao] = useState<'ensaio' | 'real'>('ensaio')
  const [confirmacao, setConfirmacao] = useState('')
  const [estadoTesteEmail, setEstadoTesteEmail] = useState<'ocioso' | 'confirmando' | 'enviando' | 'enviado'>('ocioso')
  const [destinatarioTeste, setDestinatarioTeste] = useState('')
  const [buscaEmpresa, setBuscaEmpresa] = useState('')
  const [paginaEmpresas, setPaginaEmpresas] = useState(1)
  const [whatsappRetorno, setWhatsappRetorno] = useState<WhatsappRetornoOpcoes | null>(null)

  const responsavel = membros.find((membro) => membro.id === publico.responsavel_id)
  // Modo carteira: o retorno vai para o responsável de cada lead e `responsavel`
  // acima vira fallback. Campanha antiga não tem o campo — e segue com a pessoa fixa.
  const retornoPorCarteira = publico.retornoPara === 'lead'
  const destinoRetorno = retornoPorCarteira
    ? `responsável de cada lead (fallback: ${nomeMembro(responsavel)})`
    : nomeMembro(responsavel)
  // Campanha sem os campos (anterior a eles) abre com o padrão da tela: cópia
  // ligada e aviso por e-mail e WhatsApp — salvar grava a escolha explícita.
  const responsavelRecebe: ResponsavelRecebe = publico.operacao?.responsavelRecebe ?? 'envios_e_respostas'
  const canaisRetorno: CanaisRetorno = publico.operacao?.resposta?.canais ?? 'email_whatsapp'
  // Mesma regra do servidor (exigirWhatsappRetornoPronto) para o que dá para
  // saber aqui: Z-API e o número do responsável geral. Na carteira, os donos
  // dos leads são conferidos pelo servidor ao iniciar.
  const responsavelTemWhatsapp = whatsappRetorno?.perfisComNumero && publico.responsavel_id
    ? whatsappRetorno.perfisComNumero.includes(publico.responsavel_id)
    : null
  const bloqueioSomenteWhatsapp: string | null = !whatsappRetorno
    ? null
    : !whatsappRetorno.provedorConfigurado
      ? 'O WhatsApp (Z-API) não está configurado no servidor.'
      : !retornoPorCarteira && responsavelTemWhatsapp === false
        ? `${nomeMembro(responsavel)} ainda não ligou o WhatsApp de avisos (Meu perfil > Avisos no WhatsApp).`
        : null
  const mensagemInicial = publico.operacao?.mensagemInicial ?? mensagemVazia()
  const followups = publico.operacao?.followups ?? []
  const disparoUnico = campanhaEhDisparoUnico(tipo)
  const regraPublico = regraPublicoCampanha(tipo)
  const resposta = publico.operacao?.resposta
  const htmlMensagemInicial = montarEmailCampanhaHtml(
    mensagemInicial.corpo?.trim() || 'Não configurado',
    { responsavelNome: nomeMembro(responsavel) },
    mensagemInicial.html,
  )
  const htmlResposta = montarEmailCampanhaHtml(resposta?.emailCorpo ?? '', {}, resposta?.emailHtml)
  const empresasFiltradas = useMemo(() => {
    const termo = buscaEmpresa.trim().toLocaleLowerCase('pt-BR')
    if (!termo) return previa?.empresas ?? []
    return (previa?.empresas ?? []).filter((empresa) =>
      empresa.nome.toLocaleLowerCase('pt-BR').includes(termo)
      || empresa.segmento?.toLocaleLowerCase('pt-BR').includes(termo),
    )
  }, [buscaEmpresa, previa?.empresas])
  const totalPaginasEmpresas = Math.max(1, Math.ceil(empresasFiltradas.length / EMPRESAS_POR_PAGINA))
  const paginaEmpresasSegura = Math.min(paginaEmpresas, totalPaginasEmpresas)
  const empresasDaPagina = empresasFiltradas.slice(
    (paginaEmpresasSegura - 1) * EMPRESAS_POR_PAGINA,
    paginaEmpresasSegura * EMPRESAS_POR_PAGINA,
  )

  useEffect(() => {
    let ativo = true
    Promise.all([
      // `tipo` na query: prospecção não deve herdar o fallback 'followup'/conta
      // global exibido para os demais tipos (ver app/api/campanhas/opcoes/route.ts).
      fetch(`/api/campanhas/opcoes?tipo=${encodeURIComponent(tipo)}`).then(async (res) => {
        const dados = await res.json()
        if (!res.ok) throw new Error(dados.erro || 'Não foi possível carregar as opções da campanha.')
        return dados
      }),
      fetch('/api/equipe/listar').then(async (res) => {
        const dados = await res.json()
        if (!res.ok) throw new Error(dados.erro || 'Não foi possível carregar a equipe.')
        return dados
      }),
    ]).then(([opcoes, equipe]) => {
      if (!ativo) return
      setTemplates(opcoes.templates ?? [])
      setNichos(opcoes.nichos ?? [])
      setTesteEmailDisponivel(opcoes.testeEmailDisponivel === true)
      setEnvioRealDisponivel(opcoes.envioRealDisponivel === true)
      setWhatsappRetorno(opcoes.whatsappRetorno ?? null)
      setMembros((equipe.membros ?? []).filter((m: Membro) => m.nome || m.email))
      setPublico((atual) => ({
        ...atual,
        operacao: {
          ...atual.operacao,
          mensagemInicial: atual.operacao?.mensagemInicial ?? mensagemVazia(),
          remetenteConta: opcoes.remetente?.conta,
          remetenteEmail: opcoes.remetente?.email,
        },
      }))
    }).catch((e) => {
      if (ativo) setErro(e instanceof Error ? e.message : 'Erro ao carregar opções.')
    }).finally(() => {
      if (ativo) setCarregandoOpcoes(false)
    })
    return () => { ativo = false }
  }, [tipo])

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setCarregandoPrevia(true)
      try {
        const res = await fetch('/api/campanhas/publico/previa', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ publico, tipo, workflowId: campanha?.workflow_id }),
          signal: controller.signal,
        })
        const dados = await res.json()
        if (!res.ok) throw new Error(dados.erro || 'Não foi possível calcular o público.')
        setPrevia(dados.previa)
      } catch (e) {
        if (!controller.signal.aborted) {
          setPrevia(null)
          setErro(e instanceof Error ? e.message : 'Erro ao calcular o público.')
        }
      } finally {
        if (!controller.signal.aborted) setCarregandoPrevia(false)
      }
    }, 350)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [publico.empresas, publico.selecao, tipo, campanha?.workflow_id])

  function atualizarEmpresas(patch: Partial<NonNullable<Publico['empresas']>>) {
    setPublico((atual) => ({ ...atual, empresas: { ...atual.empresas, ...patch } }))
  }

  function validarAvancoPublico(): string | null {
    if (carregandoPrevia) return 'Aguarde o recálculo do público antes de continuar.'
    if (!previa) return 'Não foi possível validar o público desta campanha.'
    if (previa.elegiveis > 0) return null
    if (previa.totalSelecionado > 0 && previa.incompativeis >= previa.totalSelecionado) {
      return `${previa.totalSelecionado} contato(s) foram selecionados, mas todos já estão em uma automação ativa ou ainda estão vinculados a outro motor.`
    }
    if (previa.totalSelecionado > 0) {
      return `${previa.totalSelecionado} contato(s) foram selecionados, mas nenhum está elegível. Confira e-mail, bloqueios, duplicidade e automações ativas.`
    }
    return 'Selecione um público que tenha ao menos um contato elegível.'
  }

  function irParaEtapa(destino: number) {
    if (destino > etapa && etapa === 0) {
      const erroPublico = validarAvancoPublico()
      if (erroPublico) {
        setErro(erroPublico)
        return
      }
    }
    setErro(null)
    setEtapa(Math.max(0, Math.min(PASSOS.length - 1, destino)))
  }

  function atualizarSelecao(patch: Partial<NonNullable<Publico['selecao']>>) {
    setPublico((atual) => ({ ...atual, selecao: { ...atual.selecao, ...patch } }))
  }

  function atualizarAgenda(patch: Partial<NonNullable<Publico['agenda']>>) {
    setPublico((atual) => ({ ...atual, agenda: { ...atual.agenda, ...patch } }))
  }

  function atualizarResposta(patch: Partial<NonNullable<NonNullable<Publico['operacao']>['resposta']>>) {
    setPublico((atual) => ({
      ...atual,
      operacao: {
        ...atual.operacao,
        mensagemInicial: atual.operacao?.mensagemInicial ?? mensagemVazia(),
        resposta: { ...atual.operacao?.resposta, ...patch },
      },
    }))
  }

  function alterarResponsavelRecebe(valor: ResponsavelRecebe) {
    setPublico((atual) => ({
      ...atual,
      operacao: {
        ...atual.operacao,
        mensagemInicial: atual.operacao?.mensagemInicial ?? mensagemVazia(),
        responsavelRecebe: valor,
      },
    }))
  }

  function alterarTipo(novoTipo: string) {
    const modeloAnterior = modeloEmailRespostaCampanha(tipo)
    const novoModelo = modeloEmailRespostaCampanha(novoTipo)
    setTipo(novoTipo)
    setPublico((atual) => {
      const respostaAtual = atual.operacao?.resposta
      const assuntoAindaPadrao = !respostaAtual?.emailAssunto || respostaAtual.emailAssunto === modeloAnterior.assunto
      const corpoAindaPadrao = !respostaAtual?.emailCorpo || respostaAtual.emailCorpo === modeloAnterior.corpo
      return aplicarRegraPublicoPorTipo({
        ...atual,
        selecao: { ...atual.selecao, excluirEmpresas: undefined },
        operacao: {
          ...atual.operacao,
          resposta: {
            ...respostaAtual,
            emailAssunto: assuntoAindaPadrao ? novoModelo.assunto : respostaAtual?.emailAssunto,
            emailCorpo: corpoAindaPadrao ? novoModelo.corpo : respostaAtual?.emailCorpo,
          },
        },
      }, novoTipo)
    })
  }

  // Campanha NOVA nasce em 'prospeccao'. Quem não tem os objetivos avançados
  // cairia num tipo que a API recusa, então troco para o primeiro permitido
  // assim que as permissões chegam. Campanha existente não é mexida.
  useEffect(() => {
    if (temTiposAvancados === null || campanha) return
    if (podeUsarTipoCampanha(tipo, temTiposAvancados)) return
    const primeiro = tiposCampanhaDisponiveis(temTiposAvancados)[0]
    if (primeiro) alterarTipo(primeiro.id)
    // alterarTipo depende de estado que muda a cada render; a guarda acima já
    // impede repetição, então basta reagir à chegada da permissão.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [temTiposAvancados, campanha, tipo])

  function selecionarEmpresa(chave: string, selecionar: boolean) {
    const excluidas = new Set(publico.selecao?.excluirEmpresas ?? [])
    if (selecionar) excluidas.delete(chave)
    else excluidas.add(chave)
    atualizarSelecao({ excluirEmpresas: [...excluidas] })
  }

  function selecionarTodasEmpresas() {
    atualizarSelecao({ excluirEmpresas: undefined })
  }

  function limparSelecaoEmpresas() {
    atualizarSelecao({ excluirEmpresas: previa?.empresas.map((empresa) => empresa.chave) ?? [] })
  }

  function atualizarMensagem(indice: number | null, patch: Partial<MensagemCampanha>) {
    if (indice == null && estadoTesteEmail === 'enviado') {
      setEstadoTesteEmail('ocioso')
      setDestinatarioTeste('')
    }
    setPublico((atual) => {
      const op = atual.operacao ?? {}
      if (indice == null) {
        return {
          ...atual,
          operacao: { ...op, mensagemInicial: { ...(op.mensagemInicial ?? mensagemVazia()), ...patch } },
        }
      }
      const lista = [...(op.followups ?? [])]
      lista[indice] = { ...lista[indice], ...patch }
      return { ...atual, operacao: { ...op, followups: lista } }
    })
  }

  function aplicarTemplate(templateId: string, indice: number | null) {
    const template = templates.find((item) => item.id === templateId)
    if (!template) {
      atualizarMensagem(indice, mensagemCampanhaVazia())
      return
    }
    atualizarMensagem(indice, {
      templateOrigemId: template.id,
      assunto: template.assunto ?? '',
      corpo: template.corpo,
      // Texto limpa o HTML anterior; HTML substitui o modelo pronto escolhido.
      html: template.html ?? undefined,
      modeloId: undefined,
      modeloCampos: undefined,
    })
  }

  function adicionarFollowup() {
    if (followups.length >= 4) return
    const ultimoDia = followups.at(-1)?.diasApos ?? 0
    setPublico((atual) => ({
      ...atual,
      operacao: {
        ...atual.operacao,
        mensagemInicial: atual.operacao?.mensagemInicial ?? mensagemVazia(),
        followups: [
          ...(atual.operacao?.followups ?? []),
          { ...mensagemVazia(), diasApos: ultimoDia ? ultimoDia + 4 : 3 },
        ],
      },
    }))
  }

  function removerFollowup(indice: number) {
    setPublico((atual) => ({
      ...atual,
      operacao: {
        ...atual.operacao,
        mensagemInicial: atual.operacao?.mensagemInicial ?? mensagemVazia(),
        followups: (atual.operacao?.followups ?? []).filter((_, i) => i !== indice),
      },
    }))
  }

  function bodyCampanha() {
    const publicoComOperacao = {
      ...publico,
      objetivo: descricao.trim() || undefined,
      agenda: { ...publico.agenda, pararAoResponder: true },
      operacao: {
        ...publico.operacao,
        mensagemInicial,
        responsavelRecebe,
        resposta: {
          ...publico.operacao?.resposta,
          canais: canaisRetorno,
          pararCadencia: true,
          criarTarefa: false,
          // "Somente WhatsApp" = sem e-mail de retorno ao responsável.
          notificarResponsavel: canaisRetorno !== 'whatsapp',
          notificarAdministradores: false,
          prepararSugestao: false,
        },
      },
    }
    return {
      nome: nome.trim(),
      tipo,
      descricao: descricao.trim() || null,
      meta_leads: null,
      publico: aplicarRegraPublicoPorTipo(publicoComOperacao, tipo),
    }
  }

  async function persistir(): Promise<string> {
    if (!nome.trim()) throw new Error('Informe um nome para a campanha.')
    const url = campanhaId ? `/api/campanhas/${campanhaId}` : '/api/campanhas'
    const res = await fetch(url, {
      method: campanhaId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyCampanha()),
    })
    const dados = await res.json()
    if (!res.ok) throw new Error(dados.erro || 'Não foi possível salvar a campanha.')
    const id = campanhaId || dados.id
    if (!id) throw new Error('A campanha foi salva sem um identificador.')
    if (!campanhaId) {
      setCampanhaId(id)
      window.history.replaceState(null, '', `/automacao/campanhas/${id}/editar`)
    }
    return id
  }

  async function salvarRascunho() {
    setSalvando('rascunho')
    setErro(null)
    setSalvo(false)
    try {
      await persistir()
      setSalvo(true)
      window.setTimeout(() => setSalvo(false), 2500)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar.')
    } finally {
      setSalvando(false)
    }
  }

  async function ativar(confirmarQuantidade?: number) {
    setSalvando('ativar')
    setErro(null)
    try {
      const id = await persistir()
      const res = await fetch(`/api/campanhas/${id}/ativar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmarQuantidade }),
      })
      const dados = await res.json()
      if (!res.ok) throw new Error(dados.erro || 'Não foi possível ativar a campanha.')
      router.push(`/automacao/campanhas/${id}`)
      router.refresh()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao ativar.')
      setConfirmando(false)
    } finally {
      setSalvando(false)
    }
  }

  async function iniciarReal(confirmarQuantidade: number) {
    setSalvando('iniciar')
    setErro(null)
    try {
      const id = await persistir()
      const res = await fetch(`/api/campanhas/${id}/iniciar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmarQuantidade }),
      })
      const dados = await res.json()
      if (!res.ok) throw new Error(dados.erro || 'Não foi possível iniciar a campanha.')
      router.push(`/automacao/campanhas/${id}`)
      router.refresh()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao iniciar a campanha.')
      setConfirmando(false)
    } finally {
      setSalvando(false)
    }
  }

  async function enviarTesteEmail() {
    setEstadoTesteEmail('enviando')
    setErro(null)
    try {
      const res = await fetch('/api/campanhas/teste-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assunto: mensagemInicial.assunto,
          corpo: mensagemInicial.corpo,
          html: mensagemInicial.html,
          responsavelNome: responsavel ? nomeMembro(responsavel) : undefined,
          tipo,
        }),
      })
      const dados = await res.json()
      if (!res.ok) throw new Error(dados.erro || 'Não foi possível enviar o teste.')
      setDestinatarioTeste(dados.destinatario ?? publico.operacao?.remetenteEmail ?? '')
      setEstadoTesteEmail('enviado')
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao enviar o teste.')
      setEstadoTesteEmail('ocioso')
    }
  }

  function solicitarAtivacao() {
    const erros = validarCampanhaGuiada(bodyCampanha().publico)
    const quantidade = previa?.elegiveis ?? 0
    if (!quantidade) erros.push('O público precisa ter ao menos um contato elegível.')
    if (erros.length) {
      setErro(erros.join(' '))
      return
    }
    if (quantidade > LIMITE_CONFIRMACAO_CAMPANHA) {
      setConfirmacao('')
      setModoConfirmacao('ensaio')
      setConfirmando(true)
      return
    }
    void ativar()
  }

  function solicitarInicioReal() {
    const erros = validarCampanhaGuiada(bodyCampanha().publico)
    const quantidade = previa?.elegiveis ?? 0
    if (!envioRealDisponivel) {
      erros.push('O envio real está indisponível. Confirme MODO_ENSAIO=false e a conta Gmail no Vercel.')
    }
    if (canaisRetorno === 'whatsapp' && bloqueioSomenteWhatsapp) {
      erros.push(`"Somente WhatsApp" indisponível: ${bloqueioSomenteWhatsapp} Escolha "E-mail e WhatsApp" ou resolva antes de iniciar.`)
    }
    if (!quantidade) erros.push('O público precisa ter ao menos um contato elegível.')
    if (erros.length) {
      setErro(erros.join(' '))
      return
    }
    setConfirmacao('')
    setModoConfirmacao('real')
    setConfirmando(true)
  }

  const contagens = useMemo(() => [
    ['Selecionados', previa?.totalSelecionado],
    ['Elegíveis', previa?.elegiveis],
    ['Sem e-mail válido', previa?.emailsAusentesOuInvalidos],
    ['Duplicados', previa?.duplicados],
    ['Bloqueados', previa?.bloqueados],
    ['Sem responsável', previa?.semResponsavel],
    ['Incompatíveis', previa?.incompativeis],
  ] as const, [previa])

  const resumoCadencia = disparoUnico
    ? 'Disparo único — somente a mensagem inicial'
    : followups.length
    ? `Mensagem inicial + ${followups.length} follow-up${followups.length > 1 ? 's' : ''} (${followups.map((f) => `dia ${f.diasApos}`).join(', ')})`
    : 'Somente a mensagem inicial'

  return (
    <div className="mx-auto max-w-[1500px] p-4 font-sans sm:p-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href={campanhaId ? `/automacao/campanhas/${campanhaId}` : '/automacao?tab=campanhas'} className="mb-2 inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200">
            <ArrowLeft size={15} /> Campanhas
          </Link>
          <h1 className="text-2xl font-semibold text-slate-100">{campanhaId ? 'Editar campanha' : 'Nova campanha'}</h1>
          <p className="mt-1 text-sm text-slate-500">Configure público, mensagem e próximos passos usando somente dados existentes.</p>
        </div>
        <button type="button" onClick={() => void salvarRascunho()} disabled={!!salvando} className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-strong)] px-4 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50">
          {salvando === 'rascunho' ? <Loader2 size={15} className="animate-spin" /> : salvo ? <Check size={15} /> : <Save size={15} />}
          {salvo ? 'Salvo' : 'Salvar rascunho'}
        </button>
      </div>

      <div className="mb-7 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {PASSOS.map((passo, indice) => {
          const { titulo, label: texto, Icon } = disparoUnico && indice === 2
            ? { titulo: 'Disparo', label: 'Envio único', Icon: Send }
            : passo
          return <button key={titulo} type="button" onClick={() => irParaEtapa(indice)} className={`flex min-w-0 items-center gap-2 rounded-xl border p-3 text-left transition-colors ${etapa === indice ? 'border-indigo-500/70 bg-indigo-500/10 text-indigo-200' : indice < etapa ? 'border-emerald-500/25 bg-emerald-500/5 text-slate-300' : 'border-[var(--border)] bg-[var(--bg-subtle)] text-slate-500'}`}>
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${indice < etapa ? 'bg-emerald-500 text-white' : etapa === indice ? 'bg-indigo-500 text-white' : 'bg-[var(--bg-input)]'}`}>
              {indice < etapa ? <Check size={14} /> : indice + 1}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-xs font-semibold">Etapa {indice + 1} · {titulo}</span>
              <span className="hidden truncate text-[11px] text-slate-500 xl:block">{texto}</span>
            </span>
            <Icon size={15} className="ml-auto hidden lg:block" />
          </button>
        })}
      </div>

      {erro && (
        <div className="mb-5 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {erro}
        </div>
      )}

      {etapa === 0 && (
        <div className="space-y-5">
          <section className={card}>
            <h2 className="mb-1 font-semibold text-slate-100">Qual é o objetivo?</h2>
            <p className="mb-5 text-sm text-slate-500">O tipo organiza a campanha; ele não cria métricas nem altera o motor.</p>
            {temTiposAvancados === null ? (
              <p className="text-sm text-slate-500">Carregando os objetivos disponíveis para o seu acesso…</p>
            ) : !podeUsarTipoCampanha(tipo, temTiposAvancados) ? (
              <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-300">
                Esta campanha tem o objetivo <b>{labelTipoCampanha(tipo)}</b>, que o seu acesso não gerencia.
                Peça a um administrador para editá-la.
              </div>
            ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {tiposCampanhaDisponiveis(temTiposAvancados).map((item) => {
                const Icone = ICONES_OBJETIVO[item.id]
                return (
                  <button key={item.id} type="button" onClick={() => alterarTipo(item.id)} className={`group flex min-h-24 items-start gap-3 rounded-xl border p-4 text-left transition-all ${tipo === item.id ? 'border-indigo-400 bg-gradient-to-br from-indigo-500/20 to-violet-500/10 shadow-[0_0_28px_rgba(99,102,241,.12)]' : 'border-[var(--border)] bg-[var(--bg-subtle)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-subtle)]'}`}>
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tipo === item.id ? 'bg-indigo-500 text-white' : 'bg-indigo-500/10 text-indigo-300'}`}><Icone size={19} /></span>
                    <span>
                      <span className="block text-sm font-semibold text-slate-100">{item.label}</span>
                      <span className="mt-1 block text-xs leading-5 text-slate-500">{item.descricao}</span>
                    </span>
                    {tipo === item.id && <CheckCircle2 size={17} className="ml-auto shrink-0 text-indigo-200" />}
                  </button>
                )
              })}
            </div>
            )}
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <div>
                <label className={label}>Nome da campanha</label>
                <input className={input} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Novidade de agosto" />
              </div>
              <div>
                <label className={label}>Objetivo interno (opcional)</label>
                <textarea maxLength={200} className={`${input} min-h-[42px] resize-y`} value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Contexto para quem revisar a campanha" />
                <div className="mt-1 text-right text-[11px] text-slate-600">{descricao.length}/200</div>
              </div>
            </div>

            {/* Escolha explícita, em cartão: a diferença entre carteira e pessoa
                única muda para quem vai CADA resposta, então não cabe escondida
                num select de uma coluna. */}
            <div className="mt-5 rounded-xl border border-[var(--border)] bg-[var(--bg-subtle)] p-4">
              <h3 className="text-sm font-semibold text-slate-100">Quem recebe os retornos?</h3>
              <p className="mt-1 text-xs text-slate-500">Quando o contato responder, o aviso da oportunidade vai para quem você escolher aqui.</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {[
                  {
                    id: 'lead' as const,
                    Icone: Users,
                    titulo: 'Responsável de cada lead',
                    descricao: 'Cada resposta vai para o comercial que já é dono daquele lead na base.',
                  },
                  {
                    id: 'campanha' as const,
                    Icone: UserRound,
                    titulo: 'Um responsável geral',
                    descricao: 'Todas as respostas desta campanha vão para a mesma pessoa.',
                  },
                ].map((opcao) => {
                  const ativa = (retornoPorCarteira ? 'lead' : 'campanha') === opcao.id
                  return (
                    <button
                      key={opcao.id}
                      type="button"
                      onClick={() => setPublico((atual) => ({ ...atual, retornoPara: opcao.id }))}
                      className={`flex items-start gap-3 rounded-xl border p-3.5 text-left transition-all ${ativa ? 'border-indigo-400 bg-gradient-to-br from-indigo-500/20 to-violet-500/10' : 'border-[var(--border)] bg-[var(--bg-subtle)] hover:border-[var(--border-strong)]'}`}
                    >
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${ativa ? 'bg-indigo-500 text-white' : 'bg-indigo-500/10 text-indigo-300'}`}>
                        <opcao.Icone size={17} />
                      </span>
                      <span>
                        <span className="block text-sm font-semibold text-slate-100">{opcao.titulo}</span>
                        <span className="mt-1 block text-xs leading-5 text-slate-500">{opcao.descricao}</span>
                      </span>
                      {ativa && <CheckCircle2 size={16} className="ml-auto shrink-0 text-indigo-200" />}
                    </button>
                  )
                })}
              </div>
              <div className="mt-4 max-w-sm">
                <label className={label}>
                  {retornoPorCarteira ? 'Se o lead não tiver responsável, avisar' : 'Responsável geral desta campanha'}
                </label>
                <select className={input} value={publico.responsavel_id ?? ''} onChange={(e) => setPublico((atual) => ({ ...atual, responsavel_id: e.target.value || undefined }))}>
                  <option value="">Não configurado</option>
                  {membros.map((membro) => <option key={membro.id} value={membro.id}>{nomeMembro(membro)}</option>)}
                </select>
                <p className="mt-1.5 text-[11px] leading-4 text-slate-500">
                  {retornoPorCarteira
                    ? 'Obrigatório: é a rede de segurança para lead sem responsável ou com responsável sem e-mail cadastrado.'
                    : 'Vale para toda a campanha, independente de quem seja o dono do lead na base.'}
                </p>
              </div>

              {/* O que o responsável acompanha e por onde a resposta chega. As
                  duas escolhas são lidas no envio/na resposta (campanhas.publico). */}
              <div className="mt-5 grid gap-5 border-t border-[var(--border)] pt-4 lg:grid-cols-2">
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">O responsável recebe</h4>
                  <div className="mt-2 grid gap-2">
                    {OPCOES_RESPONSAVEL_RECEBE.map((opcao) => (
                      <CartaoOpcao
                        key={opcao.id}
                        ativa={responsavelRecebe === opcao.id}
                        titulo={opcao.titulo}
                        descricao={opcao.descricao}
                        Icone={opcao.Icone}
                        onClick={() => alterarResponsavelRecebe(opcao.id)}
                      />
                    ))}
                  </div>
                </div>
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Aviso de resposta por</h4>
                  <div className="mt-2 grid gap-2">
                    {OPCOES_CANAIS_RETORNO.map((opcao) => (
                      <CartaoOpcao
                        key={opcao.id}
                        ativa={canaisRetorno === opcao.id}
                        desabilitada={opcao.id === 'whatsapp' && canaisRetorno !== 'whatsapp' && !!bloqueioSomenteWhatsapp}
                        titulo={opcao.titulo}
                        descricao={opcao.descricao}
                        Icone={opcao.Icone}
                        onClick={() => atualizarResposta({ canais: opcao.id })}
                      />
                    ))}
                  </div>
                  <div className="mt-2 text-[11px] leading-4">
                    {!whatsappRetorno ? (
                      <span className="text-slate-500">Verificando o WhatsApp de avisos…</span>
                    ) : bloqueioSomenteWhatsapp ? (
                      <span className={canaisRetorno === 'whatsapp' ? 'text-red-300' : 'text-amber-300/90'}>
                        {canaisRetorno === 'whatsapp' ? 'A campanha não inicia assim: ' : '"Somente WhatsApp" indisponível: '}
                        {bloqueioSomenteWhatsapp}
                        {canaisRetorno !== 'whatsapp' && ' Até lá, o aviso chega só por e-mail.'}
                      </span>
                    ) : retornoPorCarteira ? (
                      <span className="text-slate-500">O WhatsApp vai para o número de avisos do responsável de cada lead (Meu perfil &gt; Avisos no WhatsApp). {canaisRetorno === 'whatsapp' ? 'Ao iniciar, quem não tiver número ligado bloqueia a campanha.' : 'Quem não tiver número ligado recebe só o e-mail.'}</span>
                    ) : responsavelTemWhatsapp ? (
                      <span className="text-emerald-300/90">{nomeMembro(responsavel)} tem o WhatsApp de avisos ligado.</span>
                    ) : whatsappRetorno.perfisComNumero === null ? (
                      <span className="text-amber-300/90">Não foi possível verificar o WhatsApp de avisos agora; o servidor confere ao iniciar.</span>
                    ) : (
                      <span className="text-slate-500">Escolha o responsável acima para conferir o WhatsApp de avisos.</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className={card}>
            <h2 className="mb-1 font-semibold text-slate-100">Selecione o público</h2>
            <p className="mb-4 text-sm text-slate-500">A contagem é recalculada no servidor e respeita bloqueios, duplicidade e automações ativas.</p>
            <div className="mb-4 grid grid-cols-2 gap-2">
              {(['filtros', 'manual'] as const).map((modo) => (
                <button key={modo} type="button" onClick={() => atualizarSelecao({ modo })} className={`rounded-lg border px-3 py-2 text-sm ${publico.selecao?.modo === modo ? 'border-indigo-500 bg-indigo-500/10 text-indigo-200' : 'border-[var(--border)] text-slate-400'}`}>
                  {modo === 'filtros' ? 'Usar filtros' : 'Seleção manual'}
                </button>
              ))}
            </div>
            {publico.selecao?.modo === 'manual' ? (
              <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] p-4">
                <p className="text-sm text-slate-300">{publico.selecao.leadIds?.length ?? 0} contato(s) selecionado(s) na base.</p>
                <p className="mt-1 text-xs text-slate-500">Para alterar a seleção, volte à Base de Leads e selecione novamente os contatos.</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-lg border border-indigo-500/25 bg-indigo-500/5 p-3">
                  <div className="text-sm font-medium text-indigo-200">{regraPublico.titulo}</div>
                  <p className="mt-1 text-xs leading-5 text-slate-400">{regraPublico.descricao}</p>
                </div>
                <div>
                  <label className={label}>Nicho</label>
                  <select className={`${input} disabled:cursor-not-allowed disabled:opacity-60`} disabled={!nichos.length && !publico.empresas?.segmento} value={publico.empresas?.segmento ?? ''} onChange={(e) => atualizarEmpresas({ segmento: e.target.value || undefined })}>
                    <option value="">Todos os nichos</option>
                    {publico.empresas?.segmento && !nichos.includes(publico.empresas.segmento) && (
                      <option value={publico.empresas.segmento}>{publico.empresas.segmento}</option>
                    )}
                    {nichos.map((nicho) => <option key={nicho} value={nicho}>{nicho}</option>)}
                  </select>
                  <p className={`mt-1.5 text-xs ${nichos.length ? 'text-slate-600' : 'text-amber-300/80'}`}>{nichos.length ? 'Opções reais do campo Segmento / nicho na Base de Leads.' : 'Filtro indisponível: nenhum contato possui Segmento / nicho cadastrado na Base de Leads.'}</p>
                </div>
                {regraPublico.permitirEscolhaStatus && <div>
                  <label className={label}>Status da prospecção (multisseleção)</label>
                  <div className="grid gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] p-3 sm:grid-cols-2">
                    {GRUPOS_STATUS_PUBLICO.map((grupo) => {
                      const atuais = publico.selecao?.estagios ?? []
                      const ativo = grupo.estagios.every((estagio) => atuais.includes(estagio))
                      return <label key={grupo.id} className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${ativo ? 'border-indigo-500/70 bg-indigo-500/10 text-indigo-100' : 'border-[var(--border-strong)] text-slate-400'}`}>
                        <input type="checkbox" className="mt-0.5 accent-indigo-500" checked={ativo} onChange={() => {
                        const estagiosDoGrupo = new Set<string>(grupo.estagios)
                        const semGrupo = atuais.filter((estagio) => !estagiosDoGrupo.has(estagio))
                        const proximos = ativo ? semGrupo : [...semGrupo, ...grupo.estagios]
                        if (proximos.length) atualizarSelecao({ estagios: proximos })
                      }} />
                        <span>{grupo.label}</span>
                      </label>
                    })}
                  </div>
                  <div className="mt-2 rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] px-3 py-2 text-xs leading-5 text-slate-500">
                    <span className="font-medium text-slate-400">Regra auditável:</span>{' '}
                    {GRUPOS_STATUS_PUBLICO.filter((grupo) => grupo.estagios.every((estagio) => (publico.selecao?.estagios ?? []).includes(estagio))).map((grupo) => grupo.label).join(', ')}.
                    <span className="mt-1 block text-[11px] text-slate-600">Estágios persistidos: {(publico.selecao?.estagios ?? []).join(', ')}</span>
                  </div>
                </div>}
                <div>
                  <label className={label}>Limite de contatos (máx. 2.000)</label>
                  <input type="number" min={1} max={2000} className={input} value={publico.empresas?.limite ?? ''} onChange={(e) => atualizarEmpresas({ limite: e.target.value ? Number(e.target.value) : undefined })} placeholder="Sem limite adicional" />
                </div>
              </div>
            )}

            <div className="mt-5 border-t border-[var(--border)] pt-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Prévia real</span>
                {carregandoPrevia && <Loader2 size={14} className="animate-spin text-indigo-400" />}
              </div>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
                {contagens.map(([rotulo, valor]) => (
                  <div key={rotulo} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-3">
                    <div className="text-xl font-semibold text-slate-100">{valor ?? '—'}</div>
                    <div className="text-[11px] text-slate-500">{rotulo}</div>
                  </div>
                ))}
              </div>
              {previa?.truncado && <p className="mt-3 text-xs text-amber-300">A prévia atingiu o limite seguro de 2.000 registros.</p>}
              {!!previa?.incompativeis && (
                <div className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs leading-5 text-amber-200">
                  <strong>{previa.incompativeis} contato(s) incompatíveis:</strong> possuem execução ativa em outra automação ou ainda estão vinculados a outro motor. Eles permanecem visíveis para auditoria, mas não podem receber esta campanha.
                </div>
              )}
              {previa && previa.totalSelecionado > 0 && previa.elegiveis === 0 && (
                <div className="mt-3 rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-xs leading-5 text-red-200">
                  A seleção atual não possui contatos elegíveis. O avanço será bloqueado até que exista ao menos um destinatário válido.
                </div>
              )}
              {previa && (
                <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--bg-subtle)] p-4">
                  <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 text-sm font-semibold text-slate-200"><Building2 size={16} className="text-indigo-400" /> Empresas encontradas</div>
                      <p className="mt-1 text-xs text-slate-500">Selecione as empresas que deseja incluir. O nicho exibido vem da Base de Leads.</p>
                    </div>
                    <span className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-xs text-indigo-200">{previa.totalEmpresasSelecionadas} de {previa.totalEmpresas} selecionadas</span>
                  </div>
                  {previa.empresas.length ? (
                    <div>
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        <button type="button" onClick={selecionarTodasEmpresas} className="rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-3 py-2 text-xs font-medium text-indigo-200 hover:bg-indigo-500/15">Selecionar todas</button>
                        <div className="relative min-w-56 flex-1">
                          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" />
                          <input className={`${input} pl-9`} value={buscaEmpresa} onChange={(e) => { setBuscaEmpresa(e.target.value); setPaginaEmpresas(1) }} placeholder="Pesquisar por empresa ou nicho" />
                        </div>
                        <button type="button" onClick={limparSelecaoEmpresas} className="rounded-lg border border-[var(--border-strong)] px-3 py-2 text-xs text-slate-400 hover:border-red-500/30 hover:text-red-300">Limpar seleção</button>
                      </div>
                      <div className="max-h-80 overflow-auto rounded-xl border border-[var(--border-subtle)]">
                        <table className="w-full min-w-[680px] border-collapse text-left">
                          <thead className="sticky top-0 z-10 bg-[var(--bg-subtle)] text-[11px] uppercase tracking-wide text-slate-500">
                            <tr><th className="w-12 px-4 py-3">Incluir</th><th className="px-4 py-3">Empresa</th><th className="px-4 py-3">Nicho</th><th className="px-4 py-3 text-right">Contatos</th><th className="px-4 py-3 text-right">Elegíveis</th></tr>
                          </thead>
                          <tbody className="divide-y divide-[var(--border-subtle)]">
                            {empresasDaPagina.map((empresa) => {
                              const selecionada = !(publico.selecao?.excluirEmpresas ?? []).includes(empresa.chave)
                              return (
                                <tr key={empresa.chave} className={`${selecionada ? 'bg-indigo-500/[.04]' : 'opacity-55'} hover:bg-white/[.03]`}>
                                  <td className="px-4 py-3"><input type="checkbox" className="h-4 w-4 accent-indigo-500" checked={selecionada} onChange={(e) => selecionarEmpresa(empresa.chave, e.target.checked)} aria-label={`Incluir ${empresa.nome}`} /></td>
                                  <td className="px-4 py-3 text-sm font-medium text-slate-200">{empresa.nome}</td>
                                  <td className="px-4 py-3 text-sm text-slate-400">{textoOuNaoConfigurado(empresa.segmento)}</td>
                                  <td className="px-4 py-3 text-right text-sm text-slate-400">{empresa.contatos}</td>
                                  <td className="px-4 py-3 text-right text-sm font-medium text-emerald-300">{empresa.elegiveis}</td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                        {!empresasFiltradas.length && <div className="p-6 text-center text-sm text-slate-500">Nenhuma empresa corresponde à busca.</div>}
                      </div>
                      {!!empresasFiltradas.length && (
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
                          <span>Mostrando {(paginaEmpresasSegura - 1) * EMPRESAS_POR_PAGINA + 1}–{Math.min(paginaEmpresasSegura * EMPRESAS_POR_PAGINA, empresasFiltradas.length)} de {empresasFiltradas.length} empresas</span>
                          <div className="flex items-center gap-2">
                            <button type="button" onClick={() => setPaginaEmpresas((atual) => Math.max(1, atual - 1))} disabled={paginaEmpresasSegura === 1} className="rounded-lg border border-[var(--border-strong)] px-3 py-1.5 text-slate-400 disabled:opacity-30">Anterior</button>
                            <span className="min-w-20 text-center">Página {paginaEmpresasSegura} de {totalPaginasEmpresas}</span>
                            <button type="button" onClick={() => setPaginaEmpresas((atual) => Math.min(totalPaginasEmpresas, atual + 1))} disabled={paginaEmpresasSegura === totalPaginasEmpresas} className="rounded-lg border border-[var(--border-strong)] px-3 py-1.5 text-slate-400 disabled:opacity-30">Próxima</button>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs leading-5 text-slate-500">Nenhuma empresa corresponde ao nicho e à regra de status deste objetivo.</p>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {etapa === 1 && (
        <div className="space-y-5">
          <section className={card}>
            <h2 className="mb-1 font-semibold text-slate-100">Editor da mensagem</h2>
            <p className="mb-5 text-sm text-slate-500">Escolha um template real, edite o texto ou importe um HTML exclusivo desta campanha.</p>
            <div className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] p-3">
              <span className="text-xs text-slate-500">Remetente configurado no workspace</span>
              <div className="mt-1 flex items-center gap-2 text-sm text-slate-200"><Mail size={15} className="text-indigo-400" /> {textoOuNaoConfigurado(publico.operacao?.remetenteEmail)}</div>
              {publico.operacao?.remetenteConta && <div className="mt-1 text-xs text-slate-600">Conta: {publico.operacao.remetenteConta}</div>}
            </div>
            <div className="space-y-4">
              <div>
                <label className={label}>Usar template</label>
                <select className={input} value={mensagemInicial.templateOrigemId ?? ''} onChange={(e) => aplicarTemplate(e.target.value, null)}>
                  <option value="">Escrever do zero</option>
                  {templates.map((template) => <option key={template.id} value={template.id}>{template.nome}{template.nicho ? ` · ${template.nicho}` : ''}</option>)}
                </select>
              </div>
              <div>
                <label className={label}>Assunto</label>
                <input className={input} value={mensagemInicial.assunto ?? ''} onChange={(e) => atualizarMensagem(null, { assunto: e.target.value })} placeholder="Assunto do e-mail" />
              </div>
              <div>
                <label className={label}>Mensagem</label>
                <textarea className={`${input} min-h-64 resize-y font-mono text-[13px] leading-6`} value={mensagemInicial.corpo ?? ''} onChange={(e) => atualizarMensagem(null, { corpo: e.target.value })} placeholder="Olá {nome}, ..." />
                <p className="mt-1.5 text-xs text-slate-600">Variáveis existentes: {'{nome}'}, {'{empresa}'}, {'{segmento}'}, {'{cidade}'}, {'{responsavel_comercial}'}, {'{data_validade}'} e {'{nome_servico}'}.</p>
              </div>
              <div>
                <label className={label}>Link complementar (opcional)</label>
                <input type="url" className={input} value={mensagemInicial.link ?? ''} onChange={(e) => atualizarMensagem(null, { link: e.target.value })} placeholder="https://..." />
              </div>
              <ModeloEmailPicker
                modeloId={mensagemInicial.modeloId}
                campos={mensagemInicial.modeloCampos}
                temHtmlProprio={!!mensagemInicial.html?.trim()}
                onAplicar={({ modeloId, modeloCampos, html, texto }) => atualizarMensagem(null, {
                  modeloId,
                  modeloCampos,
                  html,
                  // Só preenche o texto puro enquanto o autor não escreveu o dele:
                  // o corpo é o fallback de quem lê e-mail sem HTML.
                  ...(!mensagemInicial.corpo?.trim() || mensagemInicial.modeloId ? { corpo: texto } : {}),
                })}
                onLimpar={() => atualizarMensagem(null, { modeloId: undefined, modeloCampos: undefined, html: undefined })}
              />
              <HtmlEmailEditor
                html={mensagemInicial.html}
                previewHtml={htmlMensagemInicial}
                titulo="Ou use um HTML próprio"
                descricao="Para quem já tem a peça pronta. Carregue um arquivo HTML/TXT, arraste-o aqui ou cole o código — ele substitui o modelo escolhido acima."
                onChange={(html, textoAlternativo) => atualizarMensagem(null, {
                  html,
                  ...(!mensagemInicial.corpo?.trim() && textoAlternativo ? { corpo: textoAlternativo } : {}),
                })}
                onErro={setErro}
              />
            </div>
          </section>

          <section className={card}>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-slate-100">Prévia e teste</h2>
                <p className="text-xs text-slate-500">Confira o e-mail e envie um teste antes de publicar.</p>
              </div>
              <FileText size={18} className="text-indigo-400" />
            </div>
            <div className="rounded-xl border border-[var(--border-strong)] bg-[var(--bg-subtle)] p-4">
              <div className="text-xs text-slate-400">
                <div><span className="text-slate-500">De:</span> {textoOuNaoConfigurado(publico.operacao?.remetenteEmail)}</div>
                <div className="mt-1"><span className="text-slate-500">Assunto:</span> {textoOuNaoConfigurado(mensagemInicial.assunto)}</div>
              </div>
              <button
                type="button"
                onClick={() => { setAbaPreviaCliente('visual'); setPreviaCliente(true) }}
                className="mt-3 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-500"
              >
                <Maximize2 size={15} /> Ver como o cliente recebe
              </button>
              <p className="mt-2 text-xs text-slate-600">Abre em janela própria, com rolagem interna.</p>
            </div>
            <button
              type="button"
              onClick={() => setEstadoTesteEmail('confirmando')}
              disabled={
                carregandoOpcoes
                || estadoTesteEmail === 'enviando'
                || !testeEmailDisponivel
                || !publico.operacao?.remetenteEmail
                || !mensagemInicial.assunto?.trim()
                || !mensagemInicial.corpo?.trim()
                || !responsavel
              }
              title={!publico.operacao?.remetenteEmail
                ? 'Configure uma conta remetente no workspace.'
                : !testeEmailDisponivel
                  ? 'O motor está em modo ensaio; o Gmail real permanece bloqueado.'
                : !responsavel
                  ? 'Defina o responsável pelos retornos.'
                  : 'Envia somente para a própria conta remetente.'}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-indigo-500/40 px-4 py-2.5 text-sm text-indigo-300 hover:bg-indigo-500/10 disabled:cursor-not-allowed disabled:border-[var(--border-strong)] disabled:text-slate-600"
            >
              {estadoTesteEmail === 'enviando' ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
              Enviar teste para {textoOuNaoConfigurado(publico.operacao?.remetenteEmail)}
            </button>
            {estadoTesteEmail === 'enviado' && (
              <p role="status" className="mt-3 flex items-center justify-center gap-2 text-sm text-emerald-300">
                <Check size={15} /> Teste enviado para {destinatarioTeste}
              </p>
            )}
            {!carregandoOpcoes && publico.operacao?.remetenteEmail && !testeEmailDisponivel && (
              <p className="mt-3 text-center text-xs text-amber-300">Envio indisponível enquanto o motor estiver em modo ensaio.</p>
            )}
            <PreviaEmailModal
              aberto={previaCliente}
              onFechar={() => setPreviaCliente(false)}
              titulo="Como o cliente recebe"
              de={textoOuNaoConfigurado(publico.operacao?.remetenteEmail)}
              assunto={textoOuNaoConfigurado(mensagemInicial.assunto)}
              html={htmlMensagemInicial}
              codigo={mensagemInicial.html}
              aba={abaPreviaCliente}
              onAba={setAbaPreviaCliente}
            />
          </section>
        </div>
      )}

      {etapa === 2 && (
        <div className="space-y-5">
          {disparoUnico ? (
            <section className={card}>
              <div className="flex items-start gap-3">
                <span className="rounded-xl bg-indigo-500/15 p-2.5 text-indigo-300"><Send size={20} /></span>
                <div>
                  <h2 className="font-semibold text-slate-100">Disparo único</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-400">
                    Esta comunicação enviará somente a mensagem inicial ao público confirmado. Não há agenda semanal nem follow-ups, e a campanha será concluída quando o processamento desse público terminar.
                  </p>
                </div>
              </div>
            </section>
          ) : (
          <div className="grid gap-5 lg:grid-cols-[1.1fr_.9fr]">
            <section className={card}>
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold text-slate-100">Cadência de acompanhamento</h2>
                <p className="mt-1 text-sm text-slate-500">Os intervalos viram esperas persistentes no workflow versionado.</p>
              </div>
              <button type="button" onClick={adicionarFollowup} disabled={followups.length >= 4} className="rounded-lg border border-indigo-500/40 px-3 py-2 text-xs text-indigo-300 hover:bg-indigo-500/10 disabled:opacity-40">Adicionar follow-up</button>
            </div>
            {!followups.length && <div className="rounded-lg border border-dashed border-[var(--border-strong)] p-6 text-center text-sm text-slate-500">Nenhum follow-up configurado. A campanha terá somente a mensagem inicial.</div>}
            <div className="space-y-4">
              {followups.map((followup, indice) => (
                <div key={indice} className="rounded-xl border border-[var(--border-strong)] bg-[var(--bg-subtle)] p-4">
                  <div className="mb-4 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-medium text-slate-200"><Clock3 size={15} className="text-indigo-400" /> Follow-up {indice + 1}</div>
                    <button type="button" onClick={() => removerFollowup(indice)} className="rounded p-1.5 text-slate-500 hover:bg-red-500/10 hover:text-red-300" aria-label={`Remover follow-up ${indice + 1}`}><Trash2 size={15} /></button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-[130px_1fr]">
                    <div>
                      <label className={label}>Enviar no dia</label>
                      <input type="number" min={1} className={input} value={followup.diasApos ?? ''} onChange={(e) => atualizarMensagem(indice, { diasApos: Number(e.target.value) } as Partial<FollowupCampanha>)} />
                    </div>
                    <div>
                      <label className={label}>Template</label>
                      <select className={input} value={followup.templateOrigemId ?? ''} onChange={(e) => aplicarTemplate(e.target.value, indice)}>
                        <option value="">Escrever do zero</option>
                        {templates.map((template) => <option key={template.id} value={template.id}>{template.nome}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="mt-3">
                    <label className={label}>Assunto</label>
                    <input className={input} value={followup.assunto ?? ''} onChange={(e) => atualizarMensagem(indice, { assunto: e.target.value })} />
                  </div>
                  <div className="mt-3">
                    <label className={label}>Mensagem</label>
                    <textarea className={`${input} min-h-32 resize-y`} value={followup.corpo ?? ''} onChange={(e) => atualizarMensagem(indice, { corpo: e.target.value })} />
                  </div>
                  <div className="mt-3">
                    <label className={label}>Link complementar (opcional)</label>
                    <input type="url" className={input} value={followup.link ?? ''} onChange={(e) => atualizarMensagem(indice, { link: e.target.value })} placeholder="https://..." />
                  </div>
                  <div className="mt-4">
                    <HtmlEmailEditor
                      html={followup.html}
                      previewHtml={montarEmailCampanhaHtml(followup.corpo?.trim() || 'Não configurado', { responsavelNome: nomeMembro(responsavel) }, followup.html)}
                      titulo={`HTML do follow-up ${indice + 1}`}
                      onChange={(html, textoAlternativo) => atualizarMensagem(indice, {
                        html,
                        ...(!followup.corpo?.trim() && textoAlternativo ? { corpo: textoAlternativo } : {}),
                      })}
                      onErro={setErro}
                    />
                  </div>
                </div>
              ))}
            </div>
            </section>

            <section className={card}>
              <h2 className="mb-1 font-semibold text-slate-100">Janela operacional</h2>
              <p className="mb-4 text-sm text-slate-500">A preferência fica registrada para conferência. O processamento continua seguindo o cron existente.</p>
              <div className="mb-4 flex flex-wrap gap-2">
                {DIAS.map((dia) => {
                  const ativo = publico.agenda?.diasSemana?.includes(dia.id) ?? false
                  return <button key={dia.id} type="button" onClick={() => atualizarAgenda({ diasSemana: ativo ? publico.agenda?.diasSemana?.filter((id) => id !== dia.id) : [...(publico.agenda?.diasSemana ?? []), dia.id] })} className={`rounded-lg border px-3 py-2 text-xs ${ativo ? 'border-indigo-500 bg-indigo-500/10 text-indigo-200' : 'border-[var(--border-strong)] text-slate-500'}`}>{dia.label}</button>
                })}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={label}>Início</label><input type="time" className={input} value={publico.agenda?.horarioInicio ?? '09:00'} onChange={(e) => atualizarAgenda({ horarioInicio: e.target.value })} /></div>
                <div><label className={label}>Fim</label><input type="time" className={input} value={publico.agenda?.horarioFim ?? '18:00'} onChange={(e) => atualizarAgenda({ horarioFim: e.target.value })} /></div>
              </div>
            </section>
          </div>
          )}

          <section className={card}>
            <div className="mb-5">
              <h2 className="mb-1 font-semibold text-slate-100">Quando houver resposta</h2>
              <p className="text-sm text-slate-500">{disparoUnico ? 'A resposta será registrada e encaminhada ao responsável configurado.' : 'A resposta interrompe a abordagem.'} {canaisRetorno === 'whatsapp'
                ? 'O responsável é avisado só no WhatsApp de avisos; o e-mail de retorno está desligado (escolha feita na etapa Público).'
                : 'O responsável recebe o e-mail de retorno descrito abaixo e o aviso no WhatsApp de avisos.'}</p>
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-medium text-emerald-300"><ShieldCheck size={17} /> Ações automáticas</div>
                <ul className="space-y-2 text-sm leading-6 text-slate-300">
                  <li className="flex gap-2"><Check size={15} className="mt-1 shrink-0 text-emerald-400" /> {disparoUnico ? 'Não criar novos envios desta comunicação' : 'Parar a cadência desta campanha'}</li>
                  <li className="flex gap-2"><Check size={15} className="mt-1 shrink-0 text-emerald-400" /> Cancelar outros workflows ativos do contato</li>
                  <li className="flex gap-2"><Check size={15} className="mt-1 shrink-0 text-emerald-400" /> Registrar a resposta no histórico</li>
                </ul>
              </div>
              <div className="rounded-xl border border-[var(--border-strong)] bg-[var(--bg-subtle)] p-4">
                <div className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500">Responsável pelo retorno</div>
                <div className="text-sm font-medium text-slate-200">
                  {retornoPorCarteira ? 'Responsável de cada lead' : nomeMembro(responsavel)}
                </div>
                <div className="mt-1 break-all text-xs text-slate-500">
                  {retornoPorCarteira
                    ? `Fallback: ${nomeMembro(responsavel)}${responsavel?.email ? ` <${responsavel.email}>` : ''}`
                    : textoOuNaoConfigurado(responsavel?.email)}
                </div>
                <p className="mt-4 text-xs leading-5 text-slate-500">{retornoPorCarteira
                  ? 'Cada resposta vai para o responsável gravado no lead; sem responsável com e-mail, o motor usa o fallback acima.'
                  : responsavel?.email ? 'A campanha prioriza este responsável quando encaminha a oportunidade.' : 'Sem e-mail neste perfil, o motor mantém os fallbacks existentes.'}</p>
              </div>
              {canaisRetorno === 'whatsapp' ? (
                <div className="rounded-xl border border-indigo-500/25 bg-indigo-500/5 p-4">
                  <div className="mb-3 flex items-center gap-2 text-sm font-medium text-indigo-200"><MessageCircle size={16} /> WhatsApp ao responsável</div>
                  <div className="text-sm text-slate-200">Somente WhatsApp</div>
                  <p className="mt-3 text-xs leading-5 text-slate-500">A cada resposta, o número de avisos do responsável recebe empresa, contato, o trecho da resposta e o link do lead. Não há e-mail de retorno nesta campanha.</p>
                </div>
              ) : (
                <div className="rounded-xl border border-indigo-500/25 bg-indigo-500/5 p-4">
                  <div className="mb-3 flex items-center gap-2 text-sm font-medium text-indigo-200"><Mail size={16} /> E-mail e WhatsApp ao responsável</div>
                  <div className="text-xs text-slate-500">Assunto do e-mail</div>
                  <div className="mt-1 break-words text-sm text-slate-300">{textoOuNaoConfigurado(resposta?.emailAssunto)}</div>
                  <p className="mt-3 text-xs leading-5 text-slate-500">
                    O WhatsApp de avisos chega a cada resposta.
                    {tipo === 'prospeccao'
                      ? ' Na prospecção, o e-mail sai quando a leitura automática indica interesse.'
                      : ' O e-mail usa o modelo abaixo, editável.'}
                  </p>
                </div>
              )}
            </div>
            {canaisRetorno !== 'whatsapp' && <div className="mt-4 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-subtle)] p-4">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium text-slate-200">Modelo do e-mail de resposta</h3>
                  <p className="mt-1 text-xs text-slate-500">Sugestão pré-preenchida conforme o objetivo. O conteúdo não fica travado.</p>
                </div>
                <button type="button" onClick={() => {
                  const modelo = modeloEmailRespostaCampanha(tipo)
                  atualizarResposta({ emailAssunto: modelo.assunto, emailCorpo: modelo.corpo })
                }} className="rounded-lg border border-[var(--border-strong)] px-3 py-2 text-xs text-slate-400 hover:text-slate-200">Restaurar modelo sugerido</button>
              </div>
              <div>
                <label className={label}>Assunto enviado ao responsável</label>
                <input className={input} value={resposta?.emailAssunto ?? ''} onChange={(e) => atualizarResposta({ emailAssunto: e.target.value })} />
              </div>
              <div className="mt-3">
                <label className={label}>Conteúdo enviado ao responsável</label>
                <textarea className={`${input} min-h-56 resize-y font-mono text-[13px] leading-6`} value={resposta?.emailCorpo ?? ''} onChange={(e) => atualizarResposta({ emailCorpo: e.target.value })} />
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-600">Variáveis disponíveis: {VARIAVEIS_EMAIL_RESPOSTA.join(', ')}.</p>
              <div className="mt-4">
                <HtmlEmailEditor
                  html={resposta?.emailHtml}
                  previewHtml={htmlResposta}
                  titulo="HTML do e-mail de retorno ao responsável"
                  descricao="Este conteúdo será usado somente na notificação enviada ao responsável quando o lead responder. Você pode carregar um arquivo ou colar o código."
                  onChange={(emailHtml, textoAlternativo) => atualizarResposta({
                    emailHtml,
                    ...(!resposta?.emailCorpo?.trim() && textoAlternativo ? { emailCorpo: textoAlternativo } : {}),
                  })}
                  onErro={setErro}
                />
              </div>
            </div>}
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <div className="rounded-lg border border-[var(--border)] p-3 text-sm text-slate-500">Tarefa automática: <span className="text-slate-400">Não configurado</span></div>
              <div className="rounded-lg border border-[var(--border)] p-3 text-sm text-slate-500">Notificação a administradores: <span className="text-slate-400">Não configurado</span></div>
              <div className="rounded-lg border border-[var(--border)] p-3 text-sm text-slate-500">Sugestão de resposta: <span className="text-slate-400">Não configurado</span></div>
            </div>
          </section>
        </div>
      )}

      {etapa === 3 && (
        <div className="space-y-5">
          <section className={card}>
            <h2 className="mb-1 font-semibold text-slate-100">Resumo em linguagem simples</h2>
            <p className="mb-5 text-sm text-slate-500">Revise exatamente o que está configurado antes de ativar.</p>
            <div className="rounded-xl border border-indigo-500/25 bg-indigo-500/5 p-5 text-sm leading-7 text-slate-300">
              Esta campanha de <strong className="text-slate-100">{labelTipoCampanha(tipo).toLowerCase()}</strong> enviará
              {' '}<strong className="text-slate-100">{textoOuNaoConfigurado(mensagemInicial.assunto)}</strong> para
              {' '}<strong className="text-slate-100">{previa?.elegiveis ?? 'um número não calculado de'} contato(s) elegível(is)</strong>, usando
              {' '}<strong className="text-slate-100">{textoOuNaoConfigurado(publico.operacao?.remetenteEmail)}</strong>.
              {disparoUnico ? (
                <> Este é um <strong className="text-slate-100">disparo único</strong>, sem agenda recorrente ou follow-up.</>
              ) : (
                <> A cadência será: <strong className="text-slate-100">{resumoCadencia}</strong>.</>
              )}
              {' '}Se alguém responder, o retorno será encaminhado {retornoPorCarteira ? 'ao' : 'a'}
              {' '}<strong className="text-slate-100">{destinoRetorno}</strong>
              {' '}por <strong className="text-slate-100">{canaisRetorno === 'whatsapp' ? 'WhatsApp' : 'e-mail e WhatsApp'}</strong>.
              {' '}{responsavelRecebe === 'somente_respostas'
                ? <>Os e-mails ao cliente saem <strong className="text-slate-100">sem o responsável em cópia</strong>.</>
                : <>O responsável vai <strong className="text-slate-100">em cópia de cada e-mail</strong> enviado ao cliente.</>}
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {[
                ['Público', previa ? `${previa.elegiveis} elegíveis de ${previa.totalSelecionado} selecionados` : 'Não configurado'],
                ['Remetente', textoOuNaoConfigurado(publico.operacao?.remetenteEmail)],
                ['Responsável', destinoRetorno],
                ['Mensagem', textoOuNaoConfigurado(mensagemInicial.assunto)],
                [disparoUnico ? 'Envio' : 'Cadência', resumoCadencia],
                ['Regra de resposta', disparoUnico ? 'Encaminhar ao responsável' : 'Parar cadência e encaminhar ao responsável'],
                ['O responsável recebe', ROTULO_RESPONSAVEL_RECEBE[responsavelRecebe]],
                ['Aviso de resposta', ROTULO_CANAIS_RETORNO[canaisRetorno]],
                ['Status', campanha?.status ?? 'rascunho'],
                ['Próxima ação', disparoUnico ? 'Disparar comunicação' : tipo === 'prospeccao' ? 'Iniciar prospecção' : 'Iniciar campanha'],
              ].map(([titulo, valor]) => (
                <div key={titulo} className="rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] p-3">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-slate-600">{titulo}</div>
                  <div className="mt-1 text-sm text-slate-300">{valor}</div>
                </div>
              ))}
            </div>
          </section>

          <section className={card}>
            <div className="mb-4">
              <h2 className="font-semibold text-slate-100">Resumo do público</h2>
              <p className="mt-1 text-sm text-slate-500">Visão consolidada somente com dados calculados na prévia atual.</p>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              {[
                ['Contatos selecionados', previa?.totalSelecionado],
                ['Empresas incluídas', previa?.totalEmpresasSelecionadas],
                ['Contatos elegíveis', previa?.elegiveis],
                ['Duplicados removidos', previa?.duplicados],
                ['E-mails sem validade', previa?.emailsAusentesOuInvalidos],
                ['Bloqueados', previa?.bloqueados],
              ].map(([rotulo, valor]) => (
                <div key={rotulo} className="rounded-xl border border-[var(--border)] bg-[var(--bg-subtle)] p-4">
                  <div className="text-2xl font-semibold text-slate-100">{valor ?? '—'}</div>
                  <div className="mt-1 text-xs leading-5 text-slate-500">{rotulo}</div>
                </div>
              ))}
            </div>
            {!!previa?.empresas.length && (
              <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--bg-subtle)] p-4">
                <div className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500">Empresas incluídas</div>
                <div className="flex flex-wrap gap-2">
                  {previa.empresas.filter((empresa) => empresa.selecionada).slice(0, 8).map((empresa) => (
                    <span key={empresa.chave} className="rounded-full border border-indigo-500/25 bg-indigo-500/10 px-3 py-1.5 text-xs text-indigo-100">{empresa.nome} · {textoOuNaoConfigurado(empresa.segmento)}</span>
                  ))}
                  {previa.totalEmpresasSelecionadas > 8 && <span className="px-2 py-1.5 text-xs text-slate-500">+ {previa.totalEmpresasSelecionadas - 8} empresa(s)</span>}
                </div>
              </div>
            )}
          </section>

          <section className={`${card} self-start`}>
            <div className="mb-4 flex items-center gap-2 text-emerald-300"><ShieldCheck size={19} /><span className="font-medium">Ativação segura</span></div>
            <ul className="space-y-2 text-sm leading-6 text-slate-400">
              <li>• O público será recalculado no servidor.</li>
              <li>• O workflow ganhará uma versão imutável.</li>
              <li>• As inscrições serão criadas somente para os contatos elegíveis confirmados.</li>
              <li>• A primeira mensagem entra na fila imediatamente; as seguintes são espaçadas em 2 minutos.</li>
              <li>• O responsável comercial receberá uma cópia de cada e-mail.</li>
              <li>• O processamento respeita bloqueios e idempotência{disparoUnico ? '; esta comunicação não cria recorrência.' : ', além da agenda configurada.'}</li>
            </ul>
            <button type="button" onClick={solicitarInicioReal} disabled={!!salvando || carregandoPrevia || carregandoOpcoes || !envioRealDisponivel} title={!envioRealDisponivel ? 'Envio real indisponível: revise MODO_ENSAIO e a conta Gmail no Vercel.' : undefined} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-3 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50">
              {salvando === 'iniciar' ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} {disparoUnico ? 'Disparar comunicação' : tipo === 'prospeccao' ? 'Iniciar prospecção' : 'Iniciar campanha'}
            </button>
            <button type="button" onClick={solicitarAtivacao} disabled={!!salvando || carregandoPrevia || carregandoOpcoes} className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--border-strong)] px-4 py-2.5 text-sm text-slate-400 hover:border-indigo-500/50 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-50">
              {salvando === 'ativar' && <Loader2 size={15} className="animate-spin" />} Publicar somente em modo ensaio
            </button>
          </section>
        </div>
      )}

      <div className="mt-6 flex items-center justify-between border-t border-[var(--border-subtle)] pt-5">
        <button type="button" onClick={() => irParaEtapa(etapa - 1)} disabled={etapa === 0} className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-strong)] px-4 py-2 text-sm text-slate-400 hover:text-slate-200 disabled:opacity-30"><ArrowLeft size={15} /> Voltar</button>
        {etapa < PASSOS.length - 1 && <button type="button" onClick={() => irParaEtapa(etapa + 1)} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">Continuar <ArrowRight size={15} /></button>}
      </div>

      {confirmando && previa && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="confirmar-campanha">
          <div className="w-full max-w-md rounded-xl border border-[var(--border-strong)] bg-[var(--bg-card)] p-6 shadow-2xl">
            <div className="mb-3 flex items-center gap-2 text-amber-300">
              <AlertTriangle size={20} />
              <h2 id="confirmar-campanha" className="font-semibold">
                {modoConfirmacao === 'real'
                  ? (disparoUnico ? 'Disparar comunicação' : tipo === 'prospeccao' ? 'Iniciar prospecção' : 'Iniciar campanha')
                  : 'Publicar em modo ensaio'}
              </h2>
            </div>
            <p className="text-sm leading-6 text-slate-400">
              O servidor calculou <strong className="text-slate-200">{previa.elegiveis} contatos elegíveis</strong>.{' '}
              {modoConfirmacao === 'real'
                ? `Ao confirmar, a primeira mensagem entrará na fila imediatamente e as demais serão espaçadas em 2 minutos, sempre com cópia para o responsável comercial.${disparoUnico ? ' Este disparo não cria recorrência ou follow-up.' : ''} Digite essa quantidade para iniciar.`
                : 'Digite essa quantidade para confirmar a publicação sem criar inscrições.'}
            </p>
            <input autoFocus inputMode="numeric" className={`${input} mt-4`} value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} placeholder={String(previa.elegiveis)} />
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmando(false)} className="rounded-lg border border-[var(--border-strong)] px-4 py-2 text-sm text-slate-400">Cancelar</button>
              <button
                type="button"
                onClick={() => modoConfirmacao === 'real' ? void iniciarReal(previa.elegiveis) : void ativar(previa.elegiveis)}
                disabled={confirmacao !== String(previa.elegiveis) || !!salvando}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                {(salvando === 'ativar' || salvando === 'iniciar') && <Loader2 size={14} className="animate-spin" />}
                {modoConfirmacao === 'real' ? (disparoUnico ? 'Disparar' : 'Iniciar') : 'Publicar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {estadoTesteEmail === 'confirmando' && testeEmailDisponivel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="confirmar-teste-email">
          <div className="w-full max-w-md rounded-xl border border-[var(--border-strong)] bg-[var(--bg-card)] p-6 shadow-2xl">
            <div className="mb-3 flex items-center gap-2 text-indigo-300">
              <Mail size={20} />
              <h2 id="confirmar-teste-email" className="font-semibold">Enviar um teste agora?</h2>
            </div>
            <p className="text-sm leading-6 text-slate-400">
              A prévia será enviada por <strong className="text-slate-200">{publico.operacao?.remetenteEmail}</strong> para esse mesmo endereço, com o prefixo <strong className="text-slate-200">[TESTE]</strong> no assunto.
            </p>
            <div className="mt-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs leading-5 text-emerald-200">
              Este teste não salva a campanha, não inscreve leads e não inicia a cadência.
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setEstadoTesteEmail('ocioso')} className="rounded-lg border border-[var(--border-strong)] px-4 py-2 text-sm text-slate-400">Cancelar</button>
              <button type="button" onClick={() => void enviarTesteEmail()} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">
                <Send size={14} /> Enviar teste
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
