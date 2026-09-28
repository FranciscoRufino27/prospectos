-- ============================================================================
-- Migration 0053 — Aviso de resposta do cliente no WhatsApp da equipe
-- ----------------------------------------------------------------------------
-- Quando um cliente responde (e-mail ou WhatsApp), o responsável do lead e/ou o
-- grupo comercial da organização são avisados no WhatsApp (Z-API). A escolha do
-- destino é da organização (organizacoes.configuracoes → comercial.avisoResposta;
-- ausente = desligado). O número pessoal é de cada usuário, com opt-in.
--
-- 1) perfis: número de WhatsApp para avisos + liga/desliga. Separado de
--    `perfis.telefone` (0009), que é só cadastro e nunca foi ponte confiável
--    para o WhatsApp. Desligado por padrão: ninguém passa a receber mensagem
--    sem ter cadastrado e ligado o próprio número.
--
-- 2) avisos_resposta_cliente: outbox dos avisos, no molde de
--    comercial_handoff_notificacoes (0042) — intenção registrada, tentativas
--    com teto, compare-and-swap para enviar, 'enviando' preso nunca reenviado.
--    Identidade única = (organizacao_id, evento_id, destino_tipo): a mesma
--    resposta (Message-ID do e-mail / id da mensagem do WhatsApp) gera no
--    máximo um aviso por destino, mesmo com evento duplicado.
--    Ciclo: pendente → enviando → enviada | falhou (até o teto)
--           configuracao_ausente (sem Z-API/grupo/número; volta a tentar)
--
-- Aditiva e idempotente. Multi-tenant: organizacao_id + RLS de leitura por org
-- (escrita só pelo service_role, como 0042).
--
-- ROLLBACK (descarta o histórico de avisos e as preferências de número):
--   drop table if exists avisos_resposta_cliente;
--   alter table perfis drop column if exists avisos_whatsapp_ativo;
--   alter table perfis drop column if exists whatsapp_avisos;
-- ============================================================================

alter table perfis add column if not exists whatsapp_avisos text;
alter table perfis add column if not exists avisos_whatsapp_ativo boolean not null default false;

create table if not exists avisos_resposta_cliente (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  -- Identidade estável da resposta: "email:<Message-ID>" / "whatsapp:<id>".
  evento_id text not null,
  destino_tipo text not null check (destino_tipo in ('responsavel', 'grupo')),
  status text not null default 'pendente'
    check (status in ('pendente', 'enviando', 'enviada', 'falhou', 'configuracao_ausente')),
  -- Quantas vezes o envio foi de fato tentado no provedor.
  tentativas integer not null default 0,
  ultimo_erro text,
  -- Dados congelados na resposta (empresa, contato, canal, classificação,
  -- trecho, responsável): reprocessar monta o MESMO texto.
  dados jsonb not null default '{}'::jsonb,
  -- Para onde foi (número ou id do grupo) e o id devolvido pelo provedor.
  destino text,
  provider_message_id text,
  enviado_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint avisos_resposta_cliente_enviada_coerente check (
    status <> 'enviada' or enviado_em is not null
  )
);

-- A trava de duplicidade: um aviso por resposta e destino.
create unique index if not exists uniq_avisos_resposta_cliente_evento_destino
  on avisos_resposta_cliente(organizacao_id, evento_id, destino_tipo);

-- Anti-spam por lead (último aviso do lead na janela).
create index if not exists idx_avisos_resposta_cliente_lead
  on avisos_resposta_cliente(organizacao_id, lead_id, criado_em desc);

-- Reprocessamento: só o que ainda não saiu.
create index if not exists idx_avisos_resposta_cliente_pendentes
  on avisos_resposta_cliente(organizacao_id, status, criado_em)
  where status <> 'enviada';

drop trigger if exists trg_atualizado_em on avisos_resposta_cliente;
create trigger trg_atualizado_em before update on avisos_resposta_cliente
  for each row execute function set_atualizado_em();

do $rls$
declare pol record;
begin
  alter table avisos_resposta_cliente enable row level security;
  for pol in select policyname from pg_policies
    where schemaname = 'public' and tablename = 'avisos_resposta_cliente'
  loop execute format('drop policy %I on avisos_resposta_cliente', pol.policyname); end loop;
  create policy avisos_resposta_cliente_leitura on avisos_resposta_cliente
    for select using (organizacao_id = current_org_id());
end
$rls$;
