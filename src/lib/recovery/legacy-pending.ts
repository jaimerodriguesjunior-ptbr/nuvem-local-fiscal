import {createHash} from 'node:crypto';
import {DOMParser} from '@xmldom/xmldom';
import {SignedXml} from 'xml-crypto';
import type {ManagedScope} from './controller-types.js';
import {validateRecoveryDocument,reconcileInitialAuthorization} from './evidence.js';

const NFE='http://www.portalfiscal.inf.br/nfe',DS='http://www.w3.org/2000/09/xmldsig#';
export function verifyLegacyPendingSnapshot(scope:ManagedScope,source:Record<string,any>) {
  if(!['erro','processamento','processando','rejeitado'].includes(source.status)||source.protocol||
    source.cancellation_state||source.cancellation_attempt_id||source.cancellation_request_xml||source.cancellation_response_xml||
    source.cancelled_at||!source.signed_xml||source.issuer_cnpj!==scope.cnpj||source.document_type!==scope.model||
    source.environment!==scope.environment||source.serie!==scope.series)throw Error('RECOVERY_LEGACY_PENDING_INELIGIBLE');
  const signedXmlSha256=createHash('sha256').update(source.signed_xml).digest('hex');
  const frozen={...scope,documentId:source.id,number:source.number,accessKey:source.access_key,
    signedXml:source.signed_xml,signedXmlSha256};
  validateRecoveryDocument(frozen);
  const doc=new DOMParser({onError:()=>{throw Error('RECOVERY_LEGACY_SIGNATURE_INVALID');}}).parseFromString(source.signed_xml,'application/xml');
  const signatures=doc.getElementsByTagNameNS(DS,'Signature'),certs=doc.getElementsByTagNameNS(DS,'X509Certificate');
  if(signatures.length!==1||certs.length!==1)throw Error('RECOVERY_LEGACY_SIGNATURE_INVALID');
  const cert=certs.item(0)!.textContent?.replace(/\s/g,'')??'';
  if(!/^[A-Za-z0-9+/=]+$/.test(cert))throw Error('RECOVERY_LEGACY_SIGNATURE_INVALID');
  const verifier=new SignedXml({publicCert:`-----BEGIN CERTIFICATE-----\n${cert}\n-----END CERTIFICATE-----`,getCertFromKeyInfo:()=>null});
  verifier.loadSignature(signatures.item(0)!);
  if(!verifier.checkSignature(source.signed_xml))throw Error('RECOVERY_LEGACY_SIGNATURE_INVALID');
  const evidenceXml=String(source.sefaz_response_xml??'');
  if(evidenceXml){
    const decision=reconcileInitialAuthorization(frozen,evidenceXml);
    if(decision.state==='authorized'||decision.state==='rejected')return {...decision,signedXmlSha256};
    // Explicitly reviewed batch content rejection, bound to the immutable
    // stored request/response snapshot. This is not a generic `erro` mapping.
    if(!/<!DOCTYPE|<!ENTITY/i.test(evidenceXml)&&evidenceXml.length<4_000_000){
      const response=new DOMParser({onError:()=>{throw Error('RECOVERY_LEGACY_EVIDENCE_INVALID');}}).parseFromString(evidenceXml,'application/xml');
      const batches=response.getElementsByTagNameNS(NFE,'retEnviNFe');
      const batch=batches.item(0);
      const field=(name:string)=>{const values=[];for(let n=batch?.firstChild;n;n=n.nextSibling)
        if(n.nodeType===1&&(n as any).namespaceURI===NFE&&(n as any).localName===name)values.push(n.textContent?.trim());
        return values.length===1?values[0]:null;};
      if(batches.length===1&&field('tpAmb')==='1'&&field('cStat')==='974'&&field('xMotivo')&&
        response.getElementsByTagNameNS(NFE,'protNFe').length===0&&source.reason_code==='974')
        return {state:'rejected' as const,origin:'sefaz',code:'974',reason:field('xMotivo'),evidenceXml,signedXmlSha256};
    }
  }
  return {state:'pending' as const,origin:'central',code:'LEGACY_PENDING_CONSULTATION',signedXmlSha256};
}
