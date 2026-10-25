-- Local integration, NOT applied remotely. Requires the prepared recovery-v1
-- schema/scopes migration. Aggregates are authoritative for rv1_* documents;
-- they never enter fiscal_documents or the legacy in-memory snapshot.
begin;
create table fiscal_recovery.requests (
  request_id uuid primary key,
  scope_id uuid not null references fiscal_recovery.scopes(id),
  origin_id text not null check(length(origin_id) between 1 and 200),
  request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
  number integer not null check(number>0),
  document jsonb not null,
  phase text not null default 'accepted' check(phase in ('accepted','prepared','send_started','pending',
    'authorized','rejected','blocked_local','manual_review','cancel_started','cancel_pending','cancelled')),
  version bigint not null default 1,
  origin text not null default 'central',
  code text not null default 'ACCEPTED',
  send_started_at timestamptz,
  owner_token uuid,
  owner_until timestamptz,
  next_at timestamptz,
  query_times timestamptz[] not null default '{}',
  query_attempt integer not null default 0,
  claim_token uuid,
  claim_until timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(scope_id,number),
  check(document->>'id'='rv1_'||request_id::text),
  check(document->>'providerLikeId'='rv1_'||request_id::text)
);
create unique index recovery_request_origin_reserved on fiscal_recovery.requests(scope_id,origin_id)
  where phase not in ('rejected','cancelled');
create index recovery_request_due on fiscal_recovery.requests(next_at) where next_at is not null;
create table fiscal_recovery.request_outbox (
  request_id uuid not null references fiscal_recovery.requests(request_id),
  version bigint not null,
  delivered_at timestamptz,
  next_at timestamptz not null default clock_timestamp(),
  lease_token uuid,
  lease_until timestamptz,
  attempt integer not null default 0,
  primary key(request_id,version)
);
alter table fiscal_recovery.requests enable row level security;
alter table fiscal_recovery.request_outbox enable row level security;
revoke all on fiscal_recovery.requests,fiscal_recovery.request_outbox from public,anon,authenticated,service_role;
create trigger recovery_request_wake after insert or update of next_at,phase on fiscal_recovery.requests
  for each row execute function fiscal_recovery.notify_job();

create function fiscal_recovery.request_json(r fiscal_recovery.requests) returns jsonb
language sql stable set search_path=pg_catalog as $$
  select jsonb_build_object('requestId',r.request_id,'originId',r.origin_id,'requestHash',r.request_hash,
    'version',r.version,'phase',r.phase,'document',r.document,'errorOrigin',r.origin,'code',r.code,
    'sendStartedAt',r.send_started_at,'ownerToken',r.owner_token,'scope',jsonb_build_object(
      'id',s.id,'clientId',s.client_id,'organizationId',s.organization_id,'storeId',s.store_id,
      'cnpj',s.cnpj,'environment',s.environment,'model',s.model,'series',s.series))
  from fiscal_recovery.scopes s where s.id=r.scope_id
$$;
create function public.fiscal_recovery_request_get_v1(p_request uuid) returns jsonb
language sql security definer set search_path=pg_catalog as $$
  select fiscal_recovery.request_json(r) from fiscal_recovery.requests r where request_id=p_request
$$;
create function public.fiscal_recovery_scopes_v1(p_scopes uuid[]) returns jsonb
language sql security definer set search_path=pg_catalog as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'clientId',s.client_id,'organizationId',s.organization_id,
    'storeId',s.store_id,'cnpj',s.cnpj,'environment',s.environment,'model',s.model,'series',s.series)),'[]'::jsonb)
    from fiscal_recovery.scopes s join public.fiscal_api_clients c on c.client_id=s.client_id
    where s.id=any(p_scopes) and s.enabled and c.active and s.environment=any(c.allowed_environments) and
      (s.cnpj=any(c.allowed_cnpjs) or '*'=any(c.allowed_cnpjs)) and
      (case s.model when 'NFe' then 'nfe' else 'nfce' end)=any(c.allowed_scopes)
$$;
create function public.fiscal_recovery_request_accept_v1(p_scope uuid,p_request uuid,p_origin text,
  p_hash text,p_document jsonb,p_token uuid,p_resume_local boolean default false) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare r fiscal_recovery.requests; s fiscal_recovery.scopes;
