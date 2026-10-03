import { describe, expect, it } from 'vitest'
import type { ResultadoCatalogo } from '@/lib/prospeccao/buscaServidor'
import { celulaCsv, linhaCsv, montarCsv, nomeArquivoCsv } from '@/lib/prospeccao/exportarCsv'

const EMPRESA: ResultadoCatalogo = {
  cnpj: '04433548000186', razao_social: 'EMILIANO EMPREENDIMENTOS LTDA', nome_fantasia: 'HOTEL EMILIANO',
  cnae_principal: '5510801', cnaes_secundarios: [], porte: 'demais', mei: false, capital_social: 687135,
  data_inicio_atividade: '2001-05-10', logradouro: null, numero: null, bairro: null, cep: null,
  uf: 'SP', municipio: 'SAO PAULO', telefone: '(11) 98765432', email: 'juridico@emiliano.com.br',
  ja_na_base: false, lead_id: null, qualidade_email: 'corporativo',
  dominio: { dominio: 'emiliano.com.br', confereComNome: true }, municipio_nome: 'São Paulo',
  atividades: { '5510801': 'Hotéis' }, analise: null,
}

describe('celulaCsv', () => {
  it('aspas quando há separador, aspas ou quebra de linha', () => {
    expect(celulaCsv('Hotel; Spa')).toBe('"Hotel; Spa"')
    expect(celulaCsv('Hotel "Mar"')).toBe('"Hotel ""Mar"""')
    expect(celulaCsv('linha\nnova')).toBe('"linha\nnova"')
    expect(celulaCsv(null)).toBe('')
  })

  it('neutraliza injeção de fórmula', () => {
    expect(celulaCsv('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(celulaCsv('+5511')).toBe("'+5511")
    expect(celulaCsv('@SUM(1)')).toBe("'@SUM(1)")
    expect(celulaCsv('-10')).toBe("'-10")
  })
})

describe('linhaCsv', () => {
  it('traz os dados legíveis da empresa e do decisor, com o e-mail do decisor', () => {
    const linha = linhaCsv(EMPRESA, { nome: 'Carlos Filgueiras', cargo: 'Sócio-Administrador', linkedin: 'br.linkedin.com/in/carlos/?x=1' }, {
      socios: [], sugerido: null, status: 'socio_serve', motivo: null, emailNominalDe: null,
    }, 'carlos@emiliano.com.br')
    expect(linha).toEqual([
      '04.433.548/0001-86', 'Hotel Emiliano', 'Emiliano Empreendimentos LTDA', 'São Paulo', 'SP', 'Médio/grande',
      'Hotéis', '5510-8/01', '10/05/2001', '687.135,00', '(11) 99876-5432', 'Celular', 'carlos@emiliano.com.br',
      'emiliano.com.br', 'Carlos Filgueiras', 'Sócio-Administrador', 'https://www.linkedin.com/in/carlos',
      'Sócio serve',
    ])
  })

  it('nome da empresa sem sufixo societário, razão social completa', () => {
    const linha = linhaCsv({ ...EMPRESA, nome_fantasia: null, razao_social: 'POLAR RIO HOTEL LTDA' }, null, undefined)
    expect(linha.slice(1, 3)).toEqual(['Polar Rio Hotel', 'Polar Rio Hotel LTDA'])
  })

  it('sem análise: campos do decisor vazios e situação "Não analisado"', () => {
    const linha = linhaCsv({ ...EMPRESA, telefone: null, email: null, mei: true, porte: 'micro' }, null, undefined)
    expect(linha[5]).toBe('Microempresa (MEI)')
    expect(linha.slice(10, 18)).toEqual(['', '', '', 'emiliano.com.br', '', '', '', 'Não analisado'])
  })

  it('nunca exporta o e-mail cadastral da Receita no lugar do e-mail do decisor', () => {
    const linha = linhaCsv(EMPRESA, { nome: 'Carlos Filgueiras', cargo: 'Sócio' }, undefined)
    expect(linha).not.toContain('juridico@emiliano.com.br')
    expect(linha[12]).toBe('')
  })
})

describe('montarCsv', () => {
  it('BOM, cabeçalho, separador ";" e CRLF', () => {
    const csv = montarCsv([linhaCsv(EMPRESA, null, undefined)])
    expect(csv.startsWith('﻿CNPJ;Empresa;Razão social;')).toBe(true)
    expect(csv.split('\r\n')).toHaveLength(3)
    expect(csv.endsWith('\r\n')).toBe(true)
  })

  it('nome do arquivo com a data', () => {
    expect(nomeArquivoCsv(new Date(2026, 9, 1, 15))).toBe('prospeccao-2026-10-01.csv')
  })
})
