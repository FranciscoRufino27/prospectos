-- ============================================================================
-- Migration 0060 — Enriquecimento pago do decisor (Crustdata + Anymail)
-- ----------------------------------------------------------------------------
-- O passo "analisar" da Prospecção ganhou duas consultas pagas, sob demanda:
--   - Crustdata People Search: pessoas com cargo de decisão no domínio da
--     empresa (quando o sócio da OpenCNPJ não serve);
--   - Anymail Finder: e-mail do decisor escolhido (nome + domínio).
-- O resultado fica em prospeccao_decisores.enriquecimento para não pagar duas
-- vezes pela mesma consulta nem perder o que foi pago ao recarregar a tela:
--   { "crustdata": { "dominio", "candidatos": [...], "consultadoEm" },
--     "anymail":   { "nome", "dominio", "status", "email", "consultadoEm" } }
-- Gravado só pelo SERVIDOR (rotas com resolverAcesso(), org da sessão), com o
-- mesmo isolamento da 0057: organizacao_id na PK, RLS de leitura por org,
-- escrita só service_role. Sem coluna nova de índice: a leitura já é por PK.
--
-- IDEMPOTENTE: add column if not exists.
-- ROLLBACK: alter table prospeccao_decisores drop column if exists enriquecimento;
--   (perde só o histórico das consultas pagas; decisor e leads não dependem dela)
-- ============================================================================

alter table prospeccao_decisores add column if not exists enriquecimento jsonb;

notify pgrst, 'reload schema';
