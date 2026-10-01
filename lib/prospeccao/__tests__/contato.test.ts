import { describe, expect, it } from 'vitest'
import { emLote, formatarTelefone, linkWhatsApp, normalizarPerfilLinkedIn, urlBuscaLinkedIn } from '@/lib/prospeccao/contato'

describe('formatarTelefone', () => {
  it('fixo no formato do catálogo da Receita', () => {
    expect(formatarTelefone('(11) 55497787')).toEqual({ exibicao: '(11) 5549-7787', tipo: 'fixo', digitos: '1155497787' })
  })

  it('celular com DDI, máscara ou zero de operadora', () => {
    expect(formatarTelefone('+55 11 99876-5432')).toMatchObject({ exibicao: '(11) 99876-5432', tipo: 'celular' })
    expect(formatarTelefone('5521987654321')?.digitos).toBe('21987654321')
    expect(formatarTelefone('011 3239 0777')).toMatchObject({ exibicao: '(11) 3239-0777', tipo: 'fixo' })
  })

  it('celular da Receita (8 dígitos, sem o nono) ganha o 9 da frente', () => {
    expect(formatarTelefone('(11) 98765432')).toEqual({ exibicao: '(11) 99876-5432', tipo: 'celular', digitos: '11998765432' })
    expect(formatarTelefone('(21) 76543210')?.digitos).toBe('21976543210')
  })

  it('DDD com zeros à esquerda, como vem em parte do catálogo', () => {
    expect(formatarTelefone('(0011) 55497787')).toMatchObject({ exibicao: '(11) 5549-7787', tipo: 'fixo' })
    expect(formatarTelefone('(011) 88776655')).toMatchObject({ exibicao: '(11) 98877-6655', tipo: 'celular' })
  })

  it('não reconhece o que não é telefone BR válido', () => {
    expect(formatarTelefone(null)).toBeNull()
    expect(formatarTelefone('')).toBeNull()
    expect(formatarTelefone('998877')).toBeNull()
    expect(formatarTelefone('(01) 55497787')).toBeNull()
    // 7 dígitos (numeração antiga) e 9 dígitos que não começam em 9.
    expect(formatarTelefone('(11) 5549778')).toBeNull()
    expect(formatarTelefone('(11) 555497787')).toBeNull()
  })
})

describe('linkWhatsApp', () => {
  it('só para celular', () => {
    expect(linkWhatsApp(formatarTelefone('(11) 99876-5432'))).toBe('https://wa.me/5511998765432')
    expect(linkWhatsApp(formatarTelefone('(11) 55497787'))).toBeNull()
    expect(linkWhatsApp(formatarTelefone('(11) 98765432'))).toBe('https://wa.me/5511998765432')
    expect(linkWhatsApp(null)).toBeNull()
  })
})

describe('urlBuscaLinkedIn', () => {
  it('busca pessoa por nome + empresa, codificada', () => {
    expect(urlBuscaLinkedIn('Erick Ribeiro Martins', 'Residencial Pantanal')).toBe(
      'https://www.linkedin.com/search/results/people/?keywords=Erick%20Ribeiro%20Martins%20Residencial%20Pantanal',
    )
    expect(urlBuscaLinkedIn(' Ana ', null)).toBe('https://www.linkedin.com/search/results/people/?keywords=Ana')
  })
})

describe('normalizarPerfilLinkedIn', () => {
  it('aceita o perfil em qualquer forma colada e devolve a canônica', () => {
    const canonica = 'https://www.linkedin.com/in/erick-martins-123'
    expect(normalizarPerfilLinkedIn('https://www.linkedin.com/in/erick-martins-123/')).toBe(canonica)
    expect(normalizarPerfilLinkedIn('br.linkedin.com/in/erick-martins-123?utm_source=share')).toBe(canonica)
    expect(normalizarPerfilLinkedIn('  linkedin.com/in/erick-martins-123  ')).toBe(canonica)
    expect(normalizarPerfilLinkedIn('https://www.linkedin.com/in/jo%C3%A3o-silva')).toBe('https://www.linkedin.com/in/jo%C3%A3o-silva')
  })

  it('recusa o que não é perfil pessoal do LinkedIn', () => {
    expect(normalizarPerfilLinkedIn('')).toBeNull()
    expect(normalizarPerfilLinkedIn(null)).toBeNull()
    expect(normalizarPerfilLinkedIn('https://www.linkedin.com/company/hotel-emiliano')).toBeNull()
    expect(normalizarPerfilLinkedIn('https://www.linkedin.com/search/results/people/?keywords=ana')).toBeNull()
    expect(normalizarPerfilLinkedIn('https://linkedin.com.golpe.io/in/ana-souza')).toBeNull()
    expect(normalizarPerfilLinkedIn('https://evil.com/in/ana-souza')).toBeNull()
    expect(normalizarPerfilLinkedIn('javascript:alert(1)')).toBeNull()
    expect(normalizarPerfilLinkedIn('https://www.linkedin.com/in/ana/posts')).toBeNull()
  })
})

describe('emLote', () => {
  it('respeita a concorrência, mantém a ordem e isola falhas', async () => {
    let ativos = 0
    let pico = 0
    const progresso: number[] = []
    const r = await emLote(
      [1, 2, 3, 4, 5],
      2,
      async (n) => {
        ativos++
        pico = Math.max(pico, ativos)
        await new Promise((ok) => setTimeout(ok, 5))
        ativos--
        if (n === 3) throw new Error('falhou')
        return n * 10
      },
      (c) => progresso.push(c),
    )
    expect(pico).toBe(2)
    expect(r).toEqual([
      { ok: true, valor: 10 }, { ok: true, valor: 20 }, { ok: false }, { ok: true, valor: 40 }, { ok: true, valor: 50 },
    ])
    expect(progresso).toEqual([1, 2, 3, 4, 5])
  })

  it('lista vazia não chama a tarefa', async () => {
    expect(await emLote([], 3, async () => { throw new Error('não deveria') })).toEqual([])
  })
})
