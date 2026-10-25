import type {ManagedDocument,ManagedScope} from './controller-types.js';
import type {CancellationRepository,CancellationOutcome} from './cancellation-types.js';
import {decodeCancellationAggregate} from './cancellation-repository.js';
import {frozenCancellation} from './cancellation-controller.js';
import {validateCancellationSnapshot,reconcileCancellationConsultation} from './cancellation-evidence.js';
import {matchesRecoveryScope} from './model.js';

type Rpc={rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}>};
/** No authorize/cancel transport is available here. A claim records the query
 * budget before external I/O; completion fences late or expired owners.
 */
export async function drainCancellation(options:{database:Rpc;repository:CancellationRepository;scopes:readonly ManagedScope[];
  consult:(record:ManagedDocument)=>Promise<string>;active?:()=>boolean}):Promise<number|null> {
  const rpc=async()=>{
    const {data,error}=await options.database.rpc('fiscal_recovery_cancel_claim_v1',{p_scopes:options.scopes.map(s=>s.id)});
    if(error)throw new Error('RECOVERY_CANCEL_STORAGE_UNAVAILABLE');
    const result=data as {lease:null|{token:string;aggregate:unknown};nextWakeAt:string|null};
    if(!result||!('lease' in result)||!('nextWakeAt' in result)||
      (result.nextWakeAt!==null&&(typeof result.nextWakeAt!=='string'||!Number.isFinite(Date.parse(result.nextWakeAt))))) {
      throw new Error('RECOVERY_CANCEL_CLAIM_INVALID');
    }
    return result;
  };
  const claimed=await rpc();
  if(!claimed.lease)return claimed.nextWakeAt===null?null:Date.parse(claimed.nextWakeAt);
  const token=claimed.lease.token,current=decodeCancellationAggregate(claimed.lease.aggregate);
  if(!token||token!==current.record.ownerToken||!current.intent.sendStartedAt)throw new Error('RECOVERY_CANCEL_OWNER_INVALID');
  if(options.active&&!options.active())return claimed.nextWakeAt===null?null:Date.parse(claimed.nextWakeAt);
  let decision:CancellationOutcome;
  try{
    if(!options.scopes.some(s=>matchesRecoveryScope(current.record.scope,s)))throw new Error('scope');
    const frozen=frozenCancellation(current);validateCancellationSnapshot(frozen,current.intent.snapshot!);
    try{decision=reconcileCancellationConsultation(frozen,await options.consult(current.record));}
    catch{decision={state:'pending',origin:'transport',code:'RECOVERY_CANCEL_QUERY_COMMUNICATION_FAILURE'};}
  }catch{decision={state:'pending',origin:'local',code:'RECOVERY_CANCELLATION_EVIDENCE_INVALID'};}
  const saved=await options.repository.finish(current,token,decision);
  // Request an immediate next bounded drain; the durable claim will return the
  // actual next due time or null after it has checked the remaining queue.
  return saved?Date.now():claimed.nextWakeAt===null?null:Date.parse(claimed.nextWakeAt);
}
