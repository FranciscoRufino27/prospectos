-- ============================================================================
-- Migration 0054 — Integração HubSpot → ProspectOS (Fase 1, OAuth somente leitura)
-- ----------------------------------------------------------------------------
-- Uma conexão por organização. access_token/refresh_token NUNCA em texto puro:
-- cifrados em aplicação (lib/seguranca/criptografia.ts, AES-256-GCM) antes de
-- gravar. Client ID/Secret do app HubSpot são globais (env), mas o token de
-- cada instalação é específico da organização que autorizou.
--
-- RLS como backstop: o caminho real de leitura/escrita é sempre service_role
-- nas rotas app/api/integracoes/hubspot/**, que filtram organizacao_id
-- explicitamente (o mesmo padrão de todo o resto do projeto).
-- ============================================================================

create table if not exists integracoes_hubspot (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  hubspot_portal_id bigint not null,
  access_token_cifrado text not null,
  refresh_token_cifrado text not null,
  expires_at timestamptz not null,
  scopes text[] not null default '{}',
  ativo boolean not null default true,
  ultima_sincronizacao timestamptz,
  conectado_por uuid references perfis(id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint uniq_integracoes_hubspot_org unique (organizacao_id)
);

create index if not exists idx_integracoes_hubspot_org on integracoes_hubspot(organizacao_id);

drop trigger if exists trg_atualizado_em on integracoes_hubspot;
create trigger trg_atualizado_em
  before update on integracoes_hubspot
  for each row execute function set_atualizado_em();

alter table integracoes_hubspot enable row level security;
drop policy if exists integracoes_hubspot_tenant on integracoes_hubspot;
create policy integracoes_hubspot_tenant on integracoes_hubspot
  for all
  using (organizacao_id = current_org_id())
  with check (organizacao_id = current_org_id());
