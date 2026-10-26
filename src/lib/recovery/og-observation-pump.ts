import {createRequire} from 'node:module';
import {RecoveryDemandPump} from './gop-drain.js';
import {PostgresRecoveryWakeSource,type RecoveryNotificationConnection} from './postgres-wake-source.js';
import {recoveryListenerUrl} from './listen-url.js';
import {recoveryDatabaseTls} from './database-tls.js';
import {signRecoverySync} from './sync-auth.js';

/** Separate consultation/synchronization consumer. No authorization/cancellation
 * adapter or managed-scope enrollment is available to this pump. */
export function createOgObservationDrain(url:string,secret:string,clientId:string,fetcher:typeof fetch=fetch) {
  const target=new URL(url);
  if(target.protocol!=='https:'||target.pathname!=='/api/fiscal/recovery-v1/drain'||target.username||target.password||
    target.search||target.hash||secret.length<32||!clientId)throw Error('RECOVERY_OG_CONFIG_INVALID');
  return async():Promise<number|null>=>{
    const timestamp=String(Math.floor(Date.now()/1000));
    const body=JSON.stringify({schema:'og-observation-v1',kind:'drain',clientId});
    const r=await fetcher(target.toString(),{method:'POST',body,headers:{'content-type':'application/json',
      'x-recovery-timestamp':timestamp,'x-recovery-signature':signRecoverySync(body,secret,timestamp)},
      redirect:'error',signal:AbortSignal.timeout(65000)});
    if(!r.ok)throw Error('RECOVERY_OG_DRAIN_UNAVAILABLE');
    const result=await r.json() as {nextWakeAt:unknown};
    if(!result||!('nextWakeAt' in result)||(result.nextWakeAt!==null&&
      (typeof result.nextWakeAt!=='string'||!Number.isFinite(Date.parse(result.nextWakeAt)))))throw Error('RECOVERY_OG_DRAIN_RESPONSE_INVALID');
    return result.nextWakeAt===null?null:Date.parse(result.nextWakeAt as string);
  };
}
export function createOgObservationPump(env:NodeJS.ProcessEnv=process.env) {
  if(env.RECOVERY_OG_OBSERVER_ENABLED!=='true')return null;
  const database=recoveryListenerUrl(env.RECOVERY_OG_DATABASE_URL||'',env.RECOVERY_OG_SUPABASE_URL||'');
  const drain=createOgObservationDrain(env.RECOVERY_OG_DRAIN_URL||'',env.RECOVERY_OG_SYNC_SECRET||'',env.RECOVERY_OG_CLIENT_ID||'');
  const pg=createRequire(__filename)('pg') as {Client:new(options:Record<string,unknown>)=>RecoveryNotificationConnection};
  const source=new PostgresRecoveryWakeSource({createConnection:()=>new pg.Client({connectionString:database,
    ssl:recoveryDatabaseTls(),connectionTimeoutMillis:10000,query_timeout:15000,application_name:'recovery-v1-og-observation'})});
  return new RecoveryDemandPump({source,drain,codePrefix:'RECOVERY_OG',report:code=>console.error(`[Recovery] ${code}`)});
}
