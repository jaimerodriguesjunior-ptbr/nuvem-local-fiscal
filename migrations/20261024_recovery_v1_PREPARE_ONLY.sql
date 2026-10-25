-- PREPARATION ONLY. Do not apply until the installed schema, grants, writers,
-- backup and activation procedure have been reviewed. No scope is enabled here.
-- Delivery A only. There is NO resend/first-send permission in this migration.
begin;
create schema fiscal_recovery;
revoke all on schema fiscal_recovery from public, anon, authenticated;

create table fiscal_recovery.scopes (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  organization_id uuid not null,
  store_id bigint not null check (store_id > 0),
  cnpj text not null check (cnpj ~ '^[0-9]{14}$'),
  environment text not null check (environment = 'producao'),
  model text not null check (model in ('NFe', 'NFCe')),
  series integer not null check (series between 1 and 999),
  enabled boolean not null default false,
  pause_until timestamptz,
  unique (client_id, organization_id, store_id, cnpj, environment, model, series),
  -- One owner of each production fiscal namespace, independent of client/store.
  unique (cnpj, environment, model, series)
);

create table fiscal_recovery.jobs (
  id uuid primary key default gen_random_uuid(),
  scope_id uuid not null references fiscal_recovery.scopes(id),
  document_id text not null unique references public.fiscal_documents(id),
  document jsonb not null,
  state text not null default 'pending' check (state in ('pending','running','authorized','manual_review')),
  version bigint not null default 1,
  attempt integer not null default 0,
  query_times timestamptz[] not null default '{}',
  next_at timestamptz not null default clock_timestamp(),
  lease_until timestamptz,
  lease_token uuid,
  worker_id text,
  decision jsonb,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check ((state = 'running') = (lease_until is not null and lease_token is not null))
);
create index fiscal_recovery_due on fiscal_recovery.jobs(next_at) where state = 'pending';
create index fiscal_recovery_expired on fiscal_recovery.jobs(lease_until) where state = 'running';
create unique index fiscal_recovery_one_key on fiscal_recovery.jobs ((document->>'accessKey'));
create table fiscal_recovery.events (
  id bigint generated always as identity primary key,
  job_id uuid not null references fiscal_recovery.jobs(id),
  version bigint not null,
  event text not null,
  code text,
  origin text,
  created_at timestamptz not null default clock_timestamp()
);
alter table fiscal_recovery.scopes enable row level security;
alter table fiscal_recovery.jobs enable row level security;
alter table fiscal_recovery.events enable row level security;
revoke all on all tables in schema fiscal_recovery from public, anon, authenticated, service_role;
revoke all on all sequences in schema fiscal_recovery from public, anon, authenticated, service_role;

create function fiscal_recovery.notify_job() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin
  perform pg_notify('fiscal_recovery_v1', 'wake'); -- no identity, XML or secret
  return new;
end $$;
create trigger recovery_wake after insert or update of next_at, state on fiscal_recovery.jobs
for each row execute function fiscal_recovery.notify_job();
create trigger recovery_scope_wake after insert or update of enabled, pause_until on fiscal_recovery.scopes
for each row execute function fiscal_recovery.notify_job();

-- Database barrier: stale API/cache/upsert/admin writers cannot restore an owned
-- document, even after a job is terminal. Cancellation needs its own CAS adapter
-- before activation; the old cancellation writer is intentionally refused.
create function fiscal_recovery.guard_document() returns trigger
language plpgsql security definer set search_path = pg_catalog as $$
begin
  if exists(select 1 from fiscal_recovery.jobs where document_id = old.id) and
     current_setting('fiscal_recovery.writer', true) is distinct from 'recovery-v1' then
    raise exception 'RECOVERY_DOCUMENT_OWNED' using errcode = '55000';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger fiscal_recovery_document_barrier before update or delete on public.fiscal_documents
for each row execute function fiscal_recovery.guard_document();

