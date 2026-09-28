// Disciplina do blob `organizacoes.configuracoes` (jsonb, migration 0014).
//
// REGRA: este blob guarda SÓ preferências FLEXÍVEIS por workspace — coisas que
// variam livremente e não valem uma tabela (widgets visíveis no dashboard,
// nomenclaturas comerciais seguras, toggles de módulo). Nada ESTRUTURAL entra
// aqui: pipelines, campos customizados, permissões, oportunidades — isso é
// tabela/coluna real, com FK e RLS. Se um dado precisa de integridade,
// relacionamento ou query, ele NÃO é preferência flexível.
//
// Disciplina obrigatória (pedido do Chico):
//   - schema tipado (WorkspaceConfig)
//   - validação na escrita (serializeWorkspaceConfig é o ÚNICO ponto de escrita)
//   - versionamento do próprio blob (_schema_version) com migração entre versões
// Sem dependência externa: validação enxuta à mão (o schema é pequeno e cresce
// junto com as fases). Se a superfície crescer muito, aí sim avaliamos um zod.

// Suba este número ao mudar o formato do blob, e adicione o passo em `migrar()`.
export const WORKSPACE_CONFIG_SCHEMA_VERSION = 7

// Objetivos que o produto já consegue medir de ponta a ponta. Novos objetivos
// só entram nesta allowlist quando houver dado operacional real para dashboard,
// fila, campanha e relatório — não basta exibir um card na configuração.
export const OBJETIVOS_OPERACIONAIS = ['prospeccao', 'vencimentos_laudos'] as const
export type ObjetivoOperacional = (typeof OBJETIVOS_OPERACIONAIS)[number]

export interface MetasMensaisOperacao {
  contatos?: number
  reunioes?: number
  renovacoes?: number
}

export interface OperacaoConfig {
  objetivoPrincipal?: ObjetivoOperacional
  objetivosAtivos?: ObjetivoOperacional[]
  relatorioSemanal?: boolean
  metasMensais?: MetasMensaisOperacao
}

export const OPERACAO_PADRAO: Required<Omit<OperacaoConfig, 'metasMensais'>> & { metasMensais: MetasMensaisOperacao } = {
  objetivoPrincipal: 'prospeccao',
  // Preserva a visão que já estava disponível para workspaces existentes.
  objetivosAtivos: ['prospeccao', 'vencimentos_laudos'],
  relatorioSemanal: true,
  metasMensais: {},
}

// Configuração de visibilidade de um campo por workspace (Personalização > Campos).
export interface CampoUI {
  chave: string       // coluna no banco (ex: 'empresa', 'data_validade')
  label: string       // nome exibido na UI
  obrigatorio: boolean
  visivel: boolean    // aparece nas listagens (Base de Leads, Pipeline)
  filtro: boolean     // aparece como filtro disponível
}

// Campos padrão (mockup Personalização > Campos). Ausência = padrão ativo.
export const CAMPOS_UI_PADRAO: CampoUI[] = [
  { chave: 'contato_nome',    label: 'Nome do contato',    obrigatorio: true,  visivel: true,  filtro: false },
  { chave: 'empresa',         label: 'Empresa',             obrigatorio: true,  visivel: true,  filtro: false },
  { chave: 'contato_email',   label: 'E-mail',              obrigatorio: false, visivel: true,  filtro: false },
  { chave: 'contato_telefone',label: 'Telefone',            obrigatorio: false, visivel: false, filtro: false },
  { chave: 'origem',          label: 'Origem',              obrigatorio: false, visivel: false, filtro: false },
  { chave: 'responsavel_id',  label: 'Responsável',         obrigatorio: false, visivel: true,  filtro: true  },
  { chave: 'estagio',         label: 'Status do contato',   obrigatorio: false, visivel: true,  filtro: true  },
  { chave: 'data_validade',   label: 'Validade do laudo',   obrigatorio: false, visivel: true,  filtro: false },
  { chave: 'proxima_acao_data', label: 'Próximo follow-up', obrigatorio: false, visivel: false, filtro: false },
  { chave: 'score',           label: 'Score',               obrigatorio: false, visivel: true,  filtro: false },
]

