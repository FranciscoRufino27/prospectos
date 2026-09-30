import { describe, it, expect } from 'vitest'
import { escolherContatoPrincipal, nivelCargo, type ContatoLido } from '../contatoPrincipal'

const c = (id: string, extra: Partial<ContatoLido> = {}): ContatoLido => ({
  id, nome: `Contato ${id}`, email: null, cargo: null, ultimoContato: null, ownerId: null, ...extra,
})

describe('nivelCargo', () => {
  it('nível 3: sócio, CEO, diretor, proprietário, fundador', () => {
    for (const cargo of ['Sócia', 'CEO', 'ceo founder', 'Diretor de Inovação', 'Proprietário', 'Fundador']) expect(nivelCargo(cargo)).toBe(3)
  })
  it('nível 2: gerente, gestor, head, coordenador, compras', () => {
    for (const cargo of ['Gerente de TI', 'Gestora de patrimônio', 'Head of TI', 'Coordenador de produção', 'Compras']) expect(nivelCargo(cargo)).toBe(2)
  })
  it('siglas e termos curtos só casam como palavra inteira', () => {
    expect(nivelCargo('Coordenador')).toBe(2) // não é "coo"
    expect(nivelCargo('Social media')).toBe(1) // não é "socia"
  })
  it('assistente/analista/estagiário nunca passam de 1, mesmo com termo sênior', () => {
    expect(nivelCargo('Assistente executiva VP')).toBe(1)
    expect(nivelCargo('Assistente administrativo do setor de compras')).toBe(1)
    expect(nivelCargo('Analista de sistemas')).toBe(1)
    expect(nivelCargo('Estagiária de diretoria')).toBe(1)
  })
  it('sem cargo → 0; cargo qualquer → 1', () => {
    expect(nivelCargo(null)).toBe(0)
    expect(nivelCargo('  ')).toBe(0)
    expect(nivelCargo('PMO')).toBe(1)
  })
})

describe('escolherContatoPrincipal', () => {
  it('sem contatos → null', () => {
    expect(escolherContatoPrincipal([])).toBeNull()
  })
  it('e-mail vence cargo mais alto sem e-mail', () => {
    const r = escolherContatoPrincipal([c('1', { cargo: 'CEO' }), c('2', { email: 'a@x.com', cargo: 'Analista' })])
    expect(r?.id).toBe('2')
  })
  it('entre contatos com e-mail, vence o cargo mais alto', () => {
    const r = escolherContatoPrincipal([c('1', { email: 'a@x.com', cargo: 'Gerente' }), c('2', { email: 'b@x.com', cargo: 'Diretora' })])
    expect(r?.id).toBe('2')
  })
  it('mesmo nível: vence o contato mais recente; depois o menor ID', () => {
    const r1 = escolherContatoPrincipal([
      c('1', { email: 'a@x.com', ultimoContato: '2025-01-01T00:00:00Z' }),
      c('2', { email: 'b@x.com', ultimoContato: '2026-01-01T00:00:00Z' }),
    ])
    expect(r1?.id).toBe('2')
    const r2 = escolherContatoPrincipal([c('20', { email: 'a@x.com' }), c('3', { email: 'b@x.com' })])
    expect(r2?.id).toBe('3')
  })
  it('determinístico: a ordem de entrada não muda o resultado', () => {
    const lista = [c('5', { email: 'a@x.com', cargo: 'Gerente' }), c('9', { email: 'b@x.com', cargo: 'Gerente' }), c('7', { cargo: 'CEO' })]
    expect(escolherContatoPrincipal(lista)?.id).toBe(escolherContatoPrincipal([...lista].reverse())?.id)
  })
})
