alter table public.fiscal_documents
  add column if not exists cancellation_justification text,
  add column if not exists cancellation_status_code text,
  add column if not exists cancellation_reason text,
  add column if not exists cancellation_protocol text,
  add column if not exists cancellation_request_xml text,
  add column if not exists cancellation_signed_xml text,
  add column if not exists cancellation_response_xml text,
  add column if not exists cancellation_processed_xml text,
  add column if not exists cancelled_at timestamptz;

create index if not exists fiscal_documents_cancellation_protocol_idx
  on public.fiscal_documents (cancellation_protocol)
  where cancellation_protocol is not null;
