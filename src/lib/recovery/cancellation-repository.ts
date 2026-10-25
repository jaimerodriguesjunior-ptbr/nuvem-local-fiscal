import type {SupabaseClient} from '@supabase/supabase-js';
import {decodeManagedDocument} from './managed-repository.js';
import type {CancellationAggregate,CancellationSnapshot,CancellationOutcome,CancellationRepository} from './cancellation-types.js';

export function decodeCancellationAggregate(value:unknown):CancellationAggregate {
  const a=value as CancellationAggregate;
  if(!a||!a.intent||a.intent.requestId!==a.record?.requestId||typeof a.intent.intentId!=='string'||
    !/^[a-f0-9-]{36}$/i.test(a.intent.intentId)||!['accepted','prepared','send_started','pending','confirmed','rejected','blocked_local'].includes(a.intent.phase)||
    typeof a.intent.justification!=='string'||a.intent.justification.length<15||a.intent.justification.length>255||
    (a.intent.sendStartedAt!==null&&!Number.isFinite(Date.parse(a.intent.sendStartedAt))))throw new Error('RECOVERY_CANCEL_AGGREGATE_INVALID');
  return {...a,record:decodeManagedDocument(a.record)};
}
export class SupabaseCancellationRepository implements CancellationRepository {
  constructor(private readonly client:SupabaseClient){}
  private async rpc(name:string,args:Record<string,unknown>){
    const {data,error}=await this.client.rpc(name,args);
    if(error)throw new Error(error.message.includes('RECOVERY_')?error.message:'RECOVERY_STORAGE_UNAVAILABLE');return data;
  }
  async get(intentId:string){const data=await this.rpc('fiscal_recovery_cancel_get_v1',{p_intent:intentId});return data===null?null:decodeCancellationAggregate(data);}
  async accept(requestId:string,intentId:string,clientId:string,scopeIds:string[],justification:string,token:string){
    const data=await this.rpc('fiscal_recovery_cancel_accept_v1',{p_request:requestId,p_intent:intentId,p_client:clientId,
      p_scopes:scopeIds,p_justification:justification,p_token:token});
    if(!data||typeof data.created!=='boolean')throw new Error('RECOVERY_CANCEL_ACCEPT_INVALID');
    return {...decodeCancellationAggregate(data),created:data.created as boolean};
  }
  async step(current:CancellationAggregate,token:string,step:'prepare'|'send_started',snapshot?:CancellationSnapshot){
    const data=await this.rpc('fiscal_recovery_cancel_step_v1',{p_intent:current.intent.intentId,p_version:current.record.version,
      p_token:token,p_step:step,p_snapshot:snapshot??null});return data===null?null:decodeCancellationAggregate(data);
  }
  async finish(current:CancellationAggregate,token:string,decision:CancellationOutcome){
    const data=await this.rpc('fiscal_recovery_cancel_finish_v1',{p_intent:current.intent.intentId,p_version:current.record.version,p_token:token,p_decision:decision});
    return data===null?null:decodeCancellationAggregate(data);
  }
}
