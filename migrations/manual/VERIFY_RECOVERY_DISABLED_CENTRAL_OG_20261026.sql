-- Read-only verification. No bindings/scopes are created here.
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
