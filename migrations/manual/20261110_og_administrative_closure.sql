-- Additive administrative disposition for explicitly resolved OG number conflicts.
-- Does not change the fiscal result, XML, key, number or successor document.
begin;
set local lock_timeout='5s';
set local statement_timeout='15s';
do $preflight$ begin
  if not exists(select 1 from pg_proc where oid='fiscal_recovery.request_json(fiscal_recovery.requests)'::regprocedure
    and md5(prosrc)='4f792eecabcbf122117ad40993e01592') then
    raise exception 'RECOVERY_CLOSURE_SCHEMA_CHANGED';
  end if;
  if not exists(select 1 from pg_proc where oid='public.fiscal_recovery_request_query_v1(uuid,text,uuid[])'::regprocedure
    and md5(prosrc)='bb6ea7c3cbb2dcbd7b1f00cd3b930dfe') then
    raise exception 'RECOVERY_CLOSURE_QUERY_SCHEMA_CHANGED';
  end if;
end $preflight$;

create table fiscal_recovery.administrative_closures (
  request_id uuid primary key references fiscal_recovery.requests(request_id),
  successor_request_id uuid not null references fiscal_recovery.requests(request_id),
  evidence jsonb not null,
  evidence_sha256 text not null,
  fiscal_snapshot jsonb not null,
  closed_at timestamptz not null default clock_timestamp(),
  check(request_id<>successor_request_id)
);
alter table fiscal_recovery.administrative_closures enable row level security;
revoke all on fiscal_recovery.administrative_closures from public,anon,authenticated,service_role;

create or replace function fiscal_recovery.request_json(r fiscal_recovery.requests) returns jsonb
language sql stable set search_path=pg_catalog as $$
  select jsonb_build_object('requestId',r.request_id,'originId',r.origin_id,'requestHash',r.request_hash,
    'version',r.version,'phase',r.phase,'document',r.document,'errorOrigin',r.origin,'code',r.code,
    'sendStartedAt',r.send_started_at,'ownerToken',r.owner_token,'provenance',r.provenance,
    'administrativeClosure',(select jsonb_build_object('kind','superseded_number_conflict',
      'closedAt',c.closed_at,'successorId','rv1_'||c.successor_request_id::text,
      'successorNumber',c.evidence->'successorNumber','erpInvoiceId',c.evidence->'invoiceId',
      'erpSuccessorInvoiceId',c.evidence->'successorInvoiceId','erpResolvedAt',c.evidence->>'resolvedAt')
      from fiscal_recovery.administrative_closures c where c.request_id=r.request_id),
    'scope',jsonb_build_object('id',s.id,'clientId',s.client_id,'organizationId',s.organization_id,
      'storeId',s.store_id,'cnpj',s.cnpj,'environment',s.environment,'model',s.model,'series',s.series))
    from fiscal_recovery.scopes s where s.id=r.scope_id
$$;

-- Defense against a stale/older caller rearming the worker after closure.
create function fiscal_recovery.guard_administrative_closure() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
  if exists(select 1 from fiscal_recovery.administrative_closures c where c.request_id=old.request_id) then
    if tg_op='DELETE' then raise exception 'RECOVERY_ADMINISTRATIVELY_CLOSED';end if;
    if new.next_at is not null or new.claim_token is not null or new.claim_until is not null or
       new.owner_token is not null or new.owner_until is not null or
       new.document is distinct from old.document or new.phase is distinct from old.phase or
       new.code is distinct from old.code or new.origin is distinct from old.origin or
       new.scope_id is distinct from old.scope_id or new.origin_id is distinct from old.origin_id or
       new.request_hash is distinct from old.request_hash or new.number is distinct from old.number or
       new.send_started_at is distinct from old.send_started_at then
      raise exception 'RECOVERY_ADMINISTRATIVELY_CLOSED';
    end if;
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger recovery_administrative_closure_guard before update or delete on fiscal_recovery.requests
  for each row execute function fiscal_recovery.guard_administrative_closure();
revoke all on function fiscal_recovery.guard_administrative_closure() from public,anon,authenticated,service_role;

