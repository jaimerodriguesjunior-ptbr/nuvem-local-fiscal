-- PREPARED ONLY. Apply after backup/schema review and user approval.
-- Adds one service-role-only read function; no data updates, scheduling or fiscal I/O.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '15s';

do $preflight$
begin
  if to_regprocedure('fiscal_recovery.request_json(fiscal_recovery.requests)') is null then
    raise exception 'ADMIN_MANAGED_SCHEMA_MISSING';
  end if;
end $preflight$;

create function public.fiscal_recovery_admin_documents_v1(
  p_after uuid default null,
  p_limit integer default 100,
  p_as_of timestamptz default statement_timestamp()
) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog as $$
declare result jsonb;
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 or p_as_of is null then
    raise exception 'ADMIN_MANAGED_PAGE_INVALID';
  end if;
  -- Administrative read intentionally includes historical/paused/disabled scopes.
  -- UUID keyset plus a fixed admission cutoff avoids skipping rows when new notes arrive.
  with page as materialized (
    select r.* from fiscal_recovery.requests r
    where (p_after is null or r.request_id > p_after) and r.created_at <= p_as_of
    order by r.request_id limit p_limit + 1
  ), visible as (
    select * from page order by request_id limit p_limit
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'record', (fiscal_recovery.request_json(r) - 'ownerToken' - 'requestHash') ||
        jsonb_build_object('document', r.document - 'nfceConfigEncrypted'),
      'legacyId', (select l.legacy_id from fiscal_recovery.legacy_links l where l.request_id = r.request_id),
      'receivedAt', r.created_at, 'updatedAt', r.updated_at
    ) order by r.request_id) from visible v
      join fiscal_recovery.requests r on r.request_id = v.request_id), '[]'::jsonb),
    'nextAfter', case when (select count(*) from page) > p_limit
      then (select request_id::text from visible order by request_id desc limit 1) else null end
  ) into result;
  return result;
end $$;

revoke all on function public.fiscal_recovery_admin_documents_v1(uuid,integer,timestamptz) from public,anon,authenticated;
grant execute on function public.fiscal_recovery_admin_documents_v1(uuid,integer,timestamptz) to service_role;
comment on function public.fiscal_recovery_admin_documents_v1(uuid,integer,timestamptz) is
  'Read-only administrative listing of managed fiscal documents. No transmission or recovery scheduling.';
-- Resolve the live row/function definitions before committing; an incompatibility rolls back the new function.
do $verify$ begin
  perform public.fiscal_recovery_admin_documents_v1(null,1,statement_timestamp());
end $verify$;
commit;
select 'ADMIN_MANAGED_READ_INSTALLED' as result;
