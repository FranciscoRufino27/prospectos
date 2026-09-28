'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  X, Star, ExternalLink, Mail, Phone,
  MessageSquare, Bot, User, ArrowRight, CheckCircle,
  FileText, Bell, Loader2, Clock, Plus, Sparkles, Repeat, Copy, Maximize2, Check, Settings, PencilLine,
} from 'lucide-react';
import { getStatusLabel, getStatusBadgeClasses, getEstagioPipelineLabel, formatDate, formatDateTime } from '@/lib/utils';
import { SdrPill, SdrCircle } from '@/components/ui/SdrAvatar';
import EmpresaDecisoresCard from '@/components/leads/EmpresaDecisoresCard';
import ServicosLaudosCard from '@/components/leads/ServicosLaudosCard';
import LaudoCicloCard from '@/components/leads/LaudoCicloCard';
import EditarLeadModal from '@/components/leads/EditarLeadModal';
import type { Empresa, Contato, EstagioPipeline } from '@/lib/types';
import { getLeadById, getInteracoesByLead, getMensagensWhatsappByLead, createInteracao, atualizarEstagio, registrarNota, executarAcao, updateLead, gerarInsightLead, gerarMensagemLead } from '@/lib/api';
import type { InsightComercialLead, MensagemPreview } from '@/lib/api';
import type { Lead, Interacao, MensagemWhatsapp } from '@/lib/supabase';
import { ESTAGIOS_MANUAIS } from '@/lib/pipeline-stages';
import { ultimoContatoEfetivo } from '@/lib/leads/ultimoContato';
import PropostasLista from '@/components/comercial/propostas/PropostasLista';
import tema from '@/components/tema/TemaModulo.module.css';

// Data real de hoje (YYYY-MM-DD).
const TODAY = new Date().toISOString().slice(0, 10);

const STAGES = [
  { id: 'novos_leads', label: 'Novos Leads', color: '#6366f1' },
  { id: 'primeiro_contato', label: 'Primeiro Contato Enviado', color: '#3b82f6' },
  { id: 'aguardando_resposta', label: 'Aguardando Resposta', color: '#f59e0b' },
  { id: 'follow_up', label: 'Follow-up', color: '#ef4444' },
  { id: 'interessado', label: 'Interessado', color: '#8b5cf6' },
  { id: 'reuniao_agendada', label: 'Reunião Agendada', color: '#22c55e' },
] as const;

// Adapta um Lead do Supabase para o shape Empresa usado pelo layout
function leadToEmpresa(lead: Lead): Empresa {
  return {
    id: lead.id,
    nome: lead.empresa,
    segmento: lead.segmento as Empresa['segmento'],
    origem: (lead.origem || 'Automação') as Empresa['origem'],
    cidade: lead.cidade,
    estado: lead.estado,
    website: lead.site ?? undefined,
    responsavel: lead.usuarios?.nome ?? lead.responsavel_nome ?? '',
    status: 'em_prospeccao',
    estagio_pipeline: lead.estagio as Empresa['estagio_pipeline'],
    em_cadencia: false,
    data_entrada: lead.created_at,
    ultimo_contato: lead.ultimo_contato ?? undefined,
    blacklist: false,
    score_engajamento: lead.score,
    observacoes: lead.proxima_acao ?? undefined,
    funcionarios_faixa: lead.faixa_funcionarios ?? undefined,
  };
}

// Cria um Contato sintético a partir dos campos de contato embutidos no Lead
function leadToContato(lead: Lead): Contato {
  const canalMap: Record<Lead['canal_preferencial'], Contato['canal_preferencial']> = {
    email: 'Email',
    whatsapp: 'WhatsApp',
    linkedin: 'LinkedIn',
    telefone: 'Telefone',
  };
  return {
    id: `${lead.id}-contato`,
    empresa_id: lead.id,
    nome: lead.contato_nome,
    cargo: lead.contato_cargo,
    canal_preferencial: canalMap[lead.canal_preferencial],
    email: lead.contato_email || undefined,
    telefone: lead.contato_telefone ?? undefined,
    linkedin_url: lead.linkedin ?? undefined,
    principal: true,
    blacklist: false,
  };
}

function daysBetween(a: string, b: string) {
  return Math.floor(
    (new Date(b.substring(0, 10)).getTime() - new Date(a.substring(0, 10)).getTime()) /
    (1000 * 60 * 60 * 24)
  );
}

// Rótulo e ícone por tipo de interação vinda do Supabase
const INTERACAO_TIPO: Record<string, { label: string; Icon: typeof Bot; color: string }> = {
  abordagem: { label: 'Abordagem', Icon: User, color: 'text-green-500' },
  resposta: { label: 'Resposta recebida', Icon: MessageSquare, color: 'text-green-400' },
  follow_up: { label: 'Follow-up registrado', Icon: CheckCircle, color: 'text-green-400' },
  nota: { label: 'Nota', Icon: FileText, color: 'text-slate-400' },
  reuniao: { label: 'Reunião', Icon: Bell, color: 'text-purple-500' },
};

// Badge de tipo na Central do Lead (cobre variações de follow_up: follow_up_1/2/3/4)
function getTipoInteracaoBadge(tipo: string, descricao?: string): { label: string; classes: string } {
  if (tipo === 'abordagem') return { label: 'Primeiro contato enviado', classes: 'bg-blue-500/20 text-blue-400' };
  if (tipo.startsWith('follow_up')) return { label: 'Follow-up enviado', classes: 'bg-purple-500/20 text-purple-400' };
  if (tipo === 'resposta') return { label: 'Resposta recebida', classes: 'bg-green-500/20 text-green-400' };
  // Handoff do motor: gravado como tipo='nota' com descrição "Encaminhado ao closer…"
  if (tipo === 'nota' && descricao?.startsWith('Encaminhado ao closer'))
    return { label: 'Encaminhado ao closer', classes: 'bg-amber-500/20 text-amber-400' };
  // Item 7: auto-reply de ausência → sugestão de contato alternativo (motor/IA).
  if (tipo === 'nota' && descricao?.startsWith('Contato alternativo sugerido'))
    return { label: 'Contato alternativo sugerido', classes: 'bg-cyan-500/20 text-cyan-400' };
  // Item 6: proposta comercial registrada pelo simulador.
  if (tipo === 'nota' && descricao?.startsWith('Proposta comercial'))
    return { label: 'Proposta comercial', classes: 'bg-indigo-500/20 text-indigo-300' };
  // Item 8: análise do copiloto pós-reunião.
  if (tipo === 'nota' && descricao?.startsWith('Copiloto pós-reunião'))
    return { label: 'Copiloto pós-reunião', classes: 'bg-violet-500/20 text-violet-300' };
  if (tipo === 'nota') return { label: 'Nota', classes: 'bg-[var(--bg-input)] text-slate-300' };
  if (tipo === 'reuniao') return { label: 'Reunião', classes: 'bg-amber-500/20 text-amber-400' };
  return { label: tipo, classes: 'bg-[var(--bg-input)] text-slate-300' };
}

// "Resposta a tratar": sinais que o MOTOR grava em proxima_acao quando um lead
// responde (aguardando_closer) e quando o closer é avisado (com_closer).
const PROXIMA_ACAO_RESPOSTA = new Set(['aguardando_closer', 'com_closer']);
function temRespostaPendente(lead: Lead | null | undefined): boolean {
  return !!lead?.proxima_acao && PROXIMA_ACAO_RESPOSTA.has(lead.proxima_acao);
}
function respostaPendenteLabel(proximaAcao?: string | null): string {
  return proximaAcao === 'com_closer' ? 'Com o closer' : 'Resposta a tratar';
}

// Badge de status (lado direito) derivado do tipo
function getStatusInteracao(tipo: string): { label: string; classes: string } | null {
  if (tipo === 'abordagem' || tipo.startsWith('follow_up')) return { label: 'Enviado', classes: 'bg-blue-500/10 text-blue-400' };
  if (tipo === 'resposta') return { label: 'Respondido', classes: 'bg-green-500/10 text-green-400' };
  if (tipo === 'reuniao') return { label: 'Agendado', classes: 'bg-amber-500/10 text-amber-400' };
  return null;
}

// --- Aba Conversa: reorganização do histórico ---
// Total de follow-ups da cadência (3/7/14/30/60/90/120/180 — item 3). Usado para
// numerar cada etapa ("Follow-up N de 8"), já que TODAS usam o mesmo template e
// sem o número parecem duplicadas.
const TOTAL_FOLLOWUPS = 8;

// Os envios do motor guardam a descrição como "**assunto**\n\ncorpo". Separa os
// dois pra mostrar o assunto como título e o corpo truncável.
function parseMensagem(descricao: string): { assunto: string | null; corpo: string } {
  const m = descricao.match(/^\*\*([\s\S]+?)\*\*\n\n([\s\S]*)$/);
  if (m) return { assunto: m[1].trim(), corpo: m[2].trim() };
  return { assunto: null, corpo: descricao };
}

// Notas que SÃO conteúdo relevante (não log): handoff, contato alt, proposta,
// copiloto. As demais notas de plataforma/sistema (mudança/normalização de
// estágio, perdido, liberado) são LOG interno — exibidas de forma discreta.
const NOTAS_RELEVANTES = ['Encaminhado ao closer', 'Contato alternativo sugerido', 'Proposta comercial', 'Copiloto pós-reunião'];
function ehLogSistema(i: Interacao): boolean {
  if (i.tipo !== 'nota') return false;
  const d = i.descricao ?? '';
  if (NOTAS_RELEVANTES.some((p) => d.startsWith(p))) return false;
  if (/^(Estágio|Lead marcado como perdido|Lead liberado)/.test(d)) return true;
  return i.canal === 'plataforma' || i.canal === 'sistema';
}

