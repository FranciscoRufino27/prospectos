// Tipos e helpers compartilhados de Campanha (client-safe — sem server-only).
// A fonte da verdade é a tabela `campanhas` (migration 0023): colunas + `publico`
// jsonb. Nada aqui inventa dado — só molda o que já existe/persiste.

import type { CamposModeloEmail } from '@/lib/campanhas/modelosEmail';

export interface PublicoEmpresas {
  fonte?: string;            // 'base' (real) | 'maps' (externa, não configurada)
  pais?: string;
  segmento?: string;
  cidades?: string;
  limite?: number;
  removerDuplicados?: boolean;
  exigirSite?: boolean;
}
export interface PublicoDecisores {
  departamento?: string;
  cargos?: string;
  senioridade?: string;
  maxPorEmpresa?: number;
  exigirEmail?: boolean;
  exigirTelefone?: boolean;
}
export interface PublicoAgenda {
  diasSemana?: string[];   // ['seg','ter','qua','qui','sex']
  horarioInicio?: string;  // 'HH:MM'
  horarioFim?: string;     // 'HH:MM'
  limiteDiario?: number;
  pararAoResponder?: boolean;
}

export interface PublicoSelecao {
  modo?: 'filtros' | 'manual';
  leadIds?: string[];
  excluirLeadIds?: string[];
  excluirEmpresas?: string[];
  estagios?: string[];
  // Critério persistido e auditável aplicado pelo servidor. `clientes` deriva
  // vínculos reais (serviço vigente, oportunidade ganha ou estágio Ganho);
  // `renovacao` exige serviço recorrente vigente.
  criterio?: 'estagios' | 'base' | 'clientes' | 'renovacao';
}

export interface MensagemCampanha {
  assunto?: string;
  corpo?: string;
  html?: string;
  link?: string;
  templateOrigemId?: string;
  templateId?: string;
  templateTipo?: string;
  // Modelo pronto usado para gerar o `html`. Guardar o id e os campos (e não só
  // o HTML final) é o que permite reabrir a campanha e continuar editando por
  // formulário, em vez de cair no HTML cru.
  modeloId?: string;
  modeloCampos?: CamposModeloEmail;
  // Identidade ESTÁVEL desta mensagem — vira `acoes[].id` no workflow
  // materializado e é a chave que a idempotência de envio usa para nunca
  // reenviar o mesmo passo ao mesmo destinatário, mesmo que o lead ou a
  // execução sejam recriados. Gerado UMA vez (`resolverAcaoIds`, em
  // `lib/campanhas/acaoId.ts`) e preservado em todo re-save/reordenação —
  // NUNCA recalculado por posição no array. Ausente só em publico legado
  // (campanhas anteriores a esta migração) ou ao clonar uma campanha: quem
  // clonar DEVE remover este campo (é o que faz a cópia ganhar UUIDs novos —
  // ela representa uma ação comercial diferente, não deve herdar identidade).
  acaoId?: string;
}

// Patch completo para a opção "Escrever do zero". Os `undefined` são
// intencionais: ao mesclar com uma mensagem existente, removem também HTML e
// identificadores materializados que poderiam manter o template anterior.
export function mensagemCampanhaVazia(): MensagemCampanha {
  return {
    assunto: '',
    corpo: '',
    html: undefined,
    link: '',
    templateOrigemId: undefined,
    templateId: undefined,
    templateTipo: undefined,
    modeloId: undefined,
    modeloCampos: undefined,
  }
}

export interface FollowupCampanha extends MensagemCampanha {
  diasApos?: number;
}

export type ResponsavelRecebe = 'envios_e_respostas' | 'somente_respostas';
export type DestinoWhatsappRetorno = 'responsavel' | 'grupo';

// Como a equipe é avisada quando o cliente responde a ESTA campanha. Com o
// campo presente, ele substitui a regra da organização (comercial.avisoResposta)
// para as respostas da campanha.
export interface AvisoRetorno {
  // E-mail de retorno ao responsável (modelo da etapa Cadência).
  email: boolean;
  // Destinos no WhatsApp; vazio = sem WhatsApp.
  whatsapp: DestinoWhatsappRetorno[];
  // Grupo desta campanha (id Z-API "…-group"); ausente = grupo cadastrado em
  // Configurações > Processo comercial > Distribuição.
  grupoWhatsappId?: string;
}

