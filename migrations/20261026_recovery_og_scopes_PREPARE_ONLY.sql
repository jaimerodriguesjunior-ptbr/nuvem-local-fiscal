-- PREPARE ONLY. No scopes/bindings are enabled or enrolled by this migration.
begin;
create table fiscal_recovery.og_scope_bindings (
  scope_id uuid primary key references fiscal_recovery.scopes(id),
  enabled boolean not null default false,
  registered_at timestamptz not null default clock_timestamp()
);
alter table fiscal_recovery.og_scope_bindings enable row level security;
revoke all on fiscal_recovery.og_scope_bindings from public,anon,authenticated,service_role;
create function public.fiscal_recovery_og_scopes_v1(p_scopes uuid[],p_client text) returns jsonb
language sql security definer set search_path=pg_catalog as $$
  select coalesce(jsonb_agg(s.value),'[]'::jsonb)
    from jsonb_array_elements(public.fiscal_recovery_scopes_v1(p_scopes)) s(value)
    join fiscal_recovery.og_scope_bindings b on b.scope_id=(s.value->>'id')::uuid and b.enabled
    where s.value->>'clientId'=p_client
$$;
revoke all on function public.fiscal_recovery_og_scopes_v1(uuid[],text) from public,anon,authenticated;
grant execute on function public.fiscal_recovery_og_scopes_v1(uuid[],text) to service_role;
commit;