// Item do histórico mesclado da aba Conversa: ou uma interação existente, ou
// uma mensagem real de WhatsApp (fonte: whatsapp_mensagens — nunca copiada
// para interacoes). `quando` é o epoch usado para ordenar os dois.
type ItemConversa =
  | { kind: 'interacao'; id: string; quando: number; interacao: Interacao }
  | { kind: 'whatsapp'; id: string; quando: number; mensagem: MensagemWhatsapp };

// Direção da mensagem de WhatsApp na mesma linguagem de cor dos badges de
// interação: recebido = verde ("Respondido"), enviado = azul ("Enviado").
const WHATSAPP_DIRECAO = {
  inbound: { rotulo: 'WhatsApp recebido', status: 'Recebido', classes: 'bg-green-500/20 text-green-400', statusClasses: 'bg-green-500/10 text-green-400' },
  outbound: { rotulo: 'WhatsApp enviado', status: 'Enviado', classes: 'bg-blue-500/20 text-blue-400', statusClasses: 'bg-blue-500/10 text-blue-400' },
} as const;
function direcaoWhatsapp(m: MensagemWhatsapp) {
  return m.direcao === 'outbound' ? WHATSAPP_DIRECAO.outbound : WHATSAPP_DIRECAO.inbound;
}
// Cronologia do WhatsApp: `mensagem_em` (timestamp da Meta), fallback `created_at`.
function quandoWhatsapp(m: MensagemWhatsapp): string {
  return m.mensagem_em || m.created_at;
}
// Remetente só faz sentido em mensagem RECEBIDA. No outbound o backend grava o
// telefone/nome do CLIENTE em `remetente` (é o que agrupa a conversa), então
// exibi-lo como autor seria errado — e quem enviou não fica registrado.
function remetenteWhatsapp(m: MensagemWhatsapp): string | null {
  if (m.direcao === 'outbound') return null;
  return m.remetente_nome || m.remetente || null;
}

// Rótulo, ícone e cor do canal (valores em minúsculo no Supabase)
const CANAL_INFO: Record<string, { label: string; Icon: typeof Bot; classes: string }> = {
  email: { label: 'Email', Icon: Mail, classes: 'bg-[var(--bg-input)] text-slate-300' },
  whatsapp: { label: 'WhatsApp', Icon: MessageSquare, classes: 'bg-green-500/20 text-green-400' },
  linkedin: { label: 'LinkedIn', Icon: ExternalLink, classes: 'bg-blue-500/20 text-blue-400' },
  telefone: { label: 'Telefone', Icon: Phone, classes: 'bg-purple-500/20 text-purple-400' },
};

// Cores do badge de aderência da Inteligência Comercial (item 4).
const ADERENCIA_BADGE: Record<InsightComercialLead['aderencia'], string> = {
  alta: 'bg-green-500/20 text-green-400',
  media: 'bg-amber-500/20 text-amber-400',
  baixa: 'bg-red-500/20 text-red-400',
};

function scoreColor(score: number): string {
  if (score >= 70) return '#16a34a';
  if (score < 50) return '#f97316';
  return '#6b7280';
}

