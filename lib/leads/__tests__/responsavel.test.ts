import { describe, it, expect } from 'vitest'
import { membroDoUsuario, vincularResponsavel, type MembroEquipe, type UsuarioRef } from '../responsavel'

// Cenário-base: os 3 membros/usuários reais depois da correção de raiz em
// `usuarios` (Rufs ganhou linha própria; e-mail da Silmara alinhado ao login).
const USUARIOS: UsuarioRef[] = [
  { id: 'u-francisco', nome: 'Francisco', email: 'suporteinterno1inovacode@gmail.com' },
  { id: 'u-silmara', nome: 'Silmara', email: 'silmaragoncalves@inovacode.com.br' },
  { id: 'u-rufs', nome: 'Francisco Rufs', email: 'franrufs13@gmail.com' },
]

const EQUIPE: MembroEquipe[] = [
  { authId: 'a-rufino', nome: 'Francisco Rufino', email: 'suporteinterno1inovacode@gmail.com' },
  { authId: 'a-silmara', nome: 'Silmara Gonçalves', email: 'silmaragoncalves@inovacode.com.br' },
  { authId: 'a-rufs', nome: 'Francisco Rufs', email: 'franrufs13@gmail.com' },
]

describe('vincularResponsavel', () => {
  it('resolve os 3 membros reais por E-MAIL exato, sem colisão', () => {
    for (const [membro, esperado] of [
      [EQUIPE[0], 'u-francisco'],
      [EQUIPE[1], 'u-silmara'],
      [EQUIPE[2], 'u-rufs'],
    ] as const) {
      const r = vincularResponsavel(membro, USUARIOS, EQUIPE)
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.usuario.id).toBe(esperado)
        expect(r.via).toBe('email')
      }
    }
  })

  it('prefere e-mail exato mesmo quando o nome também casaria por prefixo', () => {
    // "Francisco Rufs" prefixaria o usuarios "Francisco", mas o e-mail é exato.
    const r = vincularResponsavel(EQUIPE[2], USUARIOS, EQUIPE)
    expect(r).toEqual({ ok: true, usuario: USUARIOS[2], via: 'email' })
  })

  it('cai no fallback por nome quando não há e-mail e o match é único', () => {
    const usuarios: UsuarioRef[] = [{ id: 'u1', nome: 'Ana', email: 'ana@x.com' }]
    const membro: MembroEquipe = { authId: 'm1', nome: 'Ana Paula', email: 'apaula@login.com' }
    const r = vincularResponsavel(membro, usuarios, [membro])
    expect(r).toEqual({ ok: true, usuario: usuarios[0], via: 'nome' })
  })

  it('PARA (ambiguo) quando o nome casa com mais de um usuarios por prefixo', () => {
    const usuarios: UsuarioRef[] = [
      { id: 'u1', nome: 'Ana', email: 'ana@x.com' },
      { id: 'u2', nome: 'Ana Paula', email: 'anapaula@x.com' },
    ]
    const membro: MembroEquipe = { authId: 'm1', nome: 'Ana Paula Silva', email: 'aps@login.com' }
    const r = vincularResponsavel(membro, usuarios, [membro])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.motivo).toBe('ambiguo')
  })

  it('PARA (ambiguo) quando dois membros caem no mesmo usuarios só por nome', () => {
    // Regressão do bug real: "Francisco Rufs" e "Francisco Rufino" sem e-mail
    // exato, ambos prefixando o único usuarios "Francisco".
    const usuarios: UsuarioRef[] = [{ id: 'u-francisco', nome: 'Francisco', email: 'interno@x.com' }]
    const equipe: MembroEquipe[] = [
      { authId: 'a-rufino', nome: 'Francisco Rufino', email: 'rufino@login.com' },
      { authId: 'a-rufs', nome: 'Francisco Rufs', email: 'rufs@login.com' },
    ]
    for (const membro of equipe) {
      const r = vincularResponsavel(membro, usuarios, equipe)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.motivo).toBe('ambiguo')
    }
  })

  it('devolve nao_encontrado quando não há e-mail nem nome que case', () => {
    const usuarios: UsuarioRef[] = [{ id: 'u1', nome: 'Beatriz', email: 'bea@x.com' }]
    const membro: MembroEquipe = { authId: 'm1', nome: 'Carlos Dias', email: 'carlos@login.com' }
    const r = vincularResponsavel(membro, usuarios, [membro])
    expect(r).toEqual({ ok: false, motivo: 'nao_encontrado' })
  })
})

// --- Responsável vindo da planilha ------------------------------------------
// Texto cru de célula, não membro de auth. E-mail exato manda; nome casa
// INTEIRO (não por prefixo, como no bridge da equipe); ambiguidade PARA.
import { resolverResponsavelDaPlanilha, resolverColunaResponsavel, chaveResponsavelPlanilha } from '../responsavel'