-- Explicit admission only, after in-flight legacy transmitters have been drained
-- and the caller has validated signature/XSD. This is not a legacy backfill.
create function public.fiscal_recovery_admit_v1(p_scope uuid, p_document text, p_sha256 text)
returns uuid language plpgsql security definer set search_path = pg_catalog as $$
declare s fiscal_recovery.scopes; d public.fiscal_documents; j uuid;
begin
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'RECOVERY_INVALID_HASH'; end if;
  select * into strict s from fiscal_recovery.scopes where id = p_scope and enabled;
  -- Repeated admission never refreshes XML, identity, lease, status or next_at.
  select id into j from fiscal_recovery.jobs where document_id = p_document;
  if j is not null then
    if not exists(select 1 from fiscal_recovery.jobs where id=j and scope_id=p_scope
      and document->>'signedXmlSha256'=p_sha256) then raise exception 'RECOVERY_ADMISSION_CONFLICT'; end if;
    return j;
  end if;
  select * into strict d from public.fiscal_documents where id=p_document for update;
  -- A concurrent admission may have committed while we waited for the document
  -- lock. Recheck under that lock instead of failing a valid idempotent request.
  select id into j from fiscal_recovery.jobs where document_id = p_document;
  if j is not null then
    if not exists(select 1 from fiscal_recovery.jobs where id=j and scope_id=p_scope
      and document->>'signedXmlSha256'=p_sha256) then raise exception 'RECOVERY_ADMISSION_CONFLICT'; end if;
    return j;
  end if;
  if encode(sha256(convert_to(d.signed_xml,'UTF8')),'hex') is distinct from p_sha256 then
    raise exception 'RECOVERY_SIGNED_XML_HASH_MISMATCH';
  end if;
  if d.issuer_cnpj <> s.cnpj or d.environment <> s.environment or d.document_type <> s.model or
    d.serie <> s.series or d.status <> 'processamento' or d.signed_xml is null or
    not coalesce(d.signature_valid,false) or not coalesce(d.xsd_valid,false) or
    d.access_key !~ '^[0-9]{44}$' or d.access_key is null then raise exception 'RECOVERY_ADMISSION_INVALID'; end if;
  insert into fiscal_recovery.jobs(scope_id,document_id,document)
  values (s.id,d.id,jsonb_build_object('clientId',s.client_id,'organizationId',s.organization_id,
    'storeId',s.store_id,'cnpj',s.cnpj,'environment',s.environment,'model',s.model,'series',s.series,
    'documentId',d.id,'number',d.number,'accessKey',d.access_key,'signedXml',d.signed_xml,'signedXmlSha256',p_sha256))
  returning id into j;
  insert into fiscal_recovery.events(job_id,version,event) values(j,1,'admitted');
  return j;
end $$;

create function public.fiscal_recovery_claim_v1(p_worker text,p_scopes uuid[])
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare j fiscal_recovery.jobs; next_wake timestamptz; t timestamptz := clock_timestamp();
  times timestamptz[]; examined integer := 0;
begin
  if p_worker is null or length(p_worker) not between 1 and 128 then raise exception 'RECOVERY_WORKER_INVALID'; end if;
  if coalesce(cardinality(p_scopes),0)=0 then raise exception 'RECOVERY_SCOPES_REQUIRED'; end if;
  loop
    examined := examined+1;
    select q.* into j from fiscal_recovery.jobs q join fiscal_recovery.scopes s on s.id=q.scope_id
    where s.enabled and s.id=any(p_scopes) and coalesce(s.pause_until,t)<=t and
      ((q.state='pending' and q.next_at<=t) or (q.state='running' and q.lease_until<=t))
    order by coalesce(q.lease_until,q.next_at), q.id for update of q skip locked limit 1;
    exit when j.id is null;
    select coalesce(array_agg(x order by x),'{}') into times from unnest(j.query_times) x where x>t-interval '1 hour';
    exit when cardinality(times)<3;
    -- Reserve query budget in the same transaction as the lease. A crash spends
    -- the slot conservatively; it cannot manufacture permission to send.
    update fiscal_recovery.jobs set state='pending',next_at=times[1]+interval '1 hour',
      query_times=times,lease_token=null,lease_until=null,worker_id=null where id=j.id;
    if examined>=25 then j.id:=null; exit; end if;
  end loop;
  if j.id is null then
    select min(greatest(case when q.state='running' then q.lease_until else q.next_at end,coalesce(s.pause_until,t))) into next_wake
    from fiscal_recovery.jobs q join fiscal_recovery.scopes s on s.id=q.scope_id
    where s.enabled and s.id=any(p_scopes) and q.state in ('pending','running');
    return jsonb_build_object('lease',null,'nextWakeAt',ceil(extract(epoch from next_wake)*1000)::bigint);
  end if;
  update fiscal_recovery.jobs set state='running',lease_token=gen_random_uuid(),lease_until=t+interval '90 seconds',
    worker_id=p_worker,attempt=attempt+1,query_times=array_append(times,t),version=version+1,updated_at=t where id=j.id returning * into j;
  return jsonb_build_object('lease',jsonb_build_object('id',j.id,'token',j.lease_token,'version',j.version,
    'attempt',j.attempt,'document',j.document),'nextWakeAt',ceil(extract(epoch from j.lease_until)*1000)::bigint);
end $$;

