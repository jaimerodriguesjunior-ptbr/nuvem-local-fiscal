import type {RecoveryWakeSource} from './model.js';
import {signRecoverySync} from './sync-auth.js';

export type SyncEvent={schema:'recovery-v1';eventId:string;requestId:string;version:number;clientId:string;organizationId:string;storeId:number};
export type OutboxLease={token:string;attempt:number;event:SyncEvent};
type RpcClient={rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}>};
type Options={database:RpcClient;scopeIds:string[];source:RecoveryWakeSource;deliver:(event:SyncEvent)=>Promise<number>;
  report:(code:string)=>void;now?:()=>number;setTimer?:typeof setTimeout;clearTimer?:typeof clearTimeout};

export function createSyncDelivery(url:string,secret:string,fetcher:typeof fetch=fetch):(event:SyncEvent)=>Promise<number> {
  const target=new URL(url);
  if(target.protocol!=='https:'||target.username||target.password||target.hash||target.search||
    target.pathname!=='/api/fiscal/recovery-v1/events'||secret.length<32)throw new Error('RECOVERY_SYNC_CONFIG_INVALID');
  return async event=>{
    const body=JSON.stringify(event),timestamp=String(Math.floor(Date.now()/1000));
    const response=await fetcher(target.toString(),{method:'POST',headers:{'content-type':'application/json',
      'x-recovery-timestamp':timestamp,'x-recovery-signature':signRecoverySync(body,secret,timestamp)},
      body,redirect:'error',signal:AbortSignal.timeout(65_000)});
    if(!response.ok)throw new Error('RECOVERY_SYNC_DELIVERY_FAILED');
    const result=await response.json() as {eventId?:unknown;appliedVersion?:unknown};
    if(result.eventId!==event.eventId||!Number.isSafeInteger(result.appliedVersion)||(result.appliedVersion as number)<event.version) {
      throw new Error('RECOVERY_SYNC_ACK_INVALID');
    }
    return result.appliedVersion as number;
  };
}

/** Notification is a hint. Startup/reconnect drains persisted work; an empty
 * claim with no future job removes the timer. This worker has no fiscal adapter.
 */
export class RecoveryOutboxWorker {
  private stopped=true;private connected=false;private healthy=true;private dirty=false;
  private running:Promise<void>|null=null;private unsubscribe:(()=>Promise<void>)|undefined;
  private timer:ReturnType<typeof setTimeout>|undefined;
  constructor(private readonly options:Options){}
  get ready(){return !this.stopped&&this.connected&&this.healthy;}
  private async rpc(name:string,args:Record<string,unknown>){
    const result=await this.options.database.rpc(name,args);if(result.error)throw new Error('RECOVERY_OUTBOX_STORAGE');return result.data;
  }
  async start(){
    if(!this.stopped)throw new Error('RECOVERY_OUTBOX_ALREADY_STARTED');
    if(!this.options.scopeIds.length)throw new Error('RECOVERY_OUTBOX_SCOPE_REQUIRED');
    this.stopped=false;
    let disconnected=false;
    try {
      this.unsubscribe=await this.options.source.subscribe(()=>{disconnected=false;this.connected=true;this.wake();},()=>{
        disconnected=true;this.connected=false;this.cancelTimer();this.options.report('RECOVERY_OUTBOX_DISCONNECTED');});
      if(this.stopped){await this.unsubscribe();this.unsubscribe=undefined;return;}
      this.connected=!disconnected;
      this.wake();await this.running;
    }catch(error){await this.stop();throw error;}
  }
  async stop(){this.stopped=true;this.connected=false;this.cancelTimer();await this.running;await this.unsubscribe?.();this.unsubscribe=undefined;}
  wake(){
    if(this.stopped||!this.connected)return;
    this.dirty=true;this.cancelTimer();
    if(!this.running)this.running=this.drain().finally(()=>{this.running=null;if(this.dirty)this.wake();});
  }
  private cancelTimer(){if(this.timer!==undefined)(this.options.clearTimer??clearTimeout)(this.timer);this.timer=undefined;}
  private schedule(at:number|null){
    if(at===null||this.stopped||!this.connected)return;
    this.cancelTimer();this.timer=(this.options.setTimer??setTimeout)(()=>{this.timer=undefined;this.wake();},
      Math.min(2_147_483_647,Math.max(100,at-(this.options.now??Date.now)())));
  }
  private async drain(){
    try {
      do {
        this.dirty=false;
        while(!this.stopped&&this.connected){
          const raw=await this.rpc('fiscal_recovery_outbox_claim_v1',{p_scopes:this.options.scopeIds});
          const claim=raw as {lease:OutboxLease|null;nextWakeAt:string|null};
          if(!claim||!('lease' in claim)||!('nextWakeAt' in claim)||
            (claim.nextWakeAt!==null&&!Number.isFinite(Date.parse(claim.nextWakeAt))))throw new Error('RECOVERY_OUTBOX_CLAIM_INVALID');
          this.healthy=true;
          if(!claim.lease){this.schedule(claim.nextWakeAt===null?null:Date.parse(claim.nextWakeAt));break;}
          const lease=claim.lease,e=lease.event;
          if(!e||e.schema!=='recovery-v1'||!Number.isSafeInteger(e.version)||e.version<1||
            e.eventId!==`${e.requestId}:${e.version}`||typeof lease.token!=='string')throw new Error('RECOVERY_OUTBOX_LEASE_INVALID');
          if(this.stopped||!this.connected)break;
          let applied:number|null=null;
          try{applied=await this.options.deliver(e);}catch{/* durable retry; never changes fiscal state */}
          await this.rpc('fiscal_recovery_outbox_complete_v1',{p_request:e.requestId,p_version:e.version,
            p_token:lease.token,p_applied_version:applied});
        }
      }while(this.dirty&&!this.stopped&&this.connected);
    }catch{
      this.healthy=false;this.dirty=false;this.options.report('RECOVERY_OUTBOX_STORAGE_UNAVAILABLE');
      this.schedule((this.options.now??Date.now)()+30_000);
    }
  }
}
