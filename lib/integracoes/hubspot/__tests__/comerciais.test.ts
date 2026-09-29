import { describe, it, expect } from 'vitest'
import { sugerirUsuario, salvarMapeamento, mapaResponsaveis, type UsuarioProspectos } from '../comerciais'
import { supabaseFake, tocouSoOrg } from './supabaseFake'

const ORG = 'org-a'

const USUARIOS: UsuarioProspectos[] = [
  { id: 'u-bruno-veloso', nome: 'Bruno Veloso', email: 'executivo@inovacode.com.br', ativo: true },
  { id: 'u-bruno-lima', nome: 'Bruno Lima', email: 'brunolima@inovacode.com.br', ativo: true },
  { id: 'u-silmara', nome: 'Silmara', email: 'silmaragoncalves@inovacode.com.br', ativo: true },
  { id: 'u-inativo', nome: 'Antigo', email: 'antigo@x.com', ativo: false },
  { id: 'u-dup-1', nome: 'Dup 1', email: 'dup@x.com', ativo: true },
  { id: 'u-dup-2', nome: 'Dup 2', email: 'DUP@x.com', ativo: true },
]

describe('sugerirUsuario — só por e-mail, nunca por nome', () => {
  it('e-mail idêntico (case-insensitive) com um único usuário ativo → sugestão', () => {
    expect(sugerirUsuario({ id: '229861376', firstName: 'Bruno', lastName: 'Veloso', email: 'EXECUTIVO@inovacode.com.br ' }, USUARIOS))
      .toEqual({ tipo: 'email', usuarioId: 'u-bruno-veloso' })
  })

  it('mesmo nome mas e-mail diferente → nenhuma sugestão (não mapeia por nome)', () => {
    expect(sugerirUsuario({ id: '76540616', firstName: 'Silmara', lastName: 'Gonçalves', email: 'inovacodeprojetos2@gmail.com' }, USUARIOS))
      .toEqual({ tipo: 'nenhuma' })
  })

  it('e-mail que casa com mais de um usuário → ambígua, sem sugestão', () => {
    expect(sugerirUsuario({ id: '1', email: 'dup@x.com' }, USUARIOS)).toEqual({ tipo: 'ambigua', candidatos: 2 })
  })

  it('usuário inativo não é sugerido', () => {
    expect(sugerirUsuario({ id: '2', email: 'antigo@x.com' }, USUARIOS)).toEqual({ tipo: 'nenhuma' })
  })

  it('owner sem e-mail → nenhuma', () => {
    expect(sugerirUsuario({ id: '3', firstName: 'Bruno', lastName: 'Veloso' }, USUARIOS)).toEqual({ tipo: 'nenhuma' })
  })
})

describe('salvarMapeamento', () => {
  it('owner id inválido → rejeita sem tocar o banco', async () => {
    const { client, chains } = supabaseFake()
    const r = await salvarMapeamento(client, ORG, 'perfil-1', { hubspotOwnerId: 'abc', usuarioId: 'u-1' })
    expect(r).toMatchObject({ ok: false, motivo: 'owner_invalido' })
    expect(chains).toHaveLength(0)
  })

  it('usuário de OUTRA organização (não encontrado filtrando a org) → rejeita, nada gravado', async () => {
    const { client, chains } = supabaseFake((t) => (t === 'usuarios' ? { data: null } : {}))
    const r = await salvarMapeamento(client, ORG, 'perfil-1', { hubspotOwnerId: '229861376', usuarioId: 'u-outra-org' })
    expect(r).toMatchObject({ ok: false, motivo: 'usuario_invalido' })
    const busca = chains.find((c) => c.table === 'usuarios')
    expect(busca?.temEq('organizacao_id', ORG)).toBe(true)
    expect(busca?.temEq('id', 'u-outra-org')).toBe(true)
    expect(chains.some((c) => c.mode === 'upsert')).toBe(false)
  })

  it('usuário inativo → rejeita', async () => {
    const { client } = supabaseFake((t) => (t === 'usuarios' ? { data: { id: 'u-1', ativo: false } } : {}))
    const r = await salvarMapeamento(client, ORG, 'perfil-1', { hubspotOwnerId: '229861376', usuarioId: 'u-1' })
    expect(r).toMatchObject({ ok: false, motivo: 'usuario_invalido' })
  })

  it('usuário válido → upsert com organizacao_id, owner, usuário e ativo', async () => {
    const { client, chains } = supabaseFake((t) => (t === 'usuarios' ? { data: { id: 'u-bruno-veloso', ativo: true } } : {}))
    const r = await salvarMapeamento(client, ORG, 'perfil-1', { hubspotOwnerId: '229861376', usuarioId: 'u-bruno-veloso' })
    expect(r).toEqual({ ok: true, removido: false })
    const up = chains.find((c) => c.mode === 'upsert')
    expect(up?.payload).toMatchObject({
      organizacao_id: ORG, hubspot_owner_id: '229861376', usuario_id: 'u-bruno-veloso', ativo: true, atualizado_por: 'perfil-1',
    })
    expect(up?.upsertOpts).toEqual({ onConflict: 'organizacao_id,hubspot_owner_id' })
  })

  it('usuarioId null → volta para "Não mapeado" (delete filtrado pela org e pelo owner)', async () => {
    const { client, chains } = supabaseFake()
    const r = await salvarMapeamento(client, ORG, 'perfil-1', { hubspotOwnerId: '76540616', usuarioId: null })
    expect(r).toEqual({ ok: true, removido: true })
    const del = chains.find((c) => c.mode === 'delete')
    expect(del?.temEq('organizacao_id', ORG)).toBe(true)
    expect(del?.temEq('hubspot_owner_id', '76540616')).toBe(true)
  })

  it('isolamento: nenhuma chamada toca outra organização', async () => {
    const { client, chains } = supabaseFake((t) => (t === 'usuarios' ? { data: { id: 'u-1', ativo: true } } : {}))
    await salvarMapeamento(client, ORG, 'perfil-1', { hubspotOwnerId: '1', usuarioId: 'u-1' })
    await salvarMapeamento(client, ORG, 'perfil-1', { hubspotOwnerId: '2', usuarioId: null })
    expect(tocouSoOrg(chains, ORG)).toBe(true)
  })
})

describe('mapaResponsaveis', () => {
  it('só mapeamentos ATIVOS e só da organização pedida', async () => {
    const { client, chains } = supabaseFake(() => ({
      data: [
        { hubspot_owner_id: '229861376', usuario_id: 'u-bruno-veloso', ativo: true },
        { hubspot_owner_id: '34330657', usuario_id: 'u-sofie', ativo: false },
      ],
    }))
    const mapa = await mapaResponsaveis(client, ORG)
    expect([...mapa]).toEqual([['229861376', 'u-bruno-veloso']])
    expect(chains[0].temEq('organizacao_id', ORG)).toBe(true)
  })
})
