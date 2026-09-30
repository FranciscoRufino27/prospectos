-- ============================================================================
-- Migration 0054 — Busca da Prospecção prioriza as empresas de dado melhor
-- ----------------------------------------------------------------------------
-- Até aqui a busca vinha em ordem de CNPJ: pedindo 10, vinham os 10 primeiros
-- CNPJs, mesmo com e-mail de contador ou com typo.
--
-- 1. catalogo_estabelecimentos ganha qualidade_email e nota, calculadas em
--    TypeScript (lib/prospeccao/notaCatalogo.ts) na carga do catálogo e, para
--    as linhas já existentes, por scripts/catalogo-rf-nota.ts. nulas até lá.
-- 2. prospeccao_filtro_ok: "só com e-mail" passa a exigir e-mail VÁLIDO
--    (corporativo, genérico ou pessoal); contador e typo saem. Linha ainda sem
--    qualidade_email calculada mantém o critério antigo (e-mail não nulo).
-- 3. prospeccao_buscar_por_nota: mesma busca de prospeccao_buscar (0051),
--    ordenada por nota desc, cnpj — keyset pelo par (nota, cnpj). A 0051 fica
--    intacta: o código anterior segue funcionando durante o deploy.
--
-- Ordem de deploy: aplicar esta migration ANTES do código que a usa.
--
-- IDEMPOTENTE: add column if not exists / create or replace / drop function
-- if exists + create; grants repetíveis.
--
-- ROLLBACK:
--   drop function if exists prospeccao_buscar_por_nota(uuid, text[], boolean, text[], text[], text[], boolean, boolean, text, smallint, text, integer);
--   reaplicar prospeccao_filtro_ok da 0051
--   drop index if exists idx_catalogo_nota;
--   alter table catalogo_estabelecimentos drop column if exists nota, drop column if exists qualidade_email;
-- ============================================================================

alter table catalogo_estabelecimentos add column if not exists qualidade_email text;
alter table catalogo_estabelecimentos add column if not exists nota smallint;

do $check$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'catalogo_qualidade_email_valida'
  ) then
    alter table catalogo_estabelecimentos add constraint catalogo_qualidade_email_valida
      check (qualidade_email is null or qualidade_email in
        ('corporativo', 'generico', 'pessoal', 'contabilidade', 'digitacao', 'sem_email'));
  end if;
end
$check$;

create index if not exists idx_catalogo_nota
  on catalogo_estabelecimentos ((coalesce(nota, 0)) desc, cnpj);

-- ----------------------------------------------------------------------------
-- Filtro comum: mesma assinatura da 0051; muda só o critério de e-mail.
-- ----------------------------------------------------------------------------
create or replace function prospeccao_filtro_ok(
  c catalogo_estabelecimentos,
  p_cnaes text[], p_secundarios boolean, p_ufs text[], p_municipios text[],
  p_portes text[], p_excluir_mei boolean, p_so_com_email boolean, p_texto text
) returns boolean
language sql immutable as $$
  select
    (c.cnae_principal = any(p_cnaes) or (p_secundarios and c.cnaes_secundarios && p_cnaes))
    and (coalesce(cardinality(p_ufs), 0) = 0 or c.uf = any(p_ufs))
    and (coalesce(cardinality(p_municipios), 0) = 0 or c.municipio_codigo = any(p_municipios))
    and (coalesce(cardinality(p_portes), 0) = 0 or c.porte = any(p_portes))
    and (not p_excluir_mei or c.mei is not true)
    and (
      not p_so_com_email
      or (c.email is not null
          and (c.qualidade_email is null or c.qualidade_email in ('corporativo', 'generico', 'pessoal')))
    )
    and (
      coalesce(p_texto, '') = ''
      or c.razao_social ilike '%' || p_texto || '%'
      or c.nome_fantasia ilike '%' || p_texto || '%'
      or c.cnpj = regexp_replace(p_texto, '\D', '', 'g')
    )
$$;

drop function if exists prospeccao_buscar_por_nota(uuid, text[], boolean, text[], text[], text[], boolean, boolean, text, smallint, text, integer);
create function prospeccao_buscar_por_nota(
  p_org uuid,
  p_cnaes text[], p_secundarios boolean, p_ufs text[], p_municipios text[],
  p_portes text[], p_excluir_mei boolean, p_so_com_email boolean, p_texto text,
  p_apos_nota smallint, p_apos_cnpj text, p_limite integer
) returns table (
  cnpj text, razao_social text, nome_fantasia text, cnae_principal text,
  cnaes_secundarios text[], porte text, mei boolean, capital_social numeric,
  data_inicio_atividade date, logradouro text, numero text, bairro text, cep text,
  uf text, municipio text, telefone text, email text,
  ja_na_base boolean, lead_id uuid, nota smallint
)
language sql stable security definer set search_path = public as $$
  select
    c.cnpj, c.razao_social, c.nome_fantasia, c.cnae_principal,
    c.cnaes_secundarios, c.porte, c.mei, c.capital_social,
    c.data_inicio_atividade, c.logradouro, c.numero, c.bairro, c.cep,
    c.uf, c.municipio, c.telefone, c.email,
    (e.id is not null or l.id is not null) as ja_na_base,
    coalesce(le.id, l.id) as lead_id,
    coalesce(c.nota, 0)::smallint as nota
  from catalogo_estabelecimentos c
  left join empresas e on e.organizacao_id = p_org and e.cnpj = c.cnpj
  left join lateral (
    select x.id from leads x
     where x.organizacao_id = p_org and e.id is not null and x.empresa_id = e.id
     order by x.id limit 1
  ) le on true
  left join lateral (
    select x.id from leads x
     where c.email is not null and x.organizacao_id = p_org
       and lower(x.contato_email) = c.email
     order by x.id limit 1
  ) l on true
  where prospeccao_filtro_ok(c, p_cnaes, p_secundarios, p_ufs, p_municipios,
                             p_portes, p_excluir_mei, p_so_com_email, p_texto)
    and not exists (
      select 1 from prospeccao_descartes d
       where d.organizacao_id = p_org and d.cnpj = c.cnpj)
    and (
      p_apos_cnpj is null
      or coalesce(c.nota, 0) < p_apos_nota
      or (coalesce(c.nota, 0) = p_apos_nota and c.cnpj > p_apos_cnpj)
    )
  order by coalesce(c.nota, 0) desc, c.cnpj
  limit least(greatest(coalesce(p_limite, 50), 1), 200)
$$;

do $grants$
declare
  assinatura text := 'prospeccao_buscar_por_nota(uuid, text[], boolean, text[], text[], text[], boolean, boolean, text, smallint, text, integer)';
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
$grants$;

notify pgrst, 'reload schema';