// Resolve config efetiva: mescla padrão com overrides gravados.
export function camposUIEfetivos(gravados?: CampoUI[]): CampoUI[] {
  if (!gravados?.length) return CAMPOS_UI_PADRAO
  const mapa = new Map(gravados.map((c) => [c.chave, c]))
  return CAMPOS_UI_PADRAO.map((p) => mapa.get(p.chave) ?? p)
}

export interface RenovacaoConfig {
  antecedenciaDias?: number       // janela: cria a tarefa N dias antes do vencimento
  templateTipo?: string           // tipo de template da 1ª mensagem de renovação
  enviarPrimeiraMensagem?: boolean // se true, dispara a 1ª mensagem (gated por MODO_ENSAIO)
  // Janela de ALERTA do laudo: a partir de quantos dias antes de vencer o ciclo
  // atual aparece como "Próximo do vencimento". Regra própria do laudo —
  // DESACOPLADA de `antecedenciaDias`, que dispara tarefa/campanha.
  alertaDias?: number
}

// Feature flags POR ORGANIZAÇÃO (toggle de módulo — preferência flexível, cabe no
// blob). Resolvidas SEMPRE no servidor; nunca expostas ao cliente. Ausência de
// uma chave = feature DESLIGADA (default seguro / legado). Migrou pra cá o que
// antes era env var (a resolução por env quebrou em produção).
export interface FeaturesConfig {
  empresaContatoReads?: boolean   // lê Empresa/Contato via entidades no LeadPanel
  // Importação: lead com data_validade nasce no estágio `renovacao` em vez de
  // `novos_leads` (lib/leads/estagioInicial.ts). Ausente = comportamento padrão.
  estagioRenovacaoPorValidade?: boolean
  // Cópia operacional nos e-mails de renovação: usa somente o responsável do
  // lead, nunca o responsável geral da campanha. Ausente = comportamento legado.
  ccResponsavelNaRenovacao?: boolean
}

// ROI (Fase 8): custo operacional de referência p/ comparar com a receita das
// oportunidades ganhas. Preferência flexível (um número), cabe no blob.
export interface RoiConfig {
  custoMensal?: number
}

// Handoff comercial (Fase 2): para onde vai o aviso de "novo lead interessado".
// ID do grupo do WhatsApp na Z-API (ex.: 120363019502650977-group). É
// configuração da organização — preferência flexível, cabe no blob — e nunca
// um env global: cada org tem o seu grupo. Ausência = aviso fica pendente
// (configuracao_ausente), o handoff em si não é afetado.
export interface ComercialConfig {
  grupoWhatsappId?: string
  // Fase 3: minutos após `comercial_handoffs.atribuido_em` para a ProspectOS
  // perguntar o status no grupo (check-in). Ausência = 7 dias. Só a org de
  // teste muda para 5 — nenhuma outra é afetada.
  handoffRevisaoMinutos?: number
  // Fase 4: campanha de FOLLOW-UP (tipo 'followup', ativa, envio real) para
  // onde o lead volta quando o grupo responde "#CODIGO 2". Ausente = usa a
  // única campanha de follow-up ativa da org; com mais de uma, é obrigatório.
  campanhaRetornoId?: string
  // Rodízio automático do handoff: distribuir resposta positiva de prospecção
  // entre os comerciais participantes. DESLIGADO por padrão (ver
  // `rodizioHandoffAtivo`) — a distribuição passou a ser por carteira do lead.
  // Só quem marcar explicitamente volta a ter o rodízio.
  rodizioHandoff?: boolean
}

export const HANDOFF_REVISAO_MINUTOS_PADRAO = 10080 // 7 dias

