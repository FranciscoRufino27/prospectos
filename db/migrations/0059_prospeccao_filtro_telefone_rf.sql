-- ============================================================================
-- Migration 0059 — Filtro de telefone da Prospecção no formato da Receita
-- ----------------------------------------------------------------------------
-- A 0058 exigia celular com 9 dígitos, mas o catálogo RF guarda no máximo 8
-- dígitos após o DDD (layout anterior ao nono dígito): celular vem como
-- 8 dígitos começando em 6–9, e "com celular" achava 0 empresas. Parte dos
-- DDDs também vem com zeros à esquerda ("(011)", "(0011)").
--
-- Regras (iguais a lib/prospeccao/contato.ts, formatarTelefone):
--   dígitos sem zeros à esquerda = DDD (2, sem zero) + assinante;
--   fixo    = 8 dígitos começando em 2–5;
--   celular = 8 dígitos começando em 6–9 (sem o nono) ou 9 dígitos começando em 9.
-- 'com' aceita fixo ou celular; 'celular' só celular. Resto da função igual.
--
-- `create or replace` com a mesma assinatura: as RPCs _v2 (0058) passam a
-- usar a regra nova sem mudar. ROLLBACK: reaplicar prospeccao_extras_ok da 0058.
-- ============================================================================

create or replace function prospeccao_extras_ok(
  c catalogo_estabelecimentos, p_abertura_ate date, p_capital_min numeric, p_telefone text
) returns boolean
language sql immutable as $$
  select
    (p_abertura_ate is null or c.data_inicio_atividade <= p_abertura_ate)
    and (p_capital_min is null or c.capital_social >= p_capital_min)
    and (
      coalesce(p_telefone, '') = ''
      or (p_telefone = 'com'
          and ltrim(regexp_replace(coalesce(c.telefone, ''), '\D', '', 'g'), '0')
              ~ '^[1-9][1-9]([2-9][0-9]{7}|9[0-9]{8})$')
      or (p_telefone = 'celular'
          and ltrim(regexp_replace(coalesce(c.telefone, ''), '\D', '', 'g'), '0')
              ~ '^[1-9][1-9]([6-9][0-9]{7}|9[0-9]{8})$')
    )
$$;

notify pgrst, 'reload schema';
