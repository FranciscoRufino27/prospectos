import { describe, expect, it } from 'vitest'
import { adicionarNicho, paraNicho, removerNicho } from '../nichosPersonalizados'
import { alternarNicho, gruposDoPerfil, nichoDaAtividade, nomeAtividade } from '../nichos'
import { buscarAtividades, cnaeExiste, descricaoCnae } from '../referenciaIbge'
import type { NichoPersonalizado } from '@/lib/config/workspaceConfig'

const AGORA = '2026-10-13T12:00:00.000Z'
const ACADEMIAS: NichoPersonalizado = { id: 'n1', nome: 'Academias', cnaes: ['9313100'], criadoEm: AGORA }
const criar = (lista: NichoPersonalizado[], corpo: { nome?: unknown; cnaes?: unknown }) =>
  adicionarNicho(lista, corpo, 'novo', AGORA, cnaeExiste, descricaoCnae)

describe('adicionarNicho', () => {
  it('cria com nome aparado e atividades sem máscara, sem repetir', () => {
    const r = criar([], { nome: '  Academias ', cnaes: ['9313-1/00', '9313100'] })
    expect(r).toEqual({ ok: true, nicho: { id: 'novo', nome: 'Academias', cnaes: ['9313100'], criadoEm: AGORA }, lista: [{ id: 'novo', nome: 'Academias', cnaes: ['9313100'], criadoEm: AGORA }] })
  })

  it('recusa sem nome, sem atividade ou atividade que o IBGE não conhece', () => {
    expect(criar([], { nome: ' ', cnaes: ['9313100'] })).toMatchObject({ ok: false, status: 400 })
    expect(criar([], { nome: 'X', cnaes: [] })).toMatchObject({ ok: false, status: 400 })
    expect(criar([], { nome: 'X', cnaes: ['9999999'] })).toMatchObject({ ok: false, status: 400, erro: 'Atividade desconhecida: 9999999.' })
  })

  it('recusa nome repetido, inclusive de nicho pré-definido, sem diferenciar maiúsculas', () => {
    expect(criar([ACADEMIAS], { nome: 'ACADEMIAS', cnaes: ['8630504'] })).toMatchObject({ ok: false, status: 409 })
    expect(criar([], { nome: 'hotelaria', cnaes: ['8630504'] })).toMatchObject({ ok: false, status: 409 })
  })

  it('recusa atividade que já está em outro nicho, dizendo qual', () => {
    const r = criar([ACADEMIAS], { nome: 'Esportes', cnaes: ['9313100'] })
    expect(r).toMatchObject({ ok: false, status: 409 })
    expect(!r.ok && r.erro).toContain('Academias')
    expect(criar([], { nome: 'Hospedagem', cnaes: ['5510801'] })).toMatchObject({ ok: false, erro: '"Hotéis" já está no nicho Hotelaria.' })
  })
})

describe('removerNicho', () => {
  it('remove pelo id e devolve null se não existe', () => {
    expect(removerNicho([ACADEMIAS], 'n1')).toEqual([])
    expect(removerNicho([ACADEMIAS], 'outro')).toBeNull()
  })
})

describe('nichos da organização junto dos pré-definidos', () => {
  const extras = [paraNicho(ACADEMIAS, descricaoCnae)]

  it('nome e nicho da atividade vêm do nicho da organização', () => {
    expect(nichoDaAtividade('9313100', extras)?.nome).toBe('Academias')
    expect(nomeAtividade('9313100', extras)).toBe(descricaoCnae('9313100'))
    expect(nichoDaAtividade('9313100')).toBeNull()
  })

  it('agrupa o perfil com o nicho da organização depois dos pré-definidos', () => {
    expect(gruposDoPerfil(['9313100', '5510801', '0111301'], extras).map((g) => g.nome)).toEqual(['Hotelaria', 'Academias', 'Outras atividades'])
  })

  it('alterna o nicho da organização inteiro', () => {
    expect(alternarNicho([], 'n1', 20, extras)).toEqual({ ok: true, cnaes: ['9313100'] })
    expect(alternarNicho(['9313100'], 'n1', 20, extras)).toEqual({ ok: true, cnaes: [] })
  })
})

describe('buscarAtividades', () => {
  it('acha pelo nome popular do IBGE quando o nome oficial não tem a palavra', async () => {
    const r = await buscarAtividades('academia')
    expect(r[0].codigo).toBe('9313100') // "academia de ginastica" antes de "academia de danca" e de construção
    expect(descricaoCnae('9313100')).toBe('Atividades de condicionamento físico')
  })

  it('ignora o plural ("Academias" acha academia)', async () => {
    expect((await buscarAtividades('Academias'))[0].codigo).toBe('9313100')
    expect((await buscarAtividades('clínicas odontológicas')).some((a) => a.codigo === '8630504')).toBe(true)
  })

  it('modo automático ignora o que vem depois de "exceto"', async () => {
    const r = (await buscarAtividades('Dança', 8, { soFortes: true })).map((a) => a.codigo)
    expect(r).toContain('8592901') // Ensino de dança
    expect(r).not.toContain('8592902') // Ensino de artes cênicas, exceto dança
  })

  it('nome oficial que começa com o termo vem antes', async () => {
    expect((await buscarAtividades('hoteis'))[0]).toEqual({ codigo: '5510801', nome: 'Hotéis' })
  })

  it('exige todas as palavras, sem acento, e aceita código', async () => {
    expect((await buscarAtividades('atividade odontologica')).some((a) => a.codigo === '8630504')).toBe(true)
    expect(await buscarAtividades('odontologica arroz')).toEqual([])
    expect(await buscarAtividades('9313-1')).toEqual([{ codigo: '9313100', nome: descricaoCnae('9313100') }])
    expect(await buscarAtividades('a')).toEqual([])
  })
})
