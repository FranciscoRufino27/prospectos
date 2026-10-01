import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { cursorValido, filtrosDoPerfil, limitePagina, normalizarFiltros, paramsRpc, LIMITE_PAGINA } from '@/lib/prospeccao/filtros'
import { classificarEmail, provedorPretendido } from '@/lib/prospeccao/qualidadeEmail'
import { consultarSocios, mapearSocios, sugerirDecisor } from '@/lib/prospeccao/socios'
import { importarProspeccao, MAX_ITENS_IMPORTACAO, resumir, validarItens } from '@/lib/prospeccao/importacaoServidor'
import { buscarProspeccao } from '@/lib/prospeccao/buscaServidor'

const PERFIL = { cnaes: ['5510801'], ufs: ['SP'], excluirMei: true }

describe('filtros da busca', () => {
  it('parte do perfil quando o cliente não manda nada', () => {
    expect(normalizarFiltros(undefined, PERFIL)).toEqual({
      cnaes: ['5510801'], incluirCnaesSecundarios: false, ufs: ['SP'], municipios: [],
      portes: [], excluirMei: true, soComEmail: true, texto: '',
    })
    expect(filtrosDoPerfil(undefined).cnaes).toEqual([])
  })

  it('aceita ajuste do cliente e descarta valor inválido', () => {
    const f = normalizarFiltros(
      { cnaes: ['5510802', 'x'], ufs: ['RJ', 'ZZ'], portes: ['micro', 'enorme'], soComEmail: true, excluirMei: false },
      PERFIL
    )
    expect(f).toMatchObject({ cnaes: ['5510802'], ufs: ['RJ'], portes: ['micro'], soComEmail: true, excluirMei: false })
  })

  it('escapa curingas do ILIKE e limita o texto', () => {
    expect(normalizarFiltros({ texto: ' 100%_hotel ' }, PERFIL).texto).toBe('100\\%\\_hotel')
    expect(normalizarFiltros({ texto: 'a'.repeat(200) }, PERFIL).texto).toHaveLength(80)
  })

  it('limite da página fica entre 1 e LIMITE_PAGINA', () => {
    expect(limitePagina(undefined)).toBe(LIMITE_PAGINA)
    expect(limitePagina(12)).toBe(12)
    expect(limitePagina(10_000)).toBe(LIMITE_PAGINA)
    expect(limitePagina(0)).toBe(LIMITE_PAGINA)
    expect(limitePagina(2.5)).toBe(LIMITE_PAGINA)
    expect(limitePagina('10')).toBe(LIMITE_PAGINA)
  })

  it('cursor só aceita "<nota>-<cnpj>"', () => {
    expect(cursorValido('41-12345678000199')).toBe('41-12345678000199')
    expect(cursorValido('12345678000199')).toBeNull()
    expect(cursorValido('411-12345678000199')).toBeNull()
    expect(cursorValido("1' or 1=1")).toBeNull()
    expect(cursorValido(123)).toBeNull()
  })

  it('a organização dos parâmetros é a recebida do servidor', () => {
    expect(paramsRpc('org-sessao', normalizarFiltros({}, PERFIL)).p_org).toBe('org-sessao')
  })
})

describe('qualidade do e-mail', () => {
  it.each([
    [null, 'sem_email'],
    ['', 'sem_email'],
    ['sem-arroba', 'sem_email'],
    ['fiscal@escritoriosilva.com.br', 'contabilidade'],
    ['hotelx@contabilidadeabc.com.br', 'contabilidade'],
    ['joao.hotel@gmail.com', 'pessoal'],
    ['reservas@hotelmar.com.br', 'generico'],
    ['contato@hotelmar.com.br', 'generico'],
    ['maria.souza@hotelmar.com.br', 'corporativo'],
    ['joao@hotmal.com', 'digitacao'],
    ['joao@gmail.con', 'digitacao'],
    ['joao@yahoo.com,br', 'digitacao'],
    // Domínios reais perto de provedores não viram "erro".
    ['reservas@serra.com.br', 'generico'],
    ['joao@yahoo.com.ar', 'corporativo'],
    ['joao@email.com', 'corporativo'],
  ])('%s → %s', (email, esperado) => {
    expect(classificarEmail(email)).toBe(esperado)
  })

  it('aponta o provedor mais próximo do erro', () => {
    expect(provedorPretendido('homail.com')).toBe('hotmail.com')
    expect(provedorPretendido('gmial.com')).toBe('gmail.com')
    expect(provedorPretendido('outllok.com')).toBe('outlook.com')
    expect(provedorPretendido('hotelmar.com.br')).toBeNull()
  })
})

