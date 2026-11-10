import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildOgNumberConflictClosureEvidence,type ErpConflictInvoice,type ErpConflictAttempt} from './og-number-conflict-closure.js';
import {decodeManagedDocument} from './managed-repository.js';
import {publicManagedDocument} from './runtime.js';
import {managedAdminEvents} from './admin-documents.js';
import type {ManagedDocument} from './controller-types.js';

function fixture(){
  const scope={id:'11111111-1111-4111-8111-111111111111',organizationId:'22222222-2222-4222-8222-222222222222',
    storeId:7,clientId:'client',cnpj:'12345678000195',environment:'producao' as const,model:'NFe' as const,series:1};
  const request='33333333-3333-4333-8333-333333333333',next='44444444-4444-4444-8444-444444444444';
  const current:ManagedDocument={scope,requestId:request,originId:'og:invoice:39',requestHash:'a'.repeat(64),version:8,
    phase:'pending',errorOrigin:'sefaz',code:'539',sendStartedAt:'2026-10-30T12:00:00Z',ownerToken:null,
    document:{id:'rv1_'+request,providerLikeId:'rv1_'+request,tipoDocumento:'NFe',issuerCnpj:scope.cnpj,ambiente:'producao',
      numero:2499,serie:1,status:'processamento',chave:'1'.repeat(44),protocolo:null,motivo:'Conflito',motivoStatus:'539',
      mensagens:[],payloadOriginal:{},payloadNormalizado:{},xml:'',pdfUrl:'',createdAt:'2026-10-30T12:00:00Z',updatedAt:'2026-11-10T12:00:00Z'}};
  const successor:ManagedDocument={...current,requestId:next,originId:'og:invoice:40',phase:'authorized',code:'100',
    document:{...current.document,id:'rv1_'+next,providerLikeId:'rv1_'+next,numero:2500,chave:'2'.repeat(44),
      status:'autorizado',protocolo:'141260000000001',xml:'<synthetic/>'}};
  const invoice:ErpConflictInvoice={id:39,tenant_id:scope.organizationId,store_id:7,tipo_documento:'NFe',environment:'production',direction:'output',
    status:'rejected',numero:2499,serie:1,valor_total:5398,chave_acesso:current.document.chave,nuvemfiscal_uuid:current.document.id,
    recovery_request_id:request,nfe_request_key:'55555555-5555-4555-8555-555555555555',current_attempt_id:'attempt',error_message:'NUMBER_CONFLICT_RESOLVED: Encerrada localmente.'};
  const replacement={...invoice,id:40,status:'authorized',numero:2500,chave_acesso:successor.document.chave,
    nuvemfiscal_uuid:successor.document.id,recovery_request_id:next,nfe_request_key:'66666666-6666-4666-8666-666666666666',current_attempt_id:'next-attempt',error_message:null};
  const attempt:ErpConflictAttempt={id:'attempt',invoice_id:39,operation:'submission',state:'completed',recovery_state:'settled',recovery_due_at:null};
  const resolution={invoice_id:39,tenant_id:scope.organizationId,store_id:7,source_invoice_id:19,attempt_id:'attempt',request_id:request,
    client_id:scope.clientId,original_key:current.document.chave!,original_number:2499,provider_version:8,successor_invoice_id:40,
    successor_request_id:replacement.nfe_request_key,requires_review:false,created_at:'2026-10-30T13:00:00Z',late_result:null,late_xml:null};
  return {current,successor,invoice,replacement,attempt,resolution};
}
test('closure evidence requires the actual ERP ledger, settled attempt and authorized linked successor',()=>{
  const f=fixture(),proof=buildOgNumberConflictClosureEvidence(f.resolution,f.invoice,f.replacement,f.attempt,f.current,f.successor);
  assert.equal(proof.originalNumber,2499);assert.equal(proof.successorNumber,2500);assert.equal(proof.amount,5398);
  assert.notEqual(proof.successorDraftKey,proof.successorRequestId);
  for(const mutate of [
    (x:typeof f)=>{x.resolution.requires_review=true;},(x:typeof f)=>{(x.resolution as any).late_result={phase:'authorized'};},
    (x:typeof f)=>{x.resolution.original_key='3'.repeat(44);},(x:typeof f)=>{x.resolution.successor_request_id=x.current.requestId;},
    (x:typeof f)=>{x.invoice.error_message=null;},(x:typeof f)=>{x.attempt.recovery_state='pending';},
    (x:typeof f)=>{x.attempt.recovery_due_at='2026-11-10';},(x:typeof f)=>{x.replacement.tenant_id='foreign';},
    (x:typeof f)=>{x.replacement.valor_total=1;},(x:typeof f)=>{x.successor.phase='pending';},
    (x:typeof f)=>{x.successor.document.protocolo=null;},(x:typeof f)=>{x.current.phase='authorized';}
  ]){const invalid=fixture();mutate(invalid);assert.throws(()=>buildOgNumberConflictClosureEvidence(invalid.resolution,invalid.invoice,
    invalid.replacement,invalid.attempt,invalid.current,invalid.successor),/OG_CLOSURE_EVIDENCE_INVALID/);}
});
test('public closure metadata and log preserve the original fiscal warning and add a dated administrative event',()=>{
  const {current}=fixture();current.administrativeClosure={kind:'superseded_number_conflict',closedAt:'2026-11-10T13:00:00Z',
    successorId:'rv1_44444444-4444-4444-8444-444444444444',successorNumber:2500,erpInvoiceId:39,erpSuccessorInvoiceId:40,erpResolvedAt:'2026-10-30T13:00:00Z'};
  const decoded=decodeManagedDocument(current),document=publicManagedDocument(decoded);
  assert.equal(document.status,'processamento');assert.equal(document.recovery.code,'539');
  const events=managedAdminEvents({document,legacyId:null,receivedAt:document.createdAt,updatedAt:document.updatedAt,sendStartedAt:current.sendStartedAt});
  assert.equal(events.find(e=>e.eventType==='managed_current')?.level,'warn');
  const closure=events.find(e=>e.eventType==='managed_administratively_closed');assert.equal(closure?.level,'info');
  assert.equal(closure?.createdAt,current.administrativeClosure.closedAt);assert.ok(closure?.message.includes('#2500'));
  for(const change of [{successorNumber:2499},{successorId:current.document.id},{closedAt:'invalid'},{erpInvoiceId:0}]){
    assert.throws(()=>decodeManagedDocument({...current,administrativeClosure:{...current.administrativeClosure,...change}}),/CLOSURE_INVALID/);
  }
});
