/** Explicit checked rollout of the rehearsed additive schema. Default = check.
 * --mode apply performs one atomic transaction/project, records checksums and
 * leaves all scopes disabled. It cannot emit, cancel, enroll or allocate numbers.
 * Credentials stay in environment files/memory, never argv, logs or reports. */
import {readFile,writeFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import pg from 'pg';
const require=createRequire(import.meta.url),{recoveryListenUrl}=require('../../dist/lib/recovery/listen-url.js'),
  {recoveryDatabaseTls}=require('../../dist/lib/recovery/database-tls.js');
const args=new Map();for(let i=2;i<process.argv.length;i+=2)args.set(process.argv[i],process.argv[i+1]);
let stage='configuration',client,transaction=false;
try{
  const project=args.get('--project'),mode=args.get('--mode')??'check';
  if(!['central','gop'].includes(project)||!['check','apply'].includes(mode))throw Error('INVALID_ARGUMENTS');
  const central=parseEnv(await readFile(args.get('--central-env'),'utf8')),
    e=project==='central'?central:parseEnv(await readFile(args.get('--gop-env'),'utf8'));
  const projectUrl=e.SUPABASE_URL||e.NEXT_PUBLIC_SUPABASE_URL;
  if(new URL(projectUrl).hostname!==(project==='central'?'kfebaoocbgmcvveumlem.supabase.co':'thmglufejrivyhabfqfb.supabase.co'))throw Error('WRONG_PROJECT');
  const url=recoveryListenUrl(e[project==='central'?'RECOVERY_V1_DATABASE_URL':'SUPABASE_DB_URL'],projectUrl);
  const files=project==='central'?[
    'migrations/20261024_recovery_v1_PREPARE_ONLY.sql','migrations/20261024_recovery_controller_PREPARE_ONLY.sql',
    'migrations/20261024_recovery_sync_PREPARE_ONLY.sql','migrations/20261024_recovery_manual_PREPARE_ONLY.sql',
    'migrations/20261024_recovery_cancellation_PREPARE_ONLY.sql','migrations/20261024_recovery_legacy_adoption_PREPARE_ONLY.sql',
    'migrations/20261025_recovery_legacy_queue_PREPARE_ONLY.sql']:[
    '20261024190000_recovery_pilot_gop.sql','20261024191000_recovery_sync_gop.sql','20261024192000_recovery_reconcile_gop.sql',
    '20261024193000_recovery_cancellation_gop.sql','20261024194000_recovery_origin_barrier_gop.sql',
    '20261024195000_recovery_atomic_order_delete_gop.sql','20261024200000_recovery_number_permissions_gop.sql',
    '20261025010000_recovery_legacy_adoption_gop.sql'].map(f=>'../piloto-gop/supabase/migrations/'+f);
  const restore=JSON.parse(await readFile(args.get('--restore-report'),'utf8')),
    proof=restore.projects?.find(p=>p.project===project),now=Date.now();
  if(!restore.offline||restore.hostedWrites!==false||restore.localServerStopped!==true||restore.localDataRemoved!==true||
    !proof?.restored||!proof.fiscalRowsPreserved||proof.publicRpcExecution!==false||
    !Number.isFinite(Date.parse(restore.date))||now-Date.parse(restore.date)>6*3600000||Date.parse(restore.date)>now+60000)throw Error('RESTORE_PROOF_REQUIRED');
  const backup=JSON.parse(await readFile(args.get('--backups')+'/'+project+'/manifest.json','utf8'));
  const backupBytes=await readFile(args.get('--backups')+'/'+project+'/public.dump');
  if(backup.sha256!==proof.backupSha256||createHash('sha256').update(backupBytes).digest('hex')!==backup.sha256||
    !Number.isFinite(Date.parse(backup.date))||now-Date.parse(backup.date)>6*3600000||Date.parse(backup.date)>now+60000)
    throw Error('RECENT_MATCHING_BACKUP_REQUIRED');
  const migrations=[];
  for(const file of files){const sql=(await readFile(file,'utf8')).replace(/\r\n/g,'\n'),name=file.split('/').pop(),sha256=createHash('sha256').update(sql).digest('hex');
    if(proof.migrations?.find(x=>x.file===name)?.sha256!==sha256)throw Error('REHEARSED_MIGRATION_CHANGED');
    if(!/^begin;\r?$/m.test(sql)||!/commit;\s*$/.test(sql))throw Error('TRANSACTION_WRAPPER_REQUIRED');
    migrations.push({name,sha256,sql,body:sql.replace(/^begin;\r?\n/m,'').replace(/commit;\s*$/,'')});
  }
  client=new pg.Client({connectionString:url,ssl:recoveryDatabaseTls(central.RECOVERY_V1_DATABASE_CA_FILE),
    connectionTimeoutMillis:10000,application_name:'recovery-pilot-schema-rollout'});
  stage='catalog';await client.connect();
  await client.query(mode==='apply'?'begin':'begin transaction read only');transaction=true;
  await client.query("set local lock_timeout='5s'");await client.query("set local statement_timeout='120s'");
  if(mode==='apply')await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))",['recovery-pilot-schema:'+project]);
  const schema=project==='central'?'fiscal_recovery':'fiscal_recovery_gop';
  const exists=(await client.query('select to_regnamespace($1) is not null as yes',[schema])).rows[0].yes;
  let installed=[];
  if(exists){
    if(!(await client.query('select to_regclass($1) is not null as yes',[schema+'.migration_history'])).rows[0].yes)throw Error('UNTRACKED_RECOVERY_SCHEMA');
    installed=(await client.query(`select name,sha256 from ${schema}.migration_history order by applied_at,name`)).rows;
    if(installed.length!==migrations.length||migrations.some(m=>!installed.some(i=>i.name===m.name&&i.sha256===m.sha256)))throw Error('INSTALLED_MIGRATION_MISMATCH');
  }
  if(project==='gop'&&!exists){
    const versions=migrations.map(m=>m.name.split('_')[0]);
    if((await client.query('select version from supabase_migrations.schema_migrations where version=any($1::text[])',[versions])).rowCount)
      throw Error('MIGRATION_VERSION_ALREADY_REGISTERED');
  }
  const fingerprint=async()=>{
    const table=project==='central'?'fiscal_documents':'fiscal_invoices';
    const columns=project==='central'?'id,status,number,serie,access_key,protocol':'id,status,numero,serie,nuvemfiscal_uuid,chave_acesso,work_order_id';
    return (await client.query(`select count(*)::int as rows,md5(coalesce(string_agg(md5(jsonb_build_array(${columns})::text),',' order by id),'')) as fingerprint from public.${table}`)).rows[0];
  };
  const before=await fingerprint();let applied=0;
  if(mode==='apply'&&!exists){
    for(const m of migrations){stage=m.name;await client.query(m.body);
      if(applied===0)await client.query(`create table ${schema}.migration_history(name text primary key,sha256 text not null,
        applied_at timestamptz not null default clock_timestamp());alter table ${schema}.migration_history enable row level security;
        revoke all on ${schema}.migration_history from public,anon,authenticated,service_role;`);
      await client.query(`insert into ${schema}.migration_history(name,sha256) values($1,$2)`,[m.name,m.sha256]);
      if(project==='gop')await client.query('insert into supabase_migrations.schema_migrations(version,statements,name) values($1,$2,$3)',
        [m.name.split('_')[0],[m.sql],m.name.replace(/^\d+_/,'').replace(/\.sql$/,'')]);
      applied++;
    }
  }
  stage='verify';const after=await fingerprint();
  if(before.rows!==after.rows||before.fingerprint!==after.fingerprint)throw Error('FISCAL_RECORDS_CHANGED');
  if(mode==='apply'||exists){
    const prefix=project==='central'?'fiscal_recovery_':'gop_recovery_';
    const exposed=(await client.query(`select count(*)::int as n from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and left(p.proname,length($1))=$1 and
      (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute'))`,[prefix])).rows[0].n;
    if(exposed!==0)throw Error('PUBLIC_RPC_EXECUTION_FOUND');
    if(project==='central'&&(await client.query('select count(*)::int as n from fiscal_recovery.scopes where enabled')).rows[0].n!==0)
      throw Error('UNEXPECTED_ENABLED_SCOPE');
  }
  await client.query(mode==='apply'?'commit':'rollback');transaction=false;
  if(mode==='apply')await client.query("notify pgrst, 'reload schema'");
  const report={date:new Date().toISOString(),project,mode,applied,alreadyInstalled:exists,flagsActivated:false,
    fiscalRowsPreserved:true,publicRpcExecution:mode==='apply'||exists?false:'not_installed',backupSha256:proof.backupSha256,
    migrations:migrations.map(({name,sha256})=>({name,sha256}))};
  await writeFile(args.get('--report'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){if(transaction)try{await client.query('rollback');}catch{}
  console.error(JSON.stringify({migration:false,stage,errorCode:error.code??error.message??'UNKNOWN',credentialsExposed:false}));process.exitCode=1;
}finally{await client?.end();}
