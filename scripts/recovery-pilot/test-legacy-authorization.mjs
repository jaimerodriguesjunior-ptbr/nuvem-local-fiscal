/** Real synthetic signature + frozen identity + consultation proof, no I/O. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),forge=require('node-forge');
const {SignedXml}=require('xml-crypto'),{DOMParser}=require('@xmldom/xmldom');
const {verifyLegacyAuthorization}=require('../../dist/lib/recovery/legacy-authorization.js');
const {fixtureScope,fixtureSignedXml,fixtureKey}=require('../../dist/lib/recovery/test-fixtures.js');

test('legacy association requires intact signed XML and matching current authorization; never infers eligibility from status flags',()=>{
  const keys=forge.pki.rsa.generateKeyPair(1024),certificate=forge.pki.createCertificate();
  certificate.publicKey=keys.publicKey;certificate.serialNumber='11';
  certificate.validity.notBefore=new Date('2020-01-01T00:00:00Z');certificate.validity.notAfter=new Date('2021-01-01T00:00:00Z');
  certificate.setSubject([{name:'commonName',value:'Synthetic expired historical certificate'}]);
  certificate.setIssuer(certificate.subject.attributes);certificate.sign(keys.privateKey,forge.md.sha256.create());
  const signer=new SignedXml({privateKey:forge.pki.privateKeyToPem(keys.privateKey),publicCert:forge.pki.certificateToPem(certificate),
    signatureAlgorithm:'http://www.w3.org/2000/09/xmldsig#rsa-sha1',canonicalizationAlgorithm:'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'});
  signer.addReference({xpath:"//*[local-name()='infNFe']",digestAlgorithm:'http://www.w3.org/2000/09/xmldsig#sha1',
    transforms:['http://www.w3.org/2000/09/xmldsig#enveloped-signature','http://www.w3.org/TR/2001/REC-xml-c14n-20010315']});
  signer.computeSignature(fixtureSignedXml.replace(/<Signature[\s\S]*<\/Signature>/,''),
    {location:{reference:"//*[local-name()='NFe']",action:'append'}});
  const signedXml=signer.getSignedXml(),scope={...fixtureScope,id:'11111111-1111-4111-8111-111111111111'};
  const source={id:'doc_historical',providerLikeId:'doc_historical',status:'autorizado',issuerCnpj:scope.cnpj,ambiente:'producao',
    tipoDocumento:'NFCe',serie:2,numero:123,chave:fixtureKey,protocolo:'141260000000001',xmlSigned:signedXml,signatureValid:true};
  const xml=new DOMParser().parseFromString(signedXml,'application/xml');
  const digest=xml.getElementsByTagNameNS('http://www.w3.org/2000/09/xmldsig#','DigestValue').item(0).textContent;
  const reply=(code='100',value=digest,protocol=source.protocolo)=>`<retConsSitNFe xmlns="http://www.portalfiscal.inf.br/nfe"><tpAmb>1</tpAmb><cStat>${code}</cStat><chNFe>${fixtureKey}</chNFe>${code==='100'?`<protNFe><infProt><tpAmb>1</tpAmb><chNFe>${fixtureKey}</chNFe><cStat>100</cStat><nProt>${protocol}</nProt>${value===null?'':`<digVal>${value}</digVal>`}</infProt></protNFe>`:''}</retConsSitNFe>`;
  assert.equal(verifyLegacyAuthorization(scope,source,reply()).adoptionMethod,'legacy_authorized_consultation_v1');
  for(const patch of [{status:'processamento'},{id:'rv1_'+scope.id},{issuerCnpj:'9'.repeat(14)},{serie:3},
    {cancellationState:'pendente_confirmacao'},{cancellationSignedXml:'possible old event'},
    {xmlSigned:signedXml.replace('<nNF>123</nNF>','<nNF>124</nNF>')},
    {xmlSigned:signedXml.replace('<tpAmb>1</tpAmb>','<tpAmb>2</tpAmb>')},
    {xmlSigned:signedXml.replace(/<SignatureValue>[^<]+/, '<SignatureValue>AAAA')}])
    assert.throws(()=>verifyLegacyAuthorization(scope,{...source,...patch},reply()));
  for(const response of [reply('217'),reply('539'),reply('100',null),reply('100','different'),reply('100',digest,'141260000000999')])
    assert.throws(()=>verifyLegacyAuthorization(scope,source,response),/UNCONFIRMED/);
  // A false flag alone must not override valid bytes; it is neither necessary
  // nor sufficient proof. The exact signed content + consultation are checked.
  assert.equal(verifyLegacyAuthorization(scope,{...source,signatureValid:false},reply()).authorizationProtocol,source.protocolo);
});
