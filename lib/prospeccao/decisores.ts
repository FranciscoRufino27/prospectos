// Decisor escolhido na Prospecção e a consulta de sócios que o sustenta.
// Tipos e validação puros, usados pela tela e pelas rotas (migration 0057).

import type { MotivoOutroDecisor, SocioAvaliado, StatusDecisor } from './adequacaoDecisor'
import type { Socio } from './socios'

/** Resultado da consulta de sócios, levado à lista (coluna Decisor). */
export interface AvaliacaoTela {
  status: StatusDecisor
  motivo: MotivoOutroDecisor | null
  emailNominalDe: string | null
}

/** Resposta de /api/prospeccao/socios; guardada por CNPJ. */
export interface ConsultaSocios extends AvaliacaoTela {
  socios: SocioAvaliado[]
  sugerido: Socio | null
}

export interface Decisor {
  nome: string
  cargo: string
  /** Perfil do LinkedIn como o usuário colou; a importação normaliza. */
  linkedin?: string
}

/** O que a busca devolve, por CNPJ, do que a organização já salvou. */
export interface AnaliseSalva {
  decisor: Decisor | null
  consulta: ConsultaSocios | null
}

const LIMITES = { nome: 120, cargo: 120, linkedin: 400 } as const

function texto(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim().slice(0, max)
  return t || null
}

/**
 * Corpo de PUT /api/prospeccao/decisores. Decisor sem nome é "nenhum
 * decisor": grava os três campos nulos (a consulta salva continua).
 */
export function validarDecisorSalvo(
  bruto: unknown,
): { ok: true; cnpj: string; nome: string | null; cargo: string | null; linkedin: string | null } | { ok: false; erro: string } {
  const o = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, unknown>
  const cnpj = typeof o.cnpj === 'string' ? o.cnpj.replace(/\D/g, '') : ''
  if (!/^\d{14}$/.test(cnpj)) return { ok: false, erro: 'CNPJ inválido.' }
  const nome = texto(o.nome, LIMITES.nome)
  if (!nome) return { ok: true, cnpj, nome: null, cargo: null, linkedin: null }
  return { ok: true, cnpj, nome, cargo: texto(o.cargo, LIMITES.cargo), linkedin: texto(o.linkedin, LIMITES.linkedin) }
}

/** Linha de prospeccao_decisores → formato da tela. */
export function analiseDaLinha(linha: {
  nome: string | null
  cargo: string | null
  linkedin: string | null
  consulta: unknown
}): AnaliseSalva {
  const consulta = linha.consulta && typeof linha.consulta === 'object' && Array.isArray((linha.consulta as ConsultaSocios).socios)
    ? (linha.consulta as ConsultaSocios)
    : null
  return {
    decisor: linha.nome ? { nome: linha.nome, cargo: linha.cargo ?? '', ...(linha.linkedin ? { linkedin: linha.linkedin } : {}) } : null,
    consulta,
  }
}
