import type {RecoveryWakeSource} from './model.js';
import {signRecoverySync} from './sync-auth.js';

export function createGopDrain(eventUrl:string,secret:string,clientId:string,fetcher:typeof fetch=fetch):()=>Promise<number|null> {
  const target=new URL(eventUrl);
  if(target.protocol!=='https:'||target.pathname!=='/api/fiscal/recovery-v1/events'||target.username||target.password||
    target.hash||target.search||secret.length<32||!clientId)throw new Error('RECOVERY_GOP_DRAIN_CONFIG_INVALID');
  target.pathname='/api/fiscal/recovery-v1/drain';
  return async()=>{
    const timestamp=String(Math.floor(Date.now()/1000));
    const body=JSON.stringify({schema:'recovery-v1',kind:'drain',clientId,organizationId:'40b34e90-4c9d-4446-b775-770a3e77d6c0',storeId:1});
    const response=await fetcher(target.toString(),{method:'POST',body,headers:{'content-type':'application/json',
      'x-recovery-timestamp':timestamp,'x-recovery-signature':signRecoverySync(body,secret,timestamp)},
      redirect:'error',signal:AbortSignal.timeout(65_000)});
    if(!response.ok)throw new Error('RECOVERY_GOP_DRAIN_UNAVAILABLE');
    const result=await response.json() as {nextWakeAt:unknown};
    if(!result||!('nextWakeAt' in result)||(result.nextWakeAt!==null&&
      (typeof result.nextWakeAt!=='string'||!Number.isFinite(Date.parse(result.nextWakeAt)))))throw new Error('RECOVERY_GOP_DRAIN_RESPONSE_INVALID');
    return result.nextWakeAt===null?null:Date.parse(result.nextWakeAt as string);
  };
}

/** Wake from the GOP database, then ask its authenticated service to drain one
 * durable query. Only pending work or an unavailable service causes a timer.
 */
export class RecoveryDemandPump {
  private stopped=true;private connected=false;private healthy=true;private dirty=false;private failures=0;
  private running:Promise<void>|null=null;private unsubscribe:(()=>Promise<void>)|undefined;
  private timer:ReturnType<typeof setTimeout>|undefined;
  constructor(private readonly options:{source:RecoveryWakeSource;drain:()=>Promise<number|null>;report:(code:string)=>void;
    codePrefix?:'RECOVERY_GOP'|'RECOVERY_CANCEL'|'RECOVERY_OG';now?:()=>number;setTimer?:typeof setTimeout;clearTimer?:typeof clearTimeout}){}
  get ready(){return !this.stopped&&this.connected&&this.healthy;}
  get acceptingWork(){return !this.stopped&&this.connected;}
  async start(){
    if(!this.stopped)throw new Error('RECOVERY_GOP_DRAIN_ALREADY_STARTED');
    this.stopped=false;let disconnected=false;
    try{
      this.unsubscribe=await this.options.source.subscribe(()=>{disconnected=false;this.connected=true;this.wake();},()=>{
        disconnected=true;this.connected=false;this.cancelTimer();this.options.report(`${this.options.codePrefix??'RECOVERY_GOP'}_LISTENER_DISCONNECTED`);});
      if(this.stopped){await this.unsubscribe();this.unsubscribe=undefined;return;}
      this.connected=!disconnected;this.wake();await this.running;
    }catch(error){await this.stop();throw error;}
  }
  async stop(){this.stopped=true;this.connected=false;this.cancelTimer();await this.running;await this.unsubscribe?.();this.unsubscribe=undefined;}
  wake(){
    if(this.stopped||!this.connected)return;
    this.dirty=true;this.cancelTimer();
    if(!this.running)this.running=this.run().finally(()=>{this.running=null;if(this.dirty)this.wake();});
  }
  private cancelTimer(){if(this.timer!==undefined)(this.options.clearTimer??clearTimeout)(this.timer);this.timer=undefined;}
  private schedule(at:number|null){
    if(at===null||this.stopped||!this.connected)return;
    this.cancelTimer();this.timer=(this.options.setTimer??setTimeout)(()=>{this.timer=undefined;this.wake();},
      Math.min(2_147_483_647,Math.max(250,at-(this.options.now??Date.now)())));
  }
  private async run(){
    do{
      this.dirty=false;
      try{
        const next=await this.options.drain();this.healthy=true;this.failures=0;this.schedule(next);
      }catch{
        this.healthy=false;this.options.report(`${this.options.codePrefix??'RECOVERY_GOP'}_DRAIN_UNAVAILABLE`);
        this.schedule((this.options.now??Date.now)()+Math.min(300_000,30_000*2**Math.min(this.failures++,4)));
      }
    }while(this.dirty&&!this.stopped&&this.connected);
  }
}
export {RecoveryDemandPump as RecoveryGopDrainPump};