create function public.fiscal_recovery_complete_v1(p_job uuid,p_token uuid,p_version bigint,p_decision jsonb,p_next_at timestamptz)
returns boolean language plpgsql security definer set search_path = pg_catalog as $$
declare j fiscal_recovery.jobs; t timestamptz := clock_timestamp(); outcome text := p_decision->>'state';
  previous_writer text := current_setting('fiscal_recovery.writer',true);
begin
  if p_job is null or p_token is null or p_version is null or p_version<1 then return false; end if;
  select * into j from fiscal_recovery.jobs where id=p_job for update;
  if j.id is null or j.state<>'running' or j.lease_token is distinct from p_token or
    j.version<>p_version or j.lease_until<=t then return false; end if;
  if outcome is null or outcome not in ('pending','authorized','manual_review') or
     length(coalesce(p_decision->>'code','')) not between 1 and 128 or
     (outcome='pending' and coalesce(p_decision->>'origin','') not in ('transport','sefaz')) or
     (outcome='manual_review' and p_decision->>'origin' is distinct from 'local') then raise exception 'RECOVERY_DECISION_INVALID'; end if;
  if outcome='pending' and (p_next_at is null or p_next_at<=t) then raise exception 'RECOVERY_NEXT_AT_INVALID'; end if;
  if outcome<>'pending' and p_next_at is not null then raise exception 'RECOVERY_TERMINAL_NEXT_AT'; end if;
  if outcome='pending' and p_decision->>'origin'='sefaz' and p_decision->>'code'='656' then
    update fiscal_recovery.scopes set pause_until=greatest(coalesce(pause_until,t),t+interval '1 hour')
    where cnpj=(select cnpj from fiscal_recovery.scopes where id=j.scope_id) and environment='producao';
  end if;
  if outcome='authorized' then
    if p_decision->>'origin' is distinct from 'sefaz' or p_decision->>'code' not in ('100','150') or
      coalesce(p_decision->>'protocol','') !~ '^[0-9]{15}$' or
      coalesce(p_decision->>'processedXml','')='' or coalesce(p_decision->>'evidenceXml','')='' then
      raise exception 'RECOVERY_AUTHORIZATION_INVALID';
    end if;
    perform set_config('fiscal_recovery.writer','recovery-v1',true);
    update public.fiscal_documents set status='autorizado',protocol=p_decision->>'protocol',
      authorized_xml=p_decision->>'processedXml',sefaz_response_xml=p_decision->>'evidenceXml',
      reason_code=p_decision->>'code',reason='Autorizacao recuperada por consulta SEFAZ',updated_at=t
    where id=j.document_id and status='processamento' and access_key=j.document->>'accessKey'
      and signed_xml=j.document->>'signedXml';
    if not found then raise exception 'RECOVERY_DOCUMENT_CONFLICT'; end if;
    -- Do not leave a transaction-local bypass enabled for a later legacy write
    -- in the caller's transaction. This setting is a writer fence, not a grant.
    perform set_config('fiscal_recovery.writer',coalesce(previous_writer,''),true);
  end if;
  update fiscal_recovery.jobs set state=outcome,decision=p_decision,
    next_at=coalesce(p_next_at,next_at),lease_token=null,lease_until=null,worker_id=null,version=version+1,updated_at=t
  where id=j.id;
  -- Lease bookkeeping is required on every query; an unchanged observation is
  -- not a new domain event and must not grow the fiscal event log indefinitely.
  if j.decision is null or j.decision->>'state' is distinct from outcome or
     j.decision->>'code' is distinct from p_decision->>'code' or
     j.decision->>'origin' is distinct from p_decision->>'origin' then
    insert into fiscal_recovery.events(job_id,version,event,code,origin)
      values(j.id,j.version+1,outcome,p_decision->>'code',p_decision->>'origin');
  end if;
  return true;
end $$;

revoke all on all functions in schema fiscal_recovery from public, anon, authenticated, service_role;
revoke all on function public.fiscal_recovery_admit_v1(uuid,text,text) from public, anon, authenticated;
revoke all on function public.fiscal_recovery_claim_v1(text,uuid[]) from public, anon, authenticated;
revoke all on function public.fiscal_recovery_complete_v1(uuid,uuid,bigint,jsonb,timestamptz) from public, anon, authenticated;
grant execute on function public.fiscal_recovery_admit_v1(uuid,text,text) to service_role;
grant execute on function public.fiscal_recovery_claim_v1(text,uuid[]) to service_role;
grant execute on function public.fiscal_recovery_complete_v1(uuid,uuid,bigint,jsonb,timestamptz) to service_role;
commit;
