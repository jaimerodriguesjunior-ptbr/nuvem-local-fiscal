-- PREPARED ONLY. Requires fresh backup confirmation and approval of the reviewed plan.
-- Installs disabled policy infrastructure. Does not enroll stores, issue documents,
-- change existing scopes, numbering, company permissions, fiscal history or migration history.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create table fiscal_recovery.og_tenant_policies(
  client_id text not null,
  organization_id uuid not null,
  enabled boolean not null default false,
  registered_at timestamptz not null default clock_timestamp(),
  primary key(client_id,organization_id)
);
alter table fiscal_recovery.og_tenant_policies enable row level security;
revoke all on fiscal_recovery.og_tenant_policies from public,anon,authenticated,service_role;

create function public.fiscal_recovery_og_ensure_scopes_v1(p_client text,p_organization uuid,p_scopes jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare proposal jsonb; s fiscal_recovery.scopes; v_cnpj text; v_store bigint; v_model text; v_series integer;
  v_key text; seen text[]:='{}'; ids uuid[]; blocked jsonb:='[]'; reason text;
begin
  if p_client is null or p_organization is null or coalesce(jsonb_typeof(p_scopes),'')<>'array' then raise exception 'RECOVERY_AUTO_INPUT_INVALID';end if;
  if jsonb_array_length(p_scopes)>1000 then raise exception 'RECOVERY_AUTO_LIMIT';end if;
  perform pg_advisory_xact_lock(hashtextextended('og-scope-policy:'||p_client||':'||p_organization::text,0));
  perform 1 from fiscal_recovery.og_tenant_policies where client_id=p_client and organization_id=p_organization and enabled for share;
  if not found then raise exception 'RECOVERY_AUTO_POLICY_DISABLED';end if;
  for proposal in select value from jsonb_array_elements(p_scopes) loop
    if jsonb_typeof(proposal) is distinct from 'object' or
      exists(select 1 from jsonb_object_keys(proposal) k where k not in ('organizationId','storeId','cnpj','environment','model','series')) or
      proposal->>'organizationId' is distinct from p_organization::text or proposal->>'environment' is distinct from 'producao' or
      coalesce(proposal->>'cnpj','')!~'^[0-9]{14}$' or coalesce(proposal->>'storeId','')!~'^[1-9][0-9]{0,15}$' or
      coalesce(proposal->>'series','')!~'^[1-9][0-9]{0,2}$' or coalesce(proposal->>'model','') not in ('NFe','NFCe') then raise exception 'RECOVERY_AUTO_IDENTITY_INVALID';end if;
    v_store:=(proposal->>'storeId')::bigint;v_cnpj:=proposal->>'cnpj';v_model:=proposal->>'model';v_series:=(proposal->>'series')::integer;
    if v_store>9007199254740991 or v_series>999 then raise exception 'RECOVERY_AUTO_IDENTITY_INVALID';end if;
    v_key:=v_cnpj||':'||v_model||':'||v_series::text;
    if v_key=any(seen) then raise exception 'RECOVERY_AUTO_NAMESPACE_DUPLICATE';end if;seen:=array_append(seen,v_key);
    reason:=null;
    if not exists(select 1 from public.fiscal_api_clients c where c.client_id=p_client and c.active and
      'producao'=any(c.allowed_environments) and lower(v_model)=any(c.allowed_scopes) and v_cnpj=any(c.allowed_cnpjs)) then
      reason:='COMPANY_NOT_AUTHORIZED';
    elsif not exists(select 1 from public.fiscal_companies c join public.fiscal_company_environments e on e.company_id=c.id
      where c.cnpj=v_cnpj and e.environment='producao') then reason:='COMPANY_NOT_REGISTERED';
    elsif not exists(select 1 from fiscal_recovery.scopes where cnpj=v_cnpj and environment='producao' and model=v_model and series=v_series) and
      exists(select 1 from public.fiscal_documents where issuer_cnpj=v_cnpj and environment='producao' and document_type=v_model and serie=v_series) then
      reason:='LEGACY_NAMESPACE_REVIEW_REQUIRED';
    end if;
    if reason is null then
      insert into fiscal_recovery.scopes(client_id,organization_id,store_id,cnpj,environment,model,series,enabled)
        values(p_client,p_organization,v_store,v_cnpj,'producao',v_model,v_series,true)
        on conflict(cnpj,environment,model,series) do nothing;
      select * into strict s from fiscal_recovery.scopes where cnpj=v_cnpj and environment='producao' and model=v_model and series=v_series for update;
      if s.client_id<>p_client or s.organization_id<>p_organization or s.store_id<>v_store then reason:='NAMESPACE_CONFLICT';
      elsif not s.enabled then reason:='SCOPE_PAUSED';
      else
        insert into fiscal_recovery.og_scope_bindings(scope_id,enabled) values(s.id,true) on conflict(scope_id) do nothing;
        if not exists(select 1 from fiscal_recovery.og_scope_bindings where scope_id=s.id and enabled) then reason:='BINDING_PAUSED';end if;
      end if;
    end if;
    if reason is not null then blocked:=blocked||jsonb_build_array(jsonb_build_object('storeId',v_store,'model',v_model,'series',v_series,'code',reason));end if;
  end loop;
  -- Existing scopes remain observable if an ERP store is later disabled or changes series.
  select coalesce(array_agg(id),'{}') into ids from fiscal_recovery.scopes where client_id=p_client and organization_id=p_organization;
  return jsonb_build_object('scopes',public.fiscal_recovery_og_scopes_v1(ids,p_client),'blocked',blocked);
end $$;
revoke all on function public.fiscal_recovery_og_ensure_scopes_v1(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.fiscal_recovery_og_ensure_scopes_v1(text,uuid,jsonb) to service_role;
commit;
