-- Prepared only. Apply to the Nuvem Local Fiscal database, not the ERP database.
begin;

alter table public.fiscal_api_clients drop constraint fiscal_api_clients_allowed_scopes_check;
alter table public.fiscal_api_clients add constraint fiscal_api_clients_allowed_scopes_check
  check (allowed_scopes <@ array['empresa','empresa-cadastro','nfe','nfce','nfse','distribuicao-nfe']::text[]);

-- Additive access does not invalidate tokens whose signed CNPJ lists stay unchanged.
-- Any other administrative modification continues to rotate the client version.
create or replace function public.fiscal_api_client_version_v2() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if (to_jsonb(new) - 'allowed_cnpjs') = (to_jsonb(old) - 'allowed_cnpjs')
    and old.allowed_cnpjs <@ new.allowed_cnpjs
    and cardinality(new.allowed_cnpjs) > cardinality(old.allowed_cnpjs) then
    new.updated_at := old.updated_at;
  else
    new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 millisecond');
  end if;
  return new;
end;
$$;
drop trigger fiscal_api_clients_set_updated_at on public.fiscal_api_clients;
create trigger fiscal_api_clients_set_updated_at before update on public.fiscal_api_clients
  for each row execute function public.fiscal_api_client_version_v2();

create table public.fiscal_company_enrollments (
  client_id text not null references public.fiscal_api_clients(client_id),
  request_id uuid not null,
  company_id uuid not null references public.fiscal_companies(id),
  cnpj varchar(14) not null,
  external_company_id text not null,
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  certificate_fingerprint text not null check (certificate_fingerprint ~ '^[0-9a-f]{64}$'),
  environments text[] not null,
  created_at timestamptz not null default now(),
  primary key (client_id, request_id),
  unique (cnpj)
);
alter table public.fiscal_company_enrollments enable row level security;
revoke all on public.fiscal_company_enrollments from public, anon, authenticated;
grant select on public.fiscal_company_enrollments to service_role;

