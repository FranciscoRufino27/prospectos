import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AvisoRespostaRepository } from './repository'
import type {
  AvisoResposta, ClassificacaoAviso, DadosAvisoResposta, DestinoAvisoResposta, StatusAvisoResposta, TipoAviso,
} from './types'

// Implementação Supabase do outbox (migrations 0053/0067). Client admin
// (service_role BYPASSA RLS) → toda leitura/escrita filtra e grava organizacao_id.

const TABELA = 'avisos_resposta_cliente'
const COLS =
  'id, organizacao_id, lead_id, evento_id, tipo, destino_tipo, status, tentativas, ultimo_erro, dados, ' +
  'destino, provider_message_id, enviado_em, criado_em'

type Linha = {
  id: string
  organizacao_id: string
  lead_id: string
  evento_id: string
  tipo?: TipoAviso | null
  destino_tipo: DestinoAvisoResposta
  status: StatusAvisoResposta
  tentativas: number
  ultimo_erro: string | null
  dados: Partial<DadosAvisoResposta> | null
  destino: string | null
  provider_message_id: string | null
  enviado_em: string | null
  criado_em: string
}

const CLASSIFICACOES: ClassificacaoAviso[] = ['positivo', 'negativo', 'neutro', 'indeterminado']
const textoOuNull = (v: unknown) => (typeof v === 'string' && v ? v : null)

export function mapearAviso(l: Linha): AvisoResposta {
  const d = l.dados ?? {}
  return {
    id: l.id,
    organizacaoId: l.organizacao_id,
    leadId: l.lead_id,
    eventoId: l.evento_id,
    tipo: l.tipo === 'envio' ? 'envio' : 'resposta',
    destinoTipo: l.destino_tipo,
    status: l.status,
    tentativas: Number(l.tentativas ?? 0),
    ultimoErro: l.ultimo_erro ?? null,
    dados: {
      empresa: String(d.empresa ?? ''),
      contato: String(d.contato ?? ''),
      canal: d.canal === 'whatsapp' ? 'whatsapp' : 'email',
      classificacao: CLASSIFICACOES.includes(d.classificacao ?? null) ? (d.classificacao as ClassificacaoAviso) : null,
      trecho: String(d.trecho ?? ''),
      responsavelId: textoOuNull(d.responsavelId),
      // Sem estes dois, o grupo e o responsável escolhidos na campanha se
      // perdiam ao reler a linha e o aviso caía na regra da organização.
      responsavelPerfilId: textoOuNull(d.responsavelPerfilId),
      grupoId: textoOuNull(d.grupoId),
      responsavelNome: String(d.responsavelNome ?? ''),
      link: textoOuNull(d.link),
      campanhaNome: textoOuNull(d.campanhaNome),
      etapa: textoOuNull(d.etapa),
      assunto: textoOuNull(d.assunto),
    },
    destino: l.destino ?? null,
    providerMessageId: l.provider_message_id ?? null,
    enviadoEm: l.enviado_em ?? null,
    criadoEm: l.criado_em,
  }
}

const RECLAMAVEIS: StatusAvisoResposta[] = ['pendente', 'falhou', 'configuracao_ausente']

export class SupabaseAvisoRespostaRepository implements AvisoRespostaRepository {
  constructor(private readonly admin: SupabaseClient) {}

  async registrar(org: string, e: { leadId: string; eventoId: string; destinoTipo: DestinoAvisoResposta; dados: DadosAvisoResposta; tipo?: TipoAviso }): Promise<AvisoResposta> {
    // ignoreDuplicates: o índice único (org, evento, destino) segura a corrida.
    const { error } = await this.admin
      .from(TABELA)
      .upsert(
        {
          organizacao_id: org, lead_id: e.leadId, evento_id: e.eventoId, tipo: e.tipo ?? 'resposta',
          destino_tipo: e.destinoTipo, status: 'pendente', dados: e.dados,
        },
        { onConflict: 'organizacao_id,evento_id,destino_tipo', ignoreDuplicates: true },
      )
    if (error) throw new Error(error.message)
    const { data, error: erroLer } = await this.admin
      .from(TABELA)
      .select(COLS)
      .eq('organizacao_id', org)
      .eq('evento_id', e.eventoId)
      .eq('destino_tipo', e.destinoTipo)
      .maybeSingle()
    if (erroLer) throw new Error(erroLer.message)
    if (!data) throw new Error('aviso de resposta não encontrado após registrar')
    return mapearAviso(data as unknown as Linha)
  }

