/** Explicit offline restore rehearsal. Never reads a hosted connection URL.
 * Only a new cluster under .test-tools/native-pg can be modified/deleted.
 * Private SQL/logs never go to stdout. Real auth passwords/tokens are absent;
 * auth helpers are structural stubs, not an authentication behavior test. */
import {mkdir,mkdtemp,writeFile,readFile,rm,realpath,access} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {randomUUID,createHash} from 'node:crypto';
import forge from 'node-forge';
import pg from 'pg';
const args=new Map();for(let i=2;i<process.argv.length;i+=2)args.set(process.argv[i],process.argv[i+1]);
const root=resolve('.test-tools/native-pg');await mkdir(root,{recursive:true});
const directory=await mkdtemp(join(root,'restore-'));const data=join(directory,'data');
if(!directory.startsWith(root+sep))throw Error('LOCAL_PATH_INVALID');
const bin=resolve('.test-tools/node_modules/@embedded-postgres/windows-x64/native/bin');
const clientBin=resolve('.test-tools/pg-client/bin'),backupRoot=resolve(args.get('--backups'));
const reportPath=resolve(args.get('--report')),password='disposable-'+randomUUID(),passwordFile=join(directory,'password.txt');
const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
const tlsKeys=forge.pki.rsa.generateKeyPair(2048),certificate=forge.pki.createCertificate();certificate.publicKey=tlsKeys.publicKey;
certificate.serialNumber='17';certificate.validity.notBefore=new Date(Date.now()-60000);certificate.validity.notAfter=new Date(Date.now()+86400000);
certificate.setSubject([{name:'commonName',value:'localhost'}]);certificate.setIssuer(certificate.subject.attributes);
certificate.setExtensions([{name:'basicConstraints',cA:true},{name:'subjectAltName',altNames:[{type:2,value:'localhost'},{type:7,ip:'127.0.0.1'}]}]);
certificate.sign(tlsKeys.privateKey,forge.md.sha256.create());const ca=forge.pki.certificateToPem(certificate),caFile=join(directory,'ca.crt');
const env={...process.env,PGHOST:'127.0.0.1',PGPORT:String(port),PGUSER:'postgres',PGPASSWORD:password,PGSSLMODE:'verify-full',PGSSLROOTCERT:caFile};
const command=(exe,params)=>new Promise((done,fail)=>{
  const child=spawn(exe,params,{env,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';
  child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>output+=c);child.on('error',()=>fail(Error('LOCAL_CLIENT_FAILED')));
  child.on('exit',async code=>{await writeFile(join(directory,code===0?'last-command.private.log':'failed-command.private.log'),output);
    code===0?done(output):fail(Error('LOCAL_COMMAND_FAILED'));});
});
const clients=[];let started=false,stage='initdb',successful=false;
const report={date:new Date().toISOString(),offline:true,server:'PostgreSQL 17.6',tlsVerified:true,projects:[],
  authHelpers:'structural stubs, no credential/session restoration',hostedWrites:false};
try{
  await writeFile(passwordFile,password+'\n');await writeFile(caFile,ca);
  await command(join(bin,'initdb.exe'),['-D',data,'-U','postgres','--auth=scram-sha-256','--pwfile='+passwordFile,'--encoding=UTF8','--locale=C']);
  await rm(passwordFile,{force:true});await writeFile(join(data,'test.crt'),ca);await writeFile(join(data,'test.key'),forge.pki.privateKeyToPem(tlsKeys.privateKey));
  await command(join(bin,'pg_ctl.exe'),['-D',data,'-l',join(directory,'postgres.private.log'),'-o',
    `-h 127.0.0.1 -p ${port} -c ssl=on -c ssl_cert_file=test.crt -c ssl_key_file=test.key`,'-w','start']);started=true;
  const connect=async(database)=>{const c=new pg.Client({host:'127.0.0.1',port,user:'postgres',password,database,ssl:{ca,rejectUnauthorized:true}});
    await c.connect();clients.push(c);return c;};
  const admin=await connect('postgres');
  for(const role of ['anon','authenticated','authenticator','dashboard_user','pgbouncer','pgsodium_keyholder','pgsodium_keyiduser','pgsodium_keymaker',
    'service_role','supabase_admin','supabase_auth_admin','supabase_read_only_user','supabase_realtime_admin','supabase_replication_admin','supabase_storage_admin','cli_login_postgres'])
    await admin.query('create role "'+role+'"');
  for(const project of ['central','gop']){
    stage=project+'_checksum';const source=join(backupRoot,project),dump=join(source,'public.dump');
    const manifest=JSON.parse(await readFile(join(source,'manifest.json'),'utf8'));
    if(createHash('sha256').update(await readFile(dump)).digest('hex')!==manifest.sha256)throw Error('BACKUP_HASH_MISMATCH');
    const database='restore_'+project;await admin.query('create database '+database);const c=await connect(database);
    await c.query(`create schema extensions;create extension if not exists pgcrypto with schema extensions;
      create extension if not exists "uuid-ossp" with schema extensions;create extension if not exists unaccent with schema extensions;
      create schema auth;create function auth.uid() returns uuid language sql as 'select null::uuid';
      create function auth.role() returns text language sql as 'select null::text';
      create function auth.jwt() returns jsonb language sql as 'select ''{}''::jsonb';
      create function auth.email() returns text language sql as 'select null::text';`);
    if(project==='gop'){
      stage='gop_auth_dependency';
      await c.query('create extension pg_trgm with schema public');
      const sql=(await readFile(join(source,'auth-users-schema.private.sql'),'utf8')).replace(/^\\.*$/mg,'');
      await c.query(sql);await c.query('alter table auth.users add primary key(id)');
      const ids=JSON.parse(await readFile(join(source,'auth-user-ids.private.json'),'utf8'));
      await c.query('insert into auth.users(id) select unnest($1::uuid[])',[ids]);
    }
    stage=project+'_restore';
    const restoreArgs=['--no-owner','--exit-on-error','--single-transaction','--dbname='+database];
    const toc=await command(join(clientBin,'pg_restore.exe'),['--list',dump]);
    // These are new, isolated databases. Retain the precreated public schema
    // (and its real extension operators) instead of dropping it during restore.
    let filtered=toc.split(/\r?\n/).filter(line=>!/^\d+; \d+ \d+ SCHEMA - public /.test(line));
    if(project==='gop'){
      // Native PG has no pgvector. Keep the original backup complete; exclude
      // only the unrelated schema_embeddings table/sequence and three vector
      // search functions from this offline rehearsal, never replace the type
      // with a stub or claim those objects were restored/validated.
      filtered=filtered.filter(line=>!line.includes('schema_embeddings')&&!line.includes('public.vector'));
    }
    const list=join(directory,project+'-restore.private.list');await writeFile(list,filtered.join('\n'));restoreArgs.push('--use-list='+list);
    await command(join(clientBin,'pg_restore.exe'),[...restoreArgs,dump]);
    const rows=(await c.query(project==='central'?'select count(*)::int as n from public.fiscal_documents':'select count(*)::int as n from public.fiscal_invoices')).rows[0].n;
    stage=project+'_migrations';
    const migrations=project==='central'?[
      'migrations/20261024_recovery_v1_PREPARE_ONLY.sql','migrations/20261024_recovery_controller_PREPARE_ONLY.sql',
      'migrations/20261024_recovery_sync_PREPARE_ONLY.sql','migrations/20261024_recovery_manual_PREPARE_ONLY.sql',
      'migrations/20261024_recovery_cancellation_PREPARE_ONLY.sql','migrations/20261024_recovery_legacy_adoption_PREPARE_ONLY.sql',
      'migrations/20261025_recovery_legacy_queue_PREPARE_ONLY.sql']:[
      '20261024190000_recovery_pilot_gop.sql','20261024191000_recovery_sync_gop.sql','20261024192000_recovery_reconcile_gop.sql',
      '20261024193000_recovery_cancellation_gop.sql','20261024194000_recovery_origin_barrier_gop.sql',
      '20261024195000_recovery_atomic_order_delete_gop.sql','20261024200000_recovery_number_permissions_gop.sql',
      '20261025010000_recovery_legacy_adoption_gop.sql'].map(n=>'../piloto-gop/supabase/migrations/'+n);
    const migrationHashes=[];
    for(const file of migrations){stage=project+'_migration_'+file.split('/').pop();const sql=(await readFile(file,'utf8')).replace(/\r\n/g,'\n');
      await c.query(sql);migrationHashes.push({file:file.split('/').pop(),sha256:createHash('sha256').update(sql).digest('hex')});}
    const counts=(await c.query(project==='central'?'select count(*)::int as n from public.fiscal_documents':'select count(*)::int as n from public.fiscal_invoices')).rows[0].n;
    if(counts!==rows)throw Error('DOCUMENT_COUNT_CHANGED');
    const prefix=project==='central'?'fiscal_recovery_':'gop_recovery_';
    const access=(await c.query(`select count(*)::int as n from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and left(p.proname,length($1))=$1 and
      (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute'))`,[prefix])).rows[0].n;
    if(access!==0)throw Error('PUBLIC_RPC_EXECUTION_FOUND');
    report.projects.push({project,backupSha256:manifest.sha256,restored:true,migrationsAppliedLocally:migrations.length,
      fiscalRowsPreserved:true,publicRpcExecution:false,migrations:migrationHashes,
      excludedFromRehearsal:project==='gop'?['schema_embeddings and its sequence/constraints/ACLs',
        'match_schema_documents(vector,...)','search_documents(vector,...)','search_documents_v2(vector,...)']:[]});
  }
  successful=true;
}catch(error){
  // Keep the failed cluster/log ignored for diagnosis; never print private SQL.
  console.error(JSON.stringify({restored:false,stage,errorCode:error.code??'LOCAL_RESTORE_FAILED',hostedWrites:false}));process.exitCode=1;
}finally{
  for(const c of clients)try{await c.end();}catch{}
  if(started){
    try{await command(join(bin,'pg_ctl.exe'),['-D',data,'-m','fast','-t','120','-w','stop']);}
    catch{
      // A suspended Windows session can make pg_ctl time out even though the
      // owned postmaster finishes shutdown afterwards. Its own PID file must
      // have disappeared; never remove a cluster still registered as running.
      try{await access(join(data,'postmaster.pid'));successful=false;process.exitCode=1;}
      catch(error){if(error.code!=='ENOENT')throw error;}
    }
  }
  if(successful){const target=await realpath(directory),boundary=await realpath(root);
    if(!target.startsWith(boundary+sep)||!target.split(sep).pop().startsWith('restore-'))throw Error('LOCAL_CLEANUP_PATH_INVALID');
    await rm(target,{recursive:true,force:true});
    report.localServerStopped=true;report.localDataRemoved=true;
    await writeFile(reportPath,JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
}