export function handoffRevisaoMinutosEfetivo(cfg: WorkspaceConfig | null | undefined): number {
  const v = cfg?.comercial?.handoffRevisaoMinutos
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : HANDOFF_REVISAO_MINUTOS_PADRAO
}

// Rodízio DESLIGADO por padrão: a decisão do produto é distribuir pela carteira
// do lead, não por sorteio. Org nenhuma volta a rodar rodízio por acidente de
// dado antigo — só o valor booleano `true`, gravado pela tela, reativa.
export function rodizioHandoffAtivo(cfg: WorkspaceConfig | null | undefined): boolean {
  return cfg?.comercial?.rodizioHandoff === true
}

// Perfil de busca da tela de prospecção (consulta o catálogo RF, migration 0050).
// Ausência = organização ainda não definiu o perfil; a tela pede para configurar.
export const PORTES_PROSPECCAO = ['micro', 'pequeno', 'demais', 'nao_informado'] as const
export type PorteProspeccao = (typeof PORTES_PROSPECCAO)[number]

export const UFS_BRASIL = [
  'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA',
  'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
] as const

export const PROSPECCAO_LIMITES = { cnaes: 20, municipios: 100 } as const

export const FAIXAS_FUNCIONARIOS = ['1-10', '11-50', '51-200', '201-500', '501+'] as const
export type FaixaFuncionarios = (typeof FAIXAS_FUNCIONARIOS)[number]

export const CARGOS_ALVO_PROSPECCAO = ['proprietario', 'socio', 'founder', 'diretor', 'gerente'] as const
export type CargoAlvoProspeccao = (typeof CARGOS_ALVO_PROSPECCAO)[number]

export const AREAS_ALVO_PROSPECCAO = ['ti', 'rh', 'logistica', 'operacoes', 'comercial', 'marketing', 'financeiro', 'compras'] as const
export type AreaAlvoProspeccao = (typeof AREAS_ALVO_PROSPECCAO)[number]

export interface ProspeccaoConfig {
  cnaes?: string[]          // 7 dígitos, sem máscara (ex.: '5510801')
  ufs?: string[]            // vazio = Brasil inteiro
  municipios?: string[]     // códigos de município da RF; vazio = todos das UFs
  portes?: PorteProspeccao[] // vazio = todos
  // Preferências de qualificação/enriquecimento. A fonte RF atual não possui
  // estes campos, então ainda não entram nos parâmetros da busca do catálogo.
  faixasFuncionarios?: FaixaFuncionarios[]
  cargosAlvo?: CargoAlvoProspeccao[]
  areasAlvo?: AreaAlvoProspeccao[]
  excluirMei?: boolean
  // Casar também pelo CNAE secundário. Desligado por padrão: traz empresas de
  // outro ramo que só listam a atividade como acessória.
  incluirCnaesSecundarios?: boolean
}

function listaUnica(v: unknown, valido: (s: string) => boolean, max: number): string[] {
  if (!Array.isArray(v)) return []
  return [...new Set(v.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(valido))].slice(0, max)
}

