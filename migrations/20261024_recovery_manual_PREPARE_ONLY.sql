-- PREPARE ONLY: manual demand shares the worker, frozen bytes and query budget.
begin;
create function public.fiscal_recovery_request_query_v1(p_request uuid,p_client text,p_scopes uuid[]) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare r fiscal_recovery.requests; s fiscal_recovery.scopes; t timestamptz:=clock_timestamp(); times timestamptz[]; due timestamptz;
begin
  select * into r from fiscal_recovery.requests where request_id=p_request for update;
  select * into s from fiscal_recovery.scopes where id=r.scope_id and id=any(p_scopes) and enabled;
  if r.request_id is null or s.id is null or s.client_id is distinct from p_client then raise exception 'RECOVERY_QUERY_SCOPE_INVALID';end if;
  if r.phase not in ('send_started','pending','manual_review','cancel_started','cancel_pending') or coalesce(r.document->>'xmlSigned','')='' or
    coalesce(r.document->>'chave','') !~ '^[0-9]{44}$' then
    return jsonb_build_object('scheduled',false,'nextAt',null,'reason','NOT_QUERYABLE');end if;
  if r.owner_until>t or r.claim_until>t then
    return jsonb_build_object('scheduled',false,'nextAt',greatest(r.owner_until,r.claim_until),'reason','IN_PROGRESS');end if;
  select coalesce(array_agg(x order by x),'{}') into times from unnest(r.query_times) x where x>t-interval '1 hour';
  due:=greatest(t,coalesce(s.pause_until,t),coalesce(times[cardinality(times)]+interval '30 seconds',t),
    case when cardinality(times)>=3 then times[1]+interval '1 hour' else t end);
  if r.phase='cancel_pending' then
    update fiscal_recovery.requests set next_at=due,version=version+1,origin='central',code='RECOVERY_CANCEL_QUERY_QUEUED',updated_at=t
      where request_id=p_request returning * into r;
    insert into fiscal_recovery.request_outbox(request_id,version) values(p_request,r.version);
  elsif r.phase='manual_review' then
    update fiscal_recovery.requests set next_at=due,phase='pending',origin='central',code='RECOVERY_MANUAL_QUERY_QUEUED',
      version=version+1,updated_at=t,document=document||jsonb_build_object('updatedAt',t,'motivo','Consulta solicitada; reenvio bloqueado.')
      where request_id=p_request returning * into r;
    insert into fiscal_recovery.request_outbox(request_id,version) values(p_request,r.version);
  else
    update fiscal_recovery.requests set next_at=due where request_id=p_request;
  end if;
  return jsonb_build_object('scheduled',true,'nextAt',due,'reason','QUEUED');
end $$;
revoke all on function public.fiscal_recovery_request_query_v1(uuid,text,uuid[]) from public,anon,authenticated;
grant execute on function public.fiscal_recovery_request_query_v1(uuid,text,uuid[]) to service_role;
commit;
