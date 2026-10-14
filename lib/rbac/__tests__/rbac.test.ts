import { describe, it, expect } from 'vitest'
import {
  PERMISSOES,
  PERMISSOES_POR_ROLE,
  permissoesEfetivas,
  temPermissao,
  isPermissao,
} from '../permissoes'
import { podeAlterarRole, podeBloquearMembro, podeRemoverMembro } from '../guards'

describe('permissoes — efetivas e padrão por role', () => {
  it('admin recebe TODAS as permissões no padrão do role', () => {
    expect(PERMISSOES_POR_ROLE.admin).toHaveLength(PERMISSOES.length)
    const set = permissoesEfetivas('admin', [])
    for (const p of PERMISSOES) expect(set.has(p)).toBe(true)
  })

  it('usuario cria campanha de comunicado, mas não os objetivos avançados', () => {
    expect(temPermissao('usuario', [], 'analytics.view')).toBe(true)
    expect(temPermissao('usuario', [], 'workflows.view')).toBe(true)
    expect(temPermissao('usuario', [], 'campaigns.manage')).toBe(true)
    // O par abaixo é a regra inteira: `manage` deixa criar campanha, e a
    // AUSÊNCIA de `tipos.avancados` a limita a comunicado. Conceder a segunda ao
    // papel `usuario` liberaria prospecção e follow-up sem querer.
    expect(temPermissao('usuario', [], 'campaigns.tipos.avancados')).toBe(false)
  })

  it('conversations.send: comercial e admin respondem lead pela Central, sem ganhar campaigns.operate', () => {
    expect(isPermissao('conversations.send')).toBe(true)
    // Os dois roles enviam pela Central…
    expect(temPermissao('usuario', [], 'conversations.send')).toBe(true)
    expect(temPermissao('admin', [], 'conversations.send')).toBe(true)
    // …mas `campaigns.operate` (envio legado via Meta) segue só do admin.
    // As rotas de campanha (criar/ativar/iniciar) usam `campaigns.manage`.
    expect(temPermissao('usuario', [], 'campaigns.operate')).toBe(false)
    expect(temPermissao('admin', [], 'campaigns.operate')).toBe(true)
  })

  it('perfil já backfillado (0015) SEM a linha nova não recebe conversations.send só pelo código', () => {
    // É o motivo da migration 0040: com linhas na tabela, o padrão do role não
    // é consultado — quem já existia precisa da linha gravada.
    const grantsAntigos = ['campaigns.view', 'campaigns.manage', 'workflows.view', 'analytics.view']
    expect(temPermissao('usuario', grantsAntigos, 'conversations.send')).toBe(false)
    expect(temPermissao('usuario', [...grantsAntigos, 'conversations.send'], 'conversations.send')).toBe(true)
  })

  it('templates: view para os dois roles; manage só para quem administra', () => {
    expect(isPermissao('templates.view')).toBe(true)
    expect(isPermissao('templates.manage')).toBe(true)
    expect(temPermissao('usuario', [], 'templates.view')).toBe(true)
    expect(temPermissao('usuario', [], 'templates.manage')).toBe(false)
    expect(temPermissao('admin', [], 'templates.view')).toBe(true)
    expect(temPermissao('admin', [], 'templates.manage')).toBe(true)
  })

  it('perfil já backfillado SEM as linhas da 0046 não recebe templates.* só pelo código', () => {
    const grantsAntigos = ['campaigns.view', 'campaigns.manage', 'workflows.view', 'analytics.view', 'conversations.send']
    expect(temPermissao('usuario', grantsAntigos, 'templates.view')).toBe(false)
    expect(temPermissao('admin', [...grantsAntigos, 'templates.view'], 'templates.manage')).toBe(false)
  })

  it('usuario não configura o workspace nem gerencia workflows', () => {
    expect(temPermissao('usuario', [], 'workspace.configure')).toBe(false)
    expect(temPermissao('usuario', [], 'workflows.manage')).toBe(false)
    expect(temPermissao('usuario', [], 'workflows.publish')).toBe(false)
  })

  it('perfil_permissoes é autoritativa quando há linhas (concede/revoga por usuário)', () => {
    // usuario com grant explícito de campaigns.manage passa a ter só o que a tabela diz
    const set = permissoesEfetivas('usuario', ['campaigns.manage'])
    expect(set.has('campaigns.manage')).toBe(true)
    // como a tabela é autoritativa, o baseline de role NÃO é somado
    expect(set.has('analytics.view')).toBe(false)
  })

  it('sem linhas na tabela → cai no padrão do role (rede de segurança do backfill)', () => {
    expect(permissoesEfetivas('admin', []).size).toBe(PERMISSOES.length)
    expect([...permissoesEfetivas('usuario', [])].sort()).toEqual(
      [...PERMISSOES_POR_ROLE.usuario].sort(),
    )
  })

  it('descarta slugs inválidos vindos da tabela', () => {
    const set = permissoesEfetivas('usuario', ['campaigns.view', 'lixo.invalido', ''])
    expect(set.has('campaigns.view')).toBe(true)
    expect(isPermissao('lixo.invalido')).toBe(false)
    expect(set.size).toBe(1)
  })

  it('role desconhecido sem grants não tem nenhuma permissão', () => {
    expect(permissoesEfetivas('fantasma', []).size).toBe(0)
  })
})