export function parseProspeccaoConfig(bruto: unknown): ProspeccaoConfig | undefined {
  if (!ehObjeto(bruto)) return undefined
  const p: ProspeccaoConfig = {}
  const cnaes = listaUnica(bruto.cnaes, (s) => /^\d{7}$/.test(s), PROSPECCAO_LIMITES.cnaes)
  const ufs = listaUnica(bruto.ufs, (s) => (UFS_BRASIL as readonly string[]).includes(s), UFS_BRASIL.length)
  const municipios = listaUnica(bruto.municipios, (s) => /^\d{1,7}$/.test(s), PROSPECCAO_LIMITES.municipios)
  const portes = listaUnica(bruto.portes, (s) => (PORTES_PROSPECCAO as readonly string[]).includes(s), PORTES_PROSPECCAO.length)
  const faixasFuncionarios = listaUnica(bruto.faixasFuncionarios, (s) => (FAIXAS_FUNCIONARIOS as readonly string[]).includes(s), FAIXAS_FUNCIONARIOS.length)
  const cargosAlvo = listaUnica(bruto.cargosAlvo, (s) => (CARGOS_ALVO_PROSPECCAO as readonly string[]).includes(s), CARGOS_ALVO_PROSPECCAO.length)
  const areasAlvo = listaUnica(bruto.areasAlvo, (s) => (AREAS_ALVO_PROSPECCAO as readonly string[]).includes(s), AREAS_ALVO_PROSPECCAO.length)
  if (cnaes.length) p.cnaes = cnaes
  if (ufs.length) p.ufs = ufs
  if (municipios.length) p.municipios = municipios
  if (portes.length) p.portes = portes as PorteProspeccao[]
  if (faixasFuncionarios.length) p.faixasFuncionarios = faixasFuncionarios as FaixaFuncionarios[]
  if (cargosAlvo.length) p.cargosAlvo = cargosAlvo as CargoAlvoProspeccao[]
  if (areasAlvo.length) p.areasAlvo = areasAlvo as AreaAlvoProspeccao[]
  if (typeof bruto.excluirMei === 'boolean') p.excluirMei = bruto.excluirMei
  if (typeof bruto.incluirCnaesSecundarios === 'boolean') p.incluirCnaesSecundarios = bruto.incluirCnaesSecundarios
  return Object.keys(p).length ? p : undefined
}

// Pesquisas salvas da Prospecção ("Hotéis SP | Microempresa | 40 empresas").
// Ficam FORA do perfil: o perfil é substituído/limpo inteiro no PUT, e limpar
// o perfil não pode apagar as pesquisas da equipe.
export const PESQUISAS_LIMITES = { total: 20, nome: 60, quantidadeMax: 500 } as const

export interface FiltrosPesquisaSalva extends ProspeccaoConfig {
  soComEmail?: boolean
}

export interface PesquisaSalva {
  id: string
  nome: string
  filtros: FiltrosPesquisaSalva
  quantidade: number | null // null = sem limite
  criadaEm: string
}

export function parseFiltrosPesquisa(bruto: unknown): FiltrosPesquisaSalva | undefined {
  const base = parseProspeccaoConfig(bruto)
  // Sem atividade a busca não roda: pesquisa sem CNAE não é válida.
  if (!base?.cnaes?.length) return undefined
  const f: FiltrosPesquisaSalva = { ...base }
  if (ehObjeto(bruto) && bruto.soComEmail === true) f.soComEmail = true
  return f
}

export function quantidadeValida(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= PESQUISAS_LIMITES.quantidadeMax ? v : null
}

export function parsePesquisasSalvas(bruto: unknown): PesquisaSalva[] | undefined {
  if (!Array.isArray(bruto)) return undefined
  const vistos = new Set<string>()
  const lista: PesquisaSalva[] = []
  for (const item of bruto) {
    if (!ehObjeto(item) || typeof item.id !== 'string' || !item.id || vistos.has(item.id)) continue
    const nome = typeof item.nome === 'string' ? item.nome.trim().slice(0, PESQUISAS_LIMITES.nome) : ''
    const filtros = parseFiltrosPesquisa(item.filtros)
    if (!nome || !filtros) continue
    vistos.add(item.id)
    lista.push({
      id: item.id,
      nome,
      filtros,
      quantidade: quantidadeValida(item.quantidade),
      criadaEm: typeof item.criadaEm === 'string' ? item.criadaEm : '',
    })
    if (lista.length >= PESQUISAS_LIMITES.total) break
  }
  return lista.length ? lista : undefined
}

