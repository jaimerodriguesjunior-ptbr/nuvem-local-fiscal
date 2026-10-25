/** Synthetic SQL-only job lifecycle, including query budgets and fencing. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {PGlite} from '../../.test-tools/node_modules/@electric-sql/pglite/dist/index.js';
import {createCatalogFixture,insertTestDocument} from './database-fixture.mjs';
const require=createRequire(import.meta.url),{fixtureScope,fixtureKey}=require('../../dist/lib/recovery/test-fixtures.js');
test('historical query queue: idempotency, bounded retries, lease CAS, source CAS and idle',async()=>{
  const db=new PGlite();try{
    await createCatalogFixture(db);
    for(const name of ['20261024_recovery_v1_PREPARE_ONLY.sql','20261024_recovery_controller_PREPARE_ONLY.sql',
      '20261024_recovery_sync_PREPARE_ONLY.sql','20261024_recovery_manual_PREPARE_ONLY.sql','20261024_recovery_cancellation_PREPARE_ONLY.sql',
      '20261024_recovery_legacy_adoption_PREPARE_ONLY.sql','20261025_recovery_legacy_queue_PREPARE_ONLY.sql'])
      await db.exec(await readFile(new URL('../../migrations/'+name,import.meta.url),'utf8'));
    const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
    const scope=randomUUID(),request=randomUUID(),old='old-auth';
    await q(`insert into fiscal_recovery.scopes(id,client_id,organization_id,store_id,cnpj,environment,model,series,enabled)
      values($1,$2,$3,1,$4,'producao','NFCe',2,true)`,[scope,fixtureScope.clientId,fixtureScope.organizationId,fixtureScope.cnpj]);
    await insertTestDocument(db,old,123,fixtureKey,'autorizado');
    const reserve=async(id=request)=>(await q('select public.fiscal_recovery_legacy_check_v1($1,$2,$3,$4,$5) as r',
      [old,scope,fixtureScope.clientId,id,'legacy-invoice:42']))[0].r;
    assert.equal((await reserve()).requestId,request);assert.equal((await reserve()).requestId,request);
    await assert.rejects(()=>reserve(randomUUID()),/CONFLICT/);
    const claim=async()=>(await q('select public.fiscal_recovery_legacy_claim_v1($1) as r',[[scope]]))[0].r;
    const finish=async(token,state='pending',code='217')=>(await q('select public.fiscal_recovery_legacy_finish_v1($1,$2,$3,$4,$5) as r',
      [request,token,state,code,null]))[0].r;
    for(let i=0;i<3;i++){
      const lease=(await claim()).lease;assert.ok(lease);assert.equal((await claim()).lease,null);
      assert.equal(await finish(randomUUID()),false);assert.equal(await finish(lease.token),true);
      assert.equal(await finish(lease.token),false);
      await q("update fiscal_recovery.legacy_checks set next_at=clock_timestamp()-interval '1 second' where request_id=$1",[request]);
    }
    const limited=await claim();assert.equal(limited.lease,null);assert.ok(Date.parse(limited.nextWakeAt)>Date.now()+3_000_000);
    assert.equal((await q('select count(*)::int as n from fiscal_recovery.requests'))[0].n,0);
    await q("update fiscal_recovery.legacy_checks set query_times='{}',next_at=clock_timestamp()-interval '1 second' where request_id=$1",[request]);
    let lease=(await claim()).lease;
    await q("update fiscal_recovery.legacy_checks set owner_until=clock_timestamp()-interval '1 second' where request_id=$1",[request]);
    assert.equal(await finish(lease.token),false);const replacement=(await claim()).lease;
    assert.notEqual(replacement.token,lease.token);assert.equal(await finish(lease.token),false);
    await q("update public.fiscal_documents set reason='external change' where id=$1",[old]);
    assert.equal(await finish(replacement.token),true);
    assert.equal((await reserve()).state,'manual_review');assert.equal((await claim()).nextWakeAt,null);
    assert.equal((await q('select status from public.fiscal_documents where id=$1',[old]))[0].status,'autorizado');
    await db.exec('set role anon');await assert.rejects(()=>claim(),/permission denied/);await db.exec('reset role');
  }finally{await db.close();}
});