begin
  if p_request is null or p_token is null or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or
    p_origin is null or length(p_origin) not between 1 and 200 then raise exception 'RECOVERY_REQUEST_INVALID'; end if;
  select * into strict s from fiscal_recovery.scopes where id=p_scope and enabled;
  perform pg_advisory_xact_lock(hashtextextended(p_scope::text||':'||p_origin,0));
  select * into r from fiscal_recovery.requests where request_id=p_request for update;
  if r.request_id is not null then
    if r.scope_id<>p_scope or r.origin_id<>p_origin then
      raise exception 'RECOVERY_REQUEST_CONFLICT'; end if;
    if r.request_hash<>p_hash or (p_resume_local is true and r.phase='blocked_local' and r.send_started_at is null) then
      -- A user correction before any possible send is a revision of the same
      -- request/number. It is not a retry of an uncertain or rejected emission.
      if r.phase<>'blocked_local' or r.send_started_at is not null or
        p_document->>'id' is distinct from r.document->>'id' or
        p_document->>'issuerCnpj' is distinct from s.cnpj or p_document->>'ambiente' is distinct from s.environment or
        p_document->>'tipoDocumento' is distinct from s.model or (p_document->>'serie')::integer is distinct from s.series or
        (p_document->>'numero')::integer is distinct from r.number or p_document->>'status' is distinct from 'processamento' then
        raise exception 'RECOVERY_REQUEST_CONFLICT'; end if;
      -- Same-content explicit resume preserves the original cNF, timestamps and
      -- snapshot. A duplicate POST without this flag remains a read.
      if r.request_hash=p_hash then p_document:=r.document||jsonb_build_object('status','processamento','motivo',null,'motivoStatus',null);end if;
      update fiscal_recovery.requests set request_hash=p_hash,document=p_document,phase='accepted',origin='central',code='CORRECTION_ACCEPTED',
        version=version+1,owner_token=p_token,owner_until=clock_timestamp()+interval '90 seconds',
        next_at=clock_timestamp()+interval '90 seconds',updated_at=clock_timestamp()
        where request_id=r.request_id returning * into r;
      insert into fiscal_recovery.request_outbox(request_id,version) values(r.request_id,r.version);
      return jsonb_build_object('created',true,'record',fiscal_recovery.request_json(r));
    end if;
    return jsonb_build_object('created',false,'record',fiscal_recovery.request_json(r));
  end if;
  if p_document->>'id' is distinct from 'rv1_'||p_request::text or
    p_document->>'providerLikeId' is distinct from 'rv1_'||p_request::text or
    p_document->>'issuerCnpj' is distinct from s.cnpj or p_document->>'ambiente' is distinct from s.environment or
    p_document->>'tipoDocumento' is distinct from s.model or (p_document->>'serie')::integer is distinct from s.series or
    p_document->>'status' is distinct from 'processamento' or coalesce((p_document->>'numero')::integer,0)<1 then
    raise exception 'RECOVERY_DOCUMENT_SCOPE_INVALID'; end if;
  if exists(select 1 from public.fiscal_documents d where d.issuer_cnpj=s.cnpj and d.environment=s.environment
    and d.document_type=s.model and d.serie=s.series and d.number=(p_document->>'numero')::integer) then
    raise exception 'RECOVERY_LEGACY_NUMBER_CONFLICT'; end if;
  insert into fiscal_recovery.requests(request_id,scope_id,origin_id,request_hash,number,document,owner_token,owner_until,next_at)
    values(p_request,p_scope,p_origin,p_hash,(p_document->>'numero')::integer,p_document,p_token,clock_timestamp()+interval '90 seconds',clock_timestamp()+interval '90 seconds')
    returning * into r;
  insert into fiscal_recovery.request_outbox(request_id,version) values(r.request_id,r.version);
  return jsonb_build_object('created',true,'record',fiscal_recovery.request_json(r));
end $$;