describe('sócios (OpenCNPJ)', () => {
  const qsa = [
    { nome_socio: 'EMPRESA HOLDING SA', qualificacao_socio: 'Sócio', identificador_socio: 'Pessoa Jurídica' },
    { nome_socio: 'MARIA DA SILVA', qualificacao_socio: 'Sócio', identificador_socio: 'Pessoa Física', data_entrada_sociedade: '2015-01-02' },
    { nome_socio: 'JOAO DE SOUZA', qualificacao_socio: 'Sócio-Administrador', identificador_socio: 'Pessoa Física' },
  ]

  it('ignora sócio pessoa jurídica e formata o nome', () => {
    expect(mapearSocios(qsa)).toEqual([
      { nome: 'Maria da Silva', qualificacao: 'Sócio', desde: '2015-01-02' },
      { nome: 'Joao de Souza', qualificacao: 'Sócio-Administrador', desde: null },
    ])
    expect(mapearSocios('lixo')).toEqual([])
  })

  it('sugere o administrador como decisor', () => {
    expect(sugerirDecisor(mapearSocios(qsa))?.nome).toBe('Joao de Souza')
    expect(sugerirDecisor([])).toBeNull()
  })

  it('distingue CNPJ inexistente de API fora do ar', async () => {
    const f404 = vi.fn().mockResolvedValue(new Response('', { status: 404 }))
    expect(await consultarSocios('12345678000199', f404)).toEqual({ ok: false, motivo: 'nao_encontrado' })
    const f500 = vi.fn().mockResolvedValue(new Response('', { status: 503 }))
    expect(await consultarSocios('12345678000199', f500)).toEqual({ ok: false, motivo: 'indisponivel' })
    const falha = vi.fn().mockRejectedValue(new Error('rede'))
    expect(await consultarSocios('12345678000199', falha)).toEqual({ ok: false, motivo: 'indisponivel' })
    const ok = vi.fn().mockResolvedValue(new Response(JSON.stringify({ QSA: qsa }), { status: 200 }))
    expect(await consultarSocios('12345678000199', ok)).toMatchObject({ ok: true })
    // CNPJ malformado nem chega à rede.
    const nunca = vi.fn()
    expect(await consultarSocios('123', nunca)).toEqual({ ok: false, motivo: 'nao_encontrado' })
    expect(nunca).not.toHaveBeenCalled()
  })
})

describe('validação do lote de importação', () => {
  it('normaliza CNPJ e campos opcionais', () => {
    expect(
      validarItens([{ cnpj: '12.345.678/0001-99', email: ' A@B.COM ', contato_nome: '  Ana ', contato_cargo: '' }])
    ).toEqual({ ok: true, itens: [{ cnpj: '12345678000199', email: 'a@b.com', contato_nome: 'Ana', contato_cargo: null, contato_linkedin: null }] })
  })

  it('LinkedIn do decisor: normaliza o perfil e descarta o que não é perfil', () => {
    const r = validarItens([
      { cnpj: '12345678000199', contato_linkedin: 'br.linkedin.com/in/ana-souza/?trk=x' },
      { cnpj: '12345678000180', contato_linkedin: 'https://www.linkedin.com/company/hotel' },
      { cnpj: '12345678000171', contato_linkedin: 42 },
    ])
    expect(r.ok && r.itens.map((i) => i.contato_linkedin)).toEqual(['https://www.linkedin.com/in/ana-souza', null, null])
  })

  it('recusa lote vazio, grande demais ou com CNPJ inválido', () => {
    expect(validarItens([])).toMatchObject({ ok: false })
    expect(validarItens('x')).toMatchObject({ ok: false })
    expect(validarItens([{ cnpj: '123' }])).toMatchObject({ ok: false })
    const muitos = Array.from({ length: MAX_ITENS_IMPORTACAO + 1 }, () => ({ cnpj: '12345678000199' }))
    expect(validarItens(muitos)).toMatchObject({ ok: false })
  })

  it('resume por status', () => {
    expect(
      resumir([
        { cnpj: '1', status: 'importado', lead_id: 'l1' },
        { cnpj: '2', status: 'importado', lead_id: 'l2' },
        { cnpj: '3', status: 'sem_email', lead_id: null },
      ])
    ).toMatchObject({ importado: 2, sem_email: 1, ja_na_base: 0 })
  })
})

