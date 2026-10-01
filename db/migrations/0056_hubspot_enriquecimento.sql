-- ============================================================================
-- Migration 0056 — Enriquecimento das empresas do HubSpot (microentrega 1:
-- diagnóstico + PREVIEW). 100% aditiva e idempotente.
-- ----------------------------------------------------------------------------
-- NADA aqui escreve no HubSpot nem importa empresa/lead. Duas tabelas:
--
-- 1) enriquecimento_cache — respostas de fontes PÚBLICAS (OpenCNPJ por CNPJ;
--    CNPJs publicados na página inicial de um domínio). Evita consultar de novo
--    o mesmo CNPJ/domínio dentro da validade (expira_em).
--    EXCEÇÃO DELIBERADA AO ISOLAMENTO POR ORGANIZAÇÃO (mesmo desenho da 0050):
--    dado público e idêntico para todo tenant; duplicar por org não isola
--    nada. Em troca a tabela é INVISÍVEL ao cliente: RLS ligada SEM policy e
--    privilégios revogados de anon/authenticated — só o service_role lê, no
--    servidor, depois de exigirPermissao().
--
-- 2) hubspot_enriquecimentos — o último PREVIEW por empresa do HubSpot, por
--    organização (organizacao_id + RLS). Serve para revisão e para a próxima
--    etapa; não altera o HubSpot.
--
-- ROLLBACK (dado derivado/reconstruível):
--   drop table if exists hubspot_enriquecimentos;
--   drop table if exists enriquecimento_cache;
-- ============================================================================

-- 1) Cache global de fontes públicas -----------------------------------------
create table if not exists enriquecimento_cache (
  tipo text not null check (tipo in ('opencnpj', 'site_dominio')),
  chave text not null,                 -- CNPJ (14 dígitos) ou domínio
  status text not null check (status in ('ok', 'nao_encontrado', 'falha')),
  resultado jsonb not null default '{}'::jsonb,
  consultado_em timestamptz not null default now(),
  expira_em timestamptz not null,
  primary key (tipo, chave)
);
create index if not exists idx_enriquecimento_cache_expira on enriquecimento_cache (expira_em);

alter table enriquecimento_cache enable row level security;
do $grants$
declare papel text;
begin
  execute 'revoke all on table enriquecimento_cache from public';
  foreach papel in array array['anon', 'authenticated']
  loop
    if exists (select 1 from pg_roles where rolname = papel) then
      execute format('revoke all on table enriquecimento_cache from %I', papel);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant select, insert, update, delete on table enriquecimento_cache to service_role';
  end if;
end
$grants$;

-- 2) Preview por organização --------------------------------------------------
create table if not exists hubspot_enriquecimentos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  hubspot_company_id text not null,
  cadastro_atual jsonb not null default '{}'::jsonb,
  status_enriquecimento text not null
    check (status_enriquecimento in ('resolvida', 'ambigua', 'nao_resolvida', 'erro_fonte')),
  confianca text check (confianca in ('alta', 'media', 'baixa')),
  fonte text,
  cnpj text check (cnpj is null or cnpj ~ '^[0-9]{14}$'),
  razao_social text,
  nome_fantasia text,
  situacao_cadastral text,
  dominio text,
  cnae_principal text,
  atividade_principal text,
  nicho_sugerido text,
  evidencias jsonb not null default '[]'::jsonb,
  executado_por uuid references perfis(id) on delete set null,
  executado_em timestamptz not null default now(),
  constraint uniq_hubspot_enriquecimento_org unique (organizacao_id, hubspot_company_id)
);
create index if not exists idx_hubspot_enriquecimentos_org_cnpj on hubspot_enriquecimentos (organizacao_id, cnpj);

alter table hubspot_enriquecimentos enable row level security;
drop policy if exists hubspot_enriquecimentos_tenant on hubspot_enriquecimentos;
create policy hubspot_enriquecimentos_tenant on hubspot_enriquecimentos
  for all using (organizacao_id = current_org_id()) with check (organizacao_id = current_org_id());
