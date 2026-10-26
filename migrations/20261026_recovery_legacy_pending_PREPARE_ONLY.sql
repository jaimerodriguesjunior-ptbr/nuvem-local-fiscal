-- Explicit consultation-only enrollment. No historical send timestamp is invented.
begin;
alter table fiscal_recovery.requests drop constraint requests_provenance_check;
alter table fiscal_recovery.requests add constraint requests_provenance_check check
  (provenance in ('recovery-v1','legacy_authorized_consultation_v1','legacy_pending_consultation_v1'));
create function public.fiscal_recovery_legacy_pending_admit_v1(p_legacy text,p_scope uuid,p_client text,p_request uuid,
  p_origin text,p_source_sha256 text,p_proof jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare s fiscal_recovery.scopes;d public.fiscal_documents;l fiscal_recovery.legacy_links;
  r fiscal_recovery.requests;fresh jsonb;doc jsonb;phase text;code text;
begin
  if p_request is null or p_origin is null or length(p_origin) not between 1 and 200 or
    coalesce(p_source_sha256,'')!~'^[a-f0-9]{64}$' then raise exception 'RECOVERY_LEGACY_PENDING_INVALID';end if;
  select scopes.* into s from fiscal_recovery.scopes scopes
    join fiscal_recovery.og_scope_bindings b on b.scope_id=scopes.id and b.enabled
    where scopes.id=p_scope and scopes.enabled and scopes.client_id=p_client;
  if s.id is null then raise exception 'RECOVERY_LEGACY_SCOPE_INVALID';end if;
  perform pg_advisory_xact_lock(hashtextextended('recovery-legacy:'||p_legacy,0));
  perform pg_advisory_xact_lock(hashtextextended(p_scope::text||':'||p_origin,0));
  select * into l from fiscal_recovery.legacy_links where legacy_id=p_legacy;
  if l.legacy_id is not null then
    select * into strict r from fiscal_recovery.requests where request_id=l.request_id;
    if r.scope_id<>p_scope or r.request_id<>p_request or r.origin_id<>p_origin then raise exception 'RECOVERY_LEGACY_ASSOCIATION_CONFLICT';end if;
    return fiscal_recovery.request_json(r);
  end if;
  if exists(select 1 from fiscal_recovery.legacy_checks where legacy_id=p_legacy) then raise exception 'RECOVERY_LEGACY_ASSOCIATION_CONFLICT';end if;
  select * into strict d from public.fiscal_documents where id=p_legacy for update;
  fresh:=to_jsonb(d);
  if encode(sha256(convert_to(fresh::text,'UTF8')),'hex')<>p_source_sha256 or
    d.id like 'rv1_%' or d.issuer_cnpj<>s.cnpj or d.environment<>s.environment or d.document_type<>s.model or d.serie<>s.series or
    d.status not in ('erro','processamento','processando','rejeitado') or d.protocol is not null or
    coalesce(d.access_key,'')!~'^[0-9]{44}$' or coalesce(d.signed_xml,'')='' or
    coalesce(p_proof->>'signedXmlSha256','')<>encode(sha256(convert_to(d.signed_xml,'UTF8')),'hex') or
    d.cancellation_state is not null or d.cancellation_attempt_id is not null or d.cancelled_at is not null then
    raise exception 'RECOVERY_LEGACY_SOURCE_CHANGED';end if;
  phase:=p_proof->>'state';code:=p_proof->>'code';
  if phase is null or phase not in ('pending','authorized','rejected') or coalesce(length(code),0) not between 1 and 128 then
    raise exception 'RECOVERY_LEGACY_EVIDENCE_INVALID';end if;
  if phase in ('authorized','rejected') and (p_proof->>'origin' is distinct from 'sefaz' or
    p_proof->>'evidenceXml' is distinct from d.sefaz_response_xml) then raise exception 'RECOVERY_LEGACY_EVIDENCE_INVALID';end if;
  if phase='authorized' and (code not in ('100','150') or coalesce(p_proof->>'protocol','')!~'^[0-9]{15}$' or
    coalesce(p_proof->>'processedXml','')='') then raise exception 'RECOVERY_LEGACY_AUTHORIZATION_UNCONFIRMED';end if;
  if phase='rejected' and (code!~'^[2-9][0-9]{2}$' or code in ('204','217','301','302','303','539','656','999')) then
    raise exception 'RECOVERY_LEGACY_REJECTION_UNCONFIRMED';end if;
  doc:=jsonb_build_object('id','rv1_'||p_request::text,'providerLikeId','rv1_'||p_request::text,
    'tipoDocumento',s.model,'issuerCnpj',s.cnpj,'ambiente',s.environment,'numero',d.number,'serie',d.serie,
    'chave',d.access_key,'protocolo',case when phase='authorized' then p_proof->>'protocol' else null end,
    'status',case phase when 'authorized' then 'autorizado' when 'rejected' then 'rejeitado' else 'processamento' end,
    'xmlSigned',d.signed_xml,'xmlGenerated',d.generated_xml,'signatureValid',true,'xsdValid',d.xsd_valid,
    'xml',case when phase='authorized' then p_proof->>'processedXml' else '' end,
    'payloadOriginal',d.payload_original,'payloadNormalizado',d.payload_normalized,
    'motivoStatus',code,'motivo',coalesce(p_proof->>'reason',d.reason),'mensagens','[]'::jsonb,
    'sefazResponseXml',d.sefaz_response_xml,'createdAt',d.created_at,'updatedAt',d.updated_at,
    'pdfUrl','/'||case s.model when 'NFe' then 'nfe' else 'nfce' end||'/rv1_'||p_request::text||'/pdf');
  insert into fiscal_recovery.requests(request_id,scope_id,origin_id,request_hash,number,document,phase,origin,code,
    next_at,provenance) values(p_request,p_scope,p_origin,p_source_sha256,d.number,doc,phase,
    case when phase='pending' then 'central' else 'sefaz' end,code,
    case when phase='pending' then clock_timestamp() else null end,'legacy_pending_consultation_v1') returning * into r;
  insert into fiscal_recovery.legacy_links(legacy_id,request_id,source_sha256,source_snapshot,consultation_xml)
    values(d.id,r.request_id,p_source_sha256,fresh,coalesce(d.sefaz_response_xml,''));
  insert into fiscal_recovery.request_outbox(request_id,version) values(r.request_id,r.version);
  return fiscal_recovery.request_json(r);
end $$;
revoke all on function public.fiscal_recovery_legacy_pending_admit_v1(text,uuid,text,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.fiscal_recovery_legacy_pending_admit_v1(text,uuid,text,uuid,text,text,jsonb) to service_role;
commit;