export interface WorkspaceConfig {
  _schema_version: number
  prospeccao?: ProspeccaoConfig
  prospeccaoPesquisas?: PesquisaSalva[]
  // Chaves das preferências. Todas OPCIONAIS — ausência = padrão do produto.
  // Crescem nas fases seguintes (dashboard, Configurações > Processo comercial).
  dashboardWidgets?: string[]
  nomenclaturas?: Record<string, string>
  modulos?: Record<string, boolean>
  features?: FeaturesConfig
  renovacao?: RenovacaoConfig
  operacao?: OperacaoConfig
  roi?: RoiConfig
  comercial?: ComercialConfig
  // Configuração de campos por workspace (Personalização > Campos). Ausência = todos no padrão.
  camposUI?: CampoUI[]
}

// Chaves de feature conhecidas (tipadas). Só estas são aceitas na leitura do
// blob — valor com tipo errado ou chave desconhecida é descartado.
const FEATURES_BOOLEANAS: (keyof FeaturesConfig)[] = [
  'empresaContatoReads',
  'estagioRenovacaoPorValidade',
  'ccResponsavelNaRenovacao',
]

// Padrões de renovação (usados quando o workspace não configurou). NÃO hardcoda
// no motor: são defaults do produto, sobrescrevíveis por org via o jsonb.
export const RENOVACAO_PADRAO: Required<RenovacaoConfig> = {
  antecedenciaDias: 45,
  templateTipo: 'renovacao_1',
  enviarPrimeiraMensagem: true,
  alertaDias: 30,
}

// Blob de um workspace recém-criado: só a versão atual, tudo no padrão.
export function configPadrao(): WorkspaceConfig {
  return { _schema_version: WORKSPACE_CONFIG_SCHEMA_VERSION }
}

// Migra um blob de QUALQUER versão anterior para a atual. Idempotente. Blob sem
// _schema_version (ex.: o default '{}' da migration) é tratado como versão 0.
function migrar(bruto: Record<string, unknown>): Record<string, unknown> {
  const v = typeof bruto._schema_version === 'number' ? bruto._schema_version : 0
  let cfg: Record<string, unknown> = { ...bruto }
  // v0 -> v1: primeira versão formal; nada a transformar, só carimba a versão.
  if (v < 1) cfg = { ...cfg, _schema_version: 1 }
  // v1 -> v2: adiciona camposUI (Personalização). Nada a migrar, ausência = padrão.
  if (v < 2) cfg = { ...cfg, _schema_version: 2 }
  // v2 -> v3: adiciona operação/objetivos. Ausência preserva o padrão legado.
  if (v < 3) cfg = { ...cfg, _schema_version: 3 }
  // v3 -> v4: adiciona comercial (grupo de avisos do handoff). Ausência = sem grupo.
  if (v < 4) cfg = { ...cfg, _schema_version: 4 }
  // v4 -> v5: adiciona prospeccao (perfil de busca). Ausência = perfil não definido.
  if (v < 5) cfg = { ...cfg, _schema_version: 5 }
  // v5 -> v6: adiciona prospeccaoPesquisas (pesquisas salvas). Ausência = nenhuma.
  if (v < 6) cfg = { ...cfg, _schema_version: 6 }
  // v6 -> v7: adiciona preferências de qualificação da Prospecção. Ausência = nenhuma.
  if (v < 7) cfg = { ...cfg, _schema_version: 7 }
  return cfg
}

const ehObjeto = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === 'object' && !Array.isArray(x)

