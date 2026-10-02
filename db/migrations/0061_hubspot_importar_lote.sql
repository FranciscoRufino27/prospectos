-- ============================================================================
-- Migration 0061 — Importação de um lote preparado da Central HubSpot
-- ----------------------------------------------------------------------------
-- hubspot_importar cria, para cada empresa do lote, a empresa e um lead por
-- contato com e-mail (com o contato correspondente), na mesma ordem e com as
-- mesmas regras da importação da Prospecção (0051/0056): lead nasce com
-- owner='n8n' (fora do motor de cadência), estagio='novos_leads', sem
-- segmento, e só depois recebe empresa_id/contato_id (o trigger da 0018
-- sincroniza a projeção a partir do lead).
--
-- Quem chama (lib/integracoes/hubspot/importacao.ts) lê o HubSpot e manda os
-- dados prontos; aqui ficam as travas que precisam ser atômicas:
--   - a empresa precisa estar no lote da organização;
--   - empresa já importada (org + hubspot_company_id) ou CNPJ já na base → pula;
--   - responsável precisa ser usuário ativo da organização;
--   - e-mail (ou contato do HubSpot) que já é lead → pula, sem duplicar;
--   - lock por empresa serializa importações concorrentes.
-- p_simular=true (padrão) só classifica: não grava nada.
-- Sem p_simular, marca o lote como 'importado'.
--
-- IDEMPOTENTE: create or replace; grants repetíveis. Só service_role executa.
-- ROLLBACK: drop function if exists hubspot_importar(uuid, uuid, jsonb, boolean);
-- ============================================================================

create or replace function hubspot_importar(
  p_org uuid, p_lote uuid, p_itens jsonb, p_simular boolean default true
) returns table (hubspot_company_id text, email text, status text, lead_id uuid)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  item jsonb;
  contato jsonb;
  v_company text;
  v_cnpj text;
  v_nome text;
  v_dominio text;
  v_resp uuid;
  v_resp_nome text;
  v_email text;
  v_hs_contato text;
  v_telefone text;
  v_novos jsonb;
  v_empresa_id uuid;
  v_contato_id uuid;
  v_lead_id uuid;
  v_empresas text[] := '{}';
  v_emails text[] := '{}';
