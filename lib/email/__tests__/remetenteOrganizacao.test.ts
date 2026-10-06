// Remetente conectado pela própria organização (0066): precedência sobre a
// chave legada, senha cifrada que nunca volta ao navegador, organização sempre
// a da sessão, RBAC de produção e a chave legada fora do alcance do navegador.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { BancoFalso } from '@/lib/templates/__tests__/bancoFalso'

const estado = vi.hoisted(() => ({
  usuarioId: null as string | null,
  banco: null as unknown,
  credEnv: {} as Record<string, { user: string; appPassword: string }>,
  verificar: null as unknown as ReturnType<typeof import('vitest').vi.fn>,
}))

vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: estado.usuarioId ? { id: estado.usuarioId } : null } }) },
  }),
}))
vi.mock('@/lib/supabase-admin', () => ({
  createSupabaseAdminClient: () => (estado.banco as BancoFalso).cliente(),
}))
vi.mock('@/lib/engine/email/gmailProvider', async (original) => ({
  ...(await original<typeof import('@/lib/engine/email/gmailProvider')>()),
  lerCredenciaisGmail: (chave: string) => estado.credEnv[chave] ?? null,
  verificarCredenciaisGmail: (cred: unknown) => (estado.verificar as (c: unknown) => unknown)(cred),
}))

import {
  remetenteComPadrao,
  remetenteDedicado,
  situacaoRemetenteOrganizacao,
  TABELA_REMETENTES,
} from '../remetenteOrganizacao'
import { cifrar } from '@/lib/seguranca/criptografia'
import { DELETE, GET, PUT } from '@/app/api/configuracoes/remetente-email/route'
import { PUT as PUT_WORKSPACE } from '@/app/api/configuracoes/workspace/route'

const ORG_A = 'aaaaaaaa-0000-4000-8000-000000000001'
const ORG_B = 'bbbbbbbb-0000-4000-8000-000000000002'
const ADMIN_A = 'aaaaaaaa-1111-4111-8111-00000000000a'
const USUARIO_A = 'aaaaaaaa-1111-4111-8111-00000000000b'
const ADMIN_B = 'bbbbbbbb-1111-4111-8111-00000000000a'
const SENHA_A = 'abcdefghijklmnop'
const SENHA_B = 'qrstuvwxyzabcdef'

let chaveAnterior: string | undefined
beforeAll(() => {
  chaveAnterior = process.env.INTEGRACOES_ENCRYPTION_KEY
  process.env.INTEGRACOES_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
})
afterAll(() => {
  if (chaveAnterior === undefined) delete process.env.INTEGRACOES_ENCRYPTION_KEY
  else process.env.INTEGRACOES_ENCRYPTION_KEY = chaveAnterior
})

function montarBanco(remetentes: Record<string, unknown>[] = []) {
  return new BancoFalso({
    perfis: [
      { id: ADMIN_A, organizacao_id: ORG_A, role: 'admin' },
      { id: USUARIO_A, organizacao_id: ORG_A, role: 'usuario' },
      { id: ADMIN_B, organizacao_id: ORG_B, role: 'admin' },
    ],
    perfil_permissoes: [],
    organizacoes: [
      { id: ORG_A, configuracoes: { _schema_version: 11, nomenclaturas: { email_conta_key: 'LAUDO', nome_servico: 'Laudos' } } },
      { id: ORG_B, configuracoes: { _schema_version: 11 } },
    ],
    [TABELA_REMETENTES]: remetentes,
  })
}

const banco = () => estado.banco as BancoFalso
const db = () => banco().cliente() as unknown as SupabaseClient
const linhaDe = (org: string) => banco().linhas(TABELA_REMETENTES).find((l) => l.organizacao_id === org)
const configDe = (org: string) => banco().linhas('organizacoes').find((o) => o.id === org)?.configuracoes as { nomenclaturas?: Record<string, string> }
const json = async (res: Response) => ({ status: res.status, body: await res.json(), texto: '' })
const req = (corpo: unknown) => new Request('http://localhost/api/configuracoes/remetente-email', {
  method: 'PUT', body: JSON.stringify(corpo), headers: { 'Content-Type': 'application/json' },
})

beforeEach(() => {
  estado.banco = montarBanco()
  estado.usuarioId = ADMIN_A
  estado.credEnv = { LAUDO: { user: 'laudos@gmail.com', appPassword: 'env-nao-real' }, followup: { user: 'padrao@plataforma.com', appPassword: 'env-nao-real' } }
  estado.verificar = vi.fn(async () => ({ ok: true }))
})

