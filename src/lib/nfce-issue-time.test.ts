import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {DocumentRecord} from '../types.js';
import {refreshNfceIssueTime} from './nfce-issue-time.js';
import {RecoveryController} from './recovery/controller.js';
import type {ManagedDocument,ManagedRepository} from './recovery/controller-types.js';
import {fixtureScope,fixtureKey,fixtureSignedXml} from './recovery/test-fixtures.js';

const now=new Date('2026-10-20T14:00:00Z');
function doc():DocumentRecord{return {id:'rv1_11111111-1111-4111-8111-111111111111',providerLikeId:'rv1_11111111-1111-4111-8111-111111111111',
 tipoDocumento:'NFCe',issuerCnpj:fixtureScope.cnpj,ambiente:'producao',status:'processamento',numero:123,serie:2,chave:null,protoclo:null,
 protocolo:null,motivo:null,motivoStatus:null,mensagens:[],payloadOriginal:{infNFe:{ide:{dhEmi:'2026-10-20T10:00:00-03:00',cNF:'01234567',mod:65,tpAmb:1,nNF:123,serie:2},emit:{CNPJ:fixtureScope.cnpj},pag:{detPag:[{tPag:'17',vPag:298,card:{tpIntegra:2}}]}}},
 payloadNormalizado:{ide:{dhEmi:'2026-10-20T10:00:00-03:00'}},xml:'',pdfUrl:'',createdAt:'',updatedAt:''} as DocumentRecord;}

test('first-send NFC-e refresh changes only the issue time, retaining original evidence and financial identity',()=>{
 const original=doc(),before=structuredClone(original),after=refreshNfceIssueTime(original,now,'never_sent');
 assert.deepEqual(original,before);
 const expected=structuredClone(before.payloadOriginal) as any;expected.infNFe.ide.dhEmi='2026-10-20T11:00:00-03:00';
 assert.deepEqual(after.payloadOriginal,expected);assert.equal(after.issueTimeHistory?.[0].previousIssueTime,'2026-10-20T10:00:00-03:00');
 assert.equal(after.issueTimeHistory?.[0].proof,'never_sent');assert.equal(after.numero,before.numero);
});
test('authorization, pending receipts, unsafe dates and key-month changes block refresh; NFe is unchanged',()=>{
 for(const patch of [{protocolo:'141260000000001'},{sefazReceipt:'1'},{sefazBatchId:'1'},{xml:'authorized'},{status:'autorizado'}])assert.throws(()=>refreshNfceIssueTime({...doc(),...patch} as DocumentRecord,now,'never_sent'));
 assert.throws(()=>refreshNfceIssueTime(doc(),new Date('2026-11-01T03:00:00Z'),'never_sent'),/MONTH_CHANGED/);
 const invalid=doc();(invalid.payloadOriginal as any).infNFe.ide.dhEmi='';assert.throws(()=>refreshNfceIssueTime(invalid,now,'never_sent'),/INVALID/);
 const nfe={...doc(),tipoDocumento:'NFe' as const};assert.equal(refreshNfceIssueTime(nfe,now,'never_sent'),nfe);
});
function harness(created=true,savePrepared=true){
 let current:ManagedDocument|null=null;let preparedTime='',consulted=0,authorized=0;const phases:string[]=[];
 const repo:ManagedRepository={async get(){return current;},async accept(scope,requestId,originId,requestHash,document,ownerToken){current={scope,requestId,originId,requestHash,document,ownerToken,phase:created?'accepted':'pending',version:1,errorOrigin:'central',code:'ACCEPTED',sendStartedAt:created?null:'2026-10-20T13:00:00Z'};return {created,record:current};},
 async transition(r,phase,document,errorOrigin,code){phases.push(phase);if(phase==='prepared'&&!savePrepared)return null;current={...r,phase,document,errorOrigin,code,version:r.version+1};return current;}};
 const controller=new RecoveryController(repo,{async prepare(d){preparedTime=(d.payloadOriginal as any).infNFe.ide.dhEmi;return {accessKey:fixtureKey,signedXml:fixtureSignedXml,unsignedXml:fixtureSignedXml,signatureValid:true,xsdValid:true,xsdErrors:[],certificateId:'synthetic'};},
 async consult(){consulted++;throw Error('OFFLINE_NO_SEFAZ');},async authorize(){authorized++;throw Error('MUST_NOT_SEND');}},()=>now);
 return {controller,phases,result:()=>({preparedTime,consulted,authorized})};
}
test('controller persists the refreshed signed snapshot before consultation and never resends an admitted request',async()=>{
 for(const created of [true,false]){const h=harness(created);const d=doc();await h.controller.submit({...fixtureScope,id:'scope'},d.id.slice(4),'test',d.payloadOriginal as any,{},null,true);
 assert.equal(h.result().authorized,0);assert.equal(h.result().consulted,created?1:0);assert.equal(h.result().preparedTime,created?'2026-10-20T11:00:00-03:00':'');assert.deepEqual(h.phases,created?['prepared','pending']:[]);}
});
test('failed preparation persistence prevents consultation and transmission',async()=>{
 const h=harness(true,false),d=doc();await h.controller.submit({...fixtureScope,id:'scope'},d.id.slice(4),'test',d.payloadOriginal as any,{},null);
 assert.deepEqual(h.result(),{preparedTime:'2026-10-20T11:00:00-03:00',consulted:0,authorized:0});
});
