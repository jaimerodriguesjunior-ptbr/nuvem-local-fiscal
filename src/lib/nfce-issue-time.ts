import {createHash} from 'node:crypto';
import type {DocumentRecord} from '../types.js';

/** Caller must own a proven first-send admission, or a fresh keyed 704 recovery.
 * Never call from consultation workers or for an uncertain transmission. */
export function refreshNfceIssueTime(document:DocumentRecord, now:Date, proof:'never_sent'|'sefaz_704'):DocumentRecord {
  if(document.tipoDocumento!=='NFCe'||document.ambiente!=='producao')return document;
  if(document.protocolo||document.sefazReceipt||document.sefazBatchId||document.xml||
    ['autorizado','cancelado'].includes(document.status)||!Number.isFinite(now.getTime()))throw Error('NFCE_TIME_REFRESH_UNPROVEN');
  const payload=structuredClone(document.payloadOriginal) as Record<string,unknown>;
  const info=(payload?.infNFe??payload) as {ide?:Record<string,unknown>};
  const ide=info?.ide;
  const previous=String(ide?.dhEmi??'');
  if(!ide||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(previous)||!Number.isFinite(Date.parse(previous)))throw Error('NFCE_TIME_REFRESH_INVALID');
  const current=now.toLocaleString('sv-SE',{timeZone:'America/Sao_Paulo'}).replace(' ','T')+'-03:00';
  // Month is part of the access key. Never silently change a reserved identity.
  if(previous.slice(0,7)!==current.slice(0,7))throw Error('NFCE_TIME_REFRESH_MONTH_CHANGED');
  if(previous===current)return document;
  const previousPayloadHash=createHash('sha256').update(JSON.stringify(document.payloadOriginal)).digest('hex');
  ide.dhEmi=current;
  const normalized=document.payloadNormalizado&&typeof document.payloadNormalizado==='object'?structuredClone(document.payloadNormalizado) as Record<string,unknown>:{};
  normalized.ide=structuredClone(ide);
  return {...document,payloadOriginal:payload,payloadNormalizado:normalized,updatedAt:now.toISOString(),
    xmlGenerated:null,xmlSigned:null,signatureValid:false,xsdValid:false,xsdErrors:[],
    issueTimeHistory:[...(document.issueTimeHistory??[]),{previousIssueTime:previous,issueTime:current,proof,previousPayloadHash,at:now.toISOString()}]};
}