export interface OperacaoCampanha {
  // Comunicados gerais são disparos únicos; renovação e objetivos comerciais
  // usam a cadência versionada. O servidor recalcula este valor a partir do tipo.
  modoEnvio?: 'cadencia' | 'disparo_unico';
  remetenteConta?: string;
  remetenteEmail?: string;
  mensagemInicial?: MensagemCampanha;
  followups?: FollowupCampanha[];
  // O que o responsável acompanha. 'envios_e_respostas' (padrão, e o que toda
  // campanha anterior a este campo faz) = recebe cópia (CC) de cada e-mail
  // enviado ao cliente; 'somente_respostas' = os e-mails saem sem cópia e ele
  // só fica sabendo quando o cliente responde.
  responsavelRecebe?: ResponsavelRecebe;
  resposta?: {
    // Ausente = campanha anterior à escolha: e-mail conforme
    // `notificarResponsavel` e WhatsApp só pela regra da organização.
    aviso?: AvisoRetorno;
    pararCadencia?: boolean;
    criarTarefa?: boolean;
    prazoHoras?: number;
    notificarResponsavel?: boolean;
    notificarAdministradores?: boolean;
    prepararSugestao?: boolean;
    emailAssunto?: string;
    emailCorpo?: string;
    emailHtml?: string;
  };
  workflowGerenciadoId?: string;
}

export interface Publico {
  objetivo?: string;
  responsavel?: string;    // legado — preferir responsavel_id
  responsavel_id?: string;
  // Para onde vai o aviso quando o lead responde. 'campanha' (padrão e
  // comportamento legado) manda sempre para `responsavel_id`; 'lead' manda para
  // o responsável do PRÓPRIO lead (carteira importada), com `responsavel_id`
  // como fallback de lead sem responsável ou sem e-mail. Campanha sempre tem
  // `responsavel_id` — ele nunca deixa de ser exigido, só muda de papel.
  retornoPara?: 'campanha' | 'lead';
  idioma?: string;
  prazo?: string;
  empresas?: PublicoEmpresas;
  decisores?: PublicoDecisores;
  agenda?: PublicoAgenda;
  selecao?: PublicoSelecao;
  operacao?: OperacaoCampanha;
}

export interface Campanha {
  id: string;
  nome: string;
  descricao: string | null;
  tipo: string | null;
  status: string;
  workflow_id: string | null;
  publico: Publico | null;
  meta_leads: number | null;
  dry_run: boolean | null;
  iniciada_em: string | null;
  concluida_em: string | null;
  criado_em: string;
  atualizado_em: string;
  resumoExecucoes?: {
    total: number;
    emAndamento: number;
    aguardando: number;
    concluidas: number;
    canceladas: number;
    erros: number;
    emailsEnviados: number;
    respostas: number;
  };
}

export const STATUS_BADGE: Record<string, string> = {
  rascunho: 'bg-slate-500/15 text-slate-400',
  ativa: 'bg-green-500/15 text-green-400',
  pausada: 'bg-amber-500/15 text-amber-400',
  concluida: 'bg-indigo-500/15 text-indigo-300',
};

export const STATUS_LABEL: Record<string, string> = {
  rascunho: 'Rascunho', ativa: 'Ativa', pausada: 'Pausada', concluida: 'Concluída',
};

export function brl(v: number): string {
  try { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); } catch { return `R$ ${v}`; }
}

export function fmtData(d: string | null): string {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('pt-BR'); } catch { return '—'; }
}

// Resumo textual do público (para tabela/detalhe), a partir do publico jsonb.
export function resumoPublico(p: Publico | null): string {
  if (!p?.empresas) return 'Base existente';
  const e = p.empresas;
  const partes = [e.segmento, e.cidades, e.pais].filter(Boolean);
  return partes.length ? partes.join(' · ') : 'Base existente';
}
