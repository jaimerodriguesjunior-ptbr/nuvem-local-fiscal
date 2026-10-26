// Disposable in-memory PostgreSQL + actual verifier/controller RPCs. No .env or fiscal network.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {PGlite} from '../../.test-tools/node_modules/@electric-sql/pglite/dist/index.js';
import {createCatalogFixture,insertTestDocument} from './database-fixture.mjs';
const require=createRequire(import.meta.url),forge=require('node-forge');
const {SignedXml}=require('xml-crypto'),{DOMParser}=require('@xmldom/xmldom');
const {verifyLegacyPendingSnapshot}=require('../../dist/lib/recovery/legacy-pending.js');
const {reconcileConsultation}=require('../../dist/lib/recovery/evidence.js');
const {publicManagedDocument}=require('../../dist/lib/recovery/runtime.js');
const {fixtureScope,fixtureKey,fixtureSignedXml}=require('../../dist/lib/recovery/test-fixtures.js');
const migrations=['20261024_recovery_v1_PREPARE_ONLY.sql','20261024_recovery_controller_PREPARE_ONLY.sql',
 '20261024_recovery_sync_PREPARE_ONLY.sql','20261024_recovery_manual_PREPARE_ONLY.sql','20261024_recovery_cancellation_PREPARE_ONLY.sql',
 '20261024_recovery_legacy_adoption_PREPARE_ONLY.sql','20261025_recovery_legacy_queue_PREPARE_ONLY.sql',
 'manual/INSTALL_RECOVERY_DISABLED_CENTRAL_OG_20261026.sql'];
