-- ============================================================================
-- Migration 0068 — Pedidos de carga do catálogo RF (nicho novo → "Buscando")
-- ----------------------------------------------------------------------------
-- A organização cria um nicho com atividades (CNAE) que ainda não estão no
-- catálogo global (catalogo_estabelecimentos, 0050). A tela registra aqui um
-- pedido; o job do GitHub Actions (scripts/catalogo-rf-pedidos.ts) junta os
-- pedidos pendentes de todas as orgs, roda a carga da Receita (~80 min) e
-- marca cada pedido como concluído ou com erro. A tela da org mostra o
-- andamento lendo só os próprios pedidos.
--
--   status: pendente → em_andamento → concluido | erro
--   carga_id: registro em catalogo_rf_cargas da execução que atendeu o pedido
--
-- Isolamento: organizacao_id obrigatório; RLS de leitura por org como
-- backstop; escrita só service_role (rota com resolverAcesso(), org da sessão,
-- e o job interno, que filtra por id + organizacao_id).
--
-- IDEMPOTENTE: if not exists / drop policy if exists / grants repetíveis.
-- ROLLBACK: drop table if exists catalogo_rf_pedidos;
--   (perde só o histórico dos pedidos; o catálogo carregado continua)
-- ============================================================================

create table if not exists catalogo_rf_pedidos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  cnaes text[] not null check (
    cardinality(cnaes) between 1 and 20
    and array_to_string(cnaes, ',') ~ '^[0-9]{7}(,[0-9]{7})*$'
  ),
  status text not null default 'pendente'
    check (status in ('pendente', 'em_andamento', 'concluido', 'erro')),
  solicitado_por uuid references perfis(id) on delete set null,
  carga_id uuid references catalogo_rf_cargas(id) on delete set null,
  erro text,
  criado_em timestamptz not null default now(),
  iniciado_em timestamptz,
  concluido_em timestamptz
);

create index if not exists idx_catalogo_rf_pedidos_org
  on catalogo_rf_pedidos (organizacao_id, criado_em desc);
-- O job só procura os abertos.
create index if not exists idx_catalogo_rf_pedidos_abertos
  on catalogo_rf_pedidos (status, criado_em)
  where status in ('pendente', 'em_andamento');

alter table catalogo_rf_pedidos enable row level security;
drop policy if exists catalogo_rf_pedidos_leitura on catalogo_rf_pedidos;
create policy catalogo_rf_pedidos_leitura on catalogo_rf_pedidos
  for select
  using (organizacao_id = current_org_id());

do $grants$
declare
  papel text;
begin
  foreach papel in array array['anon', 'authenticated']
  loop
    if exists (select 1 from pg_roles where rolname = papel) then
      execute format('revoke insert, update, delete on table catalogo_rf_pedidos from %I', papel);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke select on table catalogo_rf_pedidos from anon';
  end if;
end
$grants$;

notify pgrst, 'reload schema';
