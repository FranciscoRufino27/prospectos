-- ============================================================================
-- Migration 0065 — Consumo do enriquecimento pago da Prospecção (travas de custo)
-- ----------------------------------------------------------------------------
-- Uma linha por consulta a fonte paga (Crustdata, Anymail) feita em nome de
-- uma organização — inclusive quando a resposta veio do cache de inteligência
-- (0064), com custo 0, para a org enxergar o que reaproveitou. O orçamento
-- mensal (organizacoes.configuracoes.enriquecimentoPago) é comparado com a
-- soma de `custo` das linhas com origem = 'api' no mês corrente.
--
--   fonte      crustdata | anymail
--   operacao   pessoas (People Search) | email (Anymail) | empresas_busca (Company Search)
--   origem     api (chamou a fonte) | cache (veio do cache global, sem custo)
--   resultado  ok | nao_encontrado | falha
--   custo      créditos (estimativa pela tabela de preço da fonte)
--   referencia CNPJ ou domínio da empresa; pessoa = nome, quando houver
--
-- Isolamento: organizacao_id obrigatório; RLS de leitura por current_org_id()
-- como backstop; escrita só service_role (rotas com a org da sessão).
--
-- prospeccao_consumo_mes(org, fonte, desde): soma do gasto via API — usada
-- antes de cada chamada paga. Só service_role executa.
--
-- ADITIVA E IDEMPOTENTE. ROLLBACK:
--   drop function if exists prospeccao_consumo_mes(uuid, text, timestamptz);
--   drop table if exists prospeccao_consumo;
-- ============================================================================

create table if not exists prospeccao_consumo (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  fonte text not null check (fonte in ('crustdata', 'anymail')),
  operacao text not null check (operacao in ('pessoas', 'email', 'empresas_busca')),
  origem text not null check (origem in ('api', 'cache')),
  resultado text check (resultado in ('ok', 'nao_encontrado', 'falha')),
  custo numeric(10, 4) not null default 0 check (custo >= 0),
  chave text check (char_length(chave) <= 500),
  referencia text check (char_length(referencia) <= 253),
  pessoa text check (char_length(pessoa) <= 120),
  usuario_id uuid,
  criado_em timestamptz not null default now()
);

create index if not exists idx_prospeccao_consumo_gasto
  on prospeccao_consumo (organizacao_id, fonte, criado_em)
  where origem = 'api';
create index if not exists idx_prospeccao_consumo_org_data
  on prospeccao_consumo (organizacao_id, criado_em desc);

alter table prospeccao_consumo enable row level security;
drop policy if exists prospeccao_consumo_leitura on prospeccao_consumo;
create policy prospeccao_consumo_leitura on prospeccao_consumo
  for select
  using (organizacao_id = current_org_id());

do $grants$
declare
  papel text;
begin
  foreach papel in array array['anon', 'authenticated']
  loop
    if exists (select 1 from pg_roles where rolname = papel) then
      execute format('revoke insert, update, delete on table prospeccao_consumo from %I', papel);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke select on table prospeccao_consumo from anon';
  end if;
end
$grants$;

create or replace function prospeccao_consumo_mes(p_org uuid, p_fonte text, p_desde timestamptz)
returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(c.custo), 0)
    from prospeccao_consumo c
   where c.organizacao_id = p_org
     and c.fonte = p_fonte
     and c.origem = 'api'
     and c.criado_em >= p_desde
$$;

do $grants_fn$
declare
  assinatura text := 'prospeccao_consumo_mes(uuid, text, timestamptz)';
  papel text;
begin
  execute format('revoke all on function %s from public', assinatura);
  foreach papel in array array['anon', 'authenticated']
  loop
    if exists (select 1 from pg_roles where rolname = papel) then
      execute format('revoke all on function %s from %I', assinatura, papel);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute format('grant execute on function %s to service_role', assinatura);
  end if;
end
$grants_fn$;

notify pgrst, 'reload schema';
