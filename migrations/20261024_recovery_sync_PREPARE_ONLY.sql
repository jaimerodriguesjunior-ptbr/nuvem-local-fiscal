-- PREPARE ONLY. Requires both recovery migrations. No remote application.
begin;
create trigger recovery_outbox_wake after insert on fiscal_recovery.request_outbox
  for each row execute function fiscal_recovery.notify_job();

create function public.fiscal_recovery_outbox_claim_v1(p_scopes uuid[]) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare o fiscal_recovery.request_outbox; token uuid:=gen_random_uuid(); next_time timestamptz; event jsonb;
begin
  -- One lease per request, newest event first. A verified newer canonical result
  -- acknowledges earlier versions too. Disabled/out-of-scope work is untouched.
  select b.* into o from fiscal_recovery.request_outbox b
    join fiscal_recovery.requests r on r.request_id=b.request_id
    join fiscal_recovery.scopes s on s.id=r.scope_id
    where r.scope_id=any(p_scopes) and s.enabled and b.delivered_at is null and b.next_at<=clock_timestamp()
      and (r.owner_until is null or r.owner_until<=clock_timestamp())
      and (b.lease_until is null or b.lease_until<=clock_timestamp())
      and not exists(select 1 from fiscal_recovery.request_outbox busy where busy.request_id=b.request_id
        and busy.delivered_at is null and busy.lease_until>clock_timestamp())
      and b.version=(select max(latest.version) from fiscal_recovery.request_outbox latest
        where latest.request_id=b.request_id and latest.delivered_at is null)
    order by b.next_at,b.request_id for update of b skip locked limit 1;
  if o.request_id is not null then
    update fiscal_recovery.request_outbox set lease_token=token,lease_until=clock_timestamp()+interval '90 seconds',attempt=attempt+1
      where request_id=o.request_id and version=o.version returning * into o;
    select jsonb_build_object('schema','recovery-v1','eventId',o.request_id::text||':'||o.version::text,
      'requestId',o.request_id,'version',o.version,'clientId',s.client_id,'organizationId',s.organization_id,'storeId',s.store_id)
      into event from fiscal_recovery.requests r join fiscal_recovery.scopes s on s.id=r.scope_id where r.request_id=o.request_id;
  end if;
  select min(greatest(b.next_at,coalesce(r.owner_until,b.next_at),coalesce((select max(busy.lease_until) from fiscal_recovery.request_outbox busy
      where busy.request_id=b.request_id and busy.delivered_at is null),b.next_at))) into next_time
    from fiscal_recovery.request_outbox b join fiscal_recovery.requests r on r.request_id=b.request_id
    join fiscal_recovery.scopes s on s.id=r.scope_id
    where r.scope_id=any(p_scopes) and s.enabled and b.delivered_at is null
      and b.version=(select max(latest.version) from fiscal_recovery.request_outbox latest
        where latest.request_id=b.request_id and latest.delivered_at is null);
  return jsonb_build_object('lease',case when o.request_id is null then null else
    jsonb_build_object('token',token,'attempt',o.attempt,'event',event) end,'nextWakeAt',next_time);
end $$;

create function public.fiscal_recovery_outbox_complete_v1(p_request uuid,p_version bigint,p_token uuid,p_applied_version bigint)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare o fiscal_recovery.request_outbox; current_version bigint;
begin
  select * into o from fiscal_recovery.request_outbox where request_id=p_request and version=p_version for update;
  if o.request_id is null or p_token is null or o.lease_token is null or o.lease_until is null or
    o.delivered_at is not null or o.lease_token is distinct from p_token or
    o.lease_until<=clock_timestamp() then return false;end if;
  select version into current_version from fiscal_recovery.requests where request_id=p_request;
  if p_applied_version is not null then
    if p_applied_version<p_version or p_applied_version>current_version then raise exception 'RECOVERY_SYNC_ACK_INVALID';end if;
    update fiscal_recovery.request_outbox set delivered_at=clock_timestamp(),lease_token=null,lease_until=null
      where request_id=p_request and version<=p_applied_version and delivered_at is null;
  else
    update fiscal_recovery.request_outbox set lease_token=null,lease_until=null,
      next_at=clock_timestamp()+least(3600,30*power(2,least(o.attempt-1,7))) * interval '1 second'
      where request_id=p_request and version=p_version;
  end if;
  return true;
end $$;
revoke all on function public.fiscal_recovery_outbox_claim_v1(uuid[]) from public,anon,authenticated;
revoke all on function public.fiscal_recovery_outbox_complete_v1(uuid,bigint,uuid,bigint) from public,anon,authenticated;
grant execute on function public.fiscal_recovery_outbox_claim_v1(uuid[]) to service_role;
grant execute on function public.fiscal_recovery_outbox_complete_v1(uuid,bigint,uuid,bigint) to service_role;
commit;
