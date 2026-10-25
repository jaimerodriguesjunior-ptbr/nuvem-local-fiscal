-- PREPARE ONLY. Explicit association of authorized historical documents.
-- Not an enrollment into first-submit recovery, and not a backfilled send log.
-- Runtime/consumer wiring and snapshot-writer compatibility remain required.
begin;
alter table fiscal_recovery.requests add column provenance text not null default 'recovery-v1'
  check(provenance in ('recovery-v1','legacy_authorized_consultation_v1'));
create table fiscal_recovery.legacy_links (
  legacy_id text primary key references public.fiscal_documents(id),
  request_id uuid not null unique references fiscal_recovery.requests(request_id),
  source_sha256 text not null check(source_sha256 ~ '^[a-f0-9]{64}$'),
  source_snapshot jsonb not null,
  consultation_xml text not null,
  associated_at timestamptz not null default clock_timestamp()
);
alter table fiscal_recovery.legacy_links enable row level security;
revoke all on fiscal_recovery.legacy_links from public,anon,authenticated,service_role;

create or replace function fiscal_recovery.request_json(r fiscal_recovery.requests) returns jsonb
language sql stable set search_path=pg_catalog as $$
  select jsonb_build_object('requestId',r.request_id,'originId',r.origin_id,'requestHash',r.request_hash,
    'version',r.version,'phase',r.phase,'document',r.document,'errorOrigin',r.origin,'code',r.code,
    'sendStartedAt',r.send_started_at,'ownerToken',r.owner_token,'provenance',r.provenance,'scope',jsonb_build_object(
      'id',s.id,'clientId',s.client_id,'organizationId',s.organization_id,'storeId',s.store_id,
      'cnpj',s.cnpj,'environment',s.environment,'model',s.model,'series',s.series))
  from fiscal_recovery.scopes s where s.id=r.scope_id
$$;

