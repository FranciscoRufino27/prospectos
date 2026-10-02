// Itens do menu lateral e a visibilidade escolhida pela organização
// (Configurações > Personalização > Menu). A escolha vive em
// organizacoes.configuracoes.modulos: `false` esconde o item; ausência ou
// `true` mostra (padrão do produto). Esconder é só visual — a rota continua
// acessível e as permissões seguem impostas no servidor.
// Puro: usado pelo Sidebar, pela tela de personalização e pelos testes.

export type GrupoMenu = 'visao' | 'execucao' | 'gestao' | 'administracao'

/** Seções do menu, na ordem em que aparecem (Plano de Execução 24/09). */
export const GRUPOS_MENU: readonly { id: GrupoMenu; label: string }[] = [
  { id: 'visao', label: 'Visão' },
  { id: 'execucao', label: 'Execução' },
  { id: 'gestao', label: 'Gestão' },
  { id: 'administracao', label: 'Administração' },
]

export interface ItemMenu {
  id: string // chave em configuracoes.modulos
  href: string
  label: string
  descricao: string
  grupo: GrupoMenu
}

// Ordem dentro de cada grupo = ordem desta lista. Configurações não entra aqui:
// não é escondível e depende de `workspace.configure` (o Sidebar a acrescenta em
// Administração).
export const ITENS_MENU: readonly ItemMenu[] = [
  { id: 'dashboard', href: '/dashboard', label: 'Dashboard', descricao: 'Visão geral e indicadores.', grupo: 'visao' },
  { id: 'inteligencia_comercial', href: '/inteligencia-comercial', label: 'Inteligência Comercial', descricao: 'Análises da prospecção.', grupo: 'visao' },
  { id: 'prospeccao', href: '/prospeccao', label: 'Prospecção', descricao: 'Busca de empresas no catálogo da Receita.', grupo: 'execucao' },
  { id: 'automacao', href: '/automacao', label: 'Campanhas', descricao: 'Campanhas, workflows e modelos.', grupo: 'execucao' },
  { id: 'pipeline', href: '/pipeline', label: 'Pipeline de Contato', descricao: 'Kanban, lista e cadência dos leads.', grupo: 'gestao' },
  { id: 'base_leads', href: '/base-leads', label: 'Base de Leads', descricao: 'Banco geral de leads, com filtros.', grupo: 'gestao' },
  { id: 'reunioes', href: '/reunioes', label: 'Reuniões', descricao: 'Agenda e reuniões marcadas.', grupo: 'gestao' },
  { id: 'comercial', href: '/comercial', label: 'Comercial', descricao: 'Simulador, propostas, copiloto e templates.', grupo: 'gestao' },
  { id: 'equipe', href: '/equipe', label: 'Equipe', descricao: 'Membros, papéis e desempenho.', grupo: 'administracao' },
]

/** Evento de janela disparado ao salvar, para o Sidebar refletir na hora. */
export const EVENTO_MENU_ATUALIZADO = 'prospectos:menu-atualizado'

export function itemVisivel(modulos: Record<string, boolean> | undefined | null, id: string): boolean {
  return modulos?.[id] !== false
}

export function itensVisiveis(modulos: Record<string, boolean> | undefined | null): ItemMenu[] {
  return ITENS_MENU.filter((i) => itemVisivel(modulos, i.id))
}

export interface SecaoMenu {
  id: GrupoMenu
  label: string
  itens: ItemMenu[]
}

/**
 * Grupos na ordem de GRUPOS_MENU, só com os itens de `itens`. Grupo vazio sai,
 * exceto os listados em `manter` (ex.: Administração, que ganha Configurações).
 */
export function agruparMenu(itens: readonly ItemMenu[], manter: readonly GrupoMenu[] = []): SecaoMenu[] {
  return GRUPOS_MENU
    .map((g) => ({ ...g, itens: itens.filter((i) => i.grupo === g.id) }))
    .filter((g) => g.itens.length > 0 || manter.includes(g.id))
}

/**
 * Mapa a gravar: mantém chaves que não são do menu (o PUT substitui o objeto
 * inteiro) e grava só `false` para os escondidos — mostrar é o padrão.
 */
export function modulosComMenu(atuais: Record<string, boolean> | undefined | null, ocultos: readonly string[]): Record<string, boolean> {
  const ids = new Set(ITENS_MENU.map((i) => i.id))
  const resto = Object.fromEntries(Object.entries(atuais ?? {}).filter(([k]) => !ids.has(k)))
  return { ...resto, ...Object.fromEntries(ocultos.filter((id) => ids.has(id)).map((id) => [id, false])) }
}