// Lê o blob do banco e devolve um WorkspaceConfig válido e normalizado. NUNCA
// lança: blob vazio/ inválido cai nos padrões. Migra a versão e força os tipos
// das chaves conhecidas (descarta valores com tipo errado, preserva o resto).
export function parseWorkspaceConfig(bruto: unknown): WorkspaceConfig {
  const obj = ehObjeto(bruto) ? migrar(bruto) : {}
  const out: WorkspaceConfig = { _schema_version: WORKSPACE_CONFIG_SCHEMA_VERSION }

  if (Array.isArray(obj.dashboardWidgets)) {
    out.dashboardWidgets = obj.dashboardWidgets.filter((x): x is string => typeof x === 'string')
  }
  if (ehObjeto(obj.nomenclaturas)) {
    out.nomenclaturas = Object.fromEntries(
      Object.entries(obj.nomenclaturas).filter(([, v]) => typeof v === 'string'),
    ) as Record<string, string>
  }
  if (ehObjeto(obj.modulos)) {
    out.modulos = Object.fromEntries(
      Object.entries(obj.modulos).filter(([, v]) => typeof v === 'boolean'),
    ) as Record<string, boolean>
  }
  if (ehObjeto(obj.features)) {
    const f: FeaturesConfig = {}
    for (const k of FEATURES_BOOLEANAS) {
      if (typeof obj.features[k] === 'boolean') f[k] = obj.features[k] as boolean
    }
    if (Object.keys(f).length > 0) out.features = f
  }
  if (ehObjeto(obj.roi)) {
    const r = obj.roi as Record<string, unknown>
    const roi: RoiConfig = {}
    if (typeof r.custoMensal === 'number' && r.custoMensal >= 0) roi.custoMensal = r.custoMensal
    if (Object.keys(roi).length > 0) out.roi = roi
  }
  if (ehObjeto(obj.comercial)) {
    const c = obj.comercial as Record<string, unknown>
    const comercial: ComercialConfig = {}
    if (typeof c.grupoWhatsappId === 'string' && c.grupoWhatsappId.trim()) comercial.grupoWhatsappId = c.grupoWhatsappId.trim()
    if (typeof c.handoffRevisaoMinutos === 'number' && Number.isInteger(c.handoffRevisaoMinutos) && c.handoffRevisaoMinutos > 0) {
      comercial.handoffRevisaoMinutos = c.handoffRevisaoMinutos
    }
    if (typeof c.campanhaRetornoId === 'string' && c.campanhaRetornoId.trim()) comercial.campanhaRetornoId = c.campanhaRetornoId.trim()
    if (typeof c.rodizioHandoff === 'boolean') comercial.rodizioHandoff = c.rodizioHandoff
    if (Object.keys(comercial).length > 0) out.comercial = comercial
  }
  if (Array.isArray(obj.camposUI)) {
    out.camposUI = (obj.camposUI as unknown[]).filter(ehObjeto).map((c) => ({
      chave: String(c.chave ?? ''),
      label: String(c.label ?? ''),
      obrigatorio: c.obrigatorio === true,
      visivel: c.visivel !== false,
      filtro: c.filtro === true,
    })).filter((c) => c.chave)
  }
  if (ehObjeto(obj.renovacao)) {
    const r = obj.renovacao as Record<string, unknown>
    const ren: RenovacaoConfig = {}
    if (typeof r.antecedenciaDias === 'number' && r.antecedenciaDias >= 0) ren.antecedenciaDias = r.antecedenciaDias
    if (typeof r.templateTipo === 'string' && r.templateTipo) ren.templateTipo = r.templateTipo
    if (typeof r.enviarPrimeiraMensagem === 'boolean') ren.enviarPrimeiraMensagem = r.enviarPrimeiraMensagem
    if (typeof r.alertaDias === 'number' && r.alertaDias >= 0) ren.alertaDias = r.alertaDias
    if (Object.keys(ren).length > 0) out.renovacao = ren
  }
  if (ehObjeto(obj.operacao)) {
    const brutoOperacao = obj.operacao as Record<string, unknown>
    const objetivosAtivos = Array.isArray(brutoOperacao.objetivosAtivos)
      ? [...new Set(brutoOperacao.objetivosAtivos.filter(
          (x): x is ObjetivoOperacional =>
            typeof x === 'string' && (OBJETIVOS_OPERACIONAIS as readonly string[]).includes(x),
        ))]
      : undefined
    const objetivoPrincipal = typeof brutoOperacao.objetivoPrincipal === 'string'
      && (OBJETIVOS_OPERACIONAIS as readonly string[]).includes(brutoOperacao.objetivoPrincipal)
      ? brutoOperacao.objetivoPrincipal as ObjetivoOperacional
      : undefined
    const operacao: OperacaoConfig = {}
    if (objetivosAtivos?.length) operacao.objetivosAtivos = objetivosAtivos
    if (objetivoPrincipal && (!objetivosAtivos || objetivosAtivos.includes(objetivoPrincipal))) {
      operacao.objetivoPrincipal = objetivoPrincipal
    }
    if (typeof brutoOperacao.relatorioSemanal === 'boolean') {
      operacao.relatorioSemanal = brutoOperacao.relatorioSemanal
    }
    if (ehObjeto(brutoOperacao.metasMensais)) {
      const metas: MetasMensaisOperacao = {}
      for (const chave of ['contatos', 'reunioes', 'renovacoes'] as const) {
        const valor = brutoOperacao.metasMensais[chave]
        if (typeof valor === 'number' && Number.isFinite(valor) && valor > 0) metas[chave] = Math.round(valor)
      }
      if (Object.keys(metas).length) operacao.metasMensais = metas
    }
    if (Object.keys(operacao).length) out.operacao = operacao
  }
  const prospeccao = parseProspeccaoConfig(obj.prospeccao)
  if (prospeccao) out.prospeccao = prospeccao
  const pesquisas = parsePesquisasSalvas(obj.prospeccaoPesquisas)
  if (pesquisas) out.prospeccaoPesquisas = pesquisas
  return out
}