describe('guards — trava do último administrador', () => {
  it('bloqueia rebaixar o único admin (inclui auto-rebaixamento)', () => {
    const r = podeAlterarRole({ alvoRole: 'admin', novoRole: 'usuario', totalAdmins: 1 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(400)
  })

  it('permite rebaixar um admin quando há outro admin', () => {
    expect(podeAlterarRole({ alvoRole: 'admin', novoRole: 'usuario', totalAdmins: 2 }).ok).toBe(true)
  })

  it('mudanças que não rebaixam admin passam', () => {
    expect(podeAlterarRole({ alvoRole: 'usuario', novoRole: 'admin', totalAdmins: 1 }).ok).toBe(true)
    expect(podeAlterarRole({ alvoRole: 'usuario', novoRole: 'usuario', totalAdmins: 1 }).ok).toBe(true)
  })

  it('bloqueia auto-remoção', () => {
    const r = podeRemoverMembro({ alvoId: 'u1', alvoRole: 'usuario', chamadorId: 'u1', totalAdmins: 2 })
    expect(r.ok).toBe(false)
  })

  it('bloqueia remover o último admin', () => {
    const r = podeRemoverMembro({ alvoId: 'a1', alvoRole: 'admin', chamadorId: 'a2', totalAdmins: 1 })
    expect(r.ok).toBe(false)
  })

  it('permite remover um admin quando há outro', () => {
    expect(
      podeRemoverMembro({ alvoId: 'a1', alvoRole: 'admin', chamadorId: 'a2', totalAdmins: 2 }).ok,
    ).toBe(true)
  })

  it('permite remover um usuario comum', () => {
    expect(
      podeRemoverMembro({ alvoId: 'u9', alvoRole: 'usuario', chamadorId: 'a1', totalAdmins: 1 }).ok,
    ).toBe(true)
  })
})

describe('guards — bloquear acesso de membro', () => {
  it('bloqueia o auto-bloqueio', () => {
    const r = podeBloquearMembro({ alvoId: 'a1', alvoRole: 'admin', chamadorId: 'a1', adminsAtivos: 3 })
    expect(r.ok).toBe(false)
  })

  it('bloqueia bloquear o último admin ativo', () => {
    const r = podeBloquearMembro({ alvoId: 'a1', alvoRole: 'admin', chamadorId: 'u2', adminsAtivos: 1 })
    expect(r.ok).toBe(false)
  })

  it('permite bloquear um admin quando há outro ativo', () => {
    expect(
      podeBloquearMembro({ alvoId: 'a1', alvoRole: 'admin', chamadorId: 'a2', adminsAtivos: 2 }).ok,
    ).toBe(true)
  })

  it('permite bloquear um usuario comum', () => {
    expect(
      podeBloquearMembro({ alvoId: 'u9', alvoRole: 'usuario', chamadorId: 'a1', adminsAtivos: 1 }).ok,
    ).toBe(true)
  })
})