function adminFake(respostas: Record<string, { data: unknown; error: unknown }>) {
  const rpc = vi.fn(async (nome: string) => respostas[nome] ?? { data: null, error: null })
  const consulta = {
    select: () => consulta, eq: () => consulta, order: () => consulta, limit: () => consulta,
    maybeSingle: async () => ({ data: { mes_rf: '2026-09', concluida_em: '2026-09-23T15:00:00Z', cnaes: ['5510801'] }, error: null }),
  }
  const admin = { rpc, from: vi.fn(() => consulta) } as unknown as SupabaseClient
  return { admin, rpc }
}

describe('importarProspeccao', () => {
  it('prévia e confirmação passam org da sessão e o modo à mesma RPC', async () => {
    const { admin, rpc } = adminFake({
      prospeccao_importar: { data: [{ cnpj: '12345678000199', status: 'importavel', lead_id: null }], error: null },
    })
    const itens = [{ cnpj: '12345678000199', email: null, contato_nome: null, contato_cargo: null, contato_linkedin: null }]
    const r = await importarProspeccao(admin, { org: 'org-a', responsavel: { id: null, nome: null }, segmento: 'hotelaria', itens, simular: true })
    expect(r.resumo.importavel).toBe(1)
    expect(rpc).toHaveBeenCalledWith('prospeccao_importar', expect.objectContaining({ p_org: 'org-a', p_simular: true, p_segmento: 'hotelaria' }))

    await importarProspeccao(admin, { org: 'org-a', responsavel: { id: 'u1', nome: 'Ana' }, segmento: null, itens, simular: false })
    expect(rpc).toHaveBeenLastCalledWith('prospeccao_importar', expect.objectContaining({ p_simular: false, p_responsavel_id: 'u1' }))
  })

  it('erro da RPC vira exceção, não sucesso silencioso', async () => {
    const { admin } = adminFake({ prospeccao_importar: { data: null, error: { message: 'boom' } } })
    await expect(
      importarProspeccao(admin, { org: 'o', responsavel: { id: null, nome: null }, segmento: null, itens: [], simular: true })
    ).rejects.toThrow(/boom/)
  })
})

