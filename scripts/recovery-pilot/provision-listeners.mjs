/** Provision bounded notification logins, never copy admin DB credentials to
 * the runtime. Explicit --mode create only. No fiscal RPC/DML or role membership
 * grant is available. Private credentials/config never enter stdout/argv. */
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {randomBytes} from 'node:crypto';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import pg from 'pg';
const require=createRequire(import.meta.url),{recoveryListenUrl,recoveryListenerUrl}=require('../../dist/lib/recovery/listen-url.js'),
  {recoveryDatabaseTls}=require('../../dist/lib/recovery/database-tls.js');
const args=new Map();for(let i=2;i<process.argv.length;i+=2)args.set(process.argv[i],process.argv[i+1]);
const role='fiscal_recovery_listener';let stage='configuration';
try{
  const mode=args.get('--mode')??'check';if(!['create','check'].includes(mode))throw Error('INVALID_MODE');
  const central=parseEnv(await readFile(args.get('--central-env'),'utf8')),gop=parseEnv(await readFile(args.get('--gop-env'),'utf8'));
  const directory=args.get('--output-dir');await mkdir(directory,{recursive:true});const file=join(directory,'listener-logins.private.json');
  let saved={},hadFile=true;try{saved=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;hadFile=false;}
  if(!hadFile&&mode!=='create')throw Error('LISTENER_CONFIG_REQUIRED');
  const report={date:new Date().toISOString(),mode,projects:[],fiscalWrites:false,flagsActivated:false};
  for(const [project,env,key,projectRef] of [['central',central,'RECOVERY_V1_DATABASE_URL','kfebaoocbgmcvveumlem'],['gop',gop,'SUPABASE_DB_URL','thmglufejrivyhabfqfb']]){
    stage=project+'_catalog';const base=env.SUPABASE_URL||env.NEXT_PUBLIC_SUPABASE_URL;
    if(new URL(base).hostname!==projectRef+'.supabase.co')throw Error('WRONG_PROJECT');
    const administrative=recoveryListenUrl(env[key],base),ssl=recoveryDatabaseTls(central.RECOVERY_V1_DATABASE_CA_FILE);
    const admin=new pg.Client({connectionString:administrative,ssl,connectionTimeoutMillis:10000});
    let listener;
    try{
      await admin.connect();let existing=(await admin.query('select rolname from pg_roles where rolname=$1',[role])).rowCount===1;
      if(existing&&!saved[project])throw Error('UNKNOWN_EXISTING_LISTENER_ROLE');
      if(!saved[project]){
        const password=randomBytes(32).toString('hex'),url=new URL(administrative);
        url.username=url.hostname===`db.${projectRef}.supabase.co`?role:role+'.'+projectRef;url.password=password;
        saved[project]={password,connectionString:recoveryListenerUrl(url.toString(),base)};
        await writeFile(file,JSON.stringify(saved,null,2));
      }
      const entry=saved[project];if(!/^[a-f0-9]{64}$/.test(entry.password)||!entry.connectionString)throw Error('PRIVATE_CONFIG_INVALID');
      const connectionString=recoveryListenerUrl(entry.connectionString,base);
      if(!existing){
        if(mode!=='create')throw Error('LISTENER_ROLE_MISSING');stage=project+'_create';
        await admin.query('begin');
        try{
          await admin.query(`create role fiscal_recovery_listener login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls
            connection limit 5 password '${entry.password}'`);
          await admin.query('grant connect on database postgres to fiscal_recovery_listener');
          await admin.query("alter role fiscal_recovery_listener set default_transaction_read_only='on'");
          await admin.query("alter role fiscal_recovery_listener set statement_timeout='15s'");
          await admin.query("alter role fiscal_recovery_listener set idle_in_transaction_session_timeout='30s'");
          await admin.query("alter role fiscal_recovery_listener set search_path='pg_catalog'");
          await admin.query('commit');existing=true;
        }catch(e){await admin.query('rollback');throw e;}
      }
      stage=project+'_privileges';
      const attrs=(await admin.query(`select rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolinherit,
        (select count(*)::int from pg_auth_members where member=r.oid) as memberships from pg_roles r where rolname=$1`,[role])).rows[0];
      if(!attrs?.rolcanlogin||attrs.rolsuper||attrs.rolcreatedb||attrs.rolcreaterole||attrs.rolreplication||attrs.rolbypassrls||attrs.rolinherit||attrs.memberships!==0)
        throw Error('LISTENER_PRIVILEGE_MISMATCH');
      const tables=project==='central'?['public.fiscal_documents','fiscal_recovery.requests','fiscal_recovery.legacy_checks']:
        ['public.fiscal_invoices','fiscal_recovery_gop.attempts','fiscal_recovery_gop.cancellations'];
      for(const table of tables){
        const p=(await admin.query("select has_table_privilege($1,$2,'select,insert,update,delete') as allowed",[role,table])).rows[0];
        if(p.allowed)throw Error('LISTENER_TABLE_GRANT_FOUND');
      }
      stage=project+'_login';listener=new pg.Client({connectionString,ssl,connectionTimeoutMillis:10000,application_name:'recovery-listener-verification'});
      await listener.connect();await listener.query('LISTEN fiscal_recovery_v1');
      const table=project==='central'?'public.fiscal_documents':'public.fiscal_invoices';
      await listener.query('begin read write');let denied=false;
      try{await listener.query(`select 1 from ${table} limit 0`);}catch(e){denied=e.code==='42501';}
      await listener.query('rollback');if(!denied)throw Error('LISTENER_TABLE_ACCESS_NOT_DENIED');
      report.projects.push({project,loginVerified:true,tlsVerified:true,listenAccepted:true,tableAccessDenied:true,
        roleMemberships:0,administrativePrivileges:false,defaultReadOnly:true});
    }finally{await listener?.end();await admin.end();}
  }
  const config={RECOVERY_V1_ENABLED:'false',RECOVERY_V1_FIRST_SEND_ENABLED:'false',RECOVERY_V1_CANCELLATION_SEND_ENABLED:'false',
    RECOVERY_V1_SCOPE_IDS:'[]',RECOVERY_V1_DATABASE_URL:saved.central.connectionString,
    RECOVERY_V1_GOP_DATABASE_URL:saved.gop.connectionString,RECOVERY_V1_GOP_SUPABASE_URL:gop.SUPABASE_URL||gop.NEXT_PUBLIC_SUPABASE_URL,
    RECOVERY_V1_DATABASE_CA_FILE:'/opt/nuvem-local-fiscal/storage/certificates/supabase-prod-ca-2021.crt',
    RECOVERY_V1_GOP_EVENT_URL:'https://mboptical.mentebinaria.com/api/fiscal/recovery-v1/events',RECOVERY_V1_SYNC_SECRET:central.RECOVERY_V1_SYNC_SECRET};
  if(!config.RECOVERY_V1_SYNC_SECRET||config.RECOVERY_V1_SYNC_SECRET.length<32)throw Error('SYNC_SECRET_REQUIRED');
  await writeFile(join(directory,'runtime.private.env'),Object.entries(config).map(([k,v])=>k+'='+v).join('\n')+'\n');
  await writeFile(args.get('--report'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(e){console.error(JSON.stringify({listeners:false,stage,errorCode:e.code??e.message??'PROVISION_FAILED',credentialsExposed:false}));process.exitCode=1;}
