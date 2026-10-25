import {randomUUID} from 'node:crypto';
import type {ManagedDocument} from './controller-types.js';
import {managedRecoveryDocument} from './controller.js';
import {reconcileInitialCancellation,validateCancellationSnapshot,type FrozenCancellation} from './cancellation-evidence.js';
import type {CancellationAggregate,CancellationRepository,CancellationSnapshot,CancellationOutcome} from './cancellation-types.js';
import {withCancellationTransmissionPermit} from './transmission-fence.js';

export function frozenCancellation(current:CancellationAggregate):FrozenCancellation {
  const snapshot=current.intent.snapshot;if(!snapshot)throw new Error('RECOVERY_CANCEL_SNAPSHOT_MISSING');
  return {document:managedRecoveryDocument(current.record),authorizationProtocol:current.record.document.protocolo??'',
    justification:current.intent.justification,signedEventXml:snapshot.signedEventXml,signedEventSha256:snapshot.signedEventSha256};
}
export class CancellationController {
  constructor(readonly repository:CancellationRepository,private readonly transport:{
    prepare(record:ManagedDocument,justification:string):Promise<CancellationSnapshot>;
    transmit(record:ManagedDocument,snapshot:CancellationSnapshot):Promise<string>;
  }){}
  async cancel(requestId:string,intentId:string,clientId:string,scopeIds:string[],justification:string):Promise<ManagedDocument> {
    if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(intentId))throw new Error('RECOVERY_CANCEL_ID_INVALID');
    const token=randomUUID();let current=await this.repository.accept(requestId,intentId,clientId,scopeIds,justification.trim(),token);
    if(!current.created)return current.record;
    const latest=async()=>{const found=await this.repository.get(intentId);if(!found)throw new Error('RECOVERY_CANCEL_NOT_FOUND');return found.record;};
    try{
      const snapshot=await this.transport.prepare(current.record,current.intent.justification);
      const prepared={...current,intent:{...current.intent,snapshot}};
      validateCancellationSnapshot(frozenCancellation(prepared),snapshot);
      const saved=await this.repository.step(current,token,'prepare',snapshot);
      if(!saved)return latest();current={...saved,created:true};
    }catch{
      // No transport has been called. A lost prepare commit may make this CAS
      // stale; in that case return its durable state without inventing a result.
      const blocked=await this.repository.finish(current,token,{state:'blocked_local',origin:'local',code:'RECOVERY_CANCEL_PREPARATION_FAILED'});
      return blocked?.record??latest();
    }
    // A missing/failed intent commit must never reach the transport. If its
    // response is lost after commit, only query reconciliation may proceed.
    const sending=await this.repository.step(current,token,'send_started');
    if(!sending)return latest();current={...sending,created:true};
    let decision:CancellationOutcome;
    try{
      const snapshot=current.intent.snapshot!;const frozen=frozenCancellation(current);
      validateCancellationSnapshot(frozen,snapshot);
      let response:string;
      try{response=await withCancellationTransmissionPermit(current.record.document.chave!,snapshot.batchXml,
        ()=>this.transport.transmit(current.record,snapshot));}
      catch{decision={state:'pending',origin:'transport',code:'RECOVERY_CANCEL_COMMUNICATION_FAILURE'};
        return (await this.repository.finish(current,token,decision))?.record??latest();}
      decision=reconcileInitialCancellation(frozen,response);
    }catch{decision={state:'pending',origin:'local',code:'RECOVERY_CANCELLATION_EVIDENCE_INVALID'};}
    return (await this.repository.finish(current,token,decision))?.record??latest();
  }
}
