-- ============================================================================
-- 0067: aviso de ENVIO de campanha no mesmo outbox dos avisos de resposta.
--
-- A campanha pode pedir uma mensagem no WhatsApp (grupo e/ou responsável) a
-- cada e-mail enviado (publico.operacao.avisoEnvio). Esses avisos usam o
-- outbox de 0053 — mesma idempotência por (organizacao_id, evento_id,
-- destino_tipo), compare-and-swap e reprocessamento — distinguidos por `tipo`.
-- evento_id do envio = "envio:<execução>:<bloco>".
--
-- Aditiva e idempotente: as linhas existentes ficam como 'resposta'.
--
-- ROLLBACK:
--   alter table avisos_resposta_cliente drop constraint if exists avisos_resposta_cliente_tipo_check;
--   alter table avisos_resposta_cliente drop column if exists tipo;
-- ============================================================================

alter table avisos_resposta_cliente
  add column if not exists tipo text not null default 'resposta';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'avisos_resposta_cliente_tipo_check'
       and conrelid = 'public.avisos_resposta_cliente'::regclass
  ) then
    alter table avisos_resposta_cliente
      add constraint avisos_resposta_cliente_tipo_check check (tipo in ('resposta', 'envio'));
  end if;
end $$;