describe('responsável vindo da planilha de importação', () => {
  const usuarios = [
    { id: 'u1', nome: 'Aline Muller', email: 'aline@empresa.com' },
    { id: 'u2', nome: 'Bruno Lima', email: 'bruno@empresa.com' },
    { id: 'u3', nome: 'Bruno Veloso', email: 'executivo@empresa.com' },
  ]

  it('casa por e-mail exato, ignorando caixa e espaços', () => {
    const r = resolverResponsavelDaPlanilha('  ALINE@EMPRESA.COM ', usuarios)
    expect(r).toMatchObject({ ok: true, via: 'email' })
    expect(r.ok && r.usuario.id).toBe('u1')
  })

  it('casa por nome INTEIRO, sem acento e sem caixa', () => {
    const r = resolverResponsavelDaPlanilha('aline muller', usuarios)
    expect(r).toMatchObject({ ok: true, via: 'nome' })
    expect(r.ok && r.usuario.id).toBe('u1')
  })

  it('nome parcial NÃO resolve — planilha não tem curadoria para chutar prefixo', () => {
    expect(resolverResponsavelDaPlanilha('Bruno', usuarios)).toEqual({ ok: false, motivo: 'nao_encontrado' })
    expect(resolverResponsavelDaPlanilha('Aline', usuarios)).toEqual({ ok: false, motivo: 'nao_encontrado' })
  })

  it('dois usuários com o mesmo nome param em ambíguo, não escolhem um', () => {
    const homonimos = [...usuarios, { id: 'u4', nome: 'Aline Muller', email: 'aline2@empresa.com' }]
    const r = resolverResponsavelDaPlanilha('Aline Muller', homonimos)
    expect(r).toMatchObject({ ok: false, motivo: 'ambiguo' })
  })

  it('célula vazia é "vazio", não "não encontrado"', () => {
    expect(resolverResponsavelDaPlanilha('   ', usuarios)).toEqual({ ok: false, motivo: 'vazio' })
    expect(resolverResponsavelDaPlanilha(null, usuarios)).toEqual({ ok: false, motivo: 'vazio' })
  })

  it('resolve a coluna inteira e agrupa o que não resolveu por valor, com a contagem de linhas', () => {
    const { porValor, naoResolvidos } = resolverColunaResponsavel(
      ['Aline Muller', 'aline@empresa.com', 'Fulano', 'Fulano', 'Fulano', 'Bruno'],
      usuarios,
    )
    expect(porValor.get(chaveResponsavelPlanilha('Aline Muller'))?.id).toBe('u1')
    expect(porValor.get(chaveResponsavelPlanilha('ALINE@EMPRESA.COM'))?.id).toBe('u1')
    // Ordenado por impacto: o que afeta mais linhas primeiro.
    expect(naoResolvidos.map((n) => [n.valor, n.linhas])).toEqual([['Fulano', 3], ['Bruno', 1]])
  })

  it('usuário sem e-mail cadastrado ainda resolve pelo nome', () => {
    const semEmail = [{ id: 'u9', nome: 'Carla Dias', email: null }]
    expect(resolverResponsavelDaPlanilha('Carla Dias', semEmail)).toMatchObject({ ok: true, via: 'nome' })
  })
})

// Caminho inverso (aviso de resposta no WhatsApp): o `usuarios` do lead → o
// membro de login, pela MESMA regra; ambíguo ou ausente = ninguém.
describe('membroDoUsuario', () => {
  it('acha o membro de cada usuário real por e-mail', () => {
    expect(membroDoUsuario('u-francisco', USUARIOS, EQUIPE)?.authId).toBe('a-rufino')
    expect(membroDoUsuario('u-silmara', USUARIOS, EQUIPE)?.authId).toBe('a-silmara')
    expect(membroDoUsuario('u-rufs', USUARIOS, EQUIPE)?.authId).toBe('a-rufs')
  })

  it('usuário sem membro correspondente → null', () => {
    expect(membroDoUsuario('u-inexistente', USUARIOS, EQUIPE)).toBeNull()
    const semEmail: MembroEquipe[] = [{ authId: 'a-x', nome: 'Outra Pessoa', email: 'x@y.com' }]
    expect(membroDoUsuario('u-francisco', USUARIOS, semEmail)).toBeNull()
  })

  it('resolve por nome quando não há e-mail, e recusa quando dois membros caem no mesmo usuário', () => {
    const usuarios: UsuarioRef[] = [{ id: 'u-tester', nome: 'Tester', email: null }]
    const um: MembroEquipe[] = [{ authId: 'a-t', nome: 'Tester', email: 'teste@prospectos.local' }]
    expect(membroDoUsuario('u-tester', usuarios, um)?.authId).toBe('a-t')
    const dois: MembroEquipe[] = [...um, { authId: 'a-t2', nome: 'Tester Dois', email: 'outro@x.com' }]
    expect(membroDoUsuario('u-tester', usuarios, dois)).toBeNull()
  })
})