export function operacaoEfetiva(cfg: WorkspaceConfig | null | undefined): Required<Omit<OperacaoConfig, 'metasMensais'>> & { metasMensais: MetasMensaisOperacao } {
  const objetivosAtivos = cfg?.operacao?.objetivosAtivos?.length
    ? cfg.operacao.objetivosAtivos
    : OPERACAO_PADRAO.objetivosAtivos
  const principalConfigurado = cfg?.operacao?.objetivoPrincipal
  return {
    objetivosAtivos,
    objetivoPrincipal: principalConfigurado && objetivosAtivos.includes(principalConfigurado)
      ? principalConfigurado
      : objetivosAtivos[0],
    relatorioSemanal: cfg?.operacao?.relatorioSemanal ?? OPERACAO_PADRAO.relatorioSemanal,
    metasMensais: cfg?.operacao?.metasMensais ?? {},
  }
}

// Config de renovação EFETIVA de um workspace: o que ele configurou sobrepõe os
// padrões do produto. Fonte: organizacoes.configuracoes (jsonb) já parseado.
export function renovacaoEfetiva(cfg: WorkspaceConfig | null | undefined): Required<RenovacaoConfig> {
  return { ...RENOVACAO_PADRAO, ...(cfg?.renovacao ?? {}) }
}

// ÚNICO ponto de escrita: valida/normaliza e carimba a versão atual. Quem for
// gravar `organizacoes.configuracoes` DEVE passar o blob por aqui antes.
export function serializeWorkspaceConfig(cfg: Partial<WorkspaceConfig>): WorkspaceConfig {
  return parseWorkspaceConfig({ ...cfg, _schema_version: WORKSPACE_CONFIG_SCHEMA_VERSION })
}

