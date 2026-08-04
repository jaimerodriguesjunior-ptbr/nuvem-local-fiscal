create table if not exists public.fiscal_return_cfop_rules (
  id text primary key,
  company_id uuid references public.fiscal_companies(id) on delete cascade,
  source_cfop varchar(4),
  profile text not null,
  conditions jsonb not null default '{}'::jsonb,
  same_state_cfop varchar(4),
  interstate_cfop varchar(4),
  risk_level text not null check (risk_level in ('low', 'medium', 'high')),
  active boolean not null default true,
  source text not null default 'manual',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (source_cfop is null or source_cfop ~ '^[0-9]{4}$'),
  check (same_state_cfop is null or same_state_cfop ~ '^[0-9]{4}$'),
  check (interstate_cfop is null or interstate_cfop ~ '^[0-9]{4}$')
);

create index if not exists fiscal_return_cfop_rules_lookup_idx
  on public.fiscal_return_cfop_rules (company_id, source_cfop, active);

drop trigger if exists fiscal_return_cfop_rules_set_updated_at on public.fiscal_return_cfop_rules;
create trigger fiscal_return_cfop_rules_set_updated_at
before update on public.fiscal_return_cfop_rules
for each row execute function public.set_updated_at();

insert into public.fiscal_return_cfop_rules (
  id, company_id, source_cfop, profile, conditions,
  same_state_cfop, interstate_cfop, risk_level, active, source
) values
  (
    'returncfop_global_resale_5102', null, '5102', 'resale_standard',
    '{"purchasePurpose":"resale"}'::jsonb, '5202', '6202', 'low', true,
    'initial_catalog_from_client_audit'
  ),
  (
    'returncfop_global_resale_6102', null, '6102', 'resale_standard',
    '{"purchasePurpose":"resale"}'::jsonb, '5202', '6202', 'low', true,
    'initial_catalog_from_client_audit'
  ),
  (
    'returncfop_global_fuel_5655', null, '5655', 'fuel_lubricant_resale',
    '{"fuel":true,"purchasePurpose":"resale"}'::jsonb, '5661', '6661', 'low', true,
    'initial_catalog_from_client_audit'
  ),
  (
    'returncfop_global_fuel_5656', null, '5656', 'fuel_lubricant_resale',
    '{"fuel":true,"purchasePurpose":"resale"}'::jsonb, '5661', '6661', 'low', true,
    'initial_catalog_from_client_audit'
  )
on conflict (id) do update set
  profile = excluded.profile,
  conditions = excluded.conditions,
  same_state_cfop = excluded.same_state_cfop,
  interstate_cfop = excluded.interstate_cfop,
  risk_level = excluded.risk_level,
  active = excluded.active,
  source = excluded.source;
