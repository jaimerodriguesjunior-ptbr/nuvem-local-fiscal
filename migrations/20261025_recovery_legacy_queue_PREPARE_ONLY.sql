-- PREPARE ONLY. Historical authorization checks; no first fiscal submission.
begin;
create table fiscal_recovery.legacy_checks(
  request_id uuid primary key,
  legacy_id text not null unique references public.fiscal_documents(id),
  scope_id uuid not null references fiscal_recovery.scopes(id),
  origin_id text not null,
  source_sha256 text not null,
  source_snapshot jsonb not null,
  state text not null default 'pending' check(state in ('pending','associated','manual_review')),
  code text not null default 'RECOVERY_LEGACY_CHECK_QUEUED',
  query_times timestamptz[] not null default '{}',
  query_attempt integer not null default 0,
  next_at timestamptz default clock_timestamp(),
  owner_token uuid,owner_until timestamptz,
  unique(scope_id,origin_id)
);
alter table fiscal_recovery.legacy_checks enable row level security;
revoke all on fiscal_recovery.legacy_checks from public,anon,authenticated,service_role;
create trigger legacy_check_wake after insert or update of next_at on fiscal_recovery.legacy_checks
  for each row execute function fiscal_recovery.notify_job();

create function public.fiscal_recovery_legacy_check_v1(p_legacy text,p_scope uuid,p_client text,p_request uuid,p_origin text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare c fiscal_recovery.legacy_checks;src jsonb;
begin
  if p_request is null or p_origin is null or length(p_origin) not between 1 and 200 or
    p_legacy is null or p_legacy like 'rv1_%' then raise exception 'RECOVERY_LEGACY_CHECK_INVALID';end if;
  src:=public.fiscal_recovery_legacy_source_v1(p_legacy,p_scope,p_client);
  perform pg_advisory_xact_lock(hashtextextended('recovery-legacy-check:'||p_legacy,0));
  select * into c from fiscal_recovery.legacy_checks where legacy_id=p_legacy for update;
  if c.request_id is null then
    insert into fiscal_recovery.legacy_checks(request_id,legacy_id,scope_id,origin_id,source_sha256,source_snapshot)
      values(p_request,p_legacy,p_scope,p_origin,src->>'sourceSha256',src->'source') returning * into c;
  elsif c.request_id<>p_request or c.scope_id<>p_scope or c.origin_id<>p_origin then
    raise exception 'RECOVERY_LEGACY_ASSOCIATION_CONFLICT';
  end if;
  return jsonb_build_object('requestId',c.request_id,'legacyId',c.legacy_id,'state',c.state,'code',c.code,
    'nextAt',c.next_at);
end $$;

create function public.fiscal_recovery_legacy_claim_v1(p_scopes uuid[]) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare c fiscal_recovery.legacy_checks;t timestamptz:=clock_timestamp();times timestamptz[];token uuid;wake timestamptz;
begin
  if coalesce(cardinality(p_scopes),0)=0 then raise exception 'RECOVERY_LEGACY_SCOPE_REQUIRED';end if;
  loop
    select q.* into c from fiscal_recovery.legacy_checks q join fiscal_recovery.scopes s on s.id=q.scope_id
      where s.enabled and s.id=any(p_scopes) and q.state='pending' and q.next_at<=t
      and coalesce(q.owner_until,t)<=t and coalesce(s.pause_until,t)<=t
      order by q.next_at,q.request_id for update of q skip locked limit 1;
    exit when c.request_id is null;
    select coalesce(array_agg(x order by x),'{}') into times from unnest(c.query_times) x where x>t-interval '1 hour';
    if cardinality(times)>=3 then
      update fiscal_recovery.legacy_checks set next_at=times[1]+interval '1 hour',query_times=times where request_id=c.request_id;
      continue;
    end if;
    token:=gen_random_uuid();
    update fiscal_recovery.legacy_checks set owner_token=token,owner_until=t+interval '90 seconds',
      query_times=array_append(times,t),query_attempt=query_attempt+1 where request_id=c.request_id returning * into c;
    return jsonb_build_object('lease',jsonb_build_object('requestId',c.request_id,'scopeId',c.scope_id,'token',token,
      'source',c.source_snapshot,'sourceSha256',c.source_sha256),'nextWakeAt',c.owner_until);
  end loop;
  select min(greatest(q.next_at,coalesce(q.owner_until,t),coalesce(s.pause_until,t))) into wake
    from fiscal_recovery.legacy_checks q join fiscal_recovery.scopes s on s.id=q.scope_id
    where s.enabled and s.id=any(p_scopes) and q.state='pending' and q.next_at is not null;
  return jsonb_build_object('lease',null,'nextWakeAt',wake);
end $$;

create function public.fiscal_recovery_legacy_finish_v1(p_request uuid,p_token uuid,p_state text,p_code text,p_proof jsonb)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare c fiscal_recovery.legacy_checks;s fiscal_recovery.scopes;t timestamptz:=clock_timestamp();fresh jsonb;r jsonb;
begin
  select * into c from fiscal_recovery.legacy_checks where request_id=p_request for update;
  if c.request_id is null or c.state<>'pending' or p_token is null or c.owner_token is distinct from p_token or
    c.owner_until is null or c.owner_until<=t then return false;end if;
  if coalesce(p_state,'') not in ('pending','associated','manual_review') or
    coalesce(length(p_code),0) not between 1 and 100 then raise exception 'RECOVERY_LEGACY_RESULT_INVALID';end if;
  select * into strict s from fiscal_recovery.scopes where id=c.scope_id;
  if not s.enabled then return false;end if;
  fresh:=public.fiscal_recovery_legacy_source_v1(c.legacy_id,c.scope_id,s.client_id);
  if fresh->>'sourceSha256' is distinct from c.source_sha256 then
    p_state:='manual_review';p_code:='RECOVERY_LEGACY_SOURCE_CHANGED';
  elsif p_state='associated' then
    r:=public.fiscal_recovery_legacy_associate_v1(c.legacy_id,c.scope_id,s.client_id,c.request_id,c.origin_id,c.source_sha256,p_proof);
    -- Transfer query history: association/cancellation share one key budget.
    update fiscal_recovery.requests set query_times=c.query_times,query_attempt=c.query_attempt where request_id=c.request_id;
  end if;
  if p_code='656' then
    update fiscal_recovery.scopes set pause_until=greatest(coalesce(pause_until,t),t+interval '1 hour')
      where cnpj=s.cnpj and environment=s.environment;
  end if;
  update fiscal_recovery.legacy_checks set state=p_state,code=p_code,owner_token=null,owner_until=null,
    next_at=case when p_state='pending' then t+least(1800,30*power(2,least(query_attempt-1,6)))*interval '1 second' else null end
    where request_id=c.request_id;
  return true;
end $$;
revoke all on function public.fiscal_recovery_legacy_check_v1(text,uuid,text,uuid,text) from public,anon,authenticated;
revoke all on function public.fiscal_recovery_legacy_claim_v1(uuid[]) from public,anon,authenticated;
revoke all on function public.fiscal_recovery_legacy_finish_v1(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.fiscal_recovery_legacy_check_v1(text,uuid,text,uuid,text) to service_role;
grant execute on function public.fiscal_recovery_legacy_claim_v1(uuid[]) to service_role;
grant execute on function public.fiscal_recovery_legacy_finish_v1(uuid,uuid,text,text,jsonb) to service_role;
commit;