describe('situacaoRemetenteOrganizacao', () => {
  it('conta conectada tem precedência sobre a chave legada e é decifrada; outra org nunca entra', async () => {
    estado.banco = montarBanco([
      { organizacao_id: ORG_A, email: 'a@empresa.com', senha_cifrada: cifrar(SENHA_A), verificado_em: '2026-10-06T12:00:00Z' },
      { organizacao_id: ORG_B, email: 'b@empresa.com', senha_cifrada: cifrar(SENHA_B), verificado_em: '2026-10-06T12:00:00Z' },
    ])
    const a = await situacaoRemetenteOrganizacao(db(), ORG_A)
    expect(a).toMatchObject({ estado: 'pronto', remetente: { fonte: 'conectada', email: 'a@empresa.com', credenciais: { user: 'a@empresa.com', appPassword: SENHA_A } } })
    const b = await remetenteDedicado(db(), ORG_B)
    expect(b?.credenciais).toEqual({ user: 'b@empresa.com', appPassword: SENHA_B })
  })

  it('legado: chave com credencial no ambiente vale; sem credencial bloqueia (nem cai na padrão)', async () => {
    expect(await remetenteDedicado(db(), ORG_A)).toMatchObject({ fonte: 'legada', conta: 'LAUDO', email: 'laudos@gmail.com' })
    estado.credEnv = { followup: estado.credEnv.followup }
    expect(await situacaoRemetenteOrganizacao(db(), ORG_A)).toMatchObject({ estado: 'incompleto', fonte: 'legada' })
    expect(await remetenteComPadrao(db(), ORG_A)).toBeNull()
  })

  it('sem nada: dedicado = null; com padrão = conta da plataforma', async () => {
    expect(await situacaoRemetenteOrganizacao(db(), ORG_B)).toEqual({ estado: 'ausente' })
    expect(await remetenteDedicado(db(), ORG_B)).toBeNull()
    expect(await remetenteComPadrao(db(), ORG_B)).toMatchObject({ fonte: 'padrao', email: 'padrao@plataforma.com' })
  })

  it('senha salva ilegível: bloqueia em vez de usar a padrão', async () => {
    estado.banco = montarBanco([{ organizacao_id: ORG_B, email: 'b@empresa.com', senha_cifrada: 'v1:lixo:lixo:lixo', verificado_em: null }])
    expect(await situacaoRemetenteOrganizacao(db(), ORG_B)).toMatchObject({ estado: 'incompleto', fonte: 'conectada', email: 'b@empresa.com' })
    expect(await remetenteComPadrao(db(), ORG_B)).toBeNull()
  })

  it('migration 0066 ainda não aplicada: comporta-se como sem conta conectada', async () => {
    const semTabela = {
      from: (t: string) => {
        const q = {
          select: () => q,
          eq: () => q,
          maybeSingle: async () => t === TABELA_REMETENTES
            ? { data: null, error: { code: '42P01', message: 'relation "organizacao_remetentes_email" does not exist' } }
            : { data: { configuracoes: {} }, error: null },
        }
        return q
      },
    } as unknown as SupabaseClient
    expect(await situacaoRemetenteOrganizacao(semTabela, ORG_B)).toEqual({ estado: 'ausente' })
  })
})

