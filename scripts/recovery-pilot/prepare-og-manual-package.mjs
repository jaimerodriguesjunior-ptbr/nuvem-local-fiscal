// Generates SQL-editor files only. No environment, database or network access.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const central=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const og=path.resolve(process.argv[2]||path.join(central,'../preparacao-og'));
const sha=s=>createHash('sha256').update(s).digest('hex');
const sources=[];
function body(root,file){
 const raw=fs.readFileSync(path.join(root,file));sources.push({repository:root===og?'og':'central',file,sha256:sha(raw)});
 let sql=raw.toString('utf8').replace(/\r\n/g,'\n');
 if([...sql.matchAll(/^\s*begin;\s*$/gim)].length!==1||[...sql.matchAll(/^\s*commit;\s*$/gim)].length!==1)throw Error('TRANSACTION_SHAPE:'+file);
 return `\n-- Source: ${file}; SHA-256: ${sha(raw)}\n`+sql.replace(/^\s*begin;\s*$/im,'').replace(/^\s*commit;\s*$/im,'');
}
const rpcHashes={acquire_fiscal_attempt:'23f17388d6ca0bd443af0b0befff1129',apply_fiscal_webhook_event:'c8b6e6994061c830b454c21f77c48bab',
 associate_fiscal_provider:'e48b2bedbdd1fa9e652dde109e3651e5',create_standalone_nfe_draft:'febdbde5e0802358ed3cf0473afd08e3',
 fiscal_retry_payload:'87c575402bbcd68992b765caca707e18',luxottica_controls_version:'43823c9ec55449446b29a13becbbc006',
 nfce_recipient_editability:'f3154052a970a073345d7c6ab55c1442',prepare_fiscal_attempt:'d450a0296854d9fa2d95450e39e1a752',
 prepare_fiscal_submission:'b7e3788bf50c168a645fcbb9f3a0c14c',preview_fiscal_submission_number:'5f3f80f15dfcd5289ea83b9356c720ce',
 reserve_next_nfce_number:'c0dad81259795c0f1043a2c70996bb96',reserve_next_nfe_number:'8ead5c656fed6abc0eb8299e6be91cbe',
 reserve_nfce_parts_with_recipient:'4490f1ce9d8226ee2914f66eda40ce31',sync_fiscal_product_claims:'9afe0b397f544bb6e16b6190f08d6613',
 transition_fiscal_attempt:'4799db87d2c38f7830a9df83ff0c324e'};
const triggerHashes={block_delete_service_order_with_authorized_nfce:'32fbfea48d7da902960fdd3df0466e5d',
 guard_delegated_nfce_attempt:'3ab7b8bf0660dfe8ef0b403ff6e62630',guard_fiscal_invoice_identity_and_links:'deb2bee3640a9aa96633611dbf04198f',
 guard_fiscal_origin:'55e0a4733fd0f8c4477503c545d659f4',guard_fiscal_reserved_scope:'e397c7ac526f4e29713041f313fdcffa',
 guard_store_module_settings:'762fadbb645338272ddec7438586b615',guard_submission_module_enabled:'99114d5749d62ba845b4e4835137f4e0',
 protect_luxottica_ar:'17ba0a139f96e181aa86c494774a74ee'};
