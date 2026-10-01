// Exporta as empresas selecionadas na Prospecção para CSV (planilha).
// Puro: a tela monta as linhas com o que já carregou e baixa o arquivo.
// Formato pensado para o Excel em português: separador ';', BOM UTF-8 e
// quebra de linha CRLF.

import type { ResultadoCatalogo } from './buscaServidor'
import type { ConsultaSocios, Decisor } from './decisores'
import { formatarTelefone, normalizarPerfilLinkedIn } from './contato'
import { formatarCnae, nomeLegivel, nomeSemSufixo, rotuloPorte } from './rotulos'
import { ROTULO_QUALIDADE } from './qualidadeEmail'
import { formatarCnpj } from '@/lib/empresas/cnpj'

const COLUNAS = [
  'CNPJ', 'Empresa', 'Razão social', 'Cidade', 'UF', 'Porte', 'Atividade principal', 'CNAE',
  'Abertura', 'Capital social', 'Telefone', 'Tipo de telefone', 'E-mail', 'Qualidade do e-mail',
  'Site provável', 'Decisor', 'Cargo do decisor', 'LinkedIn do decisor', 'Situação do decisor',
] as const

const SEPARADOR = ';'

/**
 * Uma célula do CSV: aspas quando há separador, aspas ou quebra de linha; e
 * apóstrofo na frente do que começa com = + - @ (o Excel executaria como
 * fórmula — injeção de CSV).
 */
export function celulaCsv(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined) return ''
  let texto = String(valor)
  if (/^[=+\-@\t\r]/.test(texto)) texto = `'${texto}`
  return /[";\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto
}

function situacao(decisor: Decisor | null | undefined, consulta: ConsultaSocios | undefined): string {
  if (consulta?.status === 'precisa_outro_decisor') return 'Precisa de outro decisor'
  if (consulta?.status === 'socio_serve') return 'Sócio serve'
  if (decisor?.nome) return 'Definido manualmente'
  return consulta ? 'Analisado, sem decisor' : 'Não analisado'
}

export function linhaCsv(
  empresa: ResultadoCatalogo,
  decisor: Decisor | null | undefined,
  consulta: ConsultaSocios | undefined,
): string[] {
  const telefone = formatarTelefone(empresa.telefone)
  return [
    formatarCnpj(empresa.cnpj),
    // Mesmo nome da lista (sem sufixo); a razão social completa vem ao lado.
    nomeSemSufixo(nomeLegivel(empresa.nome_fantasia ?? empresa.razao_social)),
    nomeLegivel(empresa.razao_social),
    empresa.municipio_nome ?? nomeLegivel(empresa.municipio),
    empresa.uf ?? '',
    empresa.mei ? `${rotuloPorte(empresa.porte)} (MEI)` : rotuloPorte(empresa.porte),
    empresa.atividades[empresa.cnae_principal] ?? '',
    formatarCnae(empresa.cnae_principal),
    empresa.data_inicio_atividade ? empresa.data_inicio_atividade.split('-').reverse().join('/') : '',
    empresa.capital_social === null ? '' : empresa.capital_social.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    telefone?.exibicao ?? empresa.telefone ?? '',
    telefone ? (telefone.tipo === 'celular' ? 'Celular' : 'Fixo') : '',
    empresa.email ?? '',
    empresa.email ? ROTULO_QUALIDADE[empresa.qualidade_email] : '',
    empresa.dominio?.dominio ?? '',
    decisor?.nome ?? '',
    decisor?.nome ? decisor.cargo ?? '' : '',
    normalizarPerfilLinkedIn(decisor?.linkedin) ?? '',
    situacao(decisor, consulta),
  ]
}

/** Arquivo completo: BOM + cabeçalho + uma linha por empresa. */
export function montarCsv(linhas: readonly (readonly string[])[]): string {
  const todas = [COLUNAS, ...linhas].map((l) => l.map(celulaCsv).join(SEPARADOR))
  return `﻿${todas.join('\r\n')}\r\n`
}

/** "prospeccao-2026-10-01.csv" (data local de quem exporta). */
export function nomeArquivoCsv(agora: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `prospeccao-${agora.getFullYear()}-${p(agora.getMonth() + 1)}-${p(agora.getDate())}.csv`
}
