-- ============================================================================
-- Migration 0062 — Lista de e-mails inválidos por organização
-- ----------------------------------------------------------------------------
-- Até aqui o bounce vivia só no lead (0027: leads.bounced). Lead apagado e
-- reimportado nascia limpo e voltava a ser elegível para campanha — foi assim
-- que a reimportação da base da Laudos em 12/09/2026 descartou os bounces de
-- 9–10/09 (a idempotência por mensagem, 0030, impede reler aqueles avisos).
--
-- Agora o motor grava o ENDEREÇO devolvido em `emails_invalidos`, e o trigger
-- abaixo marca como bounced qualquer lead que entre na organização (ou passe a
-- usar) um endereço da lista — por qualquer caminho: importação CSV, HubSpot
-- (0061), prospecção, cadastro manual ou script. Todos os filtros de campanha,
-- inscrição em workflow, follow-up, renovação e envio manual já respeitam
-- leads.bounced; nada mais precisa mudar para o lead ficar fora.
--
-- Escritas só via service_role (motor e scripts). Usuários da organização
-- podem LER a própria lista; outra organização não vê nada (RLS).
--
-- IDEMPOTENTE: if not exists / create or replace / drop ... if exists.
-- ROLLBACK:
--   drop trigger if exists trg_suprimir_email_invalido on leads;
--   drop function if exists leads_marcar_email_invalido();
--   drop table if exists emails_invalidos;
-- (Os leads já marcados continuam bounced; desmarcar é decisão de dados.)
-- ============================================================================

create table if not exists emails_invalidos (
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  -- Sempre minúsculo e sem espaços: a comparação com o lead é exata.
  email text not null,
  -- Códigos de status do aviso de falha (ex.: '5.1.1'), quando o servidor os informa.
  motivo text,
  -- 'bounce' (motor, em tempo real) ou 'varredura_caixa' (scripts/emails-invalidos-da-caixa.ts).
  origem text not null default 'bounce',
  detectado_em timestamptz not null default now(),
  primary key (organizacao_id, email),
  constraint emails_invalidos_email_normalizado check (email = lower(btrim(email)) and email <> '')
);

alter table emails_invalidos enable row level security;
drop policy if exists emails_invalidos_leitura on emails_invalidos;
create policy emails_invalidos_leitura on emails_invalidos
  for select
  using (organizacao_id = current_org_id());

-- Marca o lead como bounced quando o e-mail dele está na lista da PRÓPRIA
-- organização. Nunca desmarca: corrigir o endereço para um válido não apaga o
-- histórico do bounce anterior (mesma regra de antes desta migration).
create or replace function leads_marcar_email_invalido()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.contato_email is null or coalesce(new.bounced, false) then
    return new;
  end if;
  if exists (
    select 1
      from emails_invalidos e
     where e.organizacao_id = new.organizacao_id
       and e.email = lower(btrim(new.contato_email))
  ) then
    new.bounced := true;
    new.bounced_em := coalesce(new.bounced_em, now());
  end if;
  return new;
end
$$;

-- Triggers BEFORE do mesmo evento disparam em ordem alfabética: o nome
-- trg_suprimir_* roda DEPOIS de trg_set_org_id, que preenche organizacao_id
-- quando o insert vem sem ela. Sem a org preenchida a busca acima não casaria.
drop trigger if exists trg_suprimir_email_invalido on leads;
create trigger trg_suprimir_email_invalido
  before insert or update of contato_email on leads
  for each row execute function leads_marcar_email_invalido();
