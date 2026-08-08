alter table if exists public.fiscal_documents
  add column if not exists cancellation_state text,
  add column if not exists cancellation_attempt_id text,
  add column if not exists cancellation_requested_at timestamptz;

alter table if exists public.fiscal_documents
  drop constraint if exists fiscal_documents_cancellation_state_check;

alter table if exists public.fiscal_documents
  add constraint fiscal_documents_cancellation_state_check
  check (
    cancellation_state is null or
    cancellation_state in (
      'pendente_transmissao',
      'pendente_confirmacao',
      'confirmado',
      'rejeitado'
    )
  );

drop index if exists public.fiscal_documents_active_cancellation_attempt_idx;

create index if not exists fiscal_documents_pending_cancellation_lookup_idx
  on public.fiscal_documents (cancellation_requested_at desc)
  where cancellation_state in ('pendente_transmissao', 'pendente_confirmacao');