// Painel lateral COMPLETO do lead (slide-over + modal "Central do Lead").
// Dono do próprio estado: carrega o lead por id, as interações reais e executa
// as ações (mover estágio, marcar perdido, executar cadência, registrar nota).
// Compartilhado entre o Pipeline e a Base de Leads — NÃO recriar.
//
// `contexto` decide os controles terminais do rodapé: no Pipeline os estados
// Perdido/Sem resposta não são geridos aqui (vivem só na Base), então some o
// botão "Marcar como perdido" e a opção "Perdido" do seletor de estágio.
export default function LeadPanel({
  leadId,
  onClose,
  onChanged,
  usingSupabase = true,
  contexto = 'base',
}: {
  leadId: string | null;
  onClose: () => void;
  onChanged?: () => void;
  usingSupabase?: boolean;
  contexto?: 'pipeline' | 'base';
}) {
  const selectedId = leadId;
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [interacoes, setInteracoes] = useState<Interacao[]>([]);
  // Mensagens reais de WhatsApp do lead (fonte: whatsapp_mensagens, via RLS).
  // Mescladas com `interacoes` SÓ na exibição da aba Conversa / "Ver tudo".
  const [mensagensWhatsapp, setMensagensWhatsapp] = useState<MensagemWhatsapp[]>([]);
  const [loadingInteracoes, setLoadingInteracoes] = useState(false);
  const [interacoesError, setInteracoesError] = useState(false);
  const [showAllInteracoes, setShowAllInteracoes] = useState(false);
  const [centralTab, setCentralTab] = useState<'timeline' | 'dados'>('timeline');
  const [showRegistrar, setShowRegistrar] = useState(false);
  const [novaInteracao, setNovaInteracao] = useState({ tipo: 'abordagem', canal: 'email', descricao: '' });
  const [salvandoInteracao, setSalvandoInteracao] = useState(false);
  const [confirmandoPerdido, setConfirmandoPerdido] = useState(false);
  const [executando, setExecutando] = useState(false);
  const [feedbackAcao, setFeedbackAcao] = useState<string | null>(null);
  const [confirmandoLiberar, setConfirmandoLiberar] = useState(false);
  const [liberando, setLiberando] = useState(false);
  // Inteligência Comercial (item 4): gerada sob demanda pela IA.
  const [insight, setInsight] = useState<InsightComercialLead | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightErro, setInsightErro] = useState<string | null>(null);
  // Ficha lateral em abas (item 2 do doc de ajustes).
  const [abaPainel, setAbaPainel] = useState<'visao' | 'conversa' | 'propostas' | 'dados'>('visao');
  // Preview da próxima mensagem da cadência (botão "Gerar mensagem").
  const [mensagem, setMensagem] = useState<MensagemPreview | null>(null);
  const [mensagemLoading, setMensagemLoading] = useState(false);
  const [mensagemErro, setMensagemErro] = useState<string | null>(null);
  const [mensagemCopiada, setMensagemCopiada] = useState(false);
  const [editandoDados, setEditandoDados] = useState(false);
  // Aba Conversa: mensagens expandidas (corpo completo). Reset ao trocar de lead.
  const [msgsExpandidas, setMsgsExpandidas] = useState<Set<string>>(new Set());
  const toggleExpandir = (id: string) => setMsgsExpandidas(s => {
    const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n;
  });

  // Carrega (ou recarrega) as interações reais do lead selecionado
  const carregarInteracoes = useCallback(async () => {
    if (!selectedId || !usingSupabase) {
      setInteracoes([]);
      setMensagensWhatsapp([]);
      setInteracoesError(false);
      return;
    }
    setLoadingInteracoes(true);
    setInteracoesError(false);
    try {
      // WhatsApp em paralelo; uma falha aqui degrada para "sem WhatsApp" e não
      // derruba o histórico de interações.
      const [data, whatsapp] = await Promise.all([
        getInteracoesByLead(selectedId),
        getMensagensWhatsappByLead(selectedId).catch((err) => {
          console.error('Erro ao carregar mensagens WhatsApp:', err);
          return [] as MensagemWhatsapp[];
        }),
      ]);
      setInteracoes(data);
      setMensagensWhatsapp(whatsapp);
    } catch (err) {
      console.error('Erro ao carregar interações:', err);
      setInteracoesError(true);
    } finally {
      setLoadingInteracoes(false);
    }
  }, [selectedId, usingSupabase]);

  // Busca as interações quando o painel abre / troca de lead e reseta a Central
  useEffect(() => {
    setShowAllInteracoes(false);
    setCentralTab('timeline');
    setShowRegistrar(false);
    setConfirmandoPerdido(false);
    setConfirmandoLiberar(false);
    setFeedbackAcao(null);
    setInsight(null);
    setInsightErro(null);
    setInsightLoading(false);
    setAbaPainel('visao');
    setMensagem(null);
    setMensagemErro(null);
    setMensagemLoading(false);
    setMensagemCopiada(false);
    setEditandoDados(false);
    setMsgsExpandidas(new Set());
    setNovaInteracao({ tipo: 'abordagem', canal: 'email', descricao: '' });
    if (selectedId) {
      getLeadById(selectedId).then(setSelectedLead).catch(() => setSelectedLead(null));
    } else {
      setSelectedLead(null);
    }
    carregarInteracoes();
  }, [selectedId, usingSupabase, carregarInteracoes]);

  // Painel lateral — derivado do lead carregado por id.
  const selectedEmpresa: Empresa | null = selectedLead ? leadToEmpresa(selectedLead) : null;
  const selectedContato: Contato | null = selectedLead ? leadToContato(selectedLead) : null;

  // Salva uma nova interação manual e recarrega a timeline
  async function handleRegistrarInteracao() {
    if (!selectedId || !novaInteracao.descricao.trim()) return;
    setSalvandoInteracao(true);
    try {
      await createInteracao({
        lead_id: selectedId,
        tipo: novaInteracao.tipo as Interacao['tipo'],
        canal: novaInteracao.canal,
        descricao: novaInteracao.descricao.trim(),
        origem_acao: 'humano',
      });
      setNovaInteracao({ tipo: 'abordagem', canal: 'email', descricao: '' });
      setShowRegistrar(false);
      await carregarInteracoes();
    } catch (err) {
      console.error('Erro ao registrar interação:', err);
    } finally {
      setSalvandoInteracao(false);
    }
  }

  // Move o lead para outro estágio (movimentação MANUAL do closer), registra a
  // nota e avisa o pai (onChanged) para refazer a lista/board.
  async function handleMoverEstagio(novoEstagio: string) {
    if (!selectedId || !novoEstagio) return;
    try {
      await atualizarEstagio(selectedId, novoEstagio);
      await registrarNota(selectedId, `Estágio alterado manualmente para: ${novoEstagio}`);
      onChanged?.();
      const atualizado = await getLeadById(selectedId).catch(() => null);
      setSelectedLead(atualizado);
      await carregarInteracoes();
    } catch (err) {
      console.error('Erro ao mover estágio:', err);
      alert('Erro ao mover estágio. Tente novamente.');
    }
  }

  // Marca o lead como perdido (confirmação em dois cliques)
  async function handleMarcarPerdido() {
    if (!selectedId) return;
    if (!confirmandoPerdido) {
      setConfirmandoPerdido(true);
      return;
    }
    try {
      await atualizarEstagio(selectedId, 'perdido');
      await registrarNota(selectedId, 'Lead marcado como perdido manualmente.');
      setConfirmandoPerdido(false);
      onChanged?.();
      onClose();
    } catch (err) {
      console.error('Erro ao marcar como perdido:', err);
      setConfirmandoPerdido(false);
      alert('Erro ao marcar como perdido. Tente novamente.');
    }
  }

  // Libera o lead para o motor (owner n8n → engine). Passo humano DELIBERADO e
  // separado do "Executar ação": com MODO_ENSAIO=false, depois da liberação o
  // motor real pode enviar e-mails automaticamente para este lead. Confirmação
  // em dois cliques (mesmo padrão do "Marcar como perdido"). NÃO dispara a
  // ação em seguida — liberar ≠ mandar agora (ver lib/engine/README.md).
  async function handleLiberarMotor() {
    if (!selectedId) return;
    if (!confirmandoLiberar) {
      setConfirmandoLiberar(true);
      return;
    }
    setLiberando(true);
    setFeedbackAcao(null);
    try {
      await updateLead(selectedId, { owner: 'engine' });
      await registrarNota(selectedId, `Lead liberado para o motor (owner: ${selectedLead?.owner ?? 'n8n'} → engine) manualmente.`);
      const atualizado = await getLeadById(selectedId).catch(() => null);
      setSelectedLead(atualizado);
      setFeedbackAcao('✓ Lead liberado para o motor. "Executar ação" já dispara a próxima etapa.');
      onChanged?.();
      await carregarInteracoes();
    } catch (err) {
      console.error('Erro ao liberar lead para o motor:', err);
      setFeedbackAcao('✗ Não foi possível liberar o lead para o motor. Tente novamente.');
    } finally {
      setConfirmandoLiberar(false);
      setLiberando(false);
    }
  }

  // Dispara o motor (lib/engine) para executar a próxima etapa da cadência do lead
  async function handleExecutarAcao() {
    if (!selectedId) return;
    setExecutando(true);
    setFeedbackAcao(null);
    try {
      const result = await executarAcao(selectedId);
      setFeedbackAcao(`✓ Ação executada! Estágio: ${result.estagio ?? 'atualizado'}`);
      onChanged?.();
      await carregarInteracoes();
    } catch (err) {
      console.error('Erro ao executar ação:', err);
      const motivo = err instanceof Error ? err.message : null;
      const traducao: Record<string, string> = {
        owner_nao_engine: 'Este lead ainda não foi migrado para o motor (owner != engine).',
        ja_enviado: 'Este contato já foi enviado antes — o motor não reenvia (idempotência).',
        max_followups: 'Este lead já atingiu o máximo de follow-ups.',
        limite_diario: 'Limite diário de envios atingido. Tente novamente amanhã.',
        sem_proximo_estagio: 'Não há próxima etapa a executar para este estágio.',
        perdido: 'Este lead está marcado como perdido.',
        nao_encontrado: 'Lead não encontrado.',
      };
      setFeedbackAcao(`✗ ${motivo && traducao[motivo] ? traducao[motivo] : motivo ?? 'Erro ao executar ação. Tente novamente.'}`);
    } finally {
      setExecutando(false);
    }
  }

  // Gera a leitura comercial do lead via IA (item 4). Sob demanda, no clique.
  async function handleGerarInsight() {
    if (!selectedId) return;
    setInsightLoading(true);
    setInsightErro(null);
    try {
      const dados = await gerarInsightLead(selectedId);
      setInsight(dados);
    } catch (err) {
      console.error('Erro ao gerar inteligência comercial:', err);
      setInsightErro(err instanceof Error ? err.message : 'Não foi possível gerar a análise.');
    } finally {
      setInsightLoading(false);
    }
  }

  // Gera o preview da PRÓXIMA mensagem da cadência (real, via motor). Abre modal.
  async function handleGerarMensagem() {
    if (!selectedId) return;
    setMensagemLoading(true);
    setMensagemErro(null);
    setMensagem(null);
    setMensagemCopiada(false);
    try {
      setMensagem(await gerarMensagemLead(selectedId));
    } catch (err) {
      setMensagemErro(err instanceof Error ? err.message : 'Não foi possível gerar a mensagem.');
    } finally {
      setMensagemLoading(false);
    }
  }

  async function copiarMensagem() {
    if (!mensagem) return;
    try {
      await navigator.clipboard.writeText(`Assunto: ${mensagem.assunto}\n\n${mensagem.corpo}`);
      setMensagemCopiada(true);
      setTimeout(() => setMensagemCopiada(false), 3000);
    } catch { /* clipboard indisponível */ }
  }

  // Sem fonte de dados ou erro no fetch: mostra erro honesto (nunca timeline inventada).
  const historicoIndisponivel = !usingSupabase || interacoesError;

  // Cadência (item 2): progresso real de contatos enviados. 1 abordagem + 8
  // follow-ups (3/7/14/30/60/90/120/180) = 9 toques planejados. Conta pelas
  // interações reais (abordagem/follow_up), não por número inventado.
  const CADENCIA_TOTAL = 9;
  const contatosEnviados = interacoes.filter(
    (i) => i.tipo === 'abordagem' || i.tipo.startsWith('follow_up'),
  ).length;
  const cadenciaPct = Math.min(100, Math.round((contatosEnviados / CADENCIA_TOTAL) * 100));
  const ESTAGIOS_CADENCIA = ['novos_leads', 'primeiro_contato', 'aguardando_resposta', 'follow_up', 'follow_up_1', 'follow_up_2'];
  const cadenciaAtiva = !!selectedLead && selectedLead.owner === 'engine'
    && !selectedLead.perdido && ESTAGIOS_CADENCIA.includes(selectedLead.estagio);
  // Últimas 3 interações para a "Atividade recente" da aba Visão geral.
  const atividadeRecente = interacoes.slice(0, 3);

  // Numera cada follow-up pela ordem cronológica (o 1º enviado = "Follow-up 1").
  // `interacoes` vem em ordem decrescente; ordenamos ascendente só p/ ranquear.
  const followupNumero = useMemo(() => {
    const m = new Map<string, number>();
    interacoes
      .filter((i) => i.tipo.startsWith('follow_up')) // cobre follow_up e follow_up_N (dado antigo)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .forEach((i, idx) => m.set(i.id, idx + 1));
    return m;
  }, [interacoes]);

  const ultimoContato = useMemo(
    () => ultimoContatoEfetivo(selectedLead?.ultimo_contato, interacoes),
    [selectedLead?.ultimo_contato, interacoes],
  );

  // Aba Conversa / "Ver tudo": histórico ÚNICO = interações + mensagens reais
  // de WhatsApp (inbound e outbound), mescladas só aqui, na UI. Ordem
  // cronológica decrescente, igual à que getInteracoesByLead já devolve.
  // A "Atividade recente" da Visão geral e a cadência seguem só em `interacoes`.
  const historicoConversa = useMemo<ItemConversa[]>(() => {
    const itens: ItemConversa[] = [
      ...interacoes.map((i) => ({
        kind: 'interacao' as const,
        id: i.id,
        quando: new Date(i.created_at).getTime() || 0,
        interacao: i,
      })),
      ...mensagensWhatsapp.map((m) => ({
        kind: 'whatsapp' as const,
        id: m.id,
        quando: new Date(quandoWhatsapp(m)).getTime() || 0,
        mensagem: m,
      })),
    ];
    return itens.sort((a, b) => b.quando - a.quando);
  }, [interacoes, mensagensWhatsapp]);

  const panelTimeSince = selectedEmpresa
    ? (ultimoContato
        ? daysBetween(ultimoContato, TODAY)
        : daysBetween(selectedEmpresa.data_entrada, TODAY))
    : 0;
  const isActionDelayed = !!selectedEmpresa && panelTimeSince > 5 &&
    (selectedEmpresa.estagio_pipeline === 'aguardando_resposta' ||
     selectedEmpresa.estagio_pipeline === 'follow_up');

  // Lead ainda não liberado para o motor (trava owner != engine): em vez do
  // erro mudo do executarAcao, oferece a liberação como ação explícita.
  const precisaLiberar = usingSupabase && !!selectedLead && selectedLead.owner !== 'engine';

  if (!selectedEmpresa) return null;

  // Nos dois contextos o painel é a gaveta do tema dos módulos (fundo
  // desfocado, entrada deslizando), igual ao painel de perfil da Prospecção.
  // Diferenças de layout passam por `noPipeline`: no Pipeline, largura contida
  // e blocos com mais respiro.
  const noPipeline = contexto === 'pipeline';
  const larguraPainel = noPipeline
    ? 'max-w-full sm:max-w-[520px]'
    : 'max-w-md lg:max-w-[32rem] xl:max-w-[38rem] 2xl:max-w-[44rem]';
  // Divisor mais discreto e blocos com mais respiro só no Pipeline.
  const divisor = noPipeline ? 'border-b border-[var(--t-bg-card-hover,#212a3c)]' : 'border-b border-[var(--border)]';
  const secao = noPipeline ? 'px-4 py-4' : 'px-5 py-3';

  return (
    <>
      <div
        className={`${tema.gavetaFundo} z-40`}
        onClick={onClose}
      />
      <div className={`fixed top-0 right-0 h-full w-full ${larguraPainel} z-50 flex flex-col ${tema.gaveta}`}>
        {/* Panel header */}
        <div className={`${noPipeline ? 'px-4 py-3' : 'px-5 py-4'} ${divisor}`}>
          <div className={`flex items-start justify-between ${noPipeline ? 'mb-1.5' : 'mb-2'}`}>
            <div className="flex items-start gap-3 flex-1 min-w-0 pr-3">
              <SdrCircle name={selectedEmpresa.responsavel} />
              <div className="min-w-0">
                <h2 className={`font-bold text-slate-100 leading-tight ${noPipeline ? 'text-base' : 'text-lg'}`}>{selectedEmpresa.nome}</h2>
                {(() => {
                  const partes = [
                    [selectedLead?.cidade ?? selectedEmpresa.cidade, selectedLead?.estado ?? selectedEmpresa.estado].filter(Boolean).join(', '),
                    selectedLead?.segmento ?? selectedEmpresa.segmento,
                    selectedEmpresa.funcionarios_faixa ? `${selectedEmpresa.funcionarios_faixa} func.` : '',
                  ].filter(Boolean)
                  return partes.length > 0 ? (
                    <div className={`text-slate-400 mt-0.5 ${noPipeline ? 'text-xs' : 'text-sm'}`}>{partes.join(' · ')}</div>
                  ) : null
                })()}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {selectedLead && (
                <button
                  type="button"
                  onClick={() => setEditandoDados(true)}
                  className={noPipeline
                    /* Ação secundária: discreta no Pipeline, para não competir
                       com o CTA "Executar ação". */
                    ? 'inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2 py-1 text-[11px] font-semibold text-slate-400 hover:border-indigo-500/40 hover:text-indigo-300'
                    : 'inline-flex items-center gap-1.5 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-1.5 text-xs font-semibold text-indigo-300 hover:bg-indigo-500/20'}
                  title="Editar informações e validade do lead"
                >
                  <PencilLine size={12} /> Editar
                </button>
              )}
              <button className="text-slate-600 hover:text-amber-400 transition-colors"><Star size={16} /></button>
              <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors"><X size={18} /></button>
            </div>
          </div>
          {selectedContato ? (
            <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
              <span className="text-sm font-semibold text-slate-200 truncate">{selectedContato.nome}</span>
              {selectedContato.cargo && (
                <>
                  <span className="text-slate-600 text-xs shrink-0">|</span>
                  <span className="text-xs text-slate-400 truncate">{selectedContato.cargo}</span>
                </>
              )}
              {selectedContato.canal_preferencial && (
                <>
                  <span className="text-slate-600 text-xs shrink-0">|</span>
                  <span className="text-xs text-slate-300 shrink-0">{selectedContato.canal_preferencial}</span>
                </>
              )}
              <div className="flex items-center gap-2 ml-auto shrink-0 text-slate-500">
                {selectedContato.email && (
                  <a href={`mailto:${selectedContato.email}`} className="hover:text-blue-400 transition-colors" title={selectedContato.email}><Mail size={13} /></a>
                )}
                {selectedContato.telefone && (
                  <a href={`tel:${selectedContato.telefone}`} className="hover:text-green-400 transition-colors" title={selectedContato.telefone}><Phone size={13} /></a>
                )}
                {selectedContato.canal_preferencial === 'WhatsApp' && selectedContato.telefone && (
                  <a href={`https://wa.me/${selectedContato.telefone.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer"
                    className="hover:text-green-500 transition-colors" title="WhatsApp"><MessageSquare size={13} /></a>
                )}
                {selectedContato.linkedin_url && (
                  <a href={`https://${selectedContato.linkedin_url}`} target="_blank" rel="noopener noreferrer"
                    className="hover:text-blue-400 transition-colors" title="LinkedIn"><ExternalLink size={13} /></a>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 text-slate-500">
              {selectedEmpresa.website && (
                <a href={selectedEmpresa.website} target="_blank" rel="noopener noreferrer"
                  className="hover:text-blue-400 transition-colors" title="Site"><ExternalLink size={13} /></a>
              )}
            </div>
          )}
        </div>

        {/* Cartão ADITIVO da nova camada de entidades (Fase 2e) — fail-safe:
            renderiza nada quando o flag está off/erro/vazio. Não altera os
            campos legados do painel. */}
        {/* Empresa e decisor já vêm no cabeçalho do drawer: no Pipeline esta
            faixa apenas repetiria o que está logo acima. Segue inteira na Base
            de Leads (e na ficha completa, mais abaixo). */}
        {selectedLead && !noPipeline && <EmpresaDecisoresCard leadId={selectedLead.id} />}
        {/* "Laudos / serviços recorrentes" é uma faixa intermediária ACIMA das
            abas: no Pipeline ela empurra "Próxima ação · IA" para baixo e repete
            contexto que não decide o próximo passo comercial. Fica oculta só
            aqui — a funcionalidade (listar/criar/editar/arquivar) continua
            inteira na Base de Leads, que é onde esse ciclo é gerido. */}
        {selectedLead && !noPipeline && <ServicosLaudosCard leadId={selectedLead.id} />}

        <div className="flex-1 overflow-y-auto">
          {/* Abas da ficha (item 2): Visão geral · Conversa · Propostas · Dados */}
          <div className={`${noPipeline ? 'px-4' : 'px-5'} pt-2 flex gap-1 ${divisor} sticky top-0 bg-[var(--bg-card)] z-10`}>
            {([
              { id: 'visao', label: 'Visão geral' },
              { id: 'conversa', label: 'Conversa' },
              { id: 'propostas', label: 'Propostas' },
              { id: 'dados', label: 'Dados' },
            ] as const).map(t => (
              <button
                key={t.id}
                onClick={() => setAbaPainel(t.id)}
                className={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors ${
                  abaPainel === t.id ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {abaPainel === 'visao' && (<>
          {/* Status */}
          <div className={`${secao} ${divisor} flex items-center ${noPipeline ? 'gap-2 flex-wrap' : 'gap-3'}`}>
            <span className={`text-xs px-2 py-1 rounded-full font-medium ${getStatusBadgeClasses(selectedEmpresa.status)}`}>
              {getStatusLabel(selectedEmpresa.status)}
            </span>
            {temRespostaPendente(selectedLead) && (
              <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full font-semibold bg-green-500/20 text-green-300">
                <MessageSquare size={11} /> {respostaPendenteLabel(selectedLead?.proxima_acao)}
              </span>
            )}
            {selectedEmpresa.em_cadencia && (
              <span className="text-xs text-indigo-400 bg-indigo-500/10 px-2 py-1 rounded-full">
                Cadência ativa
              </span>
            )}
            <div className="ml-auto">
              <SdrPill name={selectedEmpresa.responsavel} />
            </div>
          </div>

          {/* 4 KPI cards */}
          <div className={`${noPipeline ? 'px-4 py-4' : 'px-4 py-3'} ${divisor} grid grid-cols-2 ${noPipeline ? 'gap-2.5' : 'gap-2'}`}>
            {[
              {
                label: 'Último contato',
                value: `${panelTimeSince}d`,
                sub: panelTimeSince === 0 ? 'hoje' : 'atrás',
                color: panelTimeSince > 7 ? '#ef4444' : '#374151',
              },
              {
                label: 'Score',
                value: String(selectedEmpresa.score_engajamento),
                sub: '/ 100',
                color: selectedEmpresa.score_engajamento >= 70 ? '#16a34a' : selectedEmpresa.score_engajamento >= 40 ? '#d97706' : '#ef4444',
              },
              {
                label: 'Estágio',
                value: STAGES.find(s => s.id === selectedEmpresa.estagio_pipeline)?.label ?? selectedEmpresa.estagio_pipeline,
                sub: '',
                color: STAGES.find(s => s.id === selectedEmpresa.estagio_pipeline)?.color ?? '#374151',
              },
              {
                label: 'Canal preferencial',
                value: selectedContato?.canal_preferencial ?? '—',
                sub: '',
                color: '#374151',
              },
            ].map(card => (
              /* Secundário: no Pipeline os KPIs ficam achatados (sem caixa
                 sólida) para não pesarem igual ao bloco de Próxima ação. */
              <div
                key={card.label}
                className={noPipeline ? 'rounded-lg px-2.5 py-1.5 border border-[var(--t-bg-card-hover,#212a3c)]' : 'bg-[var(--bg-base)] rounded-xl px-3 py-2'}
                style={{ maxHeight: 80 }}
              >
                <div className="text-xs text-slate-500 mb-1 leading-none">{card.label}</div>
                <div className="font-bold text-sm leading-tight truncate" style={{ color: card.color }}>{card.value}</div>
                {card.sub && <div className="text-xs text-slate-500 mt-0.5">{card.sub}</div>}
              </div>
            ))}
          </div>

          {selectedLead && (
            <div className={`${noPipeline ? 'px-4 py-4' : 'px-4 py-3'} ${divisor}`}>
              <button
                type="button"
                onClick={() => setEditandoDados(true)}
                className={`w-full flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-left hover:border-indigo-500/40 hover:bg-indigo-500/5 ${noPipeline ? 'border border-[var(--t-bg-card-hover,#212a3c)]' : 'border border-[var(--border)] bg-[var(--bg-base)]'}`}
              >
                <span>
                  <span className="block text-xs text-slate-500">Validade do laudo</span>
                  <span className={`block font-semibold text-slate-300 mt-0.5 ${noPipeline ? 'text-xs' : 'text-sm'}`}>
                    {selectedLead.data_validade ? formatDate(selectedLead.data_validade) : 'Não configurada'}
                  </span>
                </span>
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-300">
                  <PencilLine size={12} /> Editar
                </span>
              </button>
            </div>
          )}

          {/* Ciclo do laudo: status calculado + "Marcar como renovado" + histórico.
              "Editar" acima corrige a data do ciclo atual; renovar é outro fluxo. */}
          {selectedLead && (
            <LaudoCicloCard
              leadId={selectedLead.id}
              validade={selectedLead.data_validade}
              compacto={noPipeline}
              onRenovado={(novaValidade) => {
                setSelectedLead((l) => (l ? { ...l, data_validade: novaValidade } : l));
                onChanged?.();
              }}
            />
          )}

          {/* Próxima ação IA — bloco de MAIOR prioridade no Pipeline: ganha
              fundo levemente destacado e faixa lateral, para liderar a coluna
              em vez de disputar peso com os cartões vizinhos. */}
          <div className={`${secao} ${divisor} ${noPipeline ? 'bg-indigo-500/[0.05] border-l-2 border-l-indigo-500' : ''}`}>
            <div className="flex items-center gap-1.5 mb-2">
              <Bot size={12} className="text-indigo-500" />
              <span className={`text-xs font-semibold uppercase tracking-wide ${noPipeline ? 'text-indigo-300/90' : 'text-slate-500'}`}>Próxima ação · IA</span>
              {isActionDelayed && (
                <span className="ml-auto text-xs font-semibold text-red-500 bg-red-500/10 px-1.5 py-0.5 rounded">Atrasada</span>
              )}
            </div>
            <button
              type="button"
              onClick={precisaLiberar ? handleLiberarMotor : handleExecutarAcao}
              disabled={executando || liberando}
              title={precisaLiberar ? 'Liberar este lead para o motor de cadência' : 'Executar próxima etapa da cadência'}
              className={`w-full text-left rounded-xl px-3 py-2 mb-2 transition-colors disabled:opacity-60 ${isActionDelayed ? 'bg-red-500/10 hover:bg-red-500/20' : 'bg-indigo-500/10 hover:bg-indigo-500/20'}`}
            >
              <p className={`text-sm font-semibold leading-snug ${isActionDelayed ? 'text-red-900' : 'text-indigo-900'}`}>
                {selectedEmpresa.observacoes ?? 'Executar próxima etapa da cadência'}
              </p>
            </button>
            <div className="flex gap-2">
              {precisaLiberar ? (
                /* Trava n8n→motor: liberar é um passo humano separado do
                   "Executar ação" — depois disso o motor REAL pode enviar
                   e-mails automaticamente (MODO_ENSAIO=false). */
                <button
                  onClick={handleLiberarMotor}
                  disabled={liberando}
                  className={`flex-1 text-xs font-semibold py-1.5 rounded-lg transition-colors disabled:opacity-50 ${
                    confirmandoLiberar
                      ? 'text-black bg-amber-400 hover:bg-amber-300'
                      : 'text-amber-300 bg-amber-500/15 border border-amber-500/40 hover:bg-amber-500/25'
                  }`}
                >
                  {liberando ? 'Liberando...' : confirmandoLiberar ? 'Confirmar liberação?' : 'Liberar para o motor'}
                </button>
              ) : (
                /* CTA principal: no Pipeline ganha peso (mais alto, mais largo
                   que a secundária e com sombra) para liderar o bloco. */
                <button
                  onClick={handleExecutarAcao}
                  disabled={executando}
                  className={`text-xs font-semibold text-white rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50 ${
                    noPipeline ? 'flex-[1.5] py-2 shadow-lg shadow-indigo-500/20' : 'flex-1 py-1.5'
                  }`}
                  style={{ backgroundColor: '#6366f1' }}
                >
                  {executando ? 'Executando...' : 'Executar ação'}
                </button>
              )}
              <button
                onClick={handleGerarMensagem}
                disabled={mensagemLoading}
                className={`flex-1 text-xs font-medium text-slate-300 rounded-lg border hover:bg-[var(--bg-base)] transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-1 ${
                  noPipeline ? 'py-2 border-[var(--t-border-strong,#2f3a52)]' : 'py-1.5 border-[var(--border)]'
                }`}
              >
                {mensagemLoading ? <Loader2 size={12} className="animate-spin" /> : null}
                {mensagemLoading ? 'Gerando...' : 'Gerar mensagem'}
              </button>
            </div>
            {mensagemErro && (
              <p className="text-xs text-red-400 mt-2">{mensagemErro}</p>
            )}
            {confirmandoLiberar && !liberando && (
              <p className="text-[11px] text-amber-400 mt-2 leading-snug">
                Isso entrega o lead ao motor REAL: a partir da liberação, os e-mails da
                cadência são enviados de verdade (automaticamente e via “Executar ação”).
                Clique de novo para confirmar.
              </p>
            )}
            {feedbackAcao && (
              <p className={`text-xs mt-2 ${feedbackAcao.startsWith('✓') ? 'text-green-400' : 'text-red-500'}`}>
                {feedbackAcao}
              </p>
            )}
          </div>

          {/* Cadência (item 2): progresso real de contatos + status da automação */}
          <div className={`${secao} ${divisor}`}>
            <div className="flex items-center gap-1.5 mb-2">
              <Repeat size={12} className="text-indigo-400" />
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Cadência</span>
              <span className={`ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                cadenciaAtiva ? 'bg-green-500/20 text-green-400' : 'bg-slate-500/15 text-slate-400'
              }`}>
                {cadenciaAtiva ? 'Automação ativa' : 'Pausada'}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-slate-400">{contatosEnviados} de {CADENCIA_TOTAL} contatos</span>
              <span className="text-slate-500">{cadenciaPct}%</span>
            </div>
            <div className="w-full h-2 bg-[var(--bg-base)] rounded-full overflow-hidden">
              <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${cadenciaPct}%` }} />
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-500 mt-2">
              <span>Último contato: {ultimoContato ? formatDate(ultimoContato) : '—'}</span>
              <span className="capitalize">{selectedContato?.canal_preferencial ?? '—'}</span>
            </div>
          </div>

          {/* Resumo IA */}
          <div className={`${secao} ${divisor}`}>
            <div className="flex items-center gap-1.5 mb-1.5">
              <Bot size={12} className="text-green-500" />
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Resumo · IA</span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed line-clamp-3">
              {selectedEmpresa.observacoes ?? 'Sem resumo disponível.'}
            </p>
          </div>

          {/* Inteligência Comercial · IA (item 4) — gerada sob demanda */}
          <div className={`${secao} ${divisor}`}>
            <div className="flex items-center gap-1.5 mb-2">
              <Sparkles size={12} className="text-amber-400" />
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Inteligência Comercial · IA</span>
              {insight && (
                <button
                  type="button"
                  onClick={handleGerarInsight}
                  disabled={insightLoading}
                  className="ml-auto text-xs text-indigo-400 hover:underline disabled:opacity-50"
                >
                  Regerar
                </button>
              )}
            </div>

            {!insight && !insightLoading && (
              <button
                type="button"
                onClick={handleGerarInsight}
                className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold text-amber-300 bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 py-2 rounded-lg transition-colors"
              >
                <Sparkles size={13} /> Gerar análise comercial
              </button>
            )}

            {insightLoading && (
              <div className="flex items-center gap-2 text-slate-500 py-2">
                <Loader2 size={13} className="animate-spin" />
                <span className="text-xs">Analisando o lead com IA...</span>
              </div>
            )}

            {insightErro && !insightLoading && (
              <p className="text-xs text-red-400 mt-1">{insightErro}</p>
            )}

            {insight && !insightLoading && (
              <div className="space-y-2.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-slate-500">Aderência à solução:</span>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${ADERENCIA_BADGE[insight.aderencia]}`}>
                    {insight.aderencia}
                  </span>
                </div>
                {([
                  { label: 'Oportunidade', value: insight.oportunidade },
                  { label: 'Dor provável', value: insight.dor },
                  { label: 'Abordagem sugerida', value: insight.abordagem },
                ] as const).map(item => (
                  <div key={item.label}>
                    <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-0.5">{item.label}</div>
                    <p className="text-xs text-slate-300 leading-relaxed">{item.value}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Atividade recente (item 2): timeline curta + link p/ o histórico */}
          <div className={`${secao} ${divisor}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Atividade recente</span>
              <button
                type="button"
                onClick={() => setAbaPainel('conversa')}
                className="text-xs text-indigo-400 hover:underline flex items-center gap-0.5"
              >
                Ver histórico completo <ArrowRight size={10} />
              </button>
            </div>
            {historicoIndisponivel ? (
              <p className="text-xs text-red-400">Não foi possível carregar o histórico.</p>
            ) : loadingInteracoes ? (
              <div className="flex items-center gap-2 text-slate-500 py-1"><Loader2 size={13} className="animate-spin" /><span className="text-xs">Carregando...</span></div>
            ) : atividadeRecente.length === 0 ? (
              <p className="text-xs text-slate-500">Nenhuma interação registrada ainda.</p>
            ) : (
              <div className="space-y-2">
                {atividadeRecente.map(interacao => {
                  const cfg = INTERACAO_TIPO[interacao.tipo] ?? INTERACAO_TIPO.nota;
                  const isIA = interacao.origem_acao === 'ia';
                  const Icon = isIA ? Bot : cfg.Icon;
                  return (
                    <div key={interacao.id} className="flex items-start gap-2.5">
                      <div className="w-5 h-5 rounded-full bg-[var(--bg-input)] flex items-center justify-center shrink-0 mt-0.5">
                        <Icon size={10} className={isIA ? 'text-blue-500' : cfg.color} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-slate-300 truncate">{interacao.descricao || cfg.label}</div>
                        <div className="text-[11px] text-slate-500">
                          {new Date(interacao.created_at).toLocaleDateString('pt-BR')}
                          <span className="ml-1.5">{isIA ? '· IA' : '· Manual'}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Abrir ficha completa (Central do Lead) */}
          <div className="px-5 py-3">
            <button
              type="button"
              onClick={() => setShowAllInteracoes(true)}
              className="w-full flex items-center justify-center gap-1.5 text-xs font-medium text-slate-300 py-2 rounded-lg border border-[var(--border)] hover:bg-[var(--bg-base)] transition-colors"
            >
              <Maximize2 size={12} /> Abrir ficha completa
            </button>
          </div>
          </>)}

          {abaPainel === 'conversa' && (<>
          {/* Registrar interação (formulário real) */}
          <div className={`${secao} ${divisor}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Registrar interação</span>
              {!showRegistrar && (
                <button
                  type="button"
                  onClick={() => setShowRegistrar(true)}
                  className="text-xs text-indigo-400 hover:underline flex items-center gap-0.5"
                >
                  <Plus size={11} /> Nova
                </button>
              )}
            </div>
            {showRegistrar && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={novaInteracao.tipo}
                    onChange={e => setNovaInteracao(s => ({ ...s, tipo: e.target.value }))}
                    className="text-xs border border-[var(--border)] rounded-lg px-2 py-1.5 bg-[var(--bg-base)] text-slate-300 focus:outline-none"
                  >
                    <option value="abordagem">Abordagem</option>
                    <option value="follow_up">Follow-up</option>
                    <option value="resposta">Resposta</option>
                    <option value="nota">Nota</option>
                    <option value="reuniao">Reunião</option>
                  </select>
                  <select
                    value={novaInteracao.canal}
                    onChange={e => setNovaInteracao(s => ({ ...s, canal: e.target.value }))}
                    className="text-xs border border-[var(--border)] rounded-lg px-2 py-1.5 bg-[var(--bg-base)] text-slate-300 focus:outline-none"
                  >
                    <option value="email">Email</option>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="linkedin">LinkedIn</option>
                    <option value="telefone">Telefone</option>
                  </select>
                </div>
                <textarea
                  value={novaInteracao.descricao}
                  onChange={e => setNovaInteracao(s => ({ ...s, descricao: e.target.value }))}
                  rows={3}
                  placeholder="Descreva a interação..."
                  className="w-full text-xs border border-[var(--border)] rounded-lg px-2 py-1.5 bg-[var(--bg-base)] text-slate-300 focus:outline-none resize-none"
                />
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => { setShowRegistrar(false); setNovaInteracao({ tipo: 'abordagem', canal: 'email', descricao: '' }); }}
                    className="text-xs font-medium text-slate-300 px-3 py-1.5 rounded-lg border border-[var(--border)] hover:bg-[var(--bg-input)] transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleRegistrarInteracao}
                    disabled={salvandoInteracao || !novaInteracao.descricao.trim()}
                    className="flex items-center gap-1.5 text-xs font-semibold text-white px-4 py-1.5 rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50"
                    style={{ backgroundColor: '#6366f1' }}
                  >
                    {salvandoInteracao && <Loader2 size={12} className="animate-spin" />}
                    Salvar
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Histórico */}
          <div className={`${noPipeline ? 'px-4 py-4' : 'px-5 py-4'} ${divisor}`}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Histórico de interações</span>
              <button
                type="button"
                onClick={() => setShowAllInteracoes(true)}
                className="text-xs text-indigo-400 hover:underline flex items-center gap-0.5"
              >
                Ver tudo <ArrowRight size={10} />
              </button>
            </div>
            {historicoIndisponivel ? (
              <p className="text-xs text-red-400">Não foi possível carregar o histórico. Tente novamente.</p>
            ) : loadingInteracoes ? (
              <div className="flex items-center gap-2 text-slate-500 py-2">
                <Loader2 size={13} className="animate-spin" />
                <span className="text-xs">Carregando interações...</span>
              </div>
            ) : historicoConversa.length === 0 ? (
              <p className="text-xs text-slate-500">Nenhuma interação registrada ainda.</p>
            ) : (
              <div className="space-y-2">
                {historicoConversa.map(item => {
                  // Mensagem real de WhatsApp (fonte: whatsapp_mensagens). Mesmo
                  // card das interações; muda o rótulo por direção e o remetente.
                  if (item.kind === 'whatsapp') {
                    const m = item.mensagem;
                    const dir = direcaoWhatsapp(m);
                    const remetente = remetenteWhatsapp(m);
                    const corpo = m.conteudo ?? '';
                    const expandida = msgsExpandidas.has(m.id);
                    const longa = corpo.length > 160 || corpo.split('\n').length > 3;
                    return (
                      <div key={m.id} className="rounded-lg border border-[var(--border)] bg-[var(--bg-base)] p-2.5">
                        <div className="flex items-center gap-2 mb-1">
                          <MessageSquare size={11} className="text-green-400 shrink-0" />
                          <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded-full ${dir.classes}`}>{dir.rotulo}</span>
                          <span className="text-[11px] text-slate-500 ml-auto shrink-0">{formatDateTime(quandoWhatsapp(m))}</span>
                        </div>
                        {remetente && <div className="text-xs font-medium text-slate-300 mb-0.5 truncate">{remetente}</div>}
                        {corpo ? (
                          <p className={`text-xs text-slate-400 leading-relaxed whitespace-pre-wrap ${!expandida && longa ? 'line-clamp-3' : ''}`}>
                            {corpo}
                          </p>
                        ) : (
                          <p className="text-xs text-slate-600 italic">[mensagem sem texto — {m.tipo}]</p>
                        )}
                        {longa && (
                          <button onClick={() => toggleExpandir(m.id)} className="text-[11px] text-indigo-400 hover:underline mt-1">
                            {expandida ? 'Ver menos' : 'Ver mensagem completa'}
                          </button>
                        )}
                      </div>
                    );
                  }

                  const interacao = item.interacao;
                  const isIA = interacao.origem_acao === 'ia';

                  // (2) Log de sistema/manutenção: estilo discreto (uma linha, dim,
                  // itálico) — é registro interno, não conversa com o cliente.
                  if (ehLogSistema(interacao)) {
                    return (
                      <div key={interacao.id} className="flex items-center gap-2 text-[11px] text-slate-500 py-0.5 pl-1">
                        <Settings size={11} className="text-slate-600 shrink-0" />
                        <span className="truncate flex-1 italic">{interacao.descricao}</span>
                        <span className="shrink-0 text-slate-600">{new Date(interacao.created_at).toLocaleDateString('pt-BR')}</span>
                      </div>
                    );
                  }

                  // Conversa: card com rótulo. (1) Follow-up numerado ("N de 8"),
                  // (3) corpo truncado com "Ver mensagem completa".
                  const badge = getTipoInteracaoBadge(interacao.tipo, interacao.descricao);
                  const rotulo =
                    interacao.tipo.startsWith('follow_up') ? `Follow-up ${followupNumero.get(interacao.id) ?? '?'} de ${TOTAL_FOLLOWUPS}`
                    : interacao.tipo === 'abordagem' ? '1º contato'
                    : badge.label;
                  const { assunto, corpo } = parseMensagem(interacao.descricao || '');
                  const expandida = msgsExpandidas.has(interacao.id);
                  const longa = corpo.length > 160 || corpo.split('\n').length > 3;
                  const tipoBase = interacao.tipo.startsWith('follow_up') ? 'follow_up' : interacao.tipo;
                  const Icon = isIA ? Bot : (INTERACAO_TIPO[tipoBase] ?? INTERACAO_TIPO.nota).Icon;
                  return (
                    <div key={interacao.id} className="rounded-lg border border-[var(--border)] bg-[var(--bg-base)] p-2.5">
                      <div className="flex items-center gap-2 mb-1">
                        <Icon size={11} className={isIA ? 'text-blue-500' : 'text-slate-400'} />
                        <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded-full ${badge.classes}`}>{rotulo}</span>
                        <span className="text-[11px] text-slate-500 ml-auto shrink-0">
                          {new Date(interacao.created_at).toLocaleDateString('pt-BR')} · {isIA ? 'IA' : 'Manual'}
                        </span>
                      </div>
                      {assunto && <div className="text-xs font-medium text-slate-300 mb-0.5 truncate">{assunto}</div>}
                      {corpo && (
                        <p className={`text-xs text-slate-400 leading-relaxed whitespace-pre-wrap ${!expandida && longa ? 'line-clamp-3' : ''}`}>
                          {corpo}
                        </p>
                      )}
                      {longa && (
                        <button onClick={() => toggleExpandir(interacao.id)} className="text-[11px] text-indigo-400 hover:underline mt-1">
                          {expandida ? 'Ver menos' : 'Ver mensagem completa'}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          </>)}

          {/* Propostas comerciais salvas deste lead: baixar PDF e enviar ao
              cliente. Montar/salvar continua no Comercial > Simulador. */}
          {abaPainel === 'propostas' && (
            <div className={noPipeline ? 'px-4 py-4' : 'px-5 py-4'}>
              {selectedLead ? (
                <PropostasLista leadId={selectedLead.id} />
              ) : (
                <p className="text-xs text-slate-500">Propostas disponíveis apenas com a base conectada.</p>
              )}
            </div>
          )}

          {abaPainel === 'dados' && (
            (() => {
            type Linha = { label: string; value?: string | null; href?: string; link?: boolean; cap?: boolean };
            const L = selectedLead;
            const cidadeEstado = [L?.cidade ?? selectedEmpresa.cidade, L?.estado ?? selectedEmpresa.estado]
              .filter(Boolean).join(', ');
            const siteRaw = L?.site ?? selectedEmpresa.website;
            const site = siteRaw ? (siteRaw.startsWith('http') ? siteRaw : `https://${siteRaw}`) : null;
            const linkedin = L?.linkedin ? (L.linkedin.startsWith('http') ? L.linkedin : `https://${L.linkedin}`) : null;
            const score = L?.score ?? selectedEmpresa.score_engajamento;
            const criado = L?.created_at ?? selectedEmpresa.data_entrada;

            const contato: Linha[] = [
              { label: 'Contato', value: L?.contato_nome ?? selectedContato?.nome },
              { label: 'Cargo', value: L?.contato_cargo ?? selectedContato?.cargo },
              { label: 'E-mail', value: L?.contato_email ?? selectedContato?.email, href: 'mailto:' },
              { label: 'Telefone', value: L?.contato_telefone ?? selectedContato?.telefone, href: 'tel:' },
              { label: 'Canal preferencial', value: L?.canal_preferencial ?? selectedContato?.canal_preferencial, cap: true },
            ];
            const empresa: Linha[] = [
              { label: 'Segmento / nicho', value: L?.segmento ?? selectedEmpresa.segmento },
              { label: 'Cidade', value: cidadeEstado },
              { label: 'Funcionários', value: L?.faixa_funcionarios ?? selectedEmpresa.funcionarios_faixa },
              { label: 'Responsável', value: L?.usuarios?.nome ?? selectedEmpresa.responsavel },
              { label: 'Origem', value: L?.origem ?? selectedEmpresa.origem },
              { label: 'Score', value: score ? `${score} / 100` : null },
              { label: 'Criado em', value: criado ? formatDate(criado) : null },
              { label: 'Validade do laudo', value: L?.data_validade ? formatDate(L.data_validade) : 'Não configurada' },
              { label: 'Site', value: site, link: true },
              { label: 'LinkedIn', value: linkedin, link: true },
            ];
            const render = (linhas: Linha[]) =>
              linhas.filter(l => l.value).map(l => {
                const v = l.value as string;
                return (
                  <div key={l.label} className="flex justify-between gap-3">
                    <span className="text-slate-400 shrink-0">{l.label}</span>
                    {l.href ? (
                      <a href={`${l.href}${v}`} className="text-indigo-400 hover:underline text-xs truncate max-w-[18rem]">{v}</a>
                    ) : l.link ? (
                      <a href={v} target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline text-xs truncate max-w-[18rem]">{v}</a>
                    ) : (
                      <span className={`font-medium text-slate-300 text-right truncate max-w-[18rem] ${l.cap ? 'capitalize' : ''}`}>{v}</span>
                    )}
                  </div>
                );
              });

            return (
              <div className="px-5 py-4 space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-slate-500">Dados usados na Base de Leads e nas personalizações.</span>
                  <button
                    type="button"
                    onClick={() => setEditandoDados(true)}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-1.5 text-xs font-semibold text-indigo-300 hover:bg-indigo-500/20"
                  >
                    <PencilLine size={12} /> Editar informações
                  </button>
                </div>
                <div>
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide block mb-2">Dados do contato</span>
                  <div className="space-y-1.5 text-sm">{render(contato)}</div>
                </div>
                <div>
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide block mb-2">Informações da empresa</span>
                  <div className="space-y-1.5 text-sm">{render(empresa)}</div>
                </div>
              </div>
            );
            })()
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-[var(--border)] flex items-center gap-2.5 bg-[var(--bg-base)]">
          {/* Menu de AÇÃO, não mostrador da etapa (ela aparece em "Estágio"): fica
              sempre em "Mover para outro estágio". Com value = etapa atual, uma
              etapa fora da lista (ex.: Novos Leads) fazia o navegador exibir a
              primeira opção, que então não podia ser escolhida (sem onChange). */}
          <select
            value=""
            onChange={(e) => handleMoverEstagio(e.target.value)}
            aria-label="Mover para outro estágio"
            className="flex-1 text-sm border border-[var(--border)] rounded-lg px-3 py-2 bg-[var(--bg-card)] text-slate-300 focus:outline-none"
          >
            <option value="" disabled>Mover para outro estágio</option>
            {ESTAGIOS_MANUAIS
              .filter(s => contexto !== 'pipeline' || s.value !== 'perdido')
              .map(s => {
                const atual = s.value === (selectedLead?.estagio ?? selectedEmpresa.estagio_pipeline);
                return (
                  <option key={s.value} value={s.value} disabled={atual}>{s.label}{atual ? ' (atual)' : ''}</option>
                );
              })}
          </select>
          {contexto !== 'pipeline' && (
            <button
              onClick={handleMarcarPerdido}
              onBlur={() => setConfirmandoPerdido(false)}
              className={`text-sm font-medium px-3 py-2 rounded-lg transition-colors whitespace-nowrap ${
                confirmandoPerdido
                  ? 'bg-red-600 text-white hover:bg-red-700 border border-red-600'
                  : 'text-red-400 border border-red-500/30 bg-red-500/10 hover:bg-red-500/20'
              }`}
            >
              {confirmandoPerdido ? 'Confirmar perda?' : 'Marcar como perdido'}
            </button>
          )}
        </div>
      </div>

      {/* Central do Lead — modal completo */}
      {showAllInteracoes && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40"
          onClick={() => setShowAllInteracoes(false)}
        >
          <div
            className="bg-[var(--bg-card)] rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {/* HEADER */}
            <div className="px-6 py-5 border-b border-[var(--border)]">
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <h2 className="text-xl font-bold text-slate-100 leading-tight">{selectedEmpresa.nome}</h2>
                  <div className="text-sm text-slate-400 mt-0.5">
                    {selectedEmpresa.cidade}, {selectedEmpresa.estado} · {selectedEmpresa.segmento}
                  </div>
                  {selectedContato && (
                    <div className="flex items-center gap-1.5 text-sm text-slate-300 mt-1">
                      <span className="font-semibold text-slate-200">{selectedContato.nome}</span>
                      <span className="text-slate-600">·</span>
                      <span className="text-slate-400">{selectedContato.cargo}</span>
                      <span className="text-slate-600">·</span>
                      {(() => {
                        const ci = selectedLead ? CANAL_INFO[selectedLead.canal_preferencial] : null;
                        const Icon = ci?.Icon ?? Mail;
                        return (
                          <span className="inline-flex items-center gap-1 text-slate-300">
                            <Icon size={13} /> {selectedContato.canal_preferencial}
                          </span>
                        );
                      })()}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setShowAllInteracoes(false)}
                  className="text-slate-500 hover:text-slate-300 transition-colors shrink-0"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Row de badges informativos */}
              <div className="flex flex-wrap gap-2 mt-4">
                <div className="flex flex-col bg-[var(--bg-base)] rounded-lg px-3 py-1.5 border border-[var(--border)]">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wide">Responsável</span>
                  <span className="text-sm font-medium text-slate-300">{selectedEmpresa.responsavel || '—'}</span>
                </div>
                <div className="flex flex-col bg-[var(--bg-base)] rounded-lg px-3 py-1.5 border border-[var(--border)]">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wide">Status</span>
                  <span className="text-sm font-medium text-slate-300">{getEstagioPipelineLabel(selectedEmpresa.estagio_pipeline as EstagioPipeline)}</span>
                </div>
                <div className="flex flex-col bg-[var(--bg-base)] rounded-lg px-3 py-1.5 border border-[var(--border)]">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wide">Último contato</span>
                  <span className="text-sm font-medium text-slate-300">{ultimoContato ? formatDate(ultimoContato) : '—'}</span>
                </div>
                <div className="flex flex-col bg-[var(--bg-base)] rounded-lg px-3 py-1.5 border border-[var(--border)] max-w-xs">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wide">Próxima ação</span>
                  <span className="text-sm font-medium text-slate-300 truncate">{selectedLead?.proxima_acao || '—'}</span>
                </div>
                <div className="flex flex-col bg-[var(--bg-base)] rounded-lg px-3 py-1.5 border border-[var(--border)]">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wide">Canal preferencial</span>
                  <span className="text-sm font-medium text-slate-300 capitalize">{selectedLead?.canal_preferencial ?? selectedContato?.canal_preferencial ?? '—'}</span>
                </div>
                <div className="flex flex-col bg-[var(--bg-base)] rounded-lg px-3 py-1.5 border border-[var(--border)]">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wide">Score</span>
                  <span className="text-sm font-bold" style={{ color: scoreColor(selectedLead?.score ?? selectedEmpresa.score_engajamento) }}>
                    {selectedLead?.score ?? selectedEmpresa.score_engajamento} <span className="text-slate-500 font-normal">/ 100</span>
                  </span>
                </div>
              </div>
            </div>

            {/* Cartões da nova camada de entidades também na ficha completa (Fase 4.5) */}
            {selectedLead && <EmpresaDecisoresCard leadId={selectedLead.id} />}
            {selectedLead && <ServicosLaudosCard leadId={selectedLead.id} />}

            {/* TABS */}
            <div className="px-6 border-b border-[var(--border)] flex gap-1">
              {([
                { id: 'timeline', label: 'Linha do tempo' },
                { id: 'dados', label: 'Dados do lead' },
              ] as const).map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setCentralTab(tab.id)}
                  className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                    centralTab === tab.id
                      ? 'border-indigo-500 text-indigo-400'
                      : 'border-transparent text-slate-400 hover:text-slate-300'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* CONTEÚDO */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {centralTab === 'timeline' ? (
                <div>
                  {/* Botão registrar */}
                  <div className="mb-4">
                    <button
                      onClick={() => setShowRegistrar(v => !v)}
                      className="flex items-center gap-1.5 text-sm font-medium text-indigo-400 border border-indigo-500/30 bg-indigo-500/10 hover:bg-indigo-500/20 px-3 py-1.5 rounded-lg transition-colors"
                    >
                      <Plus size={14} /> Registrar interação
                    </button>

                    {showRegistrar && (
                      <div className="mt-3 p-4 rounded-xl border border-[var(--border)] bg-[var(--bg-base)] space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-xs font-medium text-slate-400 block mb-1">Tipo</label>
                            <select
                              value={novaInteracao.tipo}
                              onChange={e => setNovaInteracao(s => ({ ...s, tipo: e.target.value }))}
                              className="w-full text-sm border border-[var(--border)] rounded-lg px-3 py-2 bg-[var(--bg-card)] text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                            >
                              <option value="abordagem">Abordagem</option>
                              <option value="follow_up">Follow-up</option>
                              <option value="resposta">Resposta</option>
                              <option value="nota">Nota</option>
                              <option value="reuniao">Reunião</option>
                            </select>
                          </div>
                          <div>
                            <label className="text-xs font-medium text-slate-400 block mb-1">Canal</label>
                            <select
                              value={novaInteracao.canal}
                              onChange={e => setNovaInteracao(s => ({ ...s, canal: e.target.value }))}
                              className="w-full text-sm border border-[var(--border)] rounded-lg px-3 py-2 bg-[var(--bg-card)] text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                            >
                              <option value="email">Email</option>
                              <option value="whatsapp">WhatsApp</option>
                              <option value="linkedin">LinkedIn</option>
                              <option value="telefone">Telefone</option>
                            </select>
                          </div>
                        </div>
                        <div>
                          <label className="text-xs font-medium text-slate-400 block mb-1">Descrição</label>
                          <textarea
                            value={novaInteracao.descricao}
                            onChange={e => setNovaInteracao(s => ({ ...s, descricao: e.target.value }))}
                            rows={3}
                            placeholder="Descreva a interação..."
                            className="w-full text-sm border border-[var(--border)] rounded-lg px-3 py-2 bg-[var(--bg-card)] text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-100 resize-none"
                          />
                        </div>
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => { setShowRegistrar(false); setNovaInteracao({ tipo: 'abordagem', canal: 'email', descricao: '' }); }}
                            className="text-sm font-medium text-slate-300 px-3 py-1.5 rounded-lg border border-[var(--border)] hover:bg-[var(--bg-input)] transition-colors"
                          >
                            Cancelar
                          </button>
                          <button
                            onClick={handleRegistrarInteracao}
                            disabled={salvandoInteracao || !novaInteracao.descricao.trim()}
                            className="flex items-center gap-1.5 text-sm font-semibold text-white px-4 py-1.5 rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50"
                            style={{ backgroundColor: '#6366f1' }}
                          >
                            {salvandoInteracao && <Loader2 size={13} className="animate-spin" />}
                            Salvar
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Lista da timeline */}
                  {loadingInteracoes ? (
                    <div className="flex items-center gap-2 text-slate-500 py-6">
                      <Loader2 size={16} className="animate-spin" />
                      <span className="text-sm">Carregando interações...</span>
                    </div>
                  ) : historicoConversa.length === 0 ? (
                    <p className="text-sm text-slate-500 py-4">Nenhuma interação registrada ainda.</p>
                  ) : (
                    <div className="space-y-3">
                      {historicoConversa.map(item => {
                        // Mensagem real de WhatsApp (fonte: whatsapp_mensagens).
                        if (item.kind === 'whatsapp') {
                          const m = item.mensagem;
                          const wa = CANAL_INFO.whatsapp;
                          const dir = direcaoWhatsapp(m);
                          const remetente = remetenteWhatsapp(m);
                          return (
                            <div key={m.id} className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 shadow-none">
                              <div className="flex items-start justify-between gap-3 mb-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                                    <Clock size={11} /> {formatDateTime(quandoWhatsapp(m))}
                                  </span>
                                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${dir.classes}`}>
                                    {dir.rotulo}
                                  </span>
                                  <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${wa.classes}`}>
                                    <wa.Icon size={11} /> {wa.label}
                                  </span>
                                </div>
                                <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${dir.statusClasses}`}>
                                  {dir.status}
                                </span>
                              </div>
                              {m.conteudo ? (
                                <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{m.conteudo}</p>
                              ) : (
                                <p className="text-sm text-slate-500 italic">[mensagem sem texto — {m.tipo}]</p>
                              )}
                              {remetente && (
                                <p className="text-xs text-slate-500 mt-1.5">de {remetente}</p>
                              )}
                            </div>
                          );
                        }

                        const interacao = item.interacao;
                        const tipoBadge = getTipoInteracaoBadge(interacao.tipo, interacao.descricao);
                        const statusBadge = getStatusInteracao(interacao.tipo);
                        const canal = interacao.canal ? CANAL_INFO[interacao.canal.toLowerCase()] : null;
                        const isIA = interacao.origem_acao === 'ia';
                        return (
                          <div key={interacao.id} className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 shadow-none">
                            <div className="flex items-start justify-between gap-3 mb-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                                  <Clock size={11} /> {formatDateTime(interacao.created_at)}
                                </span>
                                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${tipoBadge.classes}`}>
                                  {tipoBadge.label}
                                </span>
                                {canal && (
                                  <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${canal.classes}`}>
                                    <canal.Icon size={11} /> {canal.label}
                                  </span>
                                )}
                                {isIA && (
                                  <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400">IA</span>
                                )}
                              </div>
                              {statusBadge && (
                                <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${statusBadge.classes}`}>
                                  {statusBadge.label}
                                </span>
                              )}
                            </div>
                            {interacao.descricao && (
                              <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{interacao.descricao}</p>
                            )}
                            {interacao.usuarios?.nome && (
                              <p className="text-xs text-slate-500 mt-1.5">por {interacao.usuarios.nome}</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : (
                /* ABA DADOS DO LEAD */
                <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                  {[
                    { label: 'Empresa', value: selectedLead?.empresa ?? selectedEmpresa.nome },
                    { label: 'Cidade', value: selectedLead?.cidade ?? selectedEmpresa.cidade },
                    { label: 'Estado', value: selectedLead?.estado ?? selectedEmpresa.estado },
                    { label: 'Segmento', value: selectedLead?.segmento ?? selectedEmpresa.segmento },
                    { label: 'Site', value: selectedLead?.site, isLink: true },
                    { label: 'LinkedIn', value: selectedLead?.linkedin, isLink: true },
                    { label: 'Contato Nome', value: selectedLead?.contato_nome ?? selectedContato?.nome },
                    { label: 'Contato Cargo', value: selectedLead?.contato_cargo ?? selectedContato?.cargo },
                    { label: 'Contato Email', value: selectedLead?.contato_email ?? selectedContato?.email },
                    { label: 'Contato Telefone', value: selectedLead?.contato_telefone ?? selectedContato?.telefone },
                    { label: 'Canal Preferencial', value: selectedLead?.canal_preferencial, capitalize: true },
                    { label: 'Origem', value: selectedLead?.origem ?? selectedEmpresa.origem },
                    { label: 'Score', value: selectedLead ? `${selectedLead.score} / 100` : `${selectedEmpresa.score_engajamento} / 100` },
                    { label: 'Criado em', value: selectedLead?.created_at ? formatDate(selectedLead.created_at) : formatDate(selectedEmpresa.data_entrada) },
                    { label: 'Validade do laudo', value: selectedLead?.data_validade ? formatDate(selectedLead.data_validade) : 'Não configurada' },
                  ].map(field => (
                    <div key={field.label} className="border-b border-[var(--border)] pb-2">
                      <span className="text-xs text-slate-500 uppercase tracking-wide block mb-0.5">{field.label}</span>
                      {field.value ? (
                        field.isLink ? (
                          <a
                            href={field.value.startsWith('http') ? field.value : `https://${field.value}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-indigo-400 hover:underline break-all"
                          >
                            {field.value}
                          </a>
                        ) : (
                          <span className={`text-sm font-medium text-slate-300 ${field.capitalize ? 'capitalize' : ''}`}>{field.value}</span>
                        )
                      ) : (
                        <span className="text-sm text-slate-600">—</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {editandoDados && selectedLead && (
        <EditarLeadModal
          lead={selectedLead}
          onClose={() => setEditandoDados(false)}
          onSaved={(leadAtualizado) => {
            setSelectedLead(leadAtualizado)
            onChanged?.()
          }}
        />
      )}

      {/* Modal — preview da próxima mensagem da cadência (botão "Gerar mensagem") */}
      {mensagem && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40" onClick={() => setMensagem(null)}>
          <div className="bg-[var(--bg-card)] rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Mail size={16} className="text-indigo-400" />
                <h2 className="font-semibold text-slate-100">
                  Próxima mensagem — {mensagem.tipo === 'abordagem' ? '1º contato' : `follow-up ${mensagem.numero ?? ''}`.trim()}
                </h2>
              </div>
              <button onClick={() => setMensagem(null)} className="text-slate-500 hover:text-slate-300"><X size={18} /></button>
            </div>
            <div className="px-5 py-4 overflow-y-auto space-y-3">
              <div>
                <div className="text-xs text-slate-500 mb-1">Assunto</div>
                <div className="text-sm font-medium text-slate-200">{mensagem.assunto}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Corpo</div>
                <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap bg-[var(--bg-base)] rounded-lg p-3 border border-[var(--border)]">{mensagem.corpo}</p>
              </div>
              <p className="text-[11px] text-slate-600">Preview do que o motor enviaria a seguir. Não envia nada — use “Executar ação” para disparar de verdade.</p>
            </div>
            <div className="px-5 py-3 border-t border-[var(--border)] flex justify-end gap-2">
              <button onClick={copiarMensagem} className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-300 px-3 py-2 rounded-lg border border-[var(--border)] hover:bg-[var(--bg-base)] transition-colors">
                {mensagemCopiada ? <><Check size={12} /> Copiado</> : <><Copy size={12} /> Copiar</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
