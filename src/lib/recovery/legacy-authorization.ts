import {createHash} from 'node:crypto';
import {DOMParser} from '@xmldom/xmldom';
import {SignedXml} from 'xml-crypto';
import type {DocumentRecord} from '../../types.js';
import type {ManagedScope} from './controller-types.js';
import {reconcileConsultation,validateRecoveryDocument} from './evidence.js';

/** Adoption is a new, explicit association of an old authorized document. It
 * never invents a historical request/send timestamp or grants authorization
 * transmission. The caller must still commit the association with source CAS.
 * No signer or transmission adapter is available in this module. */
export function verifyLegacyAuthorization(scope:ManagedScope,source:DocumentRecord,responseXml:string) {
  if(source.id.startsWith('rv1_')||source.status!=='autorizado'||source.issuerCnpj!==scope.cnpj||
    source.ambiente!==scope.environment||source.tipoDocumento!==scope.model||source.serie!==scope.series||
    !source.xmlSigned||!source.chave||!/^\d{15}$/.test(source.protocolo??'')||
    source.cancellationState||source.cancellationAttemptId||source.cancellationRequestXml||
    source.cancellationSignedXml||source.cancellationResponseXml||source.cancellationProcessedXml||source.cancelledAt) {
    throw Error('RECOVERY_LEGACY_ADOPTION_INELIGIBLE');
  }
  const frozen={...scope,documentId:source.id,number:source.numero,accessKey:source.chave,
    signedXml:source.xmlSigned,signedXmlSha256:createHash('sha256').update(source.xmlSigned).digest('hex')};
  validateRecoveryDocument(frozen);
  // Stored signature_valid alone is not evidence of valid historical bytes.
  // The embedded certificate verifies integrity; this is not a fresh PKI or
  // certificate-validity audit. A fresh authenticated SEFAZ consultation below
  // must separately match the frozen digest and stored authorization protocol.
  const xml=new DOMParser({onError:()=>{throw Error('RECOVERY_LEGACY_SIGNATURE_INVALID');}})
    .parseFromString(source.xmlSigned,'application/xml');
  const ds='http://www.w3.org/2000/09/xmldsig#',signatures=xml.getElementsByTagNameNS(ds,'Signature');
  const certificates=xml.getElementsByTagNameNS(ds,'X509Certificate');
  if(signatures.length!==1||certificates.length!==1)throw Error('RECOVERY_LEGACY_SIGNATURE_INVALID');
  const certificate=certificates.item(0)!.textContent?.replace(/\s/g,'')??'';
  if(!/^[A-Za-z0-9+/=]+$/.test(certificate))throw Error('RECOVERY_LEGACY_SIGNATURE_INVALID');
  const verifier=new SignedXml({publicCert:`-----BEGIN CERTIFICATE-----\n${certificate}\n-----END CERTIFICATE-----`,getCertFromKeyInfo:()=>null});
  verifier.loadSignature(signatures.item(0)!);
  if(!verifier.checkSignature(source.xmlSigned))throw Error('RECOVERY_LEGACY_SIGNATURE_INVALID');
  const decision=reconcileConsultation(frozen,responseXml);
  if(decision.state!=='authorized'||decision.protocol!==source.protocolo)throw Error('RECOVERY_LEGACY_AUTHORIZATION_UNCONFIRMED');
  return {legacyId:source.id,scopeId:scope.id,signedXmlSha256:frozen.signedXmlSha256,
    authorizationProtocol:decision.protocol,authorizationCode:decision.code,processedXml:decision.processedXml,evidenceXml:decision.evidenceXml,
    adoptionMethod:'legacy_authorized_consultation_v1' as const};
}
