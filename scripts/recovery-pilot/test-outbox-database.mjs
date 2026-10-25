/** Actual prepared SQL, no .env/network/fiscal data. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '../../.test-tools/node_modules/@electric-sql/pglite/dist/index.js';
import {createCatalogFixture} from './database-fixture.mjs';

test('durable outbox coalesces versions, fences leases, validates ACKs and schedules only real work',async()=>{
  const db=new PGlite();
  try{
    await createCatalogFixture(db);
    for(const name of ['20261024_recovery_v1_PREPARE_ONLY.sql','20261024_recovery_controller_PREPARE_ONLY.sql','20261024_recovery_sync_PREPARE_ONLY.sql'])
      await db.exec(await readFile(new URL('../../migrations/'+name,import.meta.url),'utf8'));
    const scope=randomUUID(),request=randomUUID();const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
    await q(`insert into fiscal_recovery.scopes(id,client_id,organization_id,store_id,cnpj,environment,model,series,enabled)
      values($1,'fixture','40b34e90-4c9d-4446-b775-770a3e77d6c0',1,'01997929000108','producao','NFCe',2,true)`,[scope]);
    await q(`insert into fiscal_recovery.requests(request_id,scope_id,origin_id,request_hash,number,document,version)
      values($1,$2,'sale:1',$3,123,$4,3)`,[request,scope,'a'.repeat(64),{id:'rv1_'+request,providerLikeId:'rv1_'+request}]);
    await q('insert into fiscal_recovery.request_outbox(request_id,version) values($1,1),($1,2),($1,3)',[request]);
    const claim=async(scopes=[scope])=>(await q('select public.fiscal_recovery_outbox_claim_v1($1) as r',[scopes]))[0].r;
    const complete=async(lease,version)=>(await q('select public.fiscal_recovery_outbox_complete_v1($1,$2,$3,$4) as r',
      [request,lease.event.version,lease.token,version]))[0].r;
    assert.equal((await claim([randomUUID()])).lease,null);
    await q("update fiscal_recovery.requests set owner_until=clock_timestamp()+interval '90 seconds' where request_id=$1",[request]);
    const active=await claim();assert.equal(active.lease,null);assert.ok(Date.parse(active.nextWakeAt)>Date.now()+60000);
    await q('update fiscal_recovery.requests set owner_until=null where request_id=$1',[request]);
    const first=(await claim()).lease;assert.equal(first.event.version,3);
    await q('update fiscal_recovery.requests set version=4 where request_id=$1',[request]);
    await q('insert into fiscal_recovery.request_outbox(request_id,version) values($1,4)',[request]);
    const busy=await claim();assert.equal(busy.lease,null);assert.ok(Date.parse(busy.nextWakeAt)>Date.now()+60000);
    assert.equal(await complete({...first,token:randomUUID()},4),false);
    assert.equal(await complete({...first,token:null},4),false);
    await assert.rejects(()=>complete(first,5),/ACK_INVALID/);
    assert.equal(await complete(first,4),true);
    assert.deepEqual(await claim(),{lease:null,nextWakeAt:null});
    await q('update fiscal_recovery.requests set version=5 where request_id=$1',[request]);
    await q('insert into fiscal_recovery.request_outbox(request_id,version) values($1,5)',[request]);
    const retry=(await claim()).lease;assert.equal(await complete(retry,null),true);
    const waiting=await claim();assert.equal(waiting.lease,null);assert.ok(Date.parse(waiting.nextWakeAt)>Date.now()+20000);
    await q("update fiscal_recovery.request_outbox set next_at=clock_timestamp()-interval '1 second' where request_id=$1 and version=5",[request]);
    const lost=(await claim()).lease;
    await q("update fiscal_recovery.request_outbox set lease_until=clock_timestamp()-interval '1 second' where request_id=$1 and version=5",[request]);
    const resumed=(await claim()).lease;assert.notEqual(resumed.token,lost.token);
    assert.equal(await complete(lost,5),false);assert.equal(await complete(resumed,5),true);
    assert.deepEqual(await claim(),{lease:null,nextWakeAt:null});
    await db.exec('set role anon');await assert.rejects(()=>claim(),/permission denied/);await db.exec('reset role');
  }finally{await db.close();}
});
