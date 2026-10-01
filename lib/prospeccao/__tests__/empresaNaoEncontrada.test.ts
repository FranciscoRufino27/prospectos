// Tela "Empresa não encontrada" da busca por nome/CNPJ: distingue empresa
// escondida pelo filtro de e-mail de empresa que não está no catálogo.
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { EmpresaNaoEncontrada } from '@/components/prospeccao/ForaDoCatalogo'

const nada = () => {}
const tela = (texto: string, escondidasPorEmail = 0) =>
  renderToStaticMarkup(
    createElement(EmpresaNaoEncontrada, { texto, escondidasPorEmail, onMostrarSemEmail: nada, onBuscarFora: nada, onLimpar: nada }),
  )

describe('EmpresaNaoEncontrada', () => {
  it('nome sem resultado: explica e oferece procurar fora do catálogo', () => {
    const html = tela('padaria xyz')
    expect(html).toContain('Empresa não encontrada')
    expect(html).toContain('Não achamos “padaria xyz” no catálogo da Receita')
    expect(html).toContain('Procurar fora do catálogo')
    expect(html).toContain('Limpar busca')
  })

  it('CNPJ sem resultado: aponta para os dados oficiais e não oferece a Crustdata', () => {
    const html = tela('12.345.678/0001-90')
    expect(html).toContain('O CNPJ “12.345.678/0001-90” não está no catálogo')
    expect(html).toContain('Fora do catálogo')
    expect(html).not.toContain('Procurar fora do catálogo')
  })

  it('empresa escondida pelo filtro de e-mail: diz quantas e oferece mostrar', () => {
    const html = tela('pousada sao', 1)
    expect(html).toContain('Empresa encontrada, mas sem e-mail válido')
    expect(html).toContain('Há 1 empresa com “pousada sao”')
    expect(html).toContain('Mostrar mesmo sem e-mail')
    expect(tela('hotel', 3)).toContain('Há 3 empresas')
  })
})