const keys=forge.pki.rsa.generateKeyPair(1024),cert=forge.pki.createCertificate();cert.publicKey=keys.publicKey;cert.serialNumber='22';
cert.validity.notBefore=new Date('2020-01-01Z');cert.validity.notAfter=new Date('2021-01-01Z');
cert.setSubject([{name:'commonName',value:'Synthetic historical fixture'}]);cert.setIssuer(cert.subject.attributes);cert.sign(keys.privateKey,forge.md.sha256.create());
function signed(number){
  const base=fixtureKey.slice(0,25)+String(number).padStart(9,'0')+fixtureKey.slice(34,43);
  let sum=0;for(let i=42,w=2;i>=0;i--,w=w===9?2:w+1)sum+=Number(base[i])*w;
  const key=base+(sum%11<2?0:11-sum%11);
  const signer=new SignedXml({privateKey:forge.pki.privateKeyToPem(keys.privateKey),publicCert:forge.pki.certificateToPem(cert),
    signatureAlgorithm:'http://www.w3.org/2000/09/xmldsig#rsa-sha1',canonicalizationAlgorithm:'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'});
  signer.addReference({xpath:"//*[local-name()='infNFe']",digestAlgorithm:'http://www.w3.org/2000/09/xmldsig#sha1',
    transforms:['http://www.w3.org/2000/09/xmldsig#enveloped-signature','http://www.w3.org/TR/2001/REC-xml-c14n-20010315']});
  signer.computeSignature(fixtureSignedXml.replace(/<Signature[\s\S]*<\/Signature>/,'').replaceAll(fixtureKey,key).replace('<nNF>123</nNF>',`<nNF>${number}</nNF>`),
    {location:{reference:"//*[local-name()='NFe']",action:'append'}});
  return {key,xml:signer.getSignedXml()};
}
test('OG positive scope bindings and historical rejection/pending recovery use only immutable evidence and query jobs',async()=>{
 const db=new PGlite();try{
  await createCatalogFixture(db);for(const name of migrations)await db.exec(await readFile(new URL('../../migrations/'+name,import.meta.url),'utf8'));
  const verification=await db.exec(await readFile(new URL('../../migrations/manual/VERIFY_RECOVERY_DISABLED_CENTRAL_OG_20261026.sql',import.meta.url),'utf8'));
  const installed=verification.flatMap(r=>r.rows).find(r=>r.recovery_installation)?.recovery_installation;
  assert.equal(installed.bindings,0);assert.equal(installed.enabled_bindings,0);assert.equal(installed.legacy_pending_requests,0);
  assert.equal(installed.new_rpc_public_execute,0);assert.equal(installed.service_rpc_count,2);assert.equal(installed.binding_rls,true);
  const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
  const scope={...fixtureScope,id:randomUUID(),storeId:23};
  await q(`insert into public.fiscal_api_clients(id,name,client_id,client_secret_hash,allowed_scopes,allowed_environments,allowed_cnpjs)
    values('fixture','fixture',$1,'not-a-real-secret',array['empresa','nfce'],array['producao'],array[$2])`,[scope.clientId,scope.cnpj]);
  await q(`insert into fiscal_recovery.scopes(id,client_id,organization_id,store_id,cnpj,environment,model,series,enabled)
    values($1,$2,$3,23,$4,'producao','NFCe',2,true)`,[scope.id,scope.clientId,scope.organizationId,scope.cnpj]);
  const scopes=async(client=scope.clientId)=>(await q('select fiscal_recovery_og_scopes_v1($1,$2) r',[[scope.id],client]))[0].r;
  assert.deepEqual(await scopes(),[]);await q('insert into fiscal_recovery.og_scope_bindings(scope_id) values($1)',[scope.id]);
  assert.deepEqual(await scopes(),[]);await q('update fiscal_recovery.og_scope_bindings set enabled=true');
  assert.equal((await scopes())[0].storeId,23);assert.deepEqual(await scopes('other-fixture'),[]);
  const seed=async(id,number,code)=>{const s=signed(number);await insertTestDocument(db,id,number,s.key,'erro');
    const xml=`<retEnviNFe xmlns="http://www.portalfiscal.inf.br/nfe"><tpAmb>1</tpAmb><cStat>${code}</cStat><xMotivo>Motivo sintetico</xMotivo></retEnviNFe>`;
    await q('update fiscal_documents set signed_xml=$2,sefaz_response_xml=$3,reason_code=$4 where id=$1',[id,s.xml,xml,code]);
    return s;};
  const snapshot=async(id)=>(await q('select fiscal_recovery_legacy_source_v1($1,$2,$3) r',[id,scope.id,scope.clientId]))[0].r;
  const admit=async(id,request,source,proof)=>(await q('select fiscal_recovery_legacy_pending_admit_v1($1,$2,$3,$4,$5,$6,$7) r',
    [id,scope.id,scope.clientId,request,'og:invoice:'+id,source.sourceSha256,proof]))[0].r;
  await seed('old-974',123,'974');const s1=await snapshot('old-974'),proof1=verifyLegacyPendingSnapshot(scope,s1.source),r1=randomUUID();
  assert.equal(proof1.state,'rejected');assert.equal(proof1.code,'974');
  assert.throws(()=>verifyLegacyPendingSnapshot(scope,{...s1.source,signed_xml:s1.source.signed_xml.replace('<nNF>123</nNF>','<nNF>999</nNF>')}));
  const rejected=await admit('old-974',r1,s1,proof1);assert.equal(rejected.phase,'rejected');assert.equal(rejected.sendStartedAt,null);
  assert.equal(publicManagedDocument(rejected).recovery.sendState,'possibly_sent');
  assert.equal((await admit('old-974',r1,s1,proof1)).requestId,r1);
  await assert.rejects(()=>admit('old-974',randomUUID(),s1,proof1),/CONFLICT/);
  await assert.rejects(()=>q("update fiscal_documents set status='processamento' where id='old-974'"),/OWNED/);
  await seed('old-pending',124,'108');const s2=await snapshot('old-pending'),proof2=verifyLegacyPendingSnapshot(scope,s2.source),r2=randomUUID();
  assert.equal(proof2.state,'pending');await admit('old-pending',r2,s2,proof2);
  const claim=async()=>(await q('select fiscal_recovery_managed_claim_v1($1,$2) r',['og-worker',[scope.id]]))[0].r;
  const finish=async(l,decision)=>(await q('select fiscal_recovery_managed_complete_v1($1,$2,$3,$4,$5) r',
    [l.id,l.token,l.version,decision,decision.state==='pending'?new Date(Date.now()+30000).toISOString():null]))[0].r;
  for(let n=0;n<3;n++){
    const c=await claim();assert.ok(c.lease);assert.equal((await claim()).lease,null);
    const xml=`<retConsSitNFe xmlns="http://www.portalfiscal.inf.br/nfe"><tpAmb>1</tpAmb><cStat>217</cStat><chNFe>${s2.source.access_key}</chNFe></retConsSitNFe>`;
    const decision=reconcileConsultation(c.lease.document,xml);assert.equal(decision.state,'pending');await finish(c.lease,decision);
    await q('update fiscal_recovery.requests set next_at=clock_timestamp() where request_id=$1',[r2]);
  }
  const limited=await claim();assert.equal(limited.lease,null);assert.ok(limited.nextWakeAt>Date.now()+3000000);
  await q("update fiscal_recovery.requests set query_times='{}',next_at=clock_timestamp() where request_id=$1",[r2]);
  const lease=(await claim()).lease;
  const digest=new DOMParser().parseFromString(s2.source.signed_xml,'application/xml').getElementsByTagNameNS('http://www.w3.org/2000/09/xmldsig#','DigestValue').item(0).textContent;
  const xml=`<retConsSitNFe xmlns="http://www.portalfiscal.inf.br/nfe"><tpAmb>1</tpAmb><cStat>100</cStat><chNFe>${s2.source.access_key}</chNFe><protNFe><infProt><tpAmb>1</tpAmb><chNFe>${s2.source.access_key}</chNFe><cStat>100</cStat><nProt>141260000000001</nProt><digVal>${digest}</digVal></infProt></protNFe></retConsSitNFe>`;
  const decision=reconcileConsultation(lease.document,xml);assert.equal(decision.state,'authorized');await finish(lease,decision);
  const current=(await q('select fiscal_recovery_request_get_v1($1) r',[r2]))[0].r;
  assert.equal(current.phase,'authorized');assert.equal(current.sendStartedAt,null);assert.equal((await claim()).lease,null);
  assert.equal((await q('select number,status from fiscal_documents where id=$1',['old-pending']))[0].number,124);
  await db.exec('set role authenticated');await assert.rejects(()=>scopes(),/permission denied/);await db.exec('reset role');
 }finally{await db.close();}
});
