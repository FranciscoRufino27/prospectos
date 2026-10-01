-- ============================================================================
-- Migration 0055 — HubSpot Fase 2, microentrega 1: mapeamento de comerciais e
-- preparo da importação de empresas. 100% ADITIVA e idempotente.
-- ----------------------------------------------------------------------------
-- NÃO importa nada: nenhuma empresa/contato/lead é criado aqui. Os lotes
-- guardam só a SELEÇÃO preparada (empresas do HubSpot + nicho esperado) para a
-- próxima etapa (validação OpenCNPJ/DGCBR).
--
-- 1) hubspot_owners_mapeamento: hubspot_owner_id → usuarios.id por organização.
--    "Não mapeado" = ausência de linha. Nunca por nome. A aplicação valida que
--    o usuário pertence à MESMA organização antes de gravar.
-- 2) empresas.hubspot_company_id: chave de dedup (organizacao_id +
--    hubspot_company_id), única quando preenchida.
-- 3) hubspot_importacao_lotes / _itens: seleção preparada. owner/nome vêm da
--    leitura server-side do HubSpot, nunca do payload do navegador.
--
-- RLS como backstop (acesso real via service_role filtrando organizacao_id).
-- ============================================================================

-- 1) Mapeamento de comerciais -------------------------------------------------
create table if not exists hubspot_owners_mapeamento (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  hubspot_owner_id text not null,
  usuario_id uuid not null references usuarios(id) on delete cascade,
  ativo boolean not null default true,
  atualizado_por uuid references perfis(id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint uniq_hubspot_owner_org unique (organizacao_id, hubspot_owner_id)
);
create index if not exists idx_hubspot_owners_map_usuario
  on hubspot_owners_mapeamento(organizacao_id, usuario_id);

drop trigger if exists trg_atualizado_em on hubspot_owners_mapeamento;
create trigger trg_atualizado_em before update on hubspot_owners_mapeamento
  for each row execute function set_atualizado_em();

alter table hubspot_owners_mapeamento enable row level security;
drop policy if exists hubspot_owners_mapeamento_tenant on hubspot_owners_mapeamento;
create policy hubspot_owners_mapeamento_tenant on hubspot_owners_mapeamento
  for all using (organizacao_id = current_org_id()) with check (organizacao_id = current_org_id());

-- 2) Dedup de empresa importada -----------------------------------------------
alter table empresas add column if not exists hubspot_company_id text;
create unique index if not exists uq_empresas_hubspot_company_org
  on empresas(organizacao_id, hubspot_company_id)
  where hubspot_company_id is not null;

-- 3) Seleção preparada (lote + itens) -----------------------------------------
create table if not exists hubspot_importacao_lotes (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  nicho_esperado text not null,
  status text not null default 'preparado',
  total_itens integer not null default 0,
  criado_por uuid references perfis(id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists idx_hubspot_lotes_org on hubspot_importacao_lotes(organizacao_id, criado_em desc);

drop trigger if exists trg_atualizado_em on hubspot_importacao_lotes;
create trigger trg_atualizado_em before update on hubspot_importacao_lotes
  for each row execute function set_atualizado_em();

create table if not exists hubspot_importacao_itens (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  lote_id uuid not null references hubspot_importacao_lotes(id) on delete cascade,
  hubspot_company_id text not null,
  nome text,
  dominio text,
  industry_hubspot text,
  hubspot_owner_id text,
  usuario_id uuid references usuarios(id) on delete set null, -- resolvido pelo mapeamento; null = não mapeado
  criado_em timestamptz not null default now(),
  constraint uniq_hubspot_item_lote unique (lote_id, hubspot_company_id)
);
create index if not exists idx_hubspot_itens_org_company
  on hubspot_importacao_itens(organizacao_id, hubspot_company_id);

alter table hubspot_importacao_lotes enable row level security;
drop policy if exists hubspot_importacao_lotes_tenant on hubspot_importacao_lotes;
create policy hubspot_importacao_lotes_tenant on hubspot_importacao_lotes
  for all using (organizacao_id = current_org_id()) with check (organizacao_id = current_org_id());

alter table hubspot_importacao_itens enable row level security;
drop policy if exists hubspot_importacao_itens_tenant on hubspot_importacao_itens;
create policy hubspot_importacao_itens_tenant on hubspot_importacao_itens
  for all using (organizacao_id = current_org_id()) with check (organizacao_id = current_org_id());
