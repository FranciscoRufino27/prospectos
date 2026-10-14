-- ============================================================================
-- Migration 0064 — Cache de inteligência: consultas pagas no cache global
-- ----------------------------------------------------------------------------
-- enriquecimento_cache (0056) já é o cache GLOBAL de fatos públicos (OpenCNPJ,
-- site do domínio) com resultado positivo ("ok"), negativo ("nao_encontrado")
-- e validade (expira_em = quando consultar de novo). Esta migration o amplia
-- para as consultas PAGAS da Prospecção, sem criar um quarto cache:
--
--   tipo 'crustdata_pessoas' — pessoas com cargo de decisão (Crustdata People
--                              Search), chave = alvo + cargos + limite;
--   tipo 'anymail_email'     — e-mail de uma pessoa num domínio (Anymail),
--                              chave = domínio + nome normalizado.
--
-- O mesmo fato pago por uma organização vale para as outras (as chaves das
-- APIs são da plataforma). O que é de cada organização — decisor escolhido,
-- descarte, importação, lead — continua nas tabelas por organização
-- (prospeccao_decisores, prospeccao_decisores_internacionais, ...).
--
-- Colunas novas (auditoria; não decidem nada):
--   custo                 — créditos estimados da consulta que gerou a linha;
--   pago_por_organizacao  — organização cuja sessão disparou a consulta.
--
-- Acesso: inalterado — RLS ligada, nenhuma policy, só service_role.
--
-- ADITIVA E IDEMPOTENTE. ROLLBACK:
--   delete from enriquecimento_cache where tipo in ('crustdata_pessoas', 'anymail_email');
--   alter table enriquecimento_cache drop constraint enriquecimento_cache_tipo_check;
--   alter table enriquecimento_cache add constraint enriquecimento_cache_tipo_check
--     check (tipo in ('opencnpj', 'site_dominio'));
--   alter table enriquecimento_cache drop column if exists custo, drop column if exists pago_por_organizacao;
-- ============================================================================

alter table enriquecimento_cache drop constraint if exists enriquecimento_cache_tipo_check;
alter table enriquecimento_cache add constraint enriquecimento_cache_tipo_check
  check (tipo in ('opencnpj', 'site_dominio', 'crustdata_pessoas', 'anymail_email'));

alter table enriquecimento_cache add column if not exists custo numeric(10, 4);
alter table enriquecimento_cache add column if not exists pago_por_organizacao uuid
  references organizacoes(id) on delete set null;

create index if not exists idx_enriquecimento_cache_pagador
  on enriquecimento_cache (pago_por_organizacao, consultado_em)
  where pago_por_organizacao is not null;

notify pgrst, 'reload schema';