create function public.fiscal_recovery_legacy_source_v1(p_legacy text,p_scope uuid,p_client text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare d public.fiscal_documents;s fiscal_recovery.scopes;
begin
  select * into s from fiscal_recovery.scopes where id=p_scope and enabled and client_id=p_client;
  if s.id is null then raise exception 'RECOVERY_LEGACY_SCOPE_INVALID';end if;
  select * into d from public.fiscal_documents where id=p_legacy;
  if d.id is null or d.issuer_cnpj<>s.cnpj or d.environment<>s.environment or d.document_type<>s.model or d.serie<>s.series then
    raise exception 'RECOVERY_LEGACY_SCOPE_INVALID';end if;
  return jsonb_build_object('source',to_jsonb(d),'sourceSha256',encode(sha256(convert_to(to_jsonb(d)::text,'UTF8')),'hex'));
end $$;

create function public.fiscal_recovery_legacy_associate_v1(p_legacy text,p_scope uuid,p_client text,p_request uuid,
  p_origin text,p_source_sha256 text,p_proof jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare d public.fiscal_documents;s fiscal_recovery.scopes;r fiscal_recovery.requests;l fiscal_recovery.legacy_links;
  snapshot jsonb;doc jsonb;fingerprint text;
begin
  if p_request is null or p_legacy is null or p_legacy like 'rv1_%' or p_origin is null or
    length(p_origin) not between 1 and 200 or coalesce(p_source_sha256,'') !~ '^[a-f0-9]{64}$' then
    raise exception 'RECOVERY_LEGACY_ASSOCIATION_INVALID';end if;
  select * into s from fiscal_recovery.scopes where id=p_scope and enabled and client_id=p_client;
  if s.id is null then raise exception 'RECOVERY_LEGACY_SCOPE_INVALID';end if;
  perform pg_advisory_xact_lock(hashtextextended('recovery-legacy:'||p_legacy,0));
  perform pg_advisory_xact_lock(hashtextextended(p_scope::text||':'||p_origin,0));
  select * into l from fiscal_recovery.legacy_links where legacy_id=p_legacy;
  if l.legacy_id is not null then
    select * into strict r from fiscal_recovery.requests where request_id=l.request_id;
    if r.scope_id<>p_scope or r.origin_id<>p_origin or r.request_id<>p_request then
      raise exception 'RECOVERY_LEGACY_ASSOCIATION_CONFLICT';end if;
    return fiscal_recovery.request_json(r);
  end if;
  select * into d from public.fiscal_documents where id=p_legacy for update;
  if d.id is null or d.issuer_cnpj<>s.cnpj or d.environment<>s.environment or d.document_type<>s.model or d.serie<>s.series then
    raise exception 'RECOVERY_LEGACY_SCOPE_INVALID';end if;
  snapshot:=to_jsonb(d);fingerprint:=encode(sha256(convert_to(snapshot::text,'UTF8')),'hex');
  if fingerprint<>p_source_sha256 then raise exception 'RECOVERY_LEGACY_SOURCE_CHANGED';end if;
  if d.status<>'autorizado' or coalesce(d.access_key,'') !~ '^[0-9]{44}$' or
    coalesce(d.protocol,'') !~ '^[0-9]{15}$' or coalesce(d.signed_xml,'')='' or
    d.cancellation_state is not null or d.cancellation_attempt_id is not null or
    coalesce(d.cancellation_request_xml,'')<>'' or coalesce(d.cancellation_signed_xml,'')<>'' or
    coalesce(d.cancellation_response_xml,'')<>'' or coalesce(d.cancellation_processed_xml,'')<>'' or d.cancelled_at is not null then
    raise exception 'RECOVERY_LEGACY_ADOPTION_INELIGIBLE';end if;
  -- Application service must cryptographically validate these frozen bytes and
  -- the authenticated, fresh consultation before calling this service-only RPC.
  if p_proof->>'adoptionMethod' is distinct from 'legacy_authorized_consultation_v1' or
    p_proof->>'legacyId' is distinct from d.id or p_proof->>'scopeId' is distinct from s.id::text or
    p_proof->>'signedXmlSha256' is distinct from encode(sha256(convert_to(d.signed_xml,'UTF8')),'hex') or
    p_proof->>'authorizationProtocol' is distinct from d.protocol or
    coalesce(p_proof->>'authorizationCode','') not in ('100','150') or
    coalesce(p_proof->>'processedXml','')='' or coalesce(p_proof->>'evidenceXml','')='' then
    raise exception 'RECOVERY_LEGACY_PROOF_INVALID';end if;
  doc:=jsonb_build_object('id','rv1_'||p_request::text,'providerLikeId','rv1_'||p_request::text,
    'tipoDocumento',d.document_type,'issuerCnpj',d.issuer_cnpj,'ambiente',d.environment,'status','autorizado',
    'numero',d.number,'serie',d.serie,'chave',d.access_key,'protocolo',d.protocol,'motivo',d.reason,
    'motivoStatus',p_proof->>'authorizationCode','mensagens',d.messages,'payloadOriginal',d.payload_original,
    'payloadNormalizado',d.payload_normalized,'xml',p_proof->>'processedXml','xmlGenerated',d.generated_xml,
    'xmlSigned',d.signed_xml,'signatureValid',d.signature_valid,'xsdValid',d.xsd_valid,'xsdErrors',d.xsd_errors,
    'certificateId',d.certificate_id,'nfceConfigEncrypted',d.nfce_config_encrypted,
    'sefazBatchId',d.sefaz_batch_id,'sefazReceipt',d.sefaz_receipt,'sefazResponseXml',p_proof->>'evidenceXml',
    'pdfUrl','/'||case when s.model='NFe' then 'nfe' else 'nfce' end||'/rv1_'||p_request::text||'/pdf',
    'createdAt',d.created_at,'updatedAt',d.updated_at);
  insert into fiscal_recovery.requests(request_id,scope_id,origin_id,request_hash,number,document,phase,origin,code,provenance)
    values(p_request,p_scope,p_origin,fingerprint,d.number,doc,'authorized','sefaz',p_proof->>'authorizationCode','legacy_authorized_consultation_v1') returning * into r;
  -- send_started_at stays NULL. The association time is not an old send time.
  insert into fiscal_recovery.legacy_links(legacy_id,request_id,source_sha256,source_snapshot,consultation_xml)
    values(d.id,p_request,fingerprint,snapshot,p_proof->>'evidenceXml');
  insert into fiscal_recovery.request_outbox(request_id,version) values(p_request,r.version);
  return fiscal_recovery.request_json(r);
end $$;

create function fiscal_recovery.guard_legacy_association() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
  if exists(select 1 from fiscal_recovery.legacy_links where legacy_id=old.id) then
    raise exception 'RECOVERY_LEGACY_DOCUMENT_OWNED' using errcode='55000';end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger fiscal_recovery_legacy_barrier before update or delete on public.fiscal_documents
  for each row execute function fiscal_recovery.guard_legacy_association();
revoke all on function fiscal_recovery.guard_legacy_association() from public,anon,authenticated,service_role;
revoke all on function public.fiscal_recovery_legacy_source_v1(text,uuid,text) from public,anon,authenticated;
revoke all on function public.fiscal_recovery_legacy_associate_v1(text,uuid,text,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.fiscal_recovery_legacy_source_v1(text,uuid,text) to service_role;
grant execute on function public.fiscal_recovery_legacy_associate_v1(text,uuid,text,uuid,text,text,jsonb) to service_role;

create function public.fiscal_recovery_legacy_lookup_v1(p_legacy text,p_scopes uuid[]) returns jsonb
language sql security definer set search_path=pg_catalog as $$
  select fiscal_recovery.request_json(r) from fiscal_recovery.legacy_links l
    join fiscal_recovery.requests r using(request_id) where l.legacy_id=p_legacy and r.scope_id=any(p_scopes)
$$;
create function public.fiscal_recovery_legacy_owned_v1(p_ids text[]) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
begin
  if coalesce(cardinality(p_ids),0)>250 then raise exception 'RECOVERY_LEGACY_BATCH_INVALID';end if;
  return (select coalesce(jsonb_agg(legacy_id),'[]'::jsonb) from fiscal_recovery.legacy_links where legacy_id=any(p_ids));
end $$;
revoke all on function public.fiscal_recovery_legacy_lookup_v1(text,uuid[]) from public,anon,authenticated;
revoke all on function public.fiscal_recovery_legacy_owned_v1(text[]) from public,anon,authenticated;
grant execute on function public.fiscal_recovery_legacy_lookup_v1(text,uuid[]) to service_role;
grant execute on function public.fiscal_recovery_legacy_owned_v1(text[]) to service_role;
commit;
