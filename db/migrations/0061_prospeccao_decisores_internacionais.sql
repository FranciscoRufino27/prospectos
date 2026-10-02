-- ============================================================================
-- Migration 0061 — Decisor automático da busca internacional (cache por org)
-- ----------------------------------------------------------------------------
-- A busca internacional (Crustdata Company Search) passou a trazer o decisor
-- de cada empresa: Crustdata People Search acha quem tem cargo-alvo no domínio
-- e a Anymail acha o e-mail dessa pessoa. As duas são pagas; o resultado fica
-- aqui, por (organizacao_id, dominio), para a mesma org não pagar de novo pela
-- mesma empresa. Empresa estrangeira não tem CNPJ: a chave é o domínio.
--
--   candidatos: [{ nome, cargo, linkedin, local }] da Crustdata (ordenados)
--   anymail:    { nome, dominio, status, email, consultadoEm }
--   decisor:    { nome, cargo, linkedin } escolhido pelo servidor
--
-- Isolamento: organizacao_id na PK; RLS de leitura por org como backstop;
-- escrita só service_role (rota com resolverAcesso(), org da sessão).
--
-- IDEMPOTENTE: if not exists / drop policy if exists / grants repetíveis.
-- ROLLBACK: drop table if exists prospeccao_decisores_internacionais;
--   (perde só o cache das consultas pagas; nada mais depende dela)
-- ============================================================================

create table if not exists prospeccao_decisores_internacionais (
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  dominio text not null check (dominio ~ '^[a-z0-9.-]+\.[a-z]{2,}$' and char_length(dominio) <= 253),
  candidatos jsonb,
  candidatos_em timestamptz,
  anymail jsonb,
  decisor jsonb,
  atualizado_em timestamptz not null default now(),
  primary key (organizacao_id, dominio)
);

alter table prospeccao_decisores_internacionais enable row level security;
drop policy if exists prospeccao_decisores_internacionais_leitura on prospeccao_decisores_internacionais;
create policy prospeccao_decisores_internacionais_leitura on prospeccao_decisores_internacionais
  for select
  using (organizacao_id = current_org_id());

do $grants$
declare
  papel text;
begin
  foreach papel in array array['anon', 'authenticated']
  loop
    if exists (select 1 from pg_roles where rolname = papel) then
      execute format('revoke insert, update, delete on table prospeccao_decisores_internacionais from %I', papel);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke select on table prospeccao_decisores_internacionais from anon';
  end if;
end
$grants$;

notify pgrst, 'reload schema';
