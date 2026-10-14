-- ============================================================================
-- Migration 0069 — Donos da plataforma (visão de usuários de TODAS as orgs)
-- ----------------------------------------------------------------------------
-- Papel acima do admin de organização: quem está aqui vê e gerencia o acesso
-- (redefinição de senha, bloqueio) dos usuários de todas as organizações, na
-- aba "Usuários da plataforma" do Meu perfil. O admin de organização continua
-- restrito à própria org.
--
-- A tabela nasce VAZIA: os donos são cadastrados direto no banco, por quem tem
-- acesso a ele (nunca pela aplicação, nunca por env ou lista no código):
--   insert into administradores_plataforma (usuario_id)
--   select id from auth.users where lower(email) = lower('<email>')
--   on conflict do nothing;
--
-- Isolamento: sem organizacao_id de propósito (o papel é global). RLS ligada e
-- SEM policy: anon/authenticated não leem nem escrevem; só o service_role, nas
-- rotas que conferem a sessão (lib/rbac/plataforma.ts).
--
-- IDEMPOTENTE: if not exists / grants repetíveis.
-- ROLLBACK: drop table if exists administradores_plataforma;
--   (só tira o papel; nenhum usuário ou dado de organização é afetado)
-- ============================================================================

create table if not exists administradores_plataforma (
  usuario_id uuid primary key references auth.users(id) on delete cascade,
  criado_em timestamptz not null default now()
);

alter table administradores_plataforma enable row level security;

do $grants$
declare
  papel text;
begin
  foreach papel in array array['anon', 'authenticated']
  loop
    if exists (select 1 from pg_roles where rolname = papel) then
      execute format('revoke all on table administradores_plataforma from %I', papel);
    end if;
  end loop;
end
$grants$;

notify pgrst, 'reload schema';
