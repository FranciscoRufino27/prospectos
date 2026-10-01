-- ============================================================================
-- Migration 0056 — Corrige a validação do LinkedIn em prospeccao_importar
-- ----------------------------------------------------------------------------
-- A 0055 validava a URL com '[^/?#\s]{3,300}', mas o Postgres só aceita
-- repetição até 255 ("invalid repetition count(s)"). O erro só aparece quando
-- o item traz contato_linkedin; aí a importação inteira falha (transação), sem
-- gravar nada. A checagem passa a ser formato + length() <= 400.
--
-- Mesma assinatura e corpo da 0055, só a condição do LinkedIn muda.
-- `create or replace` preserva os grants (só service_role executa).
-- Rollback: reaplicar a definição de prospeccao_importar da 0051 (sem LinkedIn).
-- ============================================================================
create or replace function prospeccao_importar(
  p_org uuid, p_responsavel_id uuid, p_responsavel_nome text,
  p_segmento text, p_itens jsonb, p_simular boolean default true
) returns table (cnpj text, status text, lead_id uuid)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  item jsonb;
  cat catalogo_estabelecimentos;
  v_cnpj text;
  v_email text;
  v_linkedin text;
  v_nome_empresa text;
  v_empresa_id uuid;
  v_contato_id uuid;
  v_lead_id uuid;
  v_vistos text[] := '{}';
  v_emails text[] := '{}';
begin
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) > 200 then
    raise exception 'p_itens deve ser um array de até 200 itens';
  end if;

  for item in select * from jsonb_array_elements(p_itens)
  loop
    v_cnpj := regexp_replace(coalesce(item->>'cnpj', ''), '\D', '', 'g');
    select * into cat from catalogo_estabelecimentos x where x.cnpj = v_cnpj;
    if not found then
      cnpj := v_cnpj; status := 'fora_do_catalogo'; lead_id := null; return next; continue;
    end if;
    if v_cnpj = any(v_vistos) then
      cnpj := v_cnpj; status := 'duplicado_no_lote'; lead_id := null; return next; continue;
    end if;
    v_vistos := v_vistos || v_cnpj;

    -- Serializa importações concorrentes do mesmo CNPJ na mesma org.
    perform pg_advisory_xact_lock(hashtextextended(p_org::text || ':' || v_cnpj, 0));

    if exists (select 1 from empresas e where e.organizacao_id = p_org and e.cnpj = v_cnpj) then
      cnpj := v_cnpj; status := 'ja_na_base'; lead_id := null; return next; continue;
    end if;

    v_email := lower(nullif(trim(coalesce(item->>'email', cat.email, '')), ''));
    if v_email is null or v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
      cnpj := v_cnpj; status := 'sem_email'; lead_id := null; return next; continue;
    end if;
    if v_email = any(v_emails)
       or exists (select 1 from leads l where l.organizacao_id = p_org and lower(l.contato_email) = v_email) then
      cnpj := v_cnpj; status := 'email_ja_existe'; lead_id := null; return next; continue;
    end if;
    v_emails := v_emails || v_email;

    if p_simular then
      cnpj := v_cnpj; status := 'importavel'; lead_id := null; return next; continue;
    end if;

    v_nome_empresa := coalesce(cat.nome_fantasia, cat.razao_social, v_cnpj);
    v_linkedin := nullif(trim(item->>'contato_linkedin'), '');
    -- Regex do Postgres aceita repetição até 255: o tamanho vai em length().
    if v_linkedin !~ '^https://www\.linkedin\.com/in/[^/?#\s]+$' or length(v_linkedin) > 400 then
      v_linkedin := null;
    end if;

    insert into empresas (organizacao_id, nome, cnpj, dominio, segmento, cidade, estado, pais, telefone, origem)
    values (p_org, v_nome_empresa, v_cnpj, split_part(v_email, '@', 2), nullif(p_segmento, ''),
            cat.municipio, cat.uf, 'Brasil', cat.telefone, 'catalogo_rf')
    returning id into v_empresa_id;

    insert into leads (
      organizacao_id, owner, estagio, followups_enviados, canal_preferencial, perdido, score,
      empresa, segmento, cidade, estado, dominio, origem,
      contato_nome, contato_cargo, contato_email, contato_telefone,
      responsavel_id, responsavel_nome
    ) values (
      p_org, 'n8n', 'novos_leads', 0, 'email', false, 50,
      v_nome_empresa, nullif(p_segmento, ''), cat.municipio, cat.uf, split_part(v_email, '@', 2), 'catalogo_rf',
      nullif(trim(item->>'contato_nome'), ''), nullif(trim(item->>'contato_cargo'), ''), v_email, cat.telefone,
      p_responsavel_id, p_responsavel_nome
    ) returning id into v_lead_id;

    insert into contatos (organizacao_id, empresa_id, nome, cargo, email, telefone, linkedin, origem)
    values (p_org, v_empresa_id, nullif(trim(item->>'contato_nome'), ''), nullif(trim(item->>'contato_cargo'), ''),
            v_email, cat.telefone, v_linkedin, 'catalogo_rf')
    returning id into v_contato_id;

    update leads set empresa_id = v_empresa_id, contato_id = v_contato_id
     where id = v_lead_id and organizacao_id = p_org;

    cnpj := v_cnpj; status := 'importado'; lead_id := v_lead_id; return next;
  end loop;
end
$$;
