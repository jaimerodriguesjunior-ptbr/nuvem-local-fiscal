import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import forge from 'node-forge';
import {buildSignedCancellationXml} from '../sefaz-cancellation.js';
import {reconcileInitialCancellation,reconcileCancellationConsultation,validateFrozenCancellation,validateCancellationSnapshot,type FrozenCancellation} from './cancellation-evidence.js';
import {fixtureDocument,fixtureKey} from './test-fixtures.js';

const ns='http://www.portalfiscal.inf.br/nfe';
const keys=forge.pki.rsa.generateKeyPair(1024),cert=forge.pki.createCertificate();
cert.publicKey=keys.publicKey;cert.serialNumber='04';cert.validity.notBefore=new Date(Date.now()-60_000);
cert.validity.notAfter=new Date(Date.now()+86_400_000);cert.setSubject([{name:'commonName',value:'Local recovery cancellation fixture'}]);
cert.setIssuer(cert.subject.attributes);cert.sign(keys.privateKey,forge.md.sha256.create());
const signed=buildSignedCancellationXml({uf:'PR',ambiente:'producao',cnpj:fixtureDocument.cnpj,accessKey:fixtureKey,
  authorizationProtocol:'141260000000001',justification:'Erro no preenchimento da venda de teste',privateKeyPem:forge.pki.privateKeyToPem(keys.privateKey),
  certificatePem:forge.pki.certificateToPem(cert),eventDate:new Date('2026-10-24T12:00:00Z'),batchId:'123456789012345'});
const frozen:FrozenCancellation={document:fixtureDocument,authorizationProtocol:'141260000000001',
  justification:'Erro no preenchimento da venda de teste',signedEventXml:signed.signedEventXml,
  signedEventSha256:createHash('sha256').update(signed.signedEventXml).digest('hex')};
function ret(code='135',key=fixtureKey){return `<retEvento xmlns="${ns}" versao="1.00"><infEvento><tpAmb>1</tpAmb><cOrgao>41</cOrgao><cStat>${code}</cStat><chNFe>${key}</chNFe><tpEvento>110111</tpEvento><nSeqEvento>1</nSeqEvento><nProt>141260000000002</nProt><dhRegEvento>2026-10-24T09:01:00-03:00</dhRegEvento></infEvento></retEvento>`;}
function initial(code='135'){return `<retEnvEvento xmlns="${ns}"><tpAmb>1</tpAmb><cOrgao>41</cOrgao><cStat>128</cStat>${ret(code)}</retEnvEvento>`;}
function query(code='101',event=signed.signedEventXml,response=ret()){
  return `<retConsSitNFe xmlns="${ns}"><tpAmb>1</tpAmb><chNFe>${fixtureKey}</chNFe><cStat>${code}</cStat><procEventoNFe versao="1.00">${event.replace(/^<\?xml[^?]*\?>/,'')}${response}</procEventoNFe></retConsSitNFe>`;
}

test('frozen cancellation verifies a real signature and rejects changed bytes/identity',()=>{
  assert.doesNotThrow(()=>validateFrozenCancellation(frozen));
  assert.throws(()=>validateFrozenCancellation({...frozen,authorizationProtocol:'141260000000009'}));
  assert.throws(()=>validateFrozenCancellation({...frozen,signedEventXml:frozen.signedEventXml+' '}));
  const forged=frozen.signedEventXml.replace('Erro no preenchimento','Mudanca indevida no preenchimento');
  assert.throws(()=>validateFrozenCancellation({...frozen,signedEventXml:forged,signedEventSha256:createHash('sha256').update(forged).digest('hex')}));
});

test('persisted batch contains exactly the frozen event and matching unsigned request',()=>{
  const snapshot={...signed,signedEventSha256:frozen.signedEventSha256,batchSha256:createHash('sha256').update(signed.batchXml).digest('hex')};
  assert.doesNotThrow(()=>validateCancellationSnapshot(frozen,snapshot));
  assert.throws(()=>validateCancellationSnapshot(frozen,{...snapshot,batchId:'999'}));
  assert.throws(()=>validateCancellationSnapshot(frozen,{...snapshot,requestXml:signed.requestXml.replace('Erro no preenchimento','Outro erro no preenchimento')}));
  const doubled=signed.batchXml.replace('</envEvento>',signed.signedEventXml.replace(/^<\?xml[^?]*\?>/,'')+'</envEvento>');
  assert.throws(()=>validateCancellationSnapshot(frozen,{...snapshot,batchXml:doubled,batchSha256:createHash('sha256').update(doubled).digest('hex')}));
});

test('initial cancellation requires linked event, correct key/environment/sequence and protocol',()=>{
  for(const code of ['135','155']){
    const result=reconcileInitialCancellation(frozen,initial(code));assert.equal(result.state,'cancelled');
    if(result.state==='cancelled'){assert.equal(result.protocol,'141260000000002');assert.ok(result.processedEventXml.includes('procEventoNFe'));}
  }
  for(const xml of [initial('136'),initial('573'),initial('656'),initial().replace('<tpAmb>1','<tpAmb>2'),
    initial().replace('<nSeqEvento>1','<nSeqEvento>2'),initial().replace('<tpEvento>110111','<tpEvento>110110'),
    initial().replace('<nProt>141260000000002','<nProt>invalid'),initial().replace(fixtureKey,'9'.repeat(44))]){
    assert.equal(reconcileInitialCancellation(frozen,xml).state,'pending');
  }
  assert.equal(reconcileInitialCancellation(frozen,initial('501')).state,'rejected');
});

test('lost response is recovered from the same frozen signed event, including an authorized note-level status',()=>{
  for(const code of ['100','101','151'])assert.equal(reconcileCancellationConsultation(frozen,query(code)).state,'cancelled');
  const withoutEvent=`<retConsSitNFe xmlns="${ns}"><tpAmb>1</tpAmb><chNFe>${fixtureKey}</chNFe><cStat>101</cStat></retConsSitNFe>`;
  assert.equal(reconcileCancellationConsultation(frozen,withoutEvent).state,'pending');
  assert.equal(reconcileCancellationConsultation(frozen,query('101',signed.signedEventXml,ret('136'))).state,'pending');
});

test('ambiguous, malformed, entity-bearing or changed recovered events never cancel',()=>{
  const eventChanged=signed.signedEventXml.replace('Erro no preenchimento','Outro erro no preenchimento');
  const proc=`<procEventoNFe>${signed.signedEventXml.replace(/^<\?xml[^?]*\?>/,'')}${ret()}</procEventoNFe>`;
  for(const xml of [query('101',eventChanged),query().replace('</retConsSitNFe>',proc+'</retConsSitNFe>'),
    query().slice(0,-12),'<!DOCTYPE root [<!ENTITY x "x">]>'+query(),query('101',signed.signedEventXml,ret('135','9'.repeat(44)))]){
    assert.equal(reconcileCancellationConsultation(frozen,xml).state,'pending');
  }
});
