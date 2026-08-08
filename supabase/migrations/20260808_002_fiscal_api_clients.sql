create table if not exists public.fiscal_api_clients (
  id text primary key,
  name text not null,
  client_id text not null unique,
  client_secret_hash text not null,
  allowed_scopes text[] not null default '{}'::text[],
  allowed_environments text[] not null default '{}'::text[],
  allowed_cnpjs text[] not null default '{}'::text[],
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (client_id ~ '^[A-Za-z0-9._-]{6,120}$'),
  check (allowed_environments <@ array['homologacao', 'producao']::text[]),
  check (allowed_scopes <@ array['empresa', 'nfe', 'nfce', 'nfse', 'distribuicao-nfe']::text[])
);

create index if not exists fiscal_api_clients_active_idx
  on public.fiscal_api_clients (active, client_id);

drop trigger if exists fiscal_api_clients_set_updated_at on public.fiscal_api_clients;
create trigger fiscal_api_clients_set_updated_at
before update on public.fiscal_api_clients
for each row execute function public.set_updated_at();

alter table public.fiscal_api_clients enable row level security;

revoke all on table public.fiscal_api_clients from anon, authenticated;