const expected={...rpcHashes,...triggerHashes};
const header=`-- MANUAL SQL EDITOR PACKAGE. One-time installation, initially disabled.
-- Read docs/APLICACAO_MANUAL_RECUPERACAO_OG_20261026.md first.
-- Paste this entire file in the indicated project, without splitting it.
-- No SQL here enables recovery, enrolls a note, sends HTTP or changes migration history.
begin;
set local lock_timeout='5s';
set local statement_timeout='90s';
set local check_function_bodies=on;
`;
const expectedSql=`create temporary table recovery_expected_functions(name text primary key,hash text,rpc boolean) on commit drop;
insert into recovery_expected_functions values
${Object.entries(expected).map(([n,h])=>`('${n}','${h}',${n in rpcHashes})`).join(',\n')};
do $preflight$
declare e record; f oid;
begin
 for e in select * from recovery_expected_functions loop
  select p.oid into f from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname=e.name and md5(pg_get_functiondef(p.oid))=e.hash;
  if f is null then raise exception 'OG_BASELINE_FUNCTION_MISMATCH: %',e.name;end if;
  if e.rpc and (has_function_privilege('anon',f,'execute') or has_function_privilege('authenticated',f,'execute')
    or not has_function_privilege('service_role',f,'execute')) then raise exception 'OG_BASELINE_RPC_ACCESS_MISMATCH: %',e.name;end if;
 end loop;
end $preflight$;
`;
const ogTables=['public.fiscal_invoices','public.fiscal_operation_attempts','public.nfce_sequences','public.nfe_sequences',
 'public.fiscal_os_product_claims','public.fiscal_os_emission_plans','public.fiscal_webhook_inbox','public.stores'];
const invoiceNew=['recovery_request_id','recovery_client_id','recovery_mode','recovery_server_version','recovery_canonical'];
const attemptNew=['recovery_state','recovery_due_at','recovery_lease','recovery_lease_until','recovery_queries','recovery_last_result','recovery_post_started_at'];
function snapshot(tables){return tables.map(table=>{
 const excluded=table==='public.fiscal_invoices'?invoiceNew:table==='public.fiscal_operation_attempts'?attemptNew:[];
 const expr=`(to_jsonb(t)-array[${excluded.map(x=>`'${x}'`).join(',')}]::text[])::text`;
 return `select '${table}'::text relation_name,count(*)::bigint row_count,coalesce(md5(string_agg(md5(${expr}),'' order by md5(${expr}))),md5('')) fingerprint from ${table} t`;
}).join('\nunion all\n');}
function before(tables){return `create temporary table recovery_before on commit drop as\n${snapshot(tables)};\n`;}
function preserved(tables){return `create temporary table recovery_after on commit drop as\n${snapshot(tables)};
do $preserved$ begin
 if exists((select * from recovery_before except select * from recovery_after)
   union all (select * from recovery_after except select * from recovery_before)) then
  raise exception 'RECOVERY_INSTALL_EXISTING_ROWS_CHANGED';
 end if;
end $preserved$;\n`;}
const ogBody=body(og,'supabase/migrations/20261026160000_prepare_fiscal_observation_recovery.sql')+
 body(og,'supabase/migrations/20261026170000_prepare_managed_fiscal_recovery.sql');
const ogPre=`do $project$ begin
 if to_regclass('public.service_orders') is null or to_regclass('public.fiscal_os_product_claims') is null then raise exception 'WRONG_PROJECT_EXPECTED_OG';end if;
 if to_regclass('public.og_recovery_settings') is not null or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname like 'og_recovery_%') then raise exception 'OG_RECOVERY_ALREADY_PRESENT_STOP';end if;
 if exists(select 1 from information_schema.columns where table_schema='public' and
   ((table_name='fiscal_invoices' and column_name like 'recovery_%') or (table_name='fiscal_operation_attempts' and column_name like 'recovery_%')))
   then raise exception 'OG_RECOVERY_PARTIAL_INSTALL_STOP';end if;
end $project$;
-- Brief fiscal pause required. Fail quickly if another transaction holds these tables.
lock table public.fiscal_invoices,public.fiscal_operation_attempts in access exclusive mode;
lock table ${ogTables.slice(2).join(',')} in share mode;
${expectedSql}`;
const ogPost=`do $disabled$ begin
 if (select count(*) from public.og_recovery_settings)<>1 or not exists(select 1 from public.og_recovery_settings where singleton and not enabled and not managed_enabled)
   then raise exception 'OG_RECOVERY_MUST_REMAIN_DISABLED';end if;
 if exists(select 1 from public.fiscal_invoices where recovery_request_id is not null or recovery_client_id is not null or recovery_mode is not null
   or recovery_server_version<>0 or recovery_canonical is not null) then raise exception 'OG_RECOVERY_UNEXPECTED_ENROLLMENT';end if;
 if exists(select 1 from public.fiscal_operation_attempts where recovery_state is not null or recovery_due_at is not null or recovery_lease is not null
   or recovery_lease_until is not null or recovery_queries<>0 or recovery_last_result is not null or recovery_post_started_at is not null)
   then raise exception 'OG_RECOVERY_UNEXPECTED_QUEUE';end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'og_recovery_%'
   and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute')))
   then raise exception 'OG_RECOVERY_PUBLIC_RPC_ACCESS';end if;
 if exists(select 1 from recovery_expected_functions e where not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname=e.name and md5(pg_get_functiondef(p.oid))=e.hash)) then raise exception 'OG_BASELINE_FUNCTION_CHANGED';end if;
end $disabled$;
commit;
select 'OG_RECOVERY_DISABLED_INSTALLED' as result,enabled,managed_enabled from public.og_recovery_settings where singleton;
`;
const ogSql=header+ogPre+before(ogTables)+ogBody+preserved(ogTables)+ogPost;
const centralTables=['public.fiscal_documents','fiscal_recovery.scopes','fiscal_recovery.requests','fiscal_recovery.jobs','fiscal_recovery.events',
 'fiscal_recovery.request_outbox','fiscal_recovery.cancellation_intents','fiscal_recovery.legacy_links','fiscal_recovery.legacy_checks'];
