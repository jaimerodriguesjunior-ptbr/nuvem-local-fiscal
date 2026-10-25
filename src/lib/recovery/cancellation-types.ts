import type {SignedCancellationXml} from '../sefaz-cancellation.js';
import type {ManagedDocument} from './controller-types.js';
import type {CancellationDecision} from './cancellation-evidence.js';

export type CancellationSnapshot=SignedCancellationXml&{signedEventSha256:string;batchSha256:string};
export type CancellationIntent={intentId:string;requestId:string;justification:string;
  phase:'accepted'|'prepared'|'send_started'|'pending'|'confirmed'|'rejected'|'blocked_local';
  snapshot:CancellationSnapshot|null;sendStartedAt:string|null};
export type CancellationAggregate={record:ManagedDocument;intent:CancellationIntent};
export type CancellationOutcome=CancellationDecision|{state:'blocked_local';origin:'local';code:string};
export interface CancellationRepository {
  accept(requestId:string,intentId:string,clientId:string,scopeIds:string[],justification:string,token:string):Promise<CancellationAggregate&{created:boolean}>;
  get(intentId:string):Promise<CancellationAggregate|null>;
  step(current:CancellationAggregate,token:string,step:'prepare'|'send_started',snapshot?:CancellationSnapshot):Promise<CancellationAggregate|null>;
  finish(current:CancellationAggregate,token:string,decision:CancellationOutcome):Promise<CancellationAggregate|null>;
}
