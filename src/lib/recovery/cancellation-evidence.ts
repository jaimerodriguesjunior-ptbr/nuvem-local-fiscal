import {createHash} from 'node:crypto';
import {DOMParser,XMLSerializer,type Document,type Element} from '@xmldom/xmldom';
import {C14nCanonicalization,SignedXml} from 'xml-crypto';
import type {RecoveryDocument} from './model.js';
import {validateRecoveryDocument} from './evidence.js';
import type {CancellationSnapshot} from './cancellation-types.js';

const NFE='http://www.portalfiscal.inf.br/nfe',DS='http://www.w3.org/2000/09/xmldsig#';
export type FrozenCancellation={document:RecoveryDocument;authorizationProtocol:string;justification:string;
  signedEventXml:string;signedEventSha256:string};
export type CancellationDecision=
  {state:'cancelled';origin:'sefaz';code:'135'|'155';protocol:string;receivedAt:string;processedEventXml:string;evidenceXml:string}|
  {state:'rejected';origin:'sefaz';code:string;evidenceXml:string}|
  {state:'pending';origin:'sefaz'|'transport'|'local';code:string;evidenceXml?:string};

function parse(xml:string):Document {
  if(!xml||xml.length>4_000_000||/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('unsafe_xml');
  return new DOMParser({onError:()=>{throw Error('invalid_xml');}}).parseFromString(xml,'application/xml');
}
function one(parent:Document|Element,ns:string,name:string):Element {
  const nodes=parent.getElementsByTagNameNS(ns,name);if(nodes.length!==1)throw Error('ambiguous_xml');return nodes.item(0)!;
}
function child(parent:Element,ns:string,name:string):Element {
  const matches:Element[]=[];
  for(let node=parent.firstChild;node;node=node.nextSibling){
    if(node.nodeType===1&&(node as Element).namespaceURI===ns&&(node as Element).localName===name)matches.push(node as Element);
  }
  if(matches.length!==1)throw Error('ambiguous_direct_child');return matches[0];
}
function text(parent:Element,ns:string,name:string):string {
  const node=child(parent,ns,name);
  if(node.childNodes.length!==1||node.firstChild?.nodeType!==3)throw Error('invalid_xml_text');
  return node.textContent?.trim()??'';
}
function canonical(node:Element){return new C14nCanonicalization().process(node,{});}
function eventInfo(event:Element,frozen:FrozenCancellation):Element {
  const key=frozen.document.accessKey,info=child(event,NFE,'infEvento');
  if(info.getAttribute('Id')!==`ID110111${key}01`||text(info,NFE,'cOrgao')!==key.slice(0,2)||
    text(info,NFE,'tpAmb')!=='1'||text(info,NFE,'CNPJ')!==frozen.document.cnpj||text(info,NFE,'chNFe')!==key||
    text(info,NFE,'tpEvento')!=='110111'||text(info,NFE,'nSeqEvento')!=='1'||text(info,NFE,'verEvento')!=='1.00'||
    !Number.isFinite(Date.parse(text(info,NFE,'dhEvento'))))throw Error('event_identity_mismatch');
  const detail=child(info,NFE,'detEvento');
  if(text(detail,NFE,'descEvento')!=='Cancelamento'||text(detail,NFE,'nProt')!==frozen.authorizationProtocol||
    text(detail,NFE,'xJust')!==frozen.justification)throw Error('event_detail_mismatch');
  return info;
}

/** Verify the frozen event before it can acquire permission for a first send.
 * The public certificate is part of the already-prepared signed snapshot.
 */
export function validateFrozenCancellation(frozen:FrozenCancellation):{event:Element;info:Element} {
  validateRecoveryDocument(frozen.document);
  if(!/^\d{15}$/.test(frozen.authorizationProtocol)||frozen.justification!==frozen.justification.trim()||
    frozen.justification.length<15||frozen.justification.length>255||
    createHash('sha256').update(frozen.signedEventXml).digest('hex')!==frozen.signedEventSha256)throw Error('frozen_event_changed');
  const xml=parse(frozen.signedEventXml),event=xml.documentElement;
  if(!event||event.namespaceURI!==NFE||event.localName!=='evento')throw Error('invalid_event_root');
  const info=eventInfo(event,frozen),signature=child(event,DS,'Signature');
  const signedInfo=child(signature,DS,'SignedInfo'),reference=child(signedInfo,DS,'Reference');
  if(reference.getAttribute('URI')!==`#${info.getAttribute('Id')}`)throw Error('event_signature_reference_mismatch');
  const certificate=text(child(child(signature,DS,'KeyInfo'),DS,'X509Data'),DS,'X509Certificate').replace(/\s/g,'');
  if(!/^[A-Za-z0-9+/=]+$/.test(certificate))throw Error('invalid_event_certificate');
  const verifier=new SignedXml({publicCert:`-----BEGIN CERTIFICATE-----\n${certificate}\n-----END CERTIFICATE-----`,getCertFromKeyInfo:()=>null});
  verifier.loadSignature(signature);
  if(!verifier.checkSignature(frozen.signedEventXml))throw Error('event_signature_invalid');
  return {event,info};
}

export function validateCancellationSnapshot(frozen:FrozenCancellation,snapshot:CancellationSnapshot):void {
  const original=validateFrozenCancellation(frozen);
  if(snapshot.signedEventXml!==frozen.signedEventXml||snapshot.signedEventSha256!==frozen.signedEventSha256||
    snapshot.eventId!==`ID110111${frozen.document.accessKey}01`||!/^\d{1,15}$/.test(snapshot.batchId)||
    createHash('sha256').update(snapshot.batchXml).digest('hex')!==snapshot.batchSha256)throw Error('cancellation_batch_changed');
  const batch=parse(snapshot.batchXml).documentElement;
  if(!batch||batch.namespaceURI!==NFE||batch.localName!=='envEvento'||text(batch,NFE,'idLote')!==snapshot.batchId||
    canonical(child(batch,NFE,'evento'))!==canonical(original.event))throw Error('cancellation_batch_event_mismatch');
  let elements=0;for(let node=batch.firstChild;node;node=node.nextSibling)if(node.nodeType===1)elements++;
  if(elements!==2)throw Error('cancellation_batch_multiple_events');
  const request=parse(snapshot.requestXml).documentElement;
  if(!request||request.namespaceURI!==NFE||request.localName!=='evento'||
    canonical(eventInfo(request,frozen))!==canonical(original.info))throw Error('cancellation_request_changed');
}

function verifyResult(frozen:FrozenCancellation,event:Element,result:Element,evidenceXml:string,allowRejection:boolean):CancellationDecision {
  const info=child(result,NFE,'infEvento'),key=frozen.document.accessKey,id=info.getAttribute('Id');
  if((id&&id!==`ID110111${key}01`)||text(info,NFE,'tpAmb')!=='1'||text(info,NFE,'cOrgao')!==key.slice(0,2)||
    text(info,NFE,'chNFe')!==key||text(info,NFE,'tpEvento')!=='110111'||text(info,NFE,'nSeqEvento')!=='1')throw Error('result_identity_mismatch');
  const code=text(info,NFE,'cStat');
  if(!['135','155'].includes(code)){
    if(allowRejection&&/^[2-9]\d\d$/.test(code)&&!['573','580','656','999'].includes(code))return {state:'rejected',origin:'sefaz',code,evidenceXml};
    return {state:'pending',origin:'sefaz',code,evidenceXml};
  }
  const protocol=text(info,NFE,'nProt'),receivedAt=text(info,NFE,'dhRegEvento');
  if(!/^\d{15}$/.test(protocol)||!Number.isFinite(Date.parse(receivedAt)))throw Error('result_protocol_invalid');
  const serializer=new XMLSerializer();
  return {state:'cancelled',origin:'sefaz',code:code as '135'|'155',protocol,receivedAt,evidenceXml,
    processedEventXml:`<?xml version="1.0" encoding="UTF-8"?><procEventoNFe xmlns="${NFE}" versao="1.00">${serializer.serializeToString(event)}${serializer.serializeToString(result)}</procEventoNFe>`};
}

export function reconcileInitialCancellation(frozen:FrozenCancellation,responseXml:string):CancellationDecision {
  try{
    const {event}=validateFrozenCancellation(frozen),xml=parse(responseXml),batch=one(xml,NFE,'retEnvEvento');
    if(text(batch,NFE,'tpAmb')!=='1'||text(batch,NFE,'cOrgao')!==frozen.document.accessKey.slice(0,2))throw Error('batch_identity_mismatch');
    const code=text(batch,NFE,'cStat');if(code!=='128')return {state:'pending',origin:'sefaz',code,evidenceXml:responseXml};
    return verifyResult(frozen,event,child(batch,NFE,'retEvento'),responseXml,true);
  }catch{return {state:'pending',origin:'local',code:'RECOVERY_CANCELLATION_EVIDENCE_INVALID'};}
}

/** Only a matching signed event and its linked protocol can recover a lost
 * cancellation response. A note-level 101/151 alone cannot substitute them.
 */
export function reconcileCancellationConsultation(frozen:FrozenCancellation,responseXml:string):CancellationDecision {
  try{
    const original=validateFrozenCancellation(frozen),xml=parse(responseXml),result=one(xml,NFE,'retConsSitNFe');
    if(text(result,NFE,'tpAmb')!=='1'||text(result,NFE,'chNFe')!==frozen.document.accessKey)throw Error('query_identity_mismatch');
    const candidates=result.getElementsByTagNameNS(NFE,'procEventoNFe');let match:Element|null=null;
    for(let index=0;index<candidates.length;index++){
      const proc=candidates.item(index)!;if(proc.parentNode!==result)throw Error('invalid_proc_location');
      const event=child(proc,NFE,'evento'),info=child(event,NFE,'infEvento');
      if(text(info,NFE,'tpEvento')!=='110111')continue;
      if(match)throw Error('ambiguous_cancellation');match=proc;
    }
    if(!match)return {state:'pending',origin:'sefaz',code:text(result,NFE,'cStat'),evidenceXml:responseXml};
    const event=child(match,NFE,'evento'),info=eventInfo(event,frozen);
    if(canonical(info)!==canonical(original.info)||canonical(child(event,DS,'Signature'))!==canonical(child(original.event,DS,'Signature'))) {
      throw Error('recovered_event_changed');
    }
    return verifyResult(frozen,event,child(match,NFE,'retEvento'),responseXml,false);
  }catch{return {state:'pending',origin:'local',code:'RECOVERY_CANCELLATION_EVIDENCE_INVALID'};}
}