create function public.fiscal_recovery_close_og_number_conflict_v1(
  p_request uuid,p_successor uuid,p_version bigint,p_evidence jsonb
) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare r fiscal_recovery.requests; successor fiscal_recovery.requests; s fiscal_recovery.scopes;
  prior fiscal_recovery.administrative_closures; proof_hash text;
begin
  if p_request is null or p_successor is null or p_request=p_successor or p_version is null or
     p_evidence is null or jsonb_typeof(p_evidence)<>'object' then raise exception 'RECOVERY_CLOSURE_INVALID';end if;
  -- Same lock order for both directions; leases cannot start between validation and closure.
  perform 1 from fiscal_recovery.requests where request_id in (p_request,p_successor) order by request_id for update;
  select * into r from fiscal_recovery.requests where request_id=p_request;
  select * into successor from fiscal_recovery.requests where request_id=p_successor;
  select * into s from fiscal_recovery.scopes where id=r.scope_id;
  if r.request_id is null or successor.request_id is null or r.scope_id<>successor.scope_id or
     s.model<>'NFe' or s.environment<>'producao' or
     not exists(select 1 from fiscal_recovery.og_scope_bindings b where b.scope_id=s.id) then
    raise exception 'RECOVERY_CLOSURE_SCOPE_INVALID';end if;
  proof_hash:=encode(sha256(convert_to(p_evidence::text,'UTF8')),'hex');
  select * into prior from fiscal_recovery.administrative_closures where request_id=p_request;
  if prior.request_id is not null then
    if prior.successor_request_id<>p_successor or prior.evidence<>p_evidence then
      raise exception 'RECOVERY_CLOSURE_CONFLICT';end if;
    return fiscal_recovery.request_json(r);
  end if;
  if p_evidence->>'schema' is distinct from 'og-number-conflict-resolution-v1' or
     p_evidence->>'erpProject' is distinct from 'lyidtxcngbdjxudbljca' or
     p_evidence->>'tenantId' is distinct from s.organization_id::text or
     p_evidence->>'storeId' is distinct from s.store_id::text or
     p_evidence->>'clientId' is distinct from s.client_id or
     p_evidence->>'requestId' is distinct from r.request_id::text or
     p_evidence->>'successorRequestId' is distinct from successor.request_id::text or
     p_evidence->>'originalKey' is distinct from r.document->>'chave' or
     p_evidence->>'originalNumber' is distinct from r.number::text or
     p_evidence->>'successorNumber' is distinct from successor.number::text or
     p_evidence->>'invoiceState' is distinct from 'rejected' or
     p_evidence->>'attemptState' is distinct from 'completed' or
     p_evidence->>'recoveryState' is distinct from 'settled' or
     p_evidence->>'requiresReview' is distinct from 'false' or
     coalesce(p_evidence->>'invoiceId','') !~ '^[1-9][0-9]*$' or
     coalesce(p_evidence->>'successorInvoiceId','') !~ '^[1-9][0-9]*$' or
     coalesce(p_evidence->>'sourceInvoiceId','') !~ '^[1-9][0-9]*$' or
     coalesce(p_evidence->>'successorDraftKey','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' or
     p_evidence->>'resolvedAt' is null or (p_evidence->>'resolvedAt')::timestamptz>clock_timestamp() or
     r.origin_id is distinct from 'og:invoice:'||(p_evidence->>'invoiceId') or
     successor.origin_id is distinct from 'og:invoice:'||(p_evidence->>'successorInvoiceId') or
     coalesce((p_evidence->>'amount')::numeric,0)<=0 or
     (p_evidence->>'amount')::numeric is distinct from (r.document#>>'{payloadOriginal,infNFe,total,ICMSTot,vNF}')::numeric then
    raise exception 'RECOVERY_CLOSURE_EVIDENCE_INVALID';end if;
  if r.version<>p_version then raise exception 'RECOVERY_CLOSURE_VERSION_CHANGED';end if;
  if r.phase not in ('pending','manual_review') or r.code<>'539' or r.document->>'status' is distinct from 'processamento' or
     coalesce(r.document->>'chave','') !~ '^[0-9]{44}$' or
     r.document->>'id' is distinct from 'rv1_'||r.request_id::text or
     successor.document->>'id' is distinct from 'rv1_'||successor.request_id::text or
     r.document->>'issuerCnpj' is distinct from s.cnpj or successor.document->>'issuerCnpj' is distinct from s.cnpj or
     r.document->>'ambiente' is distinct from s.environment or successor.document->>'ambiente' is distinct from s.environment or
     r.document->>'tipoDocumento' is distinct from s.model or successor.document->>'tipoDocumento' is distinct from s.model or
     r.document->>'serie' is distinct from s.series::text or successor.document->>'serie' is distinct from s.series::text or
     r.document->>'numero' is distinct from r.number::text or successor.document->>'numero' is distinct from successor.number::text or
     coalesce(r.document->>'protocolo','')<>'' or r.send_started_at is null then
    raise exception 'RECOVERY_CLOSURE_FISCAL_STATE_CHANGED';end if;
  if r.claim_token is not null or r.claim_until is not null or r.owner_token is not null or r.owner_until is not null then
    raise exception 'RECOVERY_CLOSURE_OPERATION_IN_PROGRESS';end if;
  if successor.phase<>'authorized' or successor.code not in ('100','150') or successor.document->>'status'<>'autorizado' or
     coalesce(successor.document->>'protocolo','') !~ '^[0-9]{15}$' or coalesce(successor.document->>'xml','')='' or
     successor.number<=r.number or r.document#>>'{payloadOriginal,infNFe,ide,tpNF}' is distinct from '0' or
     r.document#>>'{payloadOriginal,infNFe,ide,finNFe}' is distinct from '4' or
     successor.document#>>'{payloadOriginal,infNFe,ide,tpNF}' is distinct from '0' or
     successor.document#>>'{payloadOriginal,infNFe,ide,finNFe}' is distinct from '4' or
     r.document#>'{payloadOriginal,infNFe,total,ICMSTot}' is distinct from successor.document#>'{payloadOriginal,infNFe,total,ICMSTot}' then
    raise exception 'RECOVERY_CLOSURE_SUCCESSOR_INVALID';end if;
  insert into fiscal_recovery.administrative_closures(request_id,successor_request_id,evidence,evidence_sha256,fiscal_snapshot)
    values(r.request_id,successor.request_id,p_evidence,proof_hash,jsonb_build_object('phase',r.phase,'origin',r.origin,'code',r.code,
      'version',r.version,'document',r.document,'sendStartedAt',r.send_started_at,'nextAt',r.next_at,'queryAttempt',r.query_attempt,
      'queryTimes',r.query_times,'updatedAt',r.updated_at));
  update fiscal_recovery.requests set next_at=null,version=version+1 where request_id=r.request_id returning * into r;
  insert into fiscal_recovery.request_outbox(request_id,version) values(r.request_id,r.version);
  return fiscal_recovery.request_json(r);
end $$;
revoke all on function public.fiscal_recovery_close_og_number_conflict_v1(uuid,uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.fiscal_recovery_close_og_number_conflict_v1(uuid,uuid,bigint,jsonb) to service_role;

-- Existing manual-demand protocol, with a closed-result response after its scope checks.
create or replace function public.fiscal_recovery_request_query_v1(p_request uuid,p_client text,p_scopes uuid[]) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare r fiscal_recovery.requests; s fiscal_recovery.scopes; t timestamptz:=clock_timestamp(); times timestamptz[]; due timestamptz;
begin
  select * into r from fiscal_recovery.requests where request_id=p_request for update;
  select * into s from fiscal_recovery.scopes where id=r.scope_id and id=any(p_scopes) and enabled;
  if r.request_id is null or s.id is null or s.client_id is distinct from p_client then raise exception 'RECOVERY_QUERY_SCOPE_INVALID';end if;
  if exists(select 1 from fiscal_recovery.administrative_closures c where c.request_id=r.request_id) then
    return jsonb_build_object('scheduled',false,'nextAt',null,'reason','ADMINISTRATIVELY_CLOSED');end if;
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
commit;
