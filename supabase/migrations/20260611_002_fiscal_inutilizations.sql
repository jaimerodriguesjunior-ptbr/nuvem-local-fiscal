create table if not exists public.fiscal_inutilizations (
  id text primary key,
  provider_like_id text not null unique,
  company_id uuid not null references public.fiscal_companies(id) on delete restrict,
  company_environment_id uuid not null references public.fiscal_company_environments(id) on delete restrict,
  document_type text not null check (document_type in ('NFe', 'NFCe')),
  environment text not null check (environment in ('homologacao', 'producao')),
  status text not null check (status in ('processamento', 'homologado', 'rejeitado', 'erro')),
  issuer_cnpj varchar(14) not null,
  year integer not null check (year between 0 and 99),
  serie integer not null check (serie > 0),
  number_initial integer not null check (number_initial > 0),
  number_final integer not null check (number_final >= number_initial),
  justification text not null check (char_length(justification) >= 15),
  protocol text,
  reason text,
  reason_code text,
  request_xml text,
  signed_xml text,
  response_xml text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists fiscal_inutilizations_company_idx
  on public.fiscal_inutilizations (company_id, created_at desc);

create index if not exists fiscal_inutilizations_environment_status_idx
  on public.fiscal_inutilizations (environment, status, created_at desc);

drop trigger if exists fiscal_inutilizations_set_updated_at on public.fiscal_inutilizations;
create trigger fiscal_inutilizations_set_updated_at
before update on public.fiscal_inutilizations
for each row execute function public.set_updated_at();
