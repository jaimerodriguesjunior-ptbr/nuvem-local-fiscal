import type {DocumentRecord} from '../../types.js';
import type {ManagedScope} from './controller-types.js';
import {verifyLegacyAuthorization} from './legacy-authorization.js';
import {reconcileConsultation} from './evidence.js';
import {createHash} from 'node:crypto';
import {decodeManagedDocument} from './managed-repository.js';

type Rpc={rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}>};
export async function associateLegacy(options:{database:Rpc;scope:ManagedScope;legacyId:string;requestId:string;originId:string;
  consult:(source:DocumentRecord)=>Promise<string>;active:()=>boolean}){
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(options.requestId)||
    !options.originId||options.originId.length>200)throw Error('RECOVERY_LEGACY_REQUEST_INVALID');
  const args={p_legacy:options.legacyId,p_scope:options.scope.id,p_client:options.scope.clientId,
    p_request:options.requestId,p_origin:options.originId};
  const rpc=async(name:string,args:Record<string,unknown>)=>{
    const {data,error}=await options.database.rpc(name,args);if(error)throw Error('RECOVERY_LEGACY_STORAGE_UNAVAILABLE');return data as any;
  };
  const check=await rpc('fiscal_recovery_legacy_check_v1',args);
  if(check?.state==='pending')await drainLegacy({database:options.database,scopes:[options.scope],consult:options.consult,active:options.active});
  const current=await rpc('fiscal_recovery_legacy_check_v1',args);
  const record=await rpc('fiscal_recovery_legacy_lookup_v1',{p_legacy:options.legacyId,p_scopes:[options.scope.id]});
  return {record:record===null?null:decodeManagedDocument(record),check:current};
}
/** Only consultation is injected. Neither automatic adoption nor its retries
 * can transmit an authorization or cancellation. The DB commits budget/lease
 * before I/O and associates with both lease and source-row CAS afterwards. */
export async function drainLegacy(options:{database:Rpc;scopes:readonly ManagedScope[];
  consult:(source:DocumentRecord)=>Promise<string>;active?:()=>boolean}):Promise<number|null>{
  const rpc=async(name:string,args:Record<string,unknown>)=>{
    const {data,error}=await options.database.rpc(name,args);
    if(error)throw Error('RECOVERY_LEGACY_STORAGE_UNAVAILABLE');return data as any;
  };
  const claim=await rpc('fiscal_recovery_legacy_claim_v1',{p_scopes:options.scopes.map(s=>s.id)});
  if(!claim||!('lease' in claim)||!('nextWakeAt' in claim)||
    (claim.nextWakeAt!==null&&(typeof claim.nextWakeAt!=='string'||!Number.isFinite(Date.parse(claim.nextWakeAt)))))
    throw Error('RECOVERY_LEGACY_CLAIM_INVALID');
  if(!claim.lease)return claim.nextWakeAt===null?null:Date.parse(claim.nextWakeAt);
  const l=claim.lease,scope=options.scopes.find(s=>s.id===l.scopeId);
  if(!scope||typeof l.token!=='string'||typeof l.requestId!=='string'||!l.source||
    typeof l.sourceSha256!=='string')throw Error('RECOVERY_LEGACY_LEASE_INVALID');
  if(options.active&&!options.active())return Date.parse(claim.nextWakeAt);
  const d=l.source;
  const source:DocumentRecord={id:d.id,providerLikeId:d.provider_like_id,tipoDocumento:d.document_type,
    issuerCnpj:d.issuer_cnpj,ambiente:d.environment,status:d.status,numero:d.number,serie:d.serie,
    chave:d.access_key,protocolo:d.protocol,xmlSigned:d.signed_xml,xml:d.authorized_xml,motivo:d.reason,motivoStatus:d.reason_code,mensagens:d.messages??[],
    payloadOriginal:d.payload_original,payloadNormalizado:d.payload_normalized,pdfUrl:d.pdf_url??'',
    createdAt:d.created_at,updatedAt:d.updated_at,cancellationState:d.cancellation_state,
    cancellationAttemptId:d.cancellation_attempt_id,cancellationRequestXml:d.cancellation_request_xml,
    cancellationSignedXml:d.cancellation_signed_xml,cancellationResponseXml:d.cancellation_response_xml,
    cancellationProcessedXml:d.cancellation_processed_xml,cancelledAt:d.cancelled_at};
  let proof:unknown=null,state='pending',code='RECOVERY_LEGACY_QUERY_COMMUNICATION_FAILURE';
  try{
    // Preflight historical signature/invariants before consulting; the existing
    // verifier needs an authorization response, so its full proof runs below.
    if(source.status!=='autorizado'||!source.xmlSigned||!source.chave||!source.protocolo||source.cancellationState||
      source.cancellationAttemptId||source.cancellationRequestXml||source.cancellationSignedXml||
      source.cancellationResponseXml||source.cancellationProcessedXml||source.cancelledAt)
      throw Error('ineligible');
    let xml:string;
    try{xml=await options.consult(source);}catch{
      await rpc('fiscal_recovery_legacy_finish_v1',{p_request:l.requestId,p_token:l.token,p_state:state,p_code:code,p_proof:null});
      return Date.now();
    }
    const decision=reconcileConsultation({...scope,documentId:source.id,number:source.numero,accessKey:source.chave,
      signedXml:source.xmlSigned,signedXmlSha256:createHash('sha256').update(source.xmlSigned).digest('hex')},xml);
    code=decision.code;
    if(decision.state==='authorized'){
      proof=verifyLegacyAuthorization(scope,source,xml);state='associated';
    }else if(decision.state==='manual_review'){state='manual_review';}
    // 217 etc never revoke the historical authorization or trigger a send.
  }catch{state='manual_review';code='RECOVERY_LEGACY_EVIDENCE_INVALID';}
  await rpc('fiscal_recovery_legacy_finish_v1',{p_request:l.requestId,p_token:l.token,p_state:state,p_code:code,p_proof:proof});
  return Date.now();
}
