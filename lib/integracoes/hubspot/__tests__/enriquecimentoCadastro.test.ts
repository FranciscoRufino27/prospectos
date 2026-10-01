import { describe, it, expect } from 'vitest'
import {
  cnpjValido, estadoNome, estadoDocumento, cnpjNoNome, normalizarDominio, dominioDeEmail, ehProvedorGenerico,
  dominiosCorporativos, estadoEmailContato, diagnosticarCadastro, semelhancaNome, dominioCombinaComNome,
} from '../enriquecimento/cadastro'

const PETROBRAS = '33000167000101'

describe('CNPJ', () => {
  it('dígitos verificadores', () => {
    expect(cnpjValido(PETROBRAS)).toBe(true)
    expect(cnpjValido('33000167000102')).toBe(false)
    expect(cnpjValido('11111111111111')).toBe(false)
    expect(cnpjValido('123')).toBe(false)
  })
  it('estado do documento: válido, DV inválido, CPF (11 dígitos), ausente, formato', () => {
    expect(estadoDocumento('33.000.167/0001-01')).toBe('valido')
    expect(estadoDocumento('33.000.167/0001-02')).toBe('digito_invalido')
    expect(estadoDocumento('123.456.789-09')).toBe('cpf')
    expect(estadoDocumento('')).toBe('ausente')
    expect(estadoDocumento('12345')).toBe('formato_invalido')
  })
  it('CNPJ dentro do nome', () => {
    expect(cnpjNoNome('33.000.167/0001-01')).toBe(PETROBRAS)
    expect(cnpjNoNome('Empresa X 33000167000101')).toBe(PETROBRAS)
    expect(cnpjNoNome('Empresa X')).toBeNull()
  })
})

describe('nome', () => {
  it('vazio, inválido, CNPJ como nome, válido', () => {
    expect(estadoNome('  ')).toBe('vazio')
    expect(estadoNome(null)).toBe('vazio')
    expect(estadoNome('33.000.167/0001-01')).toBe('cnpj_como_nome')
    expect(estadoNome('xx')).toBe('invalido')
    expect(estadoNome('12345')).toBe('invalido')
    expect(estadoNome('teste')).toBe('invalido')
    expect(estadoNome('Hotel Serra Azul')).toBe('valido')
  })
})

describe('domínio e e-mail', () => {
  it('normaliza site/URL para domínio', () => {
    expect(normalizarDominio('https://www.Empresa.com.br/contato?x=1')).toBe('empresa.com.br')
    expect(normalizarDominio('empresa.com.br')).toBe('empresa.com.br')
    expect(normalizarDominio('não é domínio')).toBeNull()
    expect(normalizarDominio('http://192.168.0.1')).toBeNull()
  })
  it('provedores genéricos vêm da lista do projeto', () => {
    for (const d of ['gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'icloud.com', 'bol.com.br', 'uol.com.br']) expect(ehProvedorGenerico(d)).toBe(true)
    expect(ehProvedorGenerico('empresa.com.br')).toBe(false)
  })
  it('domínios corporativos: sem genérico, sem escritório de contabilidade, sem repetição', () => {
    expect(dominiosCorporativos(['a@gmail.com', 'b@empresa.com.br', 'c@empresa.com.br', 'd@contabilidadex.com.br', null])).toEqual(['empresa.com.br'])
    expect(dominioDeEmail('Ana@Empresa.COM.br')).toBe('empresa.com.br')
  })
  it('situação do e-mail dos contatos', () => {
    expect(estadoEmailContato([], false)).toBe('sem_contato')
    expect(estadoEmailContato([null], true)).toBe('sem_email')
    expect(estadoEmailContato(['a@gmail.com'], true)).toBe('apenas_generico')
    expect(estadoEmailContato(['a@gmail.com', 'b@empresa.com'], true)).toBe('corporativo')
  })
})

describe('diagnosticarCadastro', () => {
  it('empresa válida precisa de nome utilizável e alguma evidência', () => {
    expect(diagnosticarCadastro({ nome: 'Hotel X', documento: null, dominio: null, emailsContatos: ['a@gmail.com'], temContato: true }))
      .toEqual({ nome: 'valido', documento: 'ausente', dominio: 'ausente', email_contato: 'apenas_generico', empresa_valida: false })
    expect(diagnosticarCadastro({ nome: 'Hotel X', documento: null, dominio: 'hotelx.com.br', emailsContatos: [], temContato: false }).empresa_valida).toBe(true)
    expect(diagnosticarCadastro({ nome: 'Hotel X', documento: null, dominio: 'gmail.com', emailsContatos: [], temContato: false }).dominio).toBe('provedor_generico')
  })
})

describe('semelhança (só reforça CNPJ achado por evidência)', () => {
  it('ignora palavras vazias (ltda, comércio…) e acentos', () => {
    expect(semelhancaNome('Ótica Maria José', 'OTICAS MARIA JOSE COMERCIO LTDA')).toBeGreaterThanOrEqual(0.5)
    expect(semelhancaNome('Hotel Azul', 'PADARIA BOM PAO LTDA')).toBe(0)
    expect(semelhancaNome('Ltda', 'Comercio Ltda')).toBe(0)
  })
  it('domínio contém palavra relevante do nome na Receita', () => {
    expect(dominioCombinaComNome('randonimplementos.com.br', 'RANDON S A IMPLEMENTOS E PARTICIPACOES')).toBe(true)
    expect(dominioCombinaComNome('abc.com.br', 'RANDON S A')).toBe(false)
  })
})
