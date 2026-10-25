-- PREPARE ONLY. Depends on aggregate/controller migrations. No fiscal I/O.
begin;
create table fiscal_recovery.cancellation_intents (
  intent_id uuid primary key,
  request_id uuid not null references fiscal_recovery.requests(request_id),
  justification text not null check(length(justification) between 15 and 255),
  phase text not null check(phase in ('accepted','prepared','send_started','pending','confirmed','rejected','blocked_local')),
  snapshot jsonb,
  send_started_at timestamptz,
  outcome jsonb,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create unique index recovery_cancellation_active on fiscal_recovery.cancellation_intents(request_id)
  where phase not in ('rejected','blocked_local');
alter table fiscal_recovery.cancellation_intents enable row level security;
revoke all on fiscal_recovery.cancellation_intents from public,anon,authenticated,service_role;
create function fiscal_recovery.cancellation_json(i fiscal_recovery.cancellation_intents) returns jsonb
language sql stable set search_path=pg_catalog as $$
  select jsonb_build_object('intentId',i.intent_id,'requestId',i.request_id,'justification',i.justification,
    'phase',i.phase,'snapshot',i.snapshot,'sendStartedAt',i.send_started_at)
$$;
create function public.fiscal_recovery_cancel_get_v1(p_intent uuid) returns jsonb
language sql security definer set search_path=pg_catalog as $$
  select jsonb_build_object('record',fiscal_recovery.request_json(r),'intent',fiscal_recovery.cancellation_json(i))
    from fiscal_recovery.cancellation_intents i join fiscal_recovery.requests r using(request_id) where i.intent_id=p_intent
$$;

create function public.fiscal_recovery_cancel_accept_v1(p_request uuid,p_intent uuid,p_client text,p_scopes uuid[],p_justification text,p_token uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r fiscal_recovery.requests; i fiscal_recovery.cancellation_intents; t timestamptz:=clock_timestamp();
begin
  if p_intent is null or p_token is null or p_justification is null or p_justification<>btrim(p_justification) or
    length(p_justification) not between 15 and 255 then raise exception 'RECOVERY_CANCELLATION_INVALID';end if;
  select * into r from fiscal_recovery.requests where request_id=p_request for update;
  if r.request_id is null or not exists(select 1 from fiscal_recovery.scopes s where s.id=r.scope_id and s.id=any(p_scopes)
    and s.enabled and s.client_id=p_client) then raise exception 'RECOVERY_CANCEL_SCOPE_INVALID';end if;
  select * into i from fiscal_recovery.cancellation_intents where intent_id=p_intent;
  if i.intent_id is not null then
    if i.request_id<>p_request or i.justification<>p_justification then raise exception 'RECOVERY_CANCEL_INTENT_CONFLICT';end if;
    return jsonb_build_object('created',false,'record',fiscal_recovery.request_json(r),'intent',fiscal_recovery.cancellation_json(i));
  end if;
  if r.phase='cancelled' then
    select * into strict i from fiscal_recovery.cancellation_intents where request_id=p_request and phase='confirmed';
    return jsonb_build_object('created',false,'record',fiscal_recovery.request_json(r),'intent',fiscal_recovery.cancellation_json(i));
  end if;
  if r.phase<>'authorized' or r.document->>'status'<>'autorizado' or coalesce(r.document->>'protocolo','') !~ '^[0-9]{15}$' or
    coalesce(r.document->>'chave','') !~ '^[0-9]{44}$' or coalesce(r.owner_until,t)>t or coalesce(r.claim_until,t)>t then
    raise exception 'RECOVERY_CANCELLATION_NOT_AVAILABLE';end if;
  if exists(select 1 from fiscal_recovery.cancellation_intents where request_id=p_request and phase not in ('rejected','blocked_local')) then
    raise exception 'RECOVERY_CANCELLATION_ALREADY_PENDING';end if;
  if exists(select 1 from fiscal_recovery.scopes where id=r.scope_id and pause_until>t) then
    raise exception 'RECOVERY_CANCELLATION_SERVICE_PAUSED';end if;
  insert into fiscal_recovery.cancellation_intents(intent_id,request_id,justification,phase)
    values(p_intent,p_request,p_justification,'accepted') returning * into i;
  update fiscal_recovery.requests set phase='cancel_started',version=version+1,owner_token=p_token,owner_until=t+interval '90 seconds',
    next_at=t+interval '90 seconds',origin='central',code='RECOVERY_CANCEL_ACCEPTED',claim_token=null,claim_until=null,updated_at=t,
    document=(document-'cancellationRequestXml'-'cancellationSignedXml'-'cancellationResponseXml'-'cancellationProcessedXml'-
      'cancellationStatusCode'-'cancellationReason'-'cancellationProtocol')||jsonb_build_object('cancellationAttemptId',p_intent,
      'cancellationJustification',p_justification,'cancellationRequestedAt',t,'cancellationState','pendente_transmissao','updatedAt',t)
    where request_id=p_request returning * into r;
  insert into fiscal_recovery.request_outbox(request_id,version) values(p_request,r.version);
  return jsonb_build_object('created',true,'record',fiscal_recovery.request_json(r),'intent',fiscal_recovery.cancellation_json(i));
end $$;

create function public.fiscal_recovery_cancel_step_v1(p_intent uuid,p_version bigint,p_token uuid,p_step text,p_snapshot jsonb default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r fiscal_recovery.requests; i fiscal_recovery.cancellation_intents; t timestamptz:=clock_timestamp();
begin
  select request_id into r.request_id from fiscal_recovery.cancellation_intents where intent_id=p_intent;
  select * into r from fiscal_recovery.requests where request_id=r.request_id for update;
  select * into i from fiscal_recovery.cancellation_intents where intent_id=p_intent for update;
  if p_token is null or p_version is null or r.request_id is null or r.version<>p_version or r.owner_token is distinct from p_token or
    r.owner_until is null or r.owner_until<=t or r.phase<>'cancel_started' or r.document->>'cancellationAttemptId' is distinct from p_intent::text then return null;end if;
  if p_step='prepare' then
    if i.phase<>'accepted' or i.send_started_at is not null or p_snapshot is null or
      p_snapshot->>'eventId' is distinct from 'ID110111'||(r.document->>'chave')||'01' or
      coalesce(p_snapshot->>'batchId','') !~ '^[0-9]{1,15}$' or coalesce(p_snapshot->>'signedEventXml','')='' or
      coalesce(p_snapshot->>'requestXml','')='' or coalesce(p_snapshot->>'batchXml','')='' or
      p_snapshot->>'signedEventSha256' is distinct from encode(sha256(convert_to(p_snapshot->>'signedEventXml','UTF8')),'hex') or
      p_snapshot->>'batchSha256' is distinct from encode(sha256(convert_to(p_snapshot->>'batchXml','UTF8')),'hex') then
      raise exception 'RECOVERY_CANCEL_SNAPSHOT_INVALID';end if;
    update fiscal_recovery.cancellation_intents set phase='prepared',snapshot=p_snapshot,updated_at=t where intent_id=p_intent returning * into i;
    update fiscal_recovery.requests set document=document||jsonb_build_object('cancellationRequestXml',p_snapshot->>'requestXml',
      'cancellationSignedXml',p_snapshot->>'signedEventXml','updatedAt',t) where request_id=r.request_id;
  elsif p_step='send_started' then
    if i.phase<>'prepared' or i.send_started_at is not null or i.snapshot is null or p_snapshot is not null then
      raise exception 'RECOVERY_CANCEL_SEND_ALREADY_STARTED';end if;
    if exists(select 1 from fiscal_recovery.scopes where id=r.scope_id and pause_until>t) then
      raise exception 'RECOVERY_CANCELLATION_SERVICE_PAUSED';end if;
    update fiscal_recovery.cancellation_intents set phase='send_started',send_started_at=t,updated_at=t where intent_id=p_intent returning * into i;
    update fiscal_recovery.requests set document=document||jsonb_build_object('cancellationState','pendente_confirmacao','updatedAt',t)
      where request_id=r.request_id;
  else raise exception 'RECOVERY_CANCEL_STEP_INVALID';end if;
  update fiscal_recovery.requests set version=version+1,owner_until=t+interval '90 seconds',next_at=t+interval '90 seconds',updated_at=t,
    code=case when p_step='prepare' then 'RECOVERY_CANCEL_PREPARED' else 'RECOVERY_CANCEL_POSSIBLY_SENT' end
    where request_id=r.request_id returning * into r;
  insert into fiscal_recovery.request_outbox(request_id,version) values(r.request_id,r.version);
  return jsonb_build_object('record',fiscal_recovery.request_json(r),'intent',fiscal_recovery.cancellation_json(i));
end $$;

create function public.fiscal_recovery_cancel_finish_v1(p_intent uuid,p_version bigint,p_token uuid,p_decision jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r fiscal_recovery.requests; i fiscal_recovery.cancellation_intents; t timestamptz:=clock_timestamp();
  decision_state text:=p_decision->>'state'; decision_origin text:=p_decision->>'origin'; decision_code text:=p_decision->>'code'; d jsonb; new_phase text;
begin
  select request_id into r.request_id from fiscal_recovery.cancellation_intents where intent_id=p_intent;
  select * into r from fiscal_recovery.requests where request_id=r.request_id for update;
  select * into i from fiscal_recovery.cancellation_intents where intent_id=p_intent for update;
  if p_token is null or p_version is null or r.request_id is null or r.version<>p_version or r.owner_token is distinct from p_token or
    r.owner_until is null or r.owner_until<=t or r.phase<>'cancel_started' or r.document->>'cancellationAttemptId' is distinct from p_intent::text then return null;end if;
  if coalesce(decision_state,'') not in ('cancelled','rejected','pending','blocked_local') or coalesce(decision_origin,'') not in ('sefaz','transport','local') or
    coalesce(length(decision_code),0) not between 1 and 128 then raise exception 'RECOVERY_CANCEL_DECISION_INVALID';end if;
  if decision_state='blocked_local' then
    if i.send_started_at is not null or decision_origin<>'local' then raise exception 'RECOVERY_CANCEL_BEFORE_SEND_UNPROVEN';end if;
  elsif i.send_started_at is null then raise exception 'RECOVERY_CANCEL_SEND_INTENT_MISSING';end if;
  if decision_state='cancelled' and (decision_origin<>'sefaz' or decision_code not in ('135','155') or coalesce(p_decision->>'protocol','') !~ '^[0-9]{15}$' or
    coalesce(p_decision->>'processedEventXml','')='' or coalesce(p_decision->>'evidenceXml','')='' or
    coalesce(p_decision->>'receivedAt','')='') then raise exception 'RECOVERY_CANCEL_PROTOCOL_UNVERIFIED';end if;
  if decision_state='rejected' and (decision_origin<>'sefaz' or decision_code !~ '^[2-9][0-9]{2}$' or decision_code in ('573','580','656','999') or
    coalesce(p_decision->>'evidenceXml','')='') then raise exception 'RECOVERY_CANCEL_REJECTION_UNCERTAIN';end if;
  new_phase:=case decision_state when 'cancelled' then 'cancelled' when 'rejected' then 'authorized' when 'blocked_local' then 'authorized' else 'cancel_pending' end;
  d:=r.document||jsonb_build_object('updatedAt',t,'cancellationStatusCode',decision_code,'cancellationReason',
    case decision_state when 'cancelled' then 'Cancelamento confirmado.' when 'rejected' then 'Cancelamento rejeitado pela SEFAZ.'
      when 'blocked_local' then 'Validacao interna antes do envio do cancelamento.' else 'Resultado do cancelamento ainda nao confirmado.' end,
    'cancellationState',case decision_state when 'cancelled' then 'confirmado' when 'rejected' then 'rejeitado'
      when 'blocked_local' then 'bloqueado_local' else 'pendente_confirmacao' end);
  if p_decision->>'evidenceXml' is not null then d:=d||jsonb_build_object('cancellationResponseXml',p_decision->>'evidenceXml');end if;
  if decision_state='cancelled' then d:=d||jsonb_build_object('status','cancelado','cancelledAt',p_decision->>'receivedAt',
    'cancellationProtocol',p_decision->>'protocol','cancellationProcessedXml',p_decision->>'processedEventXml');end if;
  if decision_state='pending' and decision_origin='sefaz' and decision_code='656' then
    update fiscal_recovery.scopes set pause_until=greatest(coalesce(pause_until,t),t+interval '1 hour')
      where cnpj=(select cnpj from fiscal_recovery.scopes where id=r.scope_id) and environment='producao';
  end if;
  update fiscal_recovery.cancellation_intents set phase=case decision_state when 'cancelled' then 'confirmed' else decision_state end,
    outcome=p_decision,updated_at=t where intent_id=p_intent returning * into i;
  update fiscal_recovery.requests set document=d,phase=new_phase,version=version+1,owner_token=null,owner_until=null,
    claim_token=null,claim_until=null,next_at=case when decision_state='pending' and decision_origin<>'local' then
      t+least(1800,30*power(2,least(query_attempt,6)))*interval '1 second' else null end,
    origin=case when decision_origin='local' then 'central' else decision_origin end,code=decision_code,updated_at=t where request_id=r.request_id returning * into r;
  insert into fiscal_recovery.request_outbox(request_id,version) values(r.request_id,r.version);
  return jsonb_build_object('record',fiscal_recovery.request_json(r),'intent',fiscal_recovery.cancellation_json(i));
end $$;

create function public.fiscal_recovery_cancel_claim_v1(p_scopes uuid[]) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare r fiscal_recovery.requests; i fiscal_recovery.cancellation_intents; t timestamptz:=clock_timestamp();
  times timestamptz[]; next_wake timestamptz; token uuid;
begin
  if coalesce(cardinality(p_scopes),0)=0 then raise exception 'RECOVERY_CANCEL_CLAIM_SCOPE_REQUIRED';end if;
  loop
    select q.* into r from fiscal_recovery.requests q join fiscal_recovery.scopes s on s.id=q.scope_id
      where s.enabled and s.id=any(p_scopes) and q.phase in ('cancel_started','cancel_pending') and q.next_at<=t
      and coalesce(q.owner_until,t)<=t and coalesce(q.claim_until,t)<=t and coalesce(s.pause_until,t)<=t
      order by q.next_at,q.request_id for update of q skip locked limit 1;
    exit when r.request_id is null;
    select * into strict i from fiscal_recovery.cancellation_intents where request_id=r.request_id
      and intent_id=(r.document->>'cancellationAttemptId')::uuid for update;
    token:=gen_random_uuid();
    if i.send_started_at is null then
      -- Interrupted preparation has positive no-send evidence. No first send
      -- or consultation is attempted; user can make another explicit request.
      update fiscal_recovery.requests set owner_token=token,owner_until=t+interval '90 seconds',phase='cancel_started',version=version+1
        where request_id=r.request_id returning * into r;
      perform public.fiscal_recovery_cancel_finish_v1(i.intent_id,r.version,token,
        jsonb_build_object('state','blocked_local','origin','local','code','RECOVERY_CANCEL_PREPARATION_INTERRUPTED'));
      continue;
    end if;
    select coalesce(array_agg(x order by x),'{}') into times from unnest(r.query_times) x where x>t-interval '1 hour';
    if cardinality(times)>=3 then
      update fiscal_recovery.requests set next_at=times[1]+interval '1 hour',query_times=times where request_id=r.request_id;
      continue;
    end if;
    update fiscal_recovery.requests set owner_token=token,owner_until=t+interval '90 seconds',phase='cancel_started',
      query_times=array_append(times,t),query_attempt=query_attempt+1,version=version+1 where request_id=r.request_id returning * into r;
    return jsonb_build_object('lease',jsonb_build_object('token',token,'aggregate',jsonb_build_object(
      'record',fiscal_recovery.request_json(r),'intent',fiscal_recovery.cancellation_json(i))),
      'nextWakeAt',r.owner_until);
  end loop;
  select min(greatest(q.next_at,coalesce(q.owner_until,t),coalesce(q.claim_until,t),coalesce(s.pause_until,t))) into next_wake
    from fiscal_recovery.requests q join fiscal_recovery.scopes s on s.id=q.scope_id
    where s.enabled and s.id=any(p_scopes) and q.phase in ('cancel_started','cancel_pending') and q.next_at is not null;
  return jsonb_build_object('lease',null,'nextWakeAt',next_wake);
end $$;

revoke all on function fiscal_recovery.cancellation_json(fiscal_recovery.cancellation_intents) from public,anon,authenticated,service_role;
revoke all on function public.fiscal_recovery_cancel_get_v1(uuid) from public,anon,authenticated;
revoke all on function public.fiscal_recovery_cancel_accept_v1(uuid,uuid,text,uuid[],text,uuid) from public,anon,authenticated;
revoke all on function public.fiscal_recovery_cancel_step_v1(uuid,bigint,uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.fiscal_recovery_cancel_finish_v1(uuid,bigint,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.fiscal_recovery_cancel_get_v1(uuid) to service_role;
grant execute on function public.fiscal_recovery_cancel_accept_v1(uuid,uuid,text,uuid[],text,uuid) to service_role;
grant execute on function public.fiscal_recovery_cancel_step_v1(uuid,bigint,uuid,text,jsonb) to service_role;
grant execute on function public.fiscal_recovery_cancel_finish_v1(uuid,bigint,uuid,jsonb) to service_role;
revoke all on function public.fiscal_recovery_cancel_claim_v1(uuid[]) from public,anon,authenticated;
grant execute on function public.fiscal_recovery_cancel_claim_v1(uuid[]) to service_role;
commit;