const centralBody=body(central,'migrations/20261026_recovery_og_scopes_PREPARE_ONLY.sql')+
 body(central,'migrations/20261026_recovery_legacy_pending_PREPARE_ONLY.sql');
const centralPre=`do $project$
declare t text; baseline_constraint text;
begin
 foreach t in array array[${centralTables.map(t=>`'${t}'`).join(',')}] loop
  if to_regclass(t) is null then raise exception 'CENTRAL_RECOVERY_BASELINE_MISSING: %',t;end if;
 end loop;
 if to_regclass('fiscal_recovery.og_scope_bindings') is not null or
   to_regprocedure('public.fiscal_recovery_legacy_pending_admit_v1(text,uuid,text,uuid,text,text,jsonb)') is not null then
  raise exception 'CENTRAL_OG_ALREADY_PRESENT_STOP';end if;
 if to_regprocedure('public.fiscal_recovery_scopes_v1(uuid[])') is null or
   to_regprocedure('fiscal_recovery.request_json(fiscal_recovery.requests)') is null then raise exception 'CENTRAL_RECOVERY_RPC_MISSING';end if;
 select pg_get_constraintdef(oid) into baseline_constraint from pg_constraint where conrelid='fiscal_recovery.requests'::regclass
   and conname='requests_provenance_check' and contype='c' and convalidated;
 if baseline_constraint is null or position('legacy_authorized_consultation_v1' in baseline_constraint)=0 or
   position('legacy_pending_consultation_v1' in baseline_constraint)>0 then raise exception 'CENTRAL_PROVENANCE_BASELINE_MISMATCH';end if;
end $project$;
-- Stop fiscal traffic/workers in the agreed window before applying this file.
lock table fiscal_recovery.requests in access exclusive mode;
lock table ${centralTables.filter(t=>t!=='fiscal_recovery.requests').join(',')} in share mode;
do $idle$ begin
 if exists(select 1 from fiscal_recovery.requests where owner_until>clock_timestamp() or claim_until>clock_timestamp()) or
   exists(select 1 from fiscal_recovery.legacy_checks where owner_until>clock_timestamp()) then
  raise exception 'CENTRAL_RECOVERY_ACTIVE_LEASE_WAIT';end if;
end $idle$;
`;
const centralPost=`do $disabled$ begin
 if exists(select 1 from fiscal_recovery.og_scope_bindings) then raise exception 'CENTRAL_OG_UNEXPECTED_BINDING';end if;
 if has_function_privilege('anon','public.fiscal_recovery_og_scopes_v1(uuid[],text)','execute') or
   has_function_privilege('authenticated','public.fiscal_recovery_og_scopes_v1(uuid[],text)','execute') or
   has_function_privilege('anon','public.fiscal_recovery_legacy_pending_admit_v1(text,uuid,text,uuid,text,text,jsonb)','execute') or
   has_function_privilege('authenticated','public.fiscal_recovery_legacy_pending_admit_v1(text,uuid,text,uuid,text,text,jsonb)','execute') then
  raise exception 'CENTRAL_OG_PUBLIC_RPC_ACCESS';end if;
end $disabled$;
commit;
select 'CENTRAL_OG_DISABLED_INSTALLED' as result,count(*) as bindings from fiscal_recovery.og_scope_bindings;
`;
const centralSql=header+centralPre+before(centralTables)+centralBody+preserved(centralTables)+centralPost;
const verifyOg=`-- Read-only verification. Run after installing, before any activation.
begin transaction read only;
set local statement_timeout='15s';
select jsonb_build_object('schema','og-recovery-installation-v1','enabled',s.enabled,'managed_enabled',s.managed_enabled,
 'owned_documents',(select count(*) from public.fiscal_invoices where recovery_request_id is not null),
 'queued_attempts',(select count(*) from public.fiscal_operation_attempts where recovery_state is not null),
 'new_rpc_public_execute',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname like 'og_recovery_%' and
     (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute'))),
 'new_triggers_enabled',(select count(*) from pg_trigger t where not t.tgisinternal and t.tgenabled='O'
   and t.tgname in ('og_recovery_schedule','og_recovery_managed_barrier'))) as recovery_installation
from public.og_recovery_settings s where singleton;
commit;
`;
const verifyCentral=`-- Read-only verification. No bindings/scopes are created here.
begin transaction read only;
set local statement_timeout='15s';
select jsonb_build_object('schema','central-og-recovery-installation-v1',
 'bindings',(select count(*) from fiscal_recovery.og_scope_bindings),
 'enabled_bindings',(select count(*) from fiscal_recovery.og_scope_bindings where enabled),
 'legacy_pending_requests',(select count(*) from fiscal_recovery.requests where provenance='legacy_pending_consultation_v1'),
 'new_rpc_public_execute',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
   and p.proname in ('fiscal_recovery_og_scopes_v1','fiscal_recovery_legacy_pending_admit_v1') and
     (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute'))),
 'service_rpc_count',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
   and p.proname in ('fiscal_recovery_og_scopes_v1','fiscal_recovery_legacy_pending_admit_v1') and has_function_privilege('service_role',p.oid,'execute')),
 'binding_rls',(select relrowsecurity from pg_class where oid='fiscal_recovery.og_scope_bindings'::regclass)) as recovery_installation;
commit;
`;
const outputs=[{root:og,file:'supabase/manual/INSTALL_RECOVERY_DISABLED_OG_20261026.sql',sql:ogSql},
 {root:central,file:'migrations/manual/INSTALL_RECOVERY_DISABLED_CENTRAL_OG_20261026.sql',sql:centralSql},
 {root:og,file:'supabase/manual/VERIFY_RECOVERY_DISABLED_OG_20261026.sql',sql:verifyOg},
 {root:central,file:'migrations/manual/VERIFY_RECOVERY_DISABLED_CENTRAL_OG_20261026.sql',sql:verifyCentral}];
for(const o of outputs){fs.mkdirSync(path.dirname(path.join(o.root,o.file)),{recursive:true});fs.writeFileSync(path.join(o.root,o.file),o.sql);}
const manifest={format:1,generatedBy:'scripts/recovery-pilot/prepare-og-manual-package.mjs',sources,
 outputs:outputs.map(o=>({repository:o.root===og?'og':'central',file:o.file,sha256:sha(Buffer.from(o.sql)),bytes:Buffer.byteLength(o.sql)}))};
fs.writeFileSync(path.join(og,'docs/RECOVERY_MANUAL_PACKAGE_20261026.json'),JSON.stringify(manifest,null,2)+'\n');
fs.writeFileSync(path.join(central,'docs/RECOVERY_MANUAL_PACKAGE_20261026.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify(manifest));
