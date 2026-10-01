-- ============================================================================
-- Migration 0058 — Busca da Prospecção: tempo de empresa, capital e telefone
-- ----------------------------------------------------------------------------
-- Filtros novos no servidor (valem para o catálogo inteiro e para a contagem):
--   - p_abertura_ate: só empresas abertas até esta data ("há mais de N anos";
--     a data é calculada no servidor da aplicação, em UTC);
--   - p_capital_min: capital social mínimo, em reais;
--   - p_telefone: '' (qualquer) | 'com' (fixo ou celular reconhecível) |
--     'celular' (DDD + 9 dígitos começando em 9). Mesmas regras de
--     lib/prospeccao/contato.ts (formatarTelefone).
--
-- Aditiva: prospeccao_buscar_por_nota (0054) e prospeccao_contar (0051) ficam
-- intactas. O código só chama as versões _v2 quando algum destes filtros está
-- ligado; sem eles, segue nas antigas (deploy sem esta migration não quebra
-- a busca padrão).
--
-- IDEMPOTENTE: create or replace / drop function if exists + create; grants.
-- ROLLBACK:
--   drop function if exists prospeccao_buscar_por_nota_v2(uuid, text[], boolean, text[], text[], text[], boolean, boolean, text, date, numeric, text, smallint, text, integer);
--   drop function if exists prospeccao_contar_v2(uuid, text[], boolean, text[], text[], text[], boolean, boolean, text, date, numeric, text);
--   drop function if exists prospeccao_extras_ok(catalogo_estabelecimentos, date, numeric, text);
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
          and regexp_replace(coalesce(c.telefone, ''), '\D', '', 'g') ~ '^0?[1-9][1-9]([2-5][0-9]{7}|9[0-9]{8})$')
      or (p_telefone = 'celular'
          and regexp_replace(coalesce(c.telefone, ''), '\D', '', 'g') ~ '^0?[1-9][1-9]9[0-9]{8}$')
    )
$$;

drop function if exists prospeccao_buscar_por_nota_v2(uuid, text[], boolean, text[], text[], text[], boolean, boolean, text, date, numeric, text, smallint, text, integer);
create function prospeccao_buscar_por_nota_v2(
  p_org uuid,
  p_cnaes text[], p_secundarios boolean, p_ufs text[], p_municipios text[],
  p_portes text[], p_excluir_mei boolean, p_so_com_email boolean, p_texto text,
  p_abertura_ate date, p_capital_min numeric, p_telefone text,
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
    and prospeccao_extras_ok(c, p_abertura_ate, p_capital_min, p_telefone)
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

drop function if exists prospeccao_contar_v2(uuid, text[], boolean, text[], text[], text[], boolean, boolean, text, date, numeric, text);
create function prospeccao_contar_v2(
  p_org uuid,
  p_cnaes text[], p_secundarios boolean, p_ufs text[], p_municipios text[],
  p_portes text[], p_excluir_mei boolean, p_so_com_email boolean, p_texto text,
  p_abertura_ate date, p_capital_min numeric, p_telefone text
) returns bigint
language sql stable security definer set search_path = public as $$
  select count(*)
  from catalogo_estabelecimentos c
  where prospeccao_filtro_ok(c, p_cnaes, p_secundarios, p_ufs, p_municipios,
                             p_portes, p_excluir_mei, p_so_com_email, p_texto)
    and prospeccao_extras_ok(c, p_abertura_ate, p_capital_min, p_telefone)
    and not exists (
      select 1 from prospeccao_descartes d
       where d.organizacao_id = p_org and d.cnpj = c.cnpj)
$$;

do $grants$
declare
  assinatura text;
  papel text;
  assinaturas text[] := array[
    'prospeccao_buscar_por_nota_v2(uuid, text[], boolean, text[], text[], text[], boolean, boolean, text, date, numeric, text, smallint, text, integer)',
    'prospeccao_contar_v2(uuid, text[], boolean, text[], text[], text[], boolean, boolean, text, date, numeric, text)'
  ];
begin
  foreach assinatura in array assinaturas
  loop
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
  end loop;
end
$grants$;

notify pgrst, 'reload schema';
