-- ============================================================================
-- Migration 0057 — Índice local das empresas do HubSpot (Central de
-- Importação). 100% aditiva e idempotente.
-- ----------------------------------------------------------------------------
-- A search do HubSpot não filtra por "contato com e-mail corporativo" (e o
-- complemento passa do limite de 100 IDs), então a Central lê um ÍNDICE
-- local: uma sincronização lê a base da conta (empresas + e-mails dos
-- contatos), calcula as marcações por empresa e grava aqui. Não importa nada:
-- não cria empresa, contato nem lead — só decide o que fica DISPONÍVEL para
-- importar (aptas + clientes).
--
-- 1) hubspot_empresas_indice — uma linha por empresa, por organização (RLS).
-- 2) integracoes_hubspot.indice_* — quando o índice foi atualizado e se há
--    sincronização em andamento (trava contra execução dupla).
-- 3) hubspot_importacao_itens.cliente — clientes agora podem ser preparados
--    (envio de novidades); o item carrega a marcação para a importação
--    tratá-los separado da prospecção fria.
--
-- ROLLBACK (dado derivado, reconstruível pela sincronização):
--   drop table if exists hubspot_empresas_indice;
--   alter table integracoes_hubspot drop column if exists indice_atualizado_em,
--     drop column if exists indice_sincronizando_desde, drop column if exists indice_total;
--   alter table hubspot_importacao_itens drop column if exists cliente;
-- ============================================================================

create table if not exists hubspot_empresas_indice (
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  hubspot_company_id text not null,
  nome text,
  dominio text,
  cnpj text check (cnpj is null or cnpj ~ '^[0-9]{14}$'),
  owner_id text,
  cliente boolean not null default false,
  identificavel boolean not null default false,  -- CNPJ válido ou domínio corporativo
  contatos_total integer not null default 0,
  contatos_com_email integer not null default 0,
  contatos_corporativos integer not null default 0,
  disponivel boolean not null default false,       -- apta OU cliente com e-mail
  motivo_indisponivel text,
  situacao text not null,
  ultima_atividade timestamptz,
  busca text not null default '',                  -- nome/domínio/CNPJ/contatos, minúsculo
  sincronizado_em timestamptz not null,
  primary key (organizacao_id, hubspot_company_id)
);
create index if not exists idx_hubspot_indice_disponiveis
  on hubspot_empresas_indice (organizacao_id, disponivel, situacao, owner_id, nome, hubspot_company_id);

alter table hubspot_empresas_indice enable row level security;
drop policy if exists hubspot_empresas_indice_tenant on hubspot_empresas_indice;
create policy hubspot_empresas_indice_tenant on hubspot_empresas_indice
  for all using (organizacao_id = current_org_id()) with check (organizacao_id = current_org_id());

alter table integracoes_hubspot add column if not exists indice_atualizado_em timestamptz;
alter table integracoes_hubspot add column if not exists indice_sincronizando_desde timestamptz;
alter table integracoes_hubspot add column if not exists indice_total integer;

alter table hubspot_importacao_itens add column if not exists cliente boolean not null default false;
