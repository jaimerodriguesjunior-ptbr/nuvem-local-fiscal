/** Association/CAS and writer fences only. Proof fixture is synthetic; real
 * signature/consultation validation is independently covered by the verifier. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '../../.test-tools/node_modules/@electric-sql/pglite/dist/index.js';
import {createCatalogFixture,insertTestDocument} from './database-fixture.mjs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {fixtureKey,fixtureScope,fixtureSignedXml}=require('../../dist/lib/recovery/test-fixtures.js');
const {publicManagedDocument}=require('../../dist/lib/recovery/runtime.js');

test('explicit legacy association freezes source with CAS and never enrolls it for a first send',async()=>{
  const db=new PGlite();
  try{
    await createCatalogFixture(db);
    for(const name of ['v1','controller','sync','manual','cancellation','legacy_adoption'])
      await db.exec(await readFile(new URL('../../migrations/20261024_recovery_'+name+'_PREPARE_ONLY.sql',import.meta.url),'utf8'));
    const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
    const scope=randomUUID(),request=randomUUID(),legacy='legacy_authorized';
    await q(`insert into fiscal_recovery.scopes(id,client_id,organization_id,store_id,cnpj,environment,model,series,enabled)
      values($1,$2,$3,1,$4,'producao','NFCe',2,true)`,[scope,fixtureScope.clientId,fixtureScope.organizationId,fixtureScope.cnpj]);
    await insertTestDocument(db,legacy,123,fixtureKey,'autorizado');
    await q('update public.fiscal_documents set signed_xml=$1,protocol=$2 where id=$3',
      [fixtureSignedXml,'141260000000001',legacy]);
    const get=async(client=fixtureScope.clientId)=>(await q('select public.fiscal_recovery_legacy_source_v1($1,$2,$3) as r',[legacy,scope,client]))[0].r;
    await assert.rejects(()=>get('another-client'),/SCOPE_INVALID/);
    const source=await get();
    const proof={legacyId:legacy,scopeId:scope,signedXmlSha256:createHash('sha256').update(fixtureSignedXml).digest('hex'),
      authorizationProtocol:'141260000000001',authorizationCode:'100',processedXml:'<synthetic-authorized/>',evidenceXml:'<synthetic-proof/>',
      adoptionMethod:'legacy_authorized_consultation_v1'};
    const associate=async(hash=source.sourceSha256,p=proof,id=request)=>(await q(
      'select public.fiscal_recovery_legacy_associate_v1($1,$2,$3,$4,$5,$6,$7) as r',
      [legacy,scope,fixtureScope.clientId,id,'legacy-invoice:42',hash,p]))[0].r;
    await assert.rejects(()=>associate('0'.repeat(64)),/SOURCE_CHANGED/);
    await assert.rejects(()=>associate(undefined,{...proof,authorizationProtocol:'141260000000999'}),/PROOF_INVALID/);
    await q("update public.fiscal_documents set cancellation_state='pendente_confirmacao' where id=$1",[legacy]);
    const uncertain=await get();await assert.rejects(()=>associate(uncertain.sourceSha256),/INELIGIBLE/);
    await q('update public.fiscal_documents set cancellation_state=null where id=$1',[legacy]);
    // Updating a row also updates updated_at, so the original read is stale.
    await assert.rejects(()=>associate(),/SOURCE_CHANGED/);
    const fresh=await get(),record=await associate(fresh.sourceSha256);
    assert.equal(record.phase,'authorized');assert.equal(record.provenance,'legacy_authorized_consultation_v1');
    assert.equal(record.sendStartedAt,null);assert.equal(publicManagedDocument(record).recovery.sendState,'possibly_sent');
    assert.equal((await associate(fresh.sourceSha256)).requestId,request);
    await assert.rejects(()=>associate(fresh.sourceSha256,proof,randomUUID()),/ASSOCIATION_CONFLICT/);
    assert.equal(record.document.xmlSigned,fixtureSignedXml);assert.equal(record.document.chave,fixtureKey);
    assert.deepEqual((await get()).source, fresh.source);
    assert.deepEqual((await q('select public.fiscal_recovery_legacy_owned_v1($1) as r',[[legacy,'another']]))[0].r,[legacy]);
    assert.equal((await q('select public.fiscal_recovery_legacy_lookup_v1($1,$2) as r',[legacy,[scope]]))[0].r.requestId,request);
    assert.equal((await q('select public.fiscal_recovery_legacy_lookup_v1($1,$2) as r',[legacy,[randomUUID()]]))[0].r,null);
    await assert.rejects(()=>q("update public.fiscal_documents set status='erro' where id=$1",[legacy]),/LEGACY_DOCUMENT_OWNED/);
    await assert.rejects(()=>q('delete from public.fiscal_documents where id=$1',[legacy]),/LEGACY_DOCUMENT_OWNED/);
    const queued=(await q('select public.fiscal_recovery_managed_claim_v1($1,$2) as r',['test-worker',[scope]]))[0].r;
    assert.equal(queued.lease,null);assert.equal(queued.nextWakeAt,null);
    await assert.rejects(()=>q('select public.fiscal_recovery_request_accept_v1($1,$2,$3,$4,$5,$6,true)',
      [scope,request,'legacy-invoice:42','b'.repeat(64),record.document,randomUUID()]),/REQUEST_CONFLICT/);
    await db.exec('set role anon');await assert.rejects(()=>get(),/permission denied/);await db.exec('reset role');
  }finally{await db.close();}
});
