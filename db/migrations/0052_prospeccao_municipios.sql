-- ============================================================================
-- Migration 0052 — Municípios do catálogo para o seletor da Prospecção
-- ----------------------------------------------------------------------------
-- O perfil de busca e o filtro da tela guardam CÓDIGOS de município da RF
-- (catalogo_estabelecimentos.municipio_codigo, ver 0050/0051). Para o usuário
-- escolher pelo nome, esta função lista os municípios presentes no catálogo:
--   - por código (resolver os nomes do que já está salvo), ou
--   - por UF e/ou trecho do nome (o que o usuário digita).
-- Só aparecem municípios com algum estabelecimento carregado — cidade sem
-- empresa no catálogo não tem o que buscar.
--
-- Dado público, sem organização: não recebe p_org. Mesmo assim o catálogo é
-- invisível ao cliente (0050), então EXECUTE fica só com service_role e a
-- rota chama depois de resolverAcesso().
--
-- p_texto já chega normalizado pelo servidor (sem acento, caixa alta, com
-- % e _ escapados), igual ao nome gravado pela RF ("SAO PAULO").
--
-- IDEMPOTENTE: drop function if exists + create; grants repetíveis.
--
-- ROLLBACK:
--   drop function if exists prospeccao_municipios(text[], text, text[], integer);
-- ============================================================================

drop function if exists prospeccao_municipios(text[], text, text[], integer);
create function prospeccao_municipios(
  p_ufs text[], p_texto text, p_codigos text[], p_limite integer
) returns table (codigo text, nome text, uf text)
language sql stable security invoker set search_path = public as $$
  select m.codigo, m.nome, m.uf
  from (
    select distinct on (c.municipio_codigo)
      c.municipio_codigo as codigo, c.municipio as nome, c.uf
    from catalogo_estabelecimentos c
    where c.municipio_codigo is not null
      and c.municipio is not null
      and case
        when coalesce(cardinality(p_codigos), 0) > 0 then c.municipio_codigo = any(p_codigos)
        else (coalesce(cardinality(p_ufs), 0) = 0 or c.uf = any(p_ufs))
          and (coalesce(p_texto, '') = '' or c.municipio ilike '%' || p_texto || '%')
      end
    order by c.municipio_codigo
  ) m
  order by (coalesce(p_texto, '') <> '' and m.nome not ilike p_texto || '%'), m.nome, m.uf
  limit greatest(1, least(coalesce(p_limite, 50), 200));
$$;

do $grants$
declare
  assinatura text := 'prospeccao_municipios(text[], text, text[], integer)';
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