begin
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) > 200 then
    raise exception 'p_itens deve ser um array de até 200 empresas';
  end if;
  if not exists (select 1 from hubspot_importacao_lotes l where l.id = p_lote and l.organizacao_id = p_org) then
    raise exception 'lote não encontrado nesta organização';
  end if;

  for item in select * from jsonb_array_elements(p_itens)
  loop
    v_company := nullif(trim(coalesce(item->>'hubspot_company_id', '')), '');
    if v_company is null or v_company !~ '^[0-9]+$' then
      hubspot_company_id := v_company; email := null; status := 'item_invalido'; lead_id := null; return next; continue;
    end if;
    if v_company = any(v_empresas) then
      hubspot_company_id := v_company; email := null; status := 'duplicado_no_lote'; lead_id := null; return next; continue;
    end if;
    v_empresas := v_empresas || v_company;

    if not exists (
      select 1 from hubspot_importacao_itens i
       where i.lote_id = p_lote and i.organizacao_id = p_org and i.hubspot_company_id = v_company
    ) then
      hubspot_company_id := v_company; email := null; status := 'fora_do_lote'; lead_id := null; return next; continue;
    end if;

    -- Serializa importações concorrentes da mesma empresa na mesma org.
    perform pg_advisory_xact_lock(hashtextextended(p_org::text || ':hubspot:' || v_company, 0));

    if exists (select 1 from empresas e where e.organizacao_id = p_org and e.hubspot_company_id = v_company) then
      hubspot_company_id := v_company; email := null; status := 'empresa_ja_importada'; lead_id := null; return next; continue;
    end if;

    v_cnpj := regexp_replace(coalesce(item->>'cnpj', ''), '\D', '', 'g');
    if v_cnpj !~ '^[0-9]{14}$' then v_cnpj := null; end if;
    if v_cnpj is not null and exists (select 1 from empresas e where e.organizacao_id = p_org and e.cnpj = v_cnpj) then
      hubspot_company_id := v_company; email := null; status := 'cnpj_ja_na_base'; lead_id := null; return next; continue;
    end if;

    v_resp := null;
    if coalesce(item->>'responsavel_id', '') ~ '^[0-9a-fA-F-]{36}$' then
      v_resp := (item->>'responsavel_id')::uuid;
    end if;
    select u.nome into v_resp_nome from usuarios u
     where u.id = v_resp and u.organizacao_id = p_org and u.ativo is not false;
    if v_resp is null or not found then
      hubspot_company_id := v_company; email := null; status := 'sem_responsavel'; lead_id := null; return next; continue;
    end if;

    v_nome := coalesce(nullif(trim(item->>'nome'), ''), '(sem nome) #' || v_company);
    v_dominio := lower(nullif(trim(item->>'dominio'), ''));

    -- Contatos que viram lead: e-mail válido e ainda não é lead na org.
    v_novos := '[]'::jsonb;
    for contato in select * from jsonb_array_elements(coalesce(item->'contatos', '[]'::jsonb))
    loop
      v_email := lower(nullif(trim(coalesce(contato->>'email', '')), ''));
      v_hs_contato := nullif(trim(coalesce(contato->>'hubspot_contact_id', '')), '');
      if v_email is null or v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
        hubspot_company_id := v_company; email := v_email; status := 'sem_email'; lead_id := null; return next; continue;
      end if;
      if v_email = any(v_emails)
         or exists (select 1 from leads l where l.organizacao_id = p_org and lower(l.contato_email) = v_email)
         or (v_hs_contato is not null and exists (select 1 from leads l where l.organizacao_id = p_org and l.hubspot_id = v_hs_contato)) then
        hubspot_company_id := v_company; email := v_email; status := 'ja_e_lead'; lead_id := null; return next; continue;
      end if;
      v_emails := v_emails || v_email;
      v_novos := v_novos || jsonb_build_array(contato || jsonb_build_object('email', v_email, 'hubspot_contact_id', v_hs_contato));
    end loop;

    if jsonb_array_length(v_novos) = 0 then
      hubspot_company_id := v_company; email := null; status := 'sem_contato_novo'; lead_id := null; return next; continue;
    end if;

    if p_simular then
      for contato in select * from jsonb_array_elements(v_novos)
      loop
        hubspot_company_id := v_company; email := contato->>'email'; status := 'importavel'; lead_id := null; return next;
      end loop;
      continue;
    end if;

    insert into empresas (organizacao_id, nome, cnpj, dominio, segmento, cidade, estado, pais, telefone, origem, hubspot_company_id)
    values (p_org, v_nome, v_cnpj, v_dominio, null, nullif(trim(item->>'cidade'), ''), nullif(trim(item->>'estado'), ''),
            'Brasil', nullif(trim(item->>'telefone'), ''), 'hubspot', v_company)
    returning id into v_empresa_id;

    for contato in select * from jsonb_array_elements(v_novos)
    loop
      v_email := contato->>'email';
      v_telefone := coalesce(nullif(trim(contato->>'telefone'), ''), nullif(trim(item->>'telefone'), ''));

      insert into leads (
        organizacao_id, owner, estagio, followups_enviados, canal_preferencial, perdido, score,
        empresa, segmento, cidade, estado, dominio, origem, hubspot_id,
        contato_nome, contato_cargo, contato_email, contato_telefone,
        responsavel_id, responsavel_nome
      ) values (
        p_org, 'n8n', 'novos_leads', 0, 'email', false, 50,
        v_nome, null, nullif(trim(item->>'cidade'), ''), nullif(trim(item->>'estado'), ''),
        coalesce(v_dominio, split_part(v_email, '@', 2)), 'hubspot', contato->>'hubspot_contact_id',
        nullif(trim(contato->>'nome'), ''), nullif(trim(contato->>'cargo'), ''), v_email, v_telefone,
        v_resp, v_resp_nome
      ) returning id into v_lead_id;

      insert into contatos (organizacao_id, empresa_id, nome, cargo, email, telefone, origem)
      values (p_org, v_empresa_id, nullif(trim(contato->>'nome'), ''), nullif(trim(contato->>'cargo'), ''),
              v_email, v_telefone, 'hubspot')
      returning id into v_contato_id;

      update leads set empresa_id = v_empresa_id, contato_id = v_contato_id
       where id = v_lead_id and organizacao_id = p_org;

      hubspot_company_id := v_company; email := v_email; status := 'importado'; lead_id := v_lead_id; return next;
    end loop;
  end loop;

  if not p_simular then
    update hubspot_importacao_lotes set status = 'importado'
     where id = p_lote and organizacao_id = p_org;
  end if;
end
$$;

do $grants$
declare
  assinatura text := 'hubspot_importar(uuid, uuid, jsonb, boolean)';
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
