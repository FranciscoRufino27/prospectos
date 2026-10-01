-- ============================================================================
-- Migration 0057 — Decisor escolhido na Prospecção persiste por organização
-- ----------------------------------------------------------------------------
-- Antes, a escolha do decisor (nome, cargo, LinkedIn) e a consulta de sócios
-- viviam só na memória da página: recarregar antes de importar perdia tudo.
--
-- prospeccao_decisores guarda, por (organizacao_id, cnpj):
--   - nome/cargo/linkedin: o que o usuário escolheu ou digitou (rota
--     PUT /api/prospeccao/decisores);
--   - consulta/consultado_em: a última resposta de /api/prospeccao/socios
--     (quadro da OpenCNPJ + avaliação pelo perfil), gravada pelo SERVIDOR.
-- A busca devolve a linha de cada CNPJ da página. Importar continua lendo o
-- decisor enviado pela tela (prospeccao_importar, 0056); esta tabela não é
-- fonte da importação.
--
-- Isolamento: organizacao_id na PK; RLS de leitura por org como backstop;
-- escrita só service_role (rotas com resolverAcesso(), org da sessão).
--
-- IDEMPOTENTE: if not exists / drop policy if exists / grants repetíveis.
-- ROLLBACK: drop table if exists prospeccao_decisores;
--   (só perde escolhas ainda não importadas; leads/contatos não dependem dela)
-- ============================================================================

create table if not exists prospeccao_decisores (
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  cnpj text not null check (cnpj ~ '^[0-9]{14}$'),
  nome text check (char_length(nome) <= 120),
  cargo text check (char_length(cargo) <= 120),
  linkedin text check (char_length(linkedin) <= 400),
  consulta jsonb,
  consultado_em timestamptz,
  atualizado_por uuid,
  atualizado_em timestamptz not null default now(),
  primary key (organizacao_id, cnpj)
);

alter table prospeccao_decisores enable row level security;
drop policy if exists prospeccao_decisores_leitura on prospeccao_decisores;
create policy prospeccao_decisores_leitura on prospeccao_decisores
  for select
  using (organizacao_id = current_org_id());

do $grants$
declare
  papel text;
begin
  foreach papel in array array['anon', 'authenticated']
  loop
    if exists (select 1 from pg_roles where rolname = papel) then
      execute format('revoke insert, update, delete on table prospeccao_decisores from %I', papel);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke select on table prospeccao_decisores from anon';
  end if;
end
$grants$;

notify pgrst, 'reload schema';