create function public.fiscal_recovery_managed_claim_v1(p_worker text,p_scopes uuid[]) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare r fiscal_recovery.requests; t timestamptz:=clock_timestamp(); times timestamptz[]; next_wake timestamptz;
begin
  if coalesce(length(p_worker),0) not between 1 and 128 or coalesce(cardinality(p_scopes),0)=0 then
    raise exception 'RECOVERY_CLAIM_INVALID'; end if;
  loop
    select q.* into r from fiscal_recovery.requests q join fiscal_recovery.scopes s on q.scope_id=s.id
      where s.enabled and s.id=any(p_scopes) and q.next_at<=t and coalesce(q.owner_until,t)<=t and
        coalesce(q.claim_until,t)<=t and coalesce(s.pause_until,t)<=t and
        q.phase in ('accepted','prepared','send_started','pending','manual_review')
      order by q.next_at,q.request_id for update of q skip locked limit 1;
    exit when r.request_id is null;
    if r.phase='accepted' then
      update fiscal_recovery.requests set phase='manual_review',code='RECOVERY_PREPARATION_INTERRUPTED',
        owner_token=null,owner_until=null,next_at=null,version=version+1,updated_at=t
        where request_id=r.request_id returning * into r;
      insert into fiscal_recovery.request_outbox(request_id,version) values(r.request_id,r.version);
      continue;
    end if;
    select coalesce(array_agg(x order by x),'{}') into times from unnest(r.query_times) x where x>t-interval '1 hour';
    if cardinality(times)>=3 then
      update fiscal_recovery.requests set next_at=times[1]+interval '1 hour',query_times=times,
        claim_token=null,claim_until=null where request_id=r.request_id;
      continue;
    end if;
    update fiscal_recovery.requests set claim_token=gen_random_uuid(),claim_until=t+interval '90 seconds',
      owner_token=null,owner_until=null,query_attempt=query_attempt+1,query_times=array_append(times,t),version=version+1
      where request_id=r.request_id returning * into r;
    return jsonb_build_object('lease',jsonb_build_object('id',r.request_id,'token',r.claim_token,'version',r.version,
      'attempt',r.query_attempt,'document',(select jsonb_build_object('clientId',s.client_id,'organizationId',s.organization_id,
       'storeId',s.store_id,'cnpj',s.cnpj,'environment',s.environment,'model',s.model,'series',s.series,
       'documentId',r.document->>'id','number',r.number,'accessKey',r.document->>'chave','signedXml',r.document->>'xmlSigned',
       'signedXmlSha256',encode(sha256(convert_to(r.document->>'xmlSigned','UTF8')),'hex')) from fiscal_recovery.scopes s where s.id=r.scope_id)),
       'nextWakeAt',ceil(extract(epoch from r.claim_until)*1000)::bigint);
  end loop;
  select min(greatest(q.next_at,coalesce(q.owner_until,t),coalesce(q.claim_until,t),coalesce(s.pause_until,t))) into next_wake
    from fiscal_recovery.requests q join fiscal_recovery.scopes s on q.scope_id=s.id
    where s.enabled and s.id=any(p_scopes) and q.phase in ('accepted','prepared','send_started','pending','manual_review') and q.next_at is not null;
  return jsonb_build_object('lease',null,'nextWakeAt',ceil(extract(epoch from next_wake)*1000)::bigint);
end $$;

