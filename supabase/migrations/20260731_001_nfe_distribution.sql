alter table public.fiscal_service_configs drop constraint if exists fiscal_service_configs_service_type_check;
alter table public.fiscal_service_configs add constraint fiscal_service_configs_service_type_check check (service_type in ('NFE', 'NFCE', 'NFSE', 'DISTNFE'));

create table if not exists public.fiscal_nfe_distributions (
  id text primary key, cnpj varchar(14) not null, environment text not null check (environment in ('homologacao', 'producao')),
  status text not null check (status in ('processando', 'concluido', 'erro')), mode text not null check (mode in ('dist-nsu', 'cons-nsu', 'cons-chave')),
  nsu text, access_key varchar(44), ult_nsu text, max_nsu text, status_code text, status_reason text,
  request_xml text, response_xml text, created_at timestamptz not null, updated_at timestamptz not null
);
create index if not exists fiscal_nfe_distributions_cnpj_idx on public.fiscal_nfe_distributions (cnpj, environment, created_at desc);

create table if not exists public.fiscal_nfe_distribution_documents (
  id text primary key, distribution_id text not null references public.fiscal_nfe_distributions(id) on delete cascade,
  cnpj varchar(14) not null, environment text not null check (environment in ('homologacao', 'producao')), nsu text not null,
  schema text not null, document_type text not null check (document_type in ('nota', 'evento')), distribution_form text not null check (distribution_form in ('resumida', 'completa')),
  access_key varchar(44), xml text not null, created_at timestamptz not null, unique (cnpj, environment, nsu)
);

create table if not exists public.fiscal_nfe_distribution_manifestations (
  id text primary key, cnpj varchar(14) not null, environment text not null check (environment in ('homologacao', 'producao')),
  access_key varchar(44) not null, event_type text not null, justification text,
  status text not null check (status in ('processando', 'concluido', 'erro')), status_code text, status_reason text, protocol text,
  request_xml text, response_xml text, xml text, created_at timestamptz not null, updated_at timestamptz not null
);

alter table public.fiscal_nfe_distributions enable row level security;
alter table public.fiscal_nfe_distribution_documents enable row level security;
alter table public.fiscal_nfe_distribution_manifestations enable row level security;
