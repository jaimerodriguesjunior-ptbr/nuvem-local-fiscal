import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import forge from 'node-forge';
import {recoveryDatabaseTls} from './database-tls.js';

test('database trust remains verified and rejects invalid, expired and non-CA certificates',()=>{
  const dir=mkdtempSync(join(tmpdir(),'recovery-tls-')),file=join(dir,'ca.pem');
  try{
    assert.throws(()=>recoveryDatabaseTls(''),/^Error: RECOVERY_DATABASE_CA_INVALID$/);
    assert.throws(()=>recoveryDatabaseTls(join(dir,'missing')),/^Error: RECOVERY_DATABASE_CA_INVALID$/);
    writeFileSync(file,'invalid');assert.throws(()=>recoveryDatabaseTls(file),/CA_INVALID/);
    const keys=forge.pki.rsa.generateKeyPair(1024);
    const make=(isCa:boolean,expired=false)=>{
      const cert=forge.pki.createCertificate();cert.publicKey=keys.publicKey;cert.serialNumber='13';
      cert.validity.notBefore=new Date(Date.now()-86_400_000);cert.validity.notAfter=new Date(Date.now()+(expired?-60_000:86_400_000));
      cert.setSubject([{name:'commonName',value:'Synthetic trust fixture'}]);cert.setIssuer(cert.subject.attributes);
      cert.setExtensions([{name:'basicConstraints',cA:isCa}]);cert.sign(keys.privateKey,forge.md.sha256.create());
      return forge.pki.certificateToPem(cert);
    };
    writeFileSync(file,make(false));assert.throws(()=>recoveryDatabaseTls(file),/CA_INVALID/);
    writeFileSync(file,make(true,true));assert.throws(()=>recoveryDatabaseTls(file),/CA_INVALID/);
    const ca=make(true);writeFileSync(file,ca);assert.deepEqual(recoveryDatabaseTls(file),{rejectUnauthorized:true,ca});
    writeFileSync(file,ca+ca);assert.throws(()=>recoveryDatabaseTls(file),/CA_INVALID/);
  }finally{rmSync(join(dir,'ca.pem'),{force:true});rmdirSync(dir);}
});
