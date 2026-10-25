/** Explicit, read-only hosted backup. Credentials never enter argv or stdout.
 * Writes private dumps/IDs/logs only to a caller-selected ignored directory.
 * No restore or migration is executed by this command. */
import {readFile,mkdir,writeFile,stat} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {resolve,join} from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import pg from 'pg';
const require=createRequire(import.meta.url),{recoveryListenUrl}=require('../../dist/lib/recovery/listen-url.js'),
  {recoveryDatabaseTls}=require('../../dist/lib/recovery/database-tls.js');
const args=new Map();for(let i=2;i<process.argv.length;i+=2)args.set(process.argv[i],process.argv[i+1]);
let stage='configuration',client;
try{
  const project=args.get('--project');if(!['central','gop'].includes(project))throw Error();
  const central=parseEnv(await readFile(args.get('--central-env'),'utf8'));
  const source=project==='central'?central:parseEnv(await readFile(args.get('--gop-env'),'utf8'));
  const connection=recoveryListenUrl(source[project==='central'?'RECOVERY_V1_DATABASE_URL':'SUPABASE_DB_URL'],source.SUPABASE_URL||source.NEXT_PUBLIC_SUPABASE_URL);
  const url=new URL(connection),ca=central.RECOVERY_V1_DATABASE_CA_FILE;
  if(!ca)throw Error();
  const output=resolve(args.get('--output')),bin=resolve(args.get('--bin'));await mkdir(output,{recursive:true});
  const ssl=recoveryDatabaseTls(ca);
  client=new pg.Client({connectionString:connection,ssl,connectionTimeoutMillis:10000,application_name:'recovery-pilot-backup'});
  stage='snapshot';await client.connect();await client.query('begin isolation level repeatable read read only');
  await client.query("set local statement_timeout='30s'");
  const snapshot=(await client.query('select pg_export_snapshot() as id')).rows[0].id;
  const env={...process.env,PGHOST:url.hostname,PGPORT:url.port||'5432',PGUSER:decodeURIComponent(url.username),
    PGPASSWORD:decodeURIComponent(url.password),PGDATABASE:decodeURIComponent(url.pathname.slice(1)),PGSSLMODE:'verify-full',
    PGSSLROOTCERT:ca,PGCONNECT_TIMEOUT:'15',PGAPPNAME:'recovery-pilot-backup',PGOPTIONS:'-c default_transaction_read_only=on'};
  const command=(exe,params)=>new Promise((done,fail)=>{
    const child=spawn(join(bin,exe),params,{env,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';
    child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>output+=c);
    child.on('error',()=>fail(Error('CLIENT_START_FAILED')));
    child.on('exit',async code=>{await writeFile(join(outputDir,exe+'.private.log'),output);code===0?done():fail(Error('CLIENT_FAILED'));});
  });
  const outputDir=output;
  stage='public_dump';
  const dump=join(output,'public.dump');
  const params=['--format=custom','--compress=6','--schema=public','--snapshot='+snapshot,'--file='+dump];
  if(project==='gop')params.push('--schema=supabase_migrations');
  await command('pg_dump.exe',params);
  if(project==='gop'){
    stage='auth_dependency';
    // IDs permit an isolated FK restore without exporting authentication
    // passwords/tokens. These IDs remain private alongside the dump.
    const ids=(await client.query('select id from auth.users')).rows.map(r=>r.id);
    await writeFile(join(output,'auth-user-ids.private.json'),JSON.stringify(ids));
    await command('pg_dump.exe',['--schema-only','--section=pre-data','--table=auth.users','--no-owner','--no-privileges',
      '--snapshot='+snapshot,'--file='+join(output,'auth-users-schema.private.sql')]);
  }
  await client.query('rollback');await client.end();client=undefined;
  stage='checksum';const bytes=await readFile(dump),sha256=createHash('sha256').update(bytes).digest('hex');
  const report={date:new Date().toISOString(),project,format:'pg_dump custom 17.6',bytes:(await stat(dump)).size,sha256,
    readOnly:true,consistentSnapshot:true,schemas:project==='gop'?['public','supabase_migrations']:['public'],
    authDependency:project==='gop'?'schema and UUIDs only; no passwords/tokens':'none',restored:false};
  await writeFile(join(output,'manifest.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch{
  console.error(JSON.stringify({backup:false,stage,credentialsExposed:false}));process.exitCode=1;
}finally{if(client){try{await client.query('rollback');}catch{}await client.end();}}
