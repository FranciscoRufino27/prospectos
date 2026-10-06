-- ============================================================================
-- Migration 0066 — Remetente de e-mail conectado pela própria organização
-- ----------------------------------------------------------------------------
-- Configurações > Distribuição > E-mail de envio: a organização conecta a sua
-- conta Gmail (e-mail + senha de app). O servidor testa o login (SMTP e IMAP)
-- antes de salvar e guarda a senha CIFRADA (lib/seguranca/criptografia.ts,
-- AES-256-GCM, formato "v1:..."). Substitui, para quem conectar, o modelo
-- antigo nomenclaturas.email_conta_key → GMAIL_USER_<CHAVE> no ambiente.
--
-- Uma conta por organização (PK = organizacao_id). A senha nunca volta para o
-- navegador: a tabela não tem policy para anon/authenticated (RLS ligada e
-- sem policy = nenhuma linha visível) e os privilégios desses papéis são
-- revogados. Só service_role lê/escreve, sempre filtrando pela org da sessão
-- ou do iterador interno do motor.
--
-- ADITIVA E IDEMPOTENTE. ROLLBACK:
--   drop table if exists organizacao_remetentes_email;
--   (as organizações voltam a usar email_conta_key / conta padrão)
-- ============================================================================

create table if not exists organizacao_remetentes_email (
  organizacao_id uuid primary key references organizacoes(id) on delete cascade,
  provedor text not null default 'gmail' check (provedor = 'gmail'),
  email text not null check (char_length(email) between 3 and 254),
  senha_cifrada text not null check (senha_cifrada like 'v1:%'),
  verificado_em timestamptz not null default now(),
  conectado_por uuid,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

alter table organizacao_remetentes_email enable row level security;

do $grants$
declare
  papel text;
begin
  foreach papel in array array['anon', 'authenticated']
  loop
    if exists (select 1 from pg_roles where rolname = papel) then
      execute format('revoke all on table organizacao_remetentes_email from %I', papel);
    end if;
  end loop;
end
$grants$;

notify pgrst, 'reload schema';
