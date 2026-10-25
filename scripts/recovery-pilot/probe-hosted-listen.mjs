/** Two real session-pooler connections/project. LISTEN/NOTIFY only: no fiscal
 * queries, tables, counters or schema are changed. Notifications carry 'probe'. */
import {readFile,writeFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {createRequire} from 'node:module';
import pg from 'pg';
const require=createRequire(import.meta.url),{recoveryListenUrl,recoveryListenerUrl}=require('../../dist/lib/recovery/listen-url.js'),
  {recoveryDatabaseTls}=require('../../dist/lib/recovery/database-tls.js'),
  {PostgresRecoveryWakeSource}=require('../../dist/lib/recovery/postgres-wake-source.js');
const args=new Map();for(let i=2;i<process.argv.length;i+=2)args.set(process.argv[i],process.argv[i+1]);
const report={date:new Date().toISOString(),businessWrites:false,fiscalServiceCalls:0,projects:[]};
let stage='configuration';
try{
  const central=parseEnv(await readFile(args.get('--central-env'),'utf8')),
    gop=parseEnv(await readFile(args.get('--gop-env'),'utf8')),
    listeners=args.get('--listeners-dir')?JSON.parse(await readFile(args.get('--listeners-dir')+'/listener-logins.private.json','utf8')):null;
  for(const [project,e,key] of [['central',central,'RECOVERY_V1_DATABASE_URL'],['gop',gop,'SUPABASE_DB_URL']]){
    stage=project+'_listen';const config={connectionString:recoveryListenUrl(e[key],e.SUPABASE_URL||e.NEXT_PUBLIC_SUPABASE_URL),
      ssl:recoveryDatabaseTls(central.RECOVERY_V1_DATABASE_CA_FILE),connectionTimeoutMillis:10000,application_name:'recovery-v1-session-probe'};
    const listenerConfig=listeners?{...config,connectionString:recoveryListenerUrl(listeners[project].connectionString,e.SUPABASE_URL||e.NEXT_PUBLIC_SUPABASE_URL)}:config;
    const commands=[];let wakes=0,signal,notified=false,failed=false,close;
    const notifiedPromise=new Promise(resolve=>{signal=()=>{notified=true;resolve();};});
    const source=new PostgresRecoveryWakeSource({createConnection:()=>{
      const c=new pg.Client(listenerConfig),query=c.query.bind(c);
      c.query=(...args)=>{commands.push(String(args[0]));return query(...args);};return c;
    }});
    const sender=new pg.Client(config);let timer;
    try{
      close=await source.subscribe(()=>{wakes++;if(wakes>1)signal();},()=>{failed=true;});
      if(wakes!==1)throw Error('LISTEN_INITIAL_WAKE_INVALID');
      await sender.connect();await sender.query('begin');
      await sender.query("select pg_notify('fiscal_recovery_v1','probe')");
      await new Promise(r=>setTimeout(r,75));if(notified)throw Error('NOTIFY_BEFORE_COMMIT');
      await sender.query('commit');
      await Promise.race([notifiedPromise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('NOTIFY_TIMEOUT')),10000);})]);
      if(failed||commands.length!==1||commands[0]!=='LISTEN fiscal_recovery_v1')throw Error('LISTEN_PROBE_INVALID');
      report.projects.push({project,tlsVerified:true,sessionNotifications:true,onlyAfterCommit:true,listenerCommands:1,idlePollingQueries:0,
        dedicatedListenerRole:!!listeners});
    }finally{clearTimeout(timer);try{await sender.query('rollback');}catch{}await sender.end();await close?.();}
  }
  await writeFile(args.get('--report'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch{console.error(JSON.stringify({probe:false,stage,credentialsExposed:false}));process.exitCode=1;}