describe('/api/configuracoes/remetente-email', () => {
  it('GET sem sessão: 401', async () => {
    estado.usuarioId = null
    expect((await GET()).status).toBe(401)
  })

  it('PUT testa o login, salva cifrado SÓ na org da sessão, tira a chave legada e nunca devolve a senha', async () => {
    const r = await json(await PUT(req({ organizacao_id: ORG_B, email: ' Contato@Empresa.com ', senhaApp: 'abcd efgh ijkl mnop' })))
    expect(r.status).toBe(200)
    expect(estado.verificar).toHaveBeenCalledWith({ user: 'contato@empresa.com', appPassword: SENHA_A })
    expect(r.body).toMatchObject({ estado: 'conectado', fonte: 'conectada', email: 'contato@empresa.com' })

    const linha = linhaDe(ORG_A)!
    expect(linha.senha_cifrada).toMatch(/^v1:/)
    expect(JSON.stringify(linha)).not.toContain(SENHA_A)
    expect(linha.conectado_por).toBe(ADMIN_A)
    expect(linhaDe(ORG_B)).toBeUndefined()
    // Chave legada sai; o resto das nomenclaturas fica.
    expect(configDe(ORG_A).nomenclaturas).toEqual({ nome_servico: 'Laudos' })

    const g = await json(await GET())
    expect(g.body).toMatchObject({ estado: 'conectado', fonte: 'conectada', email: 'contato@empresa.com', podeEditar: true })
    const texto = JSON.stringify(g.body) + JSON.stringify(r.body)
    expect(texto).not.toContain(SENHA_A)
    expect(texto).not.toContain('senha_cifrada')
    expect(texto).not.toContain('v1:')

    // O envio passa a sair por essa conta.
    expect((await remetenteDedicado(db(), ORG_A))?.credenciais).toEqual({ user: 'contato@empresa.com', appPassword: SENHA_A })
  })

  it('senha que não é senha de app ou e-mail inválido: 400 sem testar nem salvar', async () => {
    for (const corpo of [{ email: 'a@empresa.com', senhaApp: 'MinhaSenha@123' }, { email: 'nao-e-email', senhaApp: SENHA_A }, {}]) {
      const r = await json(await PUT(req(corpo)))
      expect(r.status).toBe(400)
      expect(r.body.erro).toBeTruthy()
    }
    expect(estado.verificar).not.toHaveBeenCalled()
    expect(banco().linhas(TABELA_REMETENTES)).toHaveLength(0)
  })

  it('Gmail recusa o login: 400; Gmail fora do ar: 502 — nada é salvo', async () => {
    estado.verificar = vi.fn(async () => ({ ok: false, etapa: 'smtp', motivo: 'autenticacao', mensagem: '535 auth' }))
    expect((await PUT(req({ email: 'a@empresa.com', senhaApp: SENHA_A }))).status).toBe(400)
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {})
    estado.verificar = vi.fn(async () => ({ ok: false, etapa: 'imap', motivo: 'conexao', mensagem: 'timeout' }))
    expect((await PUT(req({ email: 'a@empresa.com', senhaApp: SENHA_A }))).status).toBe(502)
    erro.mockRestore()
    expect(banco().linhas(TABELA_REMETENTES)).toHaveLength(0)
    expect(configDe(ORG_A).nomenclaturas?.email_conta_key).toBe('LAUDO')
  })

  it('membro sem workspace.configure vê o status mas não conecta nem desconecta', async () => {
    estado.banco = montarBanco([{ organizacao_id: ORG_A, email: 'a@empresa.com', senha_cifrada: cifrar(SENHA_A), verificado_em: null }])
    estado.usuarioId = USUARIO_A
    expect((await json(await GET())).body).toMatchObject({ estado: 'conectado', podeEditar: false })
    expect((await PUT(req({ email: 'x@empresa.com', senhaApp: SENHA_B }))).status).toBe(403)
    expect((await DELETE()).status).toBe(403)
    expect(linhaDe(ORG_A)?.email).toBe('a@empresa.com')
  })

  it('DELETE remove também a conta configurada pela chave legada (e mais nada da config)', async () => {
    expect((await json(await GET())).body).toMatchObject({ estado: 'conectado', fonte: 'legada' })
    const r = await json(await DELETE())
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ estado: 'nao_configurado', email: null })
    expect(configDe(ORG_A).nomenclaturas).toEqual({ nome_servico: 'Laudos' })
    expect(await remetenteDedicado(db(), ORG_A)).toBeNull()
  })

  it('DELETE desconecta só a org da sessão', async () => {
    estado.banco = montarBanco([
      { organizacao_id: ORG_A, email: 'a@empresa.com', senha_cifrada: cifrar(SENHA_A), verificado_em: null },
      { organizacao_id: ORG_B, email: 'b@empresa.com', senha_cifrada: cifrar(SENHA_B), verificado_em: null },
    ])
    estado.usuarioId = ADMIN_B
    expect((await DELETE()).status).toBe(200)
    expect(linhaDe(ORG_B)).toBeUndefined()
    expect(linhaDe(ORG_A)?.email).toBe('a@empresa.com')
  })
})

describe('PUT /api/configuracoes/workspace não mexe mais em email_conta_key', () => {
  const gravar = (corpo: unknown) => PUT_WORKSPACE(new Request('http://localhost/api/configuracoes/workspace', {
    method: 'PUT', body: JSON.stringify(corpo), headers: { 'Content-Type': 'application/json' },
  }))

  it('org sem chave não consegue apontar para a conta de outra org', async () => {
    estado.usuarioId = ADMIN_B
    expect((await gravar({ nomenclaturas: { email_conta_key: 'LAUDO', nome_servico: 'Outra' } })).status).toBe(200)
    expect(configDe(ORG_B).nomenclaturas).toEqual({ nome_servico: 'Outra' })
    expect(await remetenteDedicado(db(), ORG_B)).toBeNull()
  })

  it('org com chave legada não a troca nem apaga pelo navegador; o resto é salvo', async () => {
    expect((await gravar({ nomenclaturas: { email_conta_key: 'OUTRA', nome_servico: 'Novo nome' } })).status).toBe(200)
    expect(configDe(ORG_A).nomenclaturas).toEqual({ nome_servico: 'Novo nome', email_conta_key: 'LAUDO' })
    expect((await gravar({ nomenclaturas: { nome_servico: 'Sem chave no corpo' } })).status).toBe(200)
    expect(configDe(ORG_A).nomenclaturas).toEqual({ nome_servico: 'Sem chave no corpo', email_conta_key: 'LAUDO' })
  })
})