create function public.enroll_fiscal_company_v1(
  p_client_id text, p_client_version timestamptz, p_request_id uuid, p_input jsonb default null
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  cl public.fiscal_api_clients%rowtype;
  co public.fiscal_companies%rowtype;
  en public.fiscal_company_enrollments%rowtype;
  ce public.fiscal_certificates%rowtype;
  company jsonb; cert jsonb; envs text[]; cnpj_value text; env text;
begin
  select * into cl from public.fiscal_api_clients where client_id = p_client_id for update;
  if not found or not cl.active or p_client_version is null or cl.updated_at <> p_client_version
    or not (array['empresa','empresa-cadastro']::text[] <@ cl.allowed_scopes) then
    raise exception using errcode='P0001', message='enrollment_not_allowed';
  end if;
  select * into en from public.fiscal_company_enrollments
    where client_id = p_client_id and request_id = p_request_id;
  if found then
    if not (en.cnpj = any(cl.allowed_cnpjs) or '*' = any(cl.allowed_cnpjs))
      or not en.environments <@ cl.allowed_environments then
      raise exception using errcode='P0001', message='enrollment_not_allowed';
    end if;
    if p_input is not null and (p_input->>'fingerprint' is distinct from en.fingerprint
      or p_input->>'externalCompanyId' is distinct from en.external_company_id
      or p_input#>>'{company,cnpj}' is distinct from en.cnpj) then
      raise exception using errcode='P0001', message='enrollment_request_conflict';
    end if;
    select * into co from public.fiscal_companies where id = en.company_id;
  elsif p_input is null then
    return null;
  else
    company := p_input->'company'; cert := p_input->'certificate'; cnpj_value := company->>'cnpj';
    select array_agg(value order by value) into envs from jsonb_array_elements_text(p_input->'environments');
    if cnpj_value is null or cnpj_value !~ '^[0-9]{14}$' or cnpj_value ~ '^([0-9])\1{13}$'
      or nullif(btrim(company->>'razao_social'),'') is null
      or company->>'codigo_municipio_ibge' !~ '^[0-9]{7}$'
      or company->>'uf' !~ '^[A-Z]{2}$'
      or coalesce(cardinality(envs),0) = 0 or not envs <@ cl.allowed_environments
      or not envs <@ array['homologacao','producao']::text[]
      or coalesce(p_input->>'fingerprint','') !~ '^[0-9a-f]{64}$'
      or coalesce(cert->>'fingerprint','') !~ '^[0-9a-f]{64}$'
      or nullif(p_input->>'externalCompanyId','') is null
      or cert->>'holderCnpj' is distinct from cnpj_value
      or nullif(cert->>'encryptedBundle','') is null
      or (cert->>'validFrom')::timestamptz > now() or (cert->>'validUntil')::timestamptz <= now()
      or cert->>'validFrom' is null or cert->>'validUntil' is null then
      raise exception using errcode='P0001', message='invalid_enrollment';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('company-enrollment:' || cnpj_value, 0));
    -- Never overwrite a preexisting company's shared certificate/settings, even if allowed.
    if exists(select 1 from public.fiscal_companies where cnpj = cnpj_value) then
      raise exception using errcode='P0001', message='company_already_exists';
    end if;
    insert into public.fiscal_companies(cnpj,razao_social,nome_fantasia,metadata)
      values(cnpj_value,company->>'razao_social',coalesce(nullif(company->>'nome_fantasia',''),company->>'razao_social'),
        jsonb_build_object('registeredByIntegration',p_client_id,'externalCompanyId',p_input->>'externalCompanyId',
          'enrollmentRequestId',p_request_id,'certificateFingerprint',cert->>'fingerprint',
          'lastCertificateUploadIntegration',p_client_id,'lastCertificateUploadAt',now(),
          'email',company->>'email_contato','inscricao_municipal',company->>'inscricao_municipal',
          'endereco',jsonb_build_object('logradouro',company->>'logradouro','numero',company->>'numero',
            'complemento',company->>'complemento','bairro',company->>'bairro','cidade',company->>'cidade',
            'uf',company->>'uf','cep',company->>'cep','codigo_municipio',company->>'codigo_municipio_ibge')))
      returning * into co;
    foreach env in array envs loop
      insert into public.fiscal_company_environments(company_id,environment,uf,ie,crt)
        values(co.id,env,company->>'uf',coalesce(company->>'inscricao_estadual',''),company->>'regime_tributario');
    end loop;
    insert into public.fiscal_certificates(company_id,cnpj,file_name,valid_from,valid_until,serial_number,subject,holder_cnpj,encrypted_bundle)
      values(co.id,cnpj_value,cert->>'fileName',(cert->>'validFrom')::timestamptz,(cert->>'validUntil')::timestamptz,
        cert->>'serialNumber',cert->>'subject',cnpj_value,cert->>'encryptedBundle');
    if not (cnpj_value = any(cl.allowed_cnpjs) or '*' = any(cl.allowed_cnpjs)) then
      update public.fiscal_api_clients set allowed_cnpjs = array_append(allowed_cnpjs,cnpj_value)
        where id = cl.id returning * into cl;
    end if;
    insert into public.fiscal_company_enrollments(client_id,request_id,company_id,cnpj,external_company_id,fingerprint,certificate_fingerprint,environments)
      values(p_client_id,p_request_id,co.id,cnpj_value,p_input->>'externalCompanyId',p_input->>'fingerprint',cert->>'fingerprint',envs)
      returning * into en;
  end if;
  select * into ce from public.fiscal_certificates where company_id = co.id and active;
  if not found then raise exception using errcode='P0001', message='enrollment_certificate_unavailable'; end if;
  return jsonb_build_object(
    'receipt',jsonb_build_object('success',true,'request_id',en.request_id,'cnpj',en.cnpj,'ambientes',en.environments,'fingerprint',en.fingerprint),
    'client',jsonb_build_object('id',cl.id,'name',cl.name,'clientId',cl.client_id,'clientSecretHash',cl.client_secret_hash,
      'allowedScopes',cl.allowed_scopes,'allowedEnvironments',cl.allowed_environments,'allowedCnpjs',cl.allowed_cnpjs,
      'active',cl.active,'createdAt',cl.created_at,'updatedAt',cl.updated_at),
    'issuers',(select jsonb_agg(jsonb_build_object('id',e.id,'cnpj',co.cnpj,'razaoSocial',co.razao_social,
      'nomeFantasia',co.nome_fantasia,'ambiente',e.environment,'uf',e.uf,'ie',e.ie,'crt',e.crt,
      'serieNfe',e.serie_nfe,'serieNfce',e.serie_nfce,'ativo',e.active and co.active,'metadata',co.metadata))
      from public.fiscal_company_environments e where e.company_id=co.id),
    'certificate',jsonb_build_object('id',ce.id,'issuerId',(select id from public.fiscal_company_environments where company_id=co.id limit 1),
      'cnpj',co.cnpj,'fileName',ce.file_name,'uploadedAt',ce.uploaded_at,'validFrom',ce.valid_from,'validUntil',ce.valid_until,
      'serialNumber',ce.serial_number,'subject',ce.subject,'holderCnpj',ce.holder_cnpj,'encryptedBundle',ce.encrypted_bundle,'active',ce.active)
  );
end;
$$;
revoke all on function public.enroll_fiscal_company_v1(text,timestamptz,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.enroll_fiscal_company_v1(text,timestamptz,uuid,jsonb) to service_role;
commit;