create function public.fiscal_recovery_managed_complete_v1(p_job uuid,p_token uuid,p_version bigint,p_decision jsonb,p_next_at timestamptz)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare r fiscal_recovery.requests; t timestamptz:=clock_timestamp(); outcome text:=p_decision->>'state'; d jsonb;
begin
  if p_version is null or p_token is null then return false; end if;
  select * into r from fiscal_recovery.requests where request_id=p_job for update;
  if r.request_id is null or r.version<>p_version or r.claim_token is distinct from p_token or r.claim_until<=t then return false; end if;
  if coalesce(outcome,'') not in ('authorized','pending','manual_review') or
    coalesce(length(p_decision->>'code'),0) not between 1 and 128 or
    (outcome='pending' and (p_next_at is null or p_next_at<=t)) or (outcome<>'pending' and p_next_at is not null) then
    raise exception 'RECOVERY_DECISION_INVALID'; end if;
  d:=r.document||jsonb_build_object('updatedAt',t,'motivoStatus',p_decision->>'code');
  if outcome='authorized' then
    if p_decision->>'origin' is distinct from 'sefaz' or p_decision->>'code' not in ('100','150') or
      coalesce(p_decision->>'protocol','') !~ '^[0-9]{15}$' or coalesce(p_decision->>'processedXml','')='' or
      coalesce(p_decision->>'evidenceXml','')='' then raise exception 'RECOVERY_AUTHORIZATION_INVALID'; end if;
    d:=d||jsonb_build_object('status','autorizado','protocolo',p_decision->>'protocol','xml',p_decision->>'processedXml',
      'sefazResponseXml',p_decision->>'evidenceXml','motivo','Autorizacao recuperada pela consulta SEFAZ.');
  else
    if (outcome='pending' and coalesce(p_decision->>'origin','') not in ('transport','sefaz')) or
      (outcome='manual_review' and p_decision->>'origin' is distinct from 'local') then raise exception 'RECOVERY_ORIGIN_INVALID'; end if;
    d:=d||jsonb_build_object('status','processamento','motivo','Resultado ainda nao confirmado; reenvio bloqueado.');
  end if;
  if outcome='pending' and p_decision->>'origin'='sefaz' and p_decision->>'code'='656' then
    update fiscal_recovery.scopes set pause_until=greatest(coalesce(pause_until,t),t+interval '1 hour') where
      cnpj=(select cnpj from fiscal_recovery.scopes where id=r.scope_id) and environment='producao';
  end if;
  update fiscal_recovery.requests set document=d,phase=outcome,origin=case when p_decision->>'origin'='local' then 'central' else p_decision->>'origin' end,
    code=p_decision->>'code',next_at=p_next_at,claim_token=null,claim_until=null,version=version+1,updated_at=t
    where request_id=r.request_id;
  if r.phase is distinct from outcome or r.code is distinct from p_decision->>'code' or
    r.origin is distinct from (case when p_decision->>'origin'='local' then 'central' else p_decision->>'origin' end) then
    insert into fiscal_recovery.request_outbox(request_id,version) values(r.request_id,r.version+1);
  end if;
  return true;
end $$;

