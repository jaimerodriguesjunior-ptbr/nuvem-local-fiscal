import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import https from 'node:https';
import type {IncomingMessage} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import tls from 'node:tls';
import forge from 'node-forge';
import {encryptCertificateBundle} from './certificates.js';
import {buildSignedCancellationXml,transmitSignedCancellationAtSefaz} from './sefaz-cancellation.js';

// Synthetic certificate only. HTTPS is intercepted; these tests never call SEFAZ.
const password='synthetic-cancellation-password',secret='synthetic-encryption-secret';
const keys=forge.pki.rsa.generateKeyPair(2048);
const certificate=forge.pki.createCertificate();
certificate.publicKey=keys.publicKey;
certificate.serialNumber='17';
certificate.validity.notBefore=new Date('2026-01-01T00:00:00Z');
certificate.validity.notAfter=new Date('2030-01-01T00:00:00Z');
certificate.setSubject([{name:'commonName',value:'synthetic-cancellation.test'}]);
certificate.setIssuer(certificate.subject.attributes);
certificate.sign(keys.privateKey,forge.md.sha256.create());
const pfx=Buffer.from(forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(keys.privateKey,[certificate],password,{algorithm:'aes256'})).getBytes(),'binary');

for(const documentType of ['NFe','NFCe'] as const){
  for(const fallback of [false,true]){
    test(`${documentType} cancellation uses ${fallback?'PEM compatibility':'accepted PFX'} and preserves the frozen event`,async(t)=>{
      const previousDirectory=process.cwd(),fixture=mkdtempSync(join(tmpdir(),'cancellation-tls-'));
      mkdirSync(join(fixture,'certificates'));
      writeFileSync(join(fixture,'certificates','icp-brasil-root-v10.pem'),forge.pki.certificateToPem(certificate));
      process.chdir(fixture);
      t.after(()=>{process.chdir(previousDirectory);rmSync(fixture,{recursive:true,force:true});});
      const accessKey=`41260601997929000108${documentType==='NFe'?'55':'65'}0020000000841689972490`;
      const justification='Erro de preenchimento nos dados da venda';
      const signed=buildSignedCancellationXml({uf:'PR',ambiente:'homologacao',cnpj:'01997929000108',accessKey,
        authorizationProtocol:'141260001354073',justification,eventDate:new Date('2026-06-11T13:00:00Z'),
        batchId:'123456789012345',privateKeyPem:forge.pki.privateKeyToPem(keys.privateKey),
        certificatePem:forge.pki.certificateToPem(certificate)});
      const original=structuredClone(signed);
      const createContext=tls.createSecureContext;
      if(fallback)t.mock.method(tls,'createSecureContext',(options?:tls.SecureContextOptions)=>{
        if(options?.pfx)throw new Error('Unsupported PKCS12 PFX data');
        return createContext(options);
      });
      let sentBody='',requests=0;
      t.mock.method(https,'request',((url:unknown,options:https.RequestOptions,callback:(response:IncomingMessage)=>void)=>{
        requests++;
        assert.equal(String(url),`https://homologacao.${documentType==='NFe'?'nfe':'nfce'}.sefa.pr.gov.br/${documentType==='NFe'?'nfe':'nfce'}/NFeRecepcaoEvento4`);
        assert.equal(options.method,'POST');
        assert.equal(options.minVersion,'TLSv1.2');
        assert.notEqual(options.rejectUnauthorized,false);
        assert.ok(Array.isArray(options.ca)&&options.ca.length>0);
        if(fallback){assert.equal(options.pfx,undefined);assert.equal(options.passphrase,undefined);assert.ok(options.key);assert.ok(options.cert);}
        else{assert.deepEqual(options.pfx,pfx);assert.equal(options.passphrase,password);assert.equal(options.key,undefined);}
        assert.doesNotThrow(()=>createContext(options));
        const request=new EventEmitter() as EventEmitter&{end:(body:string)=>void;destroy:(error:Error)=>void};
        request.destroy=error=>{request.emit('error',error);};
        request.end=body=>{
          sentBody=body;
          const response=new EventEmitter() as EventEmitter&{statusCode:number;setEncoding:(encoding:string)=>void};
          response.statusCode=200;response.setEncoding=()=>{};
          callback(response as unknown as IncomingMessage);
          queueMicrotask(()=>{
            response.emit('data',`<retEnvEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><tpAmb>2</tpAmb><cOrgao>41</cOrgao><cStat>128</cStat><xMotivo>Lote de Evento Processado</xMotivo><retEvento versao="1.00"><infEvento><tpAmb>2</tpAmb><cOrgao>41</cOrgao><cStat>135</cStat><xMotivo>Evento registrado e vinculado a NF-e</xMotivo><chNFe>${accessKey}</chNFe><tpEvento>110111</tpEvento><nSeqEvento>1</nSeqEvento><dhRegEvento>2026-06-11T10:00:00-03:00</dhRegEvento><nProt>141260001400000</nProt></infEvento></retEvento></retEnvEvento>`);
            response.emit('end');
          });
        };
        return request;
      }) as typeof https.request);
      const result=await transmitSignedCancellationAtSefaz({uf:'PR',ambiente:'homologacao',documentType,
        cnpj:'01997929000108',accessKey,authorizationProtocol:'141260001354073',justification,
        encryptedCertificateBundle:encryptCertificateBundle({pfxBase64:pfx.toString('base64'),password},secret),encryptionSecret:secret},signed);
      assert.equal(requests,1);assert.equal(result.statusCode,'135');assert.equal(result.protocol,'141260001400000');
      const embeddedBatch=sentBody.match(/<nfeDadosMsg[^>]*>([\s\S]*)<\/nfeDadosMsg>/)?.[1];
      assert.equal(embeddedBatch,signed.batchXml.replace(/^\s*<\?xml[^>]*\?>\s*/i,''));
      assert.deepEqual(signed,original);
      assert.equal(result.signedEventXml,original.signedEventXml);assert.equal(result.batchXml,original.batchXml);
    });
  }
}

test('cancellation never creates an HTTPS request when certificate credentials are invalid',async(t)=>{
  const request=t.mock.method(https,'request',()=>{throw new Error('Network must not be reached');});
  await assert.rejects(transmitSignedCancellationAtSefaz({uf:'PR',ambiente:'homologacao',documentType:'NFe',
    cnpj:'01997929000108',accessKey:'41260601997929000108550020000000841689972490',authorizationProtocol:'141260001354073',
    justification:'Erro de preenchimento nos dados da venda',encryptedCertificateBundle:encryptCertificateBundle({pfxBase64:pfx.toString('base64'),password:'wrong-password'},secret),encryptionSecret:secret},
    {eventId:'synthetic-event',batchId:'123',requestXml:'<evento/>',signedEventXml:'<evento/>',batchXml:'<envEvento/>'}));
  assert.equal(request.mock.callCount(),0);
});