  async listarPorEvento(org: string, eventoId: string): Promise<AvisoResposta[]> {
    const { data, error } = await this.admin
      .from(TABELA).select(COLS).eq('organizacao_id', org).eq('evento_id', eventoId)
    if (error) throw new Error(error.message)
    return ((data ?? []) as unknown as Linha[]).map(mapearAviso)
  }

  async existeDesde(org: string, leadId: string, desdeISO: string): Promise<boolean> {
    const { data, error } = await this.admin
      .from(TABELA).select('id').eq('organizacao_id', org).eq('lead_id', leadId).eq('tipo', 'resposta')
      .gte('criado_em', desdeISO).limit(1)
    if (error) throw new Error(error.message)
    return (data?.length ?? 0) > 0
  }

  async buscar(org: string, id: string): Promise<AvisoResposta | null> {
    const { data, error } = await this.admin
      .from(TABELA).select(COLS).eq('organizacao_id', org).eq('id', id).maybeSingle()
    if (error) throw new Error(error.message)
    return data ? mapearAviso(data as unknown as Linha) : null
  }

  async reivindicarEnvio(org: string, id: string, tentativasEsperadas: number): Promise<boolean> {
    const { data, error } = await this.admin
      .from(TABELA)
      .update({ status: 'enviando', tentativas: tentativasEsperadas + 1, ultimo_erro: null })
      .eq('organizacao_id', org)
      .eq('id', id)
      .in('status', RECLAMAVEIS)
      .eq('tentativas', tentativasEsperadas)
      .select('id')
    if (error) throw new Error(error.message)
    return (data?.length ?? 0) > 0
  }

  async marcarEnviada(org: string, id: string, info: { destino: string; providerMessageId: string | null }): Promise<void> {
    const { error } = await this.admin
      .from(TABELA)
      .update({ status: 'enviada', destino: info.destino, provider_message_id: info.providerMessageId, enviado_em: new Date().toISOString(), ultimo_erro: null })
      .eq('organizacao_id', org)
      .eq('id', id)
    if (error) throw new Error(error.message)
  }

  async marcarFalha(org: string, id: string, erro: string): Promise<void> {
    const { error } = await this.admin
      .from(TABELA).update({ status: 'falhou', ultimo_erro: erro.slice(0, 500) }).eq('organizacao_id', org).eq('id', id)
    if (error) throw new Error(error.message)
  }

  async marcarConfiguracaoAusente(org: string, id: string, motivo: string): Promise<void> {
    const { error } = await this.admin
      .from(TABELA)
      .update({ status: 'configuracao_ausente', ultimo_erro: motivo.slice(0, 500) })
      .eq('organizacao_id', org)
      .eq('id', id)
      .in('status', RECLAMAVEIS)
    if (error) throw new Error(error.message)
  }

  async listarReprocessaveis(org: string, tetoTentativas: number, desdeISO: string, limite: number): Promise<AvisoResposta[]> {
    const { data, error } = await this.admin
      .from(TABELA)
      .select(COLS)
      .eq('organizacao_id', org)
      .in('status', RECLAMAVEIS)
      .lt('tentativas', tetoTentativas)
      .gte('criado_em', desdeISO)
      .order('criado_em', { ascending: true })
      .limit(limite)
    if (error) throw new Error(error.message)
    return ((data ?? []) as unknown as Linha[]).map(mapearAviso)
  }
}