create function public.fiscal_recovery_request_transition_v1(p_request uuid,p_version bigint,p_token uuid,
  p_phase text,p_document jsonb,p_origin text,p_code text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare r fiscal_recovery.requests; t timestamptz:=clock_timestamp(); allowed boolean:=false; s fiscal_recovery.scopes; recent_queries timestamptz[];
begin
  if p_version is null or p_token is null then return null; end if;
  select * into r from fiscal_recovery.requests where request_id=p_request for update;
  if r.request_id is null or r.version<>p_version or r.owner_token is distinct from p_token or r.owner_until<=t then return null; end if;
  allowed := (r.phase='accepted' and p_phase in ('prepared','blocked_local')) or
    (r.phase='prepared' and p_phase in ('send_started','pending','authorized','manual_review','blocked_local')) or
    (r.phase='send_started' and p_phase in ('pending','authorized','rejected','manual_review'));
  if not coalesce(allowed,false) or coalesce(length(p_code),0) not between 1 and 128 or
    coalesce(p_origin,'') not in ('central','transport','sefaz') then raise exception 'RECOVERY_TRANSITION_INVALID'; end if;
  if p_document->>'id' is distinct from r.document->>'id' or p_document->>'issuerCnpj' is distinct from r.document->>'issuerCnpj' or
    p_document->>'ambiente' is distinct from r.document->>'ambiente' or p_document->>'tipoDocumento' is distinct from r.document->>'tipoDocumento' or
    p_document->>'numero' is distinct from r.document->>'numero' or p_document->>'serie' is distinct from r.document->>'serie' or
    (r.phase<>'accepted' and (p_document->>'chave' is distinct from r.document->>'chave' or
     p_document->>'xmlSigned' is distinct from r.document->>'xmlSigned' or
     p_document->'payloadOriginal' is distinct from r.document->'payloadOriginal')) then raise exception 'RECOVERY_FROZEN_DOCUMENT_CHANGED'; end if;
  if p_phase='prepared' and (coalesce(p_document->>'xmlSigned','')='' or coalesce(p_document->>'chave','') !~ '^[0-9]{44}$' or
    p_document->>'signatureValid' is distinct from 'true' or p_document->>'xsdValid' is distinct from 'true') then
    raise exception 'RECOVERY_PREPARATION_INVALID'; end if;
  if p_phase='authorized' and (p_origin<>'sefaz' or p_code not in ('100','150') or
    coalesce(p_document->>'protocolo','') !~ '^[0-9]{15}$' or coalesce(p_document->>'xml','')='') then
    raise exception 'RECOVERY_AUTHORIZATION_INVALID'; end if;
  if p_phase='rejected' and (p_origin<>'sefaz' or p_code in ('204','217','539','656','999')) then
    raise exception 'RECOVERY_REJECTION_UNCERTAIN'; end if;
  if p_phase='send_started' and r.send_started_at is not null then raise exception 'RECOVERY_SEND_ALREADY_STARTED'; end if;
  if p_phase in ('prepared','send_started') then
    select * into strict s from fiscal_recovery.scopes where id=r.scope_id for share;
    if not s.enabled or s.pause_until>clock_timestamp() then raise exception 'RECOVERY_SERVICE_PAUSED';end if;
  end if;
  if p_phase='prepared' then
    select coalesce(array_agg(x order by x),'{}') into recent_queries from unnest(r.query_times) x where x>t-interval '1 hour';
    if cardinality(recent_queries)>=3 or recent_queries[cardinality(recent_queries)]>t-interval '30 seconds' then
      raise exception 'RECOVERY_QUERY_BUDGET_WAIT';end if;
  end if;
  update fiscal_recovery.requests set phase=p_phase,document=p_document,origin=p_origin,code=p_code,version=version+1,
    send_started_at=case when p_phase='send_started' then t else send_started_at end,
    next_at=case when p_phase in ('prepared','send_started','pending') then t+interval '30 seconds' else null end,
    query_times=case when p_phase='prepared' then array_append(query_times,t) else query_times end,
    owner_token=case when p_phase in ('prepared','send_started','cancel_started') then owner_token else null end,
    owner_until=case when p_phase in ('prepared','send_started','cancel_started') then t+interval '90 seconds' else null end,
    updated_at=t where request_id=r.request_id returning * into r;
  insert into fiscal_recovery.request_outbox(request_id,version) values(r.request_id,r.version);
  return fiscal_recovery.request_json(r);
end $$;

revoke all on all functions in schema fiscal_recovery from public,anon,authenticated,service_role;
-- Supersede the initial prototype that owned legacy fiscal_documents. The
-- integrated runtime uses only rv1 aggregates; do not leave two admissions live.
revoke all on function public.fiscal_recovery_admit_v1(uuid,text,text) from service_role;
revoke all on function public.fiscal_recovery_claim_v1(text,uuid[]) from service_role;
revoke all on function public.fiscal_recovery_complete_v1(uuid,uuid,bigint,jsonb,timestamptz) from service_role;
revoke all on function public.fiscal_recovery_request_get_v1(uuid) from public,anon,authenticated;
revoke all on function public.fiscal_recovery_scopes_v1(uuid[]) from public,anon,authenticated;
revoke all on function public.fiscal_recovery_managed_claim_v1(text,uuid[]) from public,anon,authenticated;
revoke all on function public.fiscal_recovery_managed_complete_v1(uuid,uuid,bigint,jsonb,timestamptz) from public,anon,authenticated;
revoke all on function public.fiscal_recovery_request_accept_v1(uuid,uuid,text,text,jsonb,uuid,boolean) from public,anon,authenticated;
revoke all on function public.fiscal_recovery_request_transition_v1(uuid,bigint,uuid,text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.fiscal_recovery_request_get_v1(uuid) to service_role;
grant execute on function public.fiscal_recovery_scopes_v1(uuid[]) to service_role;
grant execute on function public.fiscal_recovery_managed_claim_v1(text,uuid[]) to service_role;
grant execute on function public.fiscal_recovery_managed_complete_v1(uuid,uuid,bigint,jsonb,timestamptz) to service_role;
grant execute on function public.fiscal_recovery_request_accept_v1(uuid,uuid,text,text,jsonb,uuid,boolean) to service_role;
grant execute on function public.fiscal_recovery_request_transition_v1(uuid,bigint,uuid,text,jsonb,text,text) to service_role;
commit;