// Campos editáveis pela tela Configurações (Processo comercial + Personalização).
// Um patch achatado e amigável à UI; a mescla preserva o resto do blob e passa
// pelo ponto único de escrita (validação/versão).
export interface WorkspaceConfigEditavel {
  nomenclaturas?: Record<string, string>
  modulos?: Record<string, boolean>
  renovacaoAntecedenciaDias?: number
  roiCustoMensal?: number
  // Grupo de avisos do handoff comercial. String vazia/null LIMPA a configuração.
  comercialGrupoWhatsappId?: string | null
  // Janela do check-in (minutos). null LIMPA (volta ao padrão de 7 dias).
  comercialHandoffRevisaoMinutos?: number | null
  // Campanha de follow-up de retorno. String vazia/null LIMPA.
  comercialCampanhaRetornoId?: string | null
  // Rodízio automático do handoff. false/null volta ao padrão (desligado).
  comercialRodizioHandoff?: boolean | null
  camposUI?: CampoUI[]
  operacao?: OperacaoConfig
  // Perfil de busca da prospecção. Substitui o perfil inteiro; null LIMPA.
  prospeccao?: ProspeccaoConfig | null
  // Pesquisas salvas. Substitui a lista inteira; lista vazia/null LIMPA.
  prospeccaoPesquisas?: PesquisaSalva[] | null
}

export function mesclarWorkspaceConfig(atual: WorkspaceConfig, patch: WorkspaceConfigEditavel): WorkspaceConfig {
  const next: Partial<WorkspaceConfig> = { ...atual }
  if (patch.nomenclaturas) next.nomenclaturas = patch.nomenclaturas
  if (patch.modulos) next.modulos = patch.modulos
  if (typeof patch.renovacaoAntecedenciaDias === 'number' && patch.renovacaoAntecedenciaDias >= 0) {
    next.renovacao = { ...atual.renovacao, antecedenciaDias: patch.renovacaoAntecedenciaDias }
  }
  if (typeof patch.roiCustoMensal === 'number' && patch.roiCustoMensal >= 0) {
    next.roi = { ...atual.roi, custoMensal: patch.roiCustoMensal }
  }
  if (patch.comercialGrupoWhatsappId !== undefined) {
    const grupo = typeof patch.comercialGrupoWhatsappId === 'string' ? patch.comercialGrupoWhatsappId.trim() : ''
    const { grupoWhatsappId: _anterior, ...resto } = next.comercial ?? atual.comercial ?? {}
    next.comercial = grupo ? { ...resto, grupoWhatsappId: grupo } : resto
  }
  if (patch.comercialHandoffRevisaoMinutos !== undefined) {
    const min = patch.comercialHandoffRevisaoMinutos
    const { handoffRevisaoMinutos: _anterior, ...resto } = next.comercial ?? atual.comercial ?? {}
    next.comercial = typeof min === 'number' && Number.isInteger(min) && min > 0 ? { ...resto, handoffRevisaoMinutos: min } : resto
  }
  if (patch.comercialCampanhaRetornoId !== undefined) {
    const id = typeof patch.comercialCampanhaRetornoId === 'string' ? patch.comercialCampanhaRetornoId.trim() : ''
    const { campanhaRetornoId: _anterior, ...resto } = next.comercial ?? atual.comercial ?? {}
    next.comercial = id ? { ...resto, campanhaRetornoId: id } : resto
  }
  if (patch.comercialRodizioHandoff !== undefined) {
    const { rodizioHandoff: _anterior, ...resto } = next.comercial ?? atual.comercial ?? {}
    // Só `true` grava a chave; false/null a remove e o padrão (desligado) volta
    // a valer — o blob não guarda o valor padrão.
    next.comercial = patch.comercialRodizioHandoff === true ? { ...resto, rodizioHandoff: true } : resto
  }
  if (Array.isArray(patch.camposUI)) next.camposUI = patch.camposUI
  if (patch.operacao) next.operacao = patch.operacao
  if (patch.prospeccao !== undefined) {
    const perfil = patch.prospeccao === null ? undefined : parseProspeccaoConfig(patch.prospeccao)
    if (perfil) next.prospeccao = perfil
    else delete next.prospeccao
  }
  if (patch.prospeccaoPesquisas !== undefined) {
    const lista = patch.prospeccaoPesquisas === null ? undefined : parsePesquisasSalvas(patch.prospeccaoPesquisas)
    if (lista) next.prospeccaoPesquisas = lista
    else delete next.prospeccaoPesquisas
  }
  return serializeWorkspaceConfig(next)
}
