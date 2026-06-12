create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.fiscal_companies (
  id uuid primary key default gen_random_uuid(),
  cnpj varchar(14) not null unique,
  razao_social text not null,
  nome_fantasia text not null,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.fiscal_company_environments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.fiscal_companies(id) on delete cascade,
  environment text not null check (environment in ('homologacao', 'producao')),
  uf char(2) not null,
  ie text not null default '',
  crt text not null default '',
  serie_nfe integer not null default 1 check (serie_nfe > 0),
  serie_nfce integer not null default 1 check (serie_nfce > 0),
  active boolean not null default true,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (company_id, environment)
);

create table if not exists public.fiscal_certificates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.fiscal_companies(id) on delete cascade,
  cnpj varchar(14) not null,
  file_name text not null,
  uploaded_at timestamptz not null default timezone('utc', now()),
  valid_from timestamptz,
  valid_until timestamptz,
  serial_number text,
  subject text,
  holder_cnpj varchar(14),
  encrypted_bundle text not null,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists fiscal_certificates_one_active_per_company_idx
  on public.fiscal_certificates (company_id)
  where active;

create table if not exists public.fiscal_service_configs (
  id uuid primary key default gen_random_uuid(),
  company_environment_id uuid not null references public.fiscal_company_environments(id) on delete cascade,
  service_type text not null check (service_type in ('NFE', 'NFCE', 'NFSE')),
  active boolean not null default true,
  settings jsonb not null default '{}'::jsonb,
  secrets_encrypted text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (company_environment_id, service_type)
);

create table if not exists public.fiscal_documents (
  id text primary key,
  provider_like_id text not null unique,
  company_id uuid not null references public.fiscal_companies(id) on delete restrict,
  company_environment_id uuid not null references public.fiscal_company_environments(id) on delete restrict,
  service_config_id uuid references public.fiscal_service_configs(id) on delete set null,
  certificate_id uuid references public.fiscal_certificates(id) on delete set null,
  document_type text not null check (document_type in ('NFe', 'NFCe', 'NFSe')),
  environment text not null check (environment in ('homologacao', 'producao')),
  status text not null check (status in ('processamento', 'autorizado', 'rejeitado', 'cancelado', 'erro')),
  issuer_cnpj varchar(14) not null,
  number integer not null check (number > 0),
  serie integer not null check (serie > 0),
  access_key varchar(44),
  protocol text,
  reason text,
  reason_code text,
  messages jsonb not null default '[]'::jsonb,
  payload_original jsonb not null default '{}'::jsonb,
  payload_normalized jsonb not null default '{}'::jsonb,
  authorized_xml text not null default '',
  generated_xml text,
  signed_xml text,
  signature_valid boolean not null default false,
  xsd_valid boolean not null default false,
  xsd_errors jsonb not null default '[]'::jsonb,
  nfce_config_encrypted text,
  sefaz_batch_id text,
  sefaz_receipt text,
  sefaz_response_xml text,
  pdf_url text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists fiscal_documents_company_idx
  on public.fiscal_documents (company_id, created_at desc);

create index if not exists fiscal_documents_environment_status_idx
  on public.fiscal_documents (environment, status, created_at desc);

create index if not exists fiscal_documents_access_key_idx
  on public.fiscal_documents (access_key);

create table if not exists public.fiscal_document_events (
  id uuid primary key default gen_random_uuid(),
  document_id text not null references public.fiscal_documents(id) on delete cascade,
  event_type text not null,
  level text not null default 'info' check (level in ('debug', 'info', 'warn', 'error')),
  message text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists fiscal_document_events_document_idx
  on public.fiscal_document_events (document_id, created_at desc);

drop trigger if exists fiscal_companies_set_updated_at on public.fiscal_companies;
create trigger fiscal_companies_set_updated_at
before update on public.fiscal_companies
for each row execute function public.set_updated_at();

drop trigger if exists fiscal_company_environments_set_updated_at on public.fiscal_company_environments;
create trigger fiscal_company_environments_set_updated_at
before update on public.fiscal_company_environments
for each row execute function public.set_updated_at();

drop trigger if exists fiscal_certificates_set_updated_at on public.fiscal_certificates;
create trigger fiscal_certificates_set_updated_at
before update on public.fiscal_certificates
for each row execute function public.set_updated_at();

drop trigger if exists fiscal_service_configs_set_updated_at on public.fiscal_service_configs;
create trigger fiscal_service_configs_set_updated_at
before update on public.fiscal_service_configs
for each row execute function public.set_updated_at();

drop trigger if exists fiscal_documents_set_updated_at on public.fiscal_documents;
create trigger fiscal_documents_set_updated_at
before update on public.fiscal_documents
for each row execute function public.set_updated_at();