describe('buscarProspeccao', () => {
  const linha = (cnpj: string) => ({
    cnpj, razao_social: 'HOTEL', nome_fantasia: null, cnae_principal: '5510801', cnaes_secundarios: [],
    porte: 'micro', mei: false, capital_social: '1000.00', data_inicio_atividade: null, logradouro: null,
    numero: null, bairro: null, cep: null, uf: 'SP', municipio: 'SAO PAULO', telefone: null,
    email: 'reservas@hotel.com.br', ja_na_base: false, lead_id: null, nota: 30,
  })

  it('sem CNAE não consulta o catálogo', async () => {
    const { admin, rpc } = adminFake({})
    const r = await buscarProspeccao(admin, 'org-a', normalizarFiltros({}, undefined), null, { contar: true })
    expect(r).toMatchObject({ itens: [], total: 0, proximoCursor: null })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('pagina por cursor, classifica e-mail e só conta na primeira página', async () => {
    const pagina = Array.from({ length: LIMITE_PAGINA }, (_, i) => linha(String(10000000000000 + i)))
    const { admin, rpc } = adminFake({
      prospeccao_buscar_por_nota: { data: pagina, error: null },
      prospeccao_contar: { data: 123, error: null },
    })
    const filtros = normalizarFiltros({}, PERFIL)
    const r = await buscarProspeccao(admin, 'org-a', filtros, null, { contar: true })
    expect(r.total).toBe(123)
    expect(r.proximoCursor).toBe(`30-${pagina[pagina.length - 1].cnpj}`)
    expect(r.itens[0]).toMatchObject({ qualidade_email: 'generico', capital_social: 1000 })
    expect(r.itens[0]).not.toHaveProperty('nota')
    expect(r.catalogo).toEqual({ mesRf: '2026-09', concluidaEm: '2026-09-23T15:00:00Z', cnaes: ['5510801'] })
    expect(rpc).toHaveBeenCalledWith('prospeccao_buscar_por_nota', expect.objectContaining({ p_org: 'org-a', p_apos_nota: null, p_apos_cnpj: null }))

    rpc.mockClear()
    const r2 = await buscarProspeccao(admin, 'org-a', filtros, r.proximoCursor, { contar: false })
    expect(rpc).toHaveBeenCalledWith('prospeccao_buscar_por_nota', expect.objectContaining({
      p_apos_nota: 30, p_apos_cnpj: pagina[pagina.length - 1].cnpj,
    }))
    expect(r2.total).toBeNull()
    expect(rpc).not.toHaveBeenCalledWith('prospeccao_contar', expect.anything())
  })

  it('conta geral e com e-mail sempre as duas, independente do toggle', async () => {
    const contagens = vi.fn(async (_nome: string, params: { p_so_com_email: boolean }) => (
      params.p_so_com_email ? { data: 60, error: null } : { data: 137, error: null }
    ))
    const admin = {
      rpc: vi.fn((nome: string, params?: Record<string, unknown>) => (
        nome === 'prospeccao_buscar_por_nota'
          ? Promise.resolve({ data: [linha('10000000000001')], error: null })
          : contagens(nome, params as { p_so_com_email: boolean })
      )),
      from: () => ({
        select: () => ({ eq: () => ({ order: () => ({ limit: () => ({
          maybeSingle: async () => ({ data: { mes_rf: '2026-09', concluida_em: null, cnaes: ['5510801'] }, error: null }),
        }) }) }) }),
      }),
    } as unknown as SupabaseClient
    const r = await buscarProspeccao(admin, 'org-a', normalizarFiltros({ soComEmail: false }, PERFIL), null, { contar: true })
    expect(r.total).toBe(137)
    expect(r.totalComEmail).toBe(60)
    expect(contagens).toHaveBeenCalledWith('prospeccao_contar', expect.objectContaining({ p_so_com_email: false }))
    expect(contagens).toHaveBeenCalledWith('prospeccao_contar', expect.objectContaining({ p_so_com_email: true }))
  })

  it('última página não devolve cursor', async () => {
    const { admin } = adminFake({ prospeccao_buscar_por_nota: { data: [linha('10000000000001')], error: null } })
    const r = await buscarProspeccao(admin, 'org-a', normalizarFiltros({}, PERFIL), null, { contar: false })
    expect(r.proximoCursor).toBeNull()
  })

  it('quantidade desejada: pede só o que falta e devolve cursor se a página veio cheia', async () => {
    const pagina = Array.from({ length: 12 }, (_, i) => linha(String(10000000000000 + i)))
    const { admin, rpc } = adminFake({ prospeccao_buscar_por_nota: { data: pagina, error: null } })
    const r = await buscarProspeccao(admin, 'org-a', normalizarFiltros({}, PERFIL), null, { contar: false, limite: 12 })
    expect(rpc).toHaveBeenCalledWith('prospeccao_buscar_por_nota', expect.objectContaining({ p_limite: 12 }))
    expect(r.proximoCursor).toBe(`30-${pagina[11].cnpj}`)
  })
})

import { iniciais, nomeLegivel } from '@/lib/prospeccao/rotulos'

describe('nomes legíveis', () => {
  it.each([
    ['HOTEL DAS FLORES LTDA', 'Hotel das Flores LTDA'],
    ["IBERICA'S PRAIA HOTEL", "Iberica's Praia Hotel"],
    ['POUSADA RECANTO DA PREGUICA', 'Pousada Recanto da Preguica'],
    ['SAO JOSE DO RIO PRETO', 'Sao Jose do Rio Preto'],
    ['APART-HOTEL S/A', 'Apart-Hotel S/A'],
    ['DE LUCA HOTEL ME', 'De Luca Hotel ME'],
    ["POUSADA D'AGUA", "Pousada D'Agua"],
    [null, ''],
  ])('%s → %s', (bruto, esperado) => {
    expect(nomeLegivel(bruto)).toBe(esperado)
  })

  it('iniciais ignoram preposição e sigla', () => {
    expect(iniciais('Hotel das Flores LTDA')).toBe('HF')
    expect(iniciais('Cordilheira')).toBe('C')
    expect(iniciais('')).toBe('?')
  })
})
