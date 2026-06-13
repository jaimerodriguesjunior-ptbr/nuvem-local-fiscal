alter table public.fiscal_documents
  add column if not exists provider_name text,
  add column if not exists provider_request_body text,
  add column if not exists provider_response_body text,
  add column if not exists provider_reference text;

create index if not exists fiscal_documents_provider_reference_idx
  on public.fiscal_documents (provider_name, provider_reference)
  where provider_reference is not null;
