import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RecoveryOutboxWorker,createSyncDelivery,type SyncEvent} from './outbox.js';
import {signRecoverySync,verifyRecoverySync} from './sync-auth.js';

const event:SyncEvent={schema:'recovery-v1',eventId:'request:3',requestId:'request',version:3,
  clientId:'fixture',organizationId:'org',storeId:1};
test('signature covers exact body, timestamp and purpose; stale/unsigned events fail closed',()=>{
  const secret='a'.repeat(32),body=JSON.stringify(event),timestamp='1792843200',now=Number(timestamp)*1000;
  const signature=signRecoverySync(body,secret,timestamp);
  assert.equal(verifyRecoverySync(body,secret,timestamp,signature,now),true);
  assert.equal(verifyRecoverySync(body+' ',secret,timestamp,signature,now),false);
  assert.equal(verifyRecoverySync(body,secret,timestamp,signature,now+300001),false);
  assert.equal(verifyRecoverySync(body,'',timestamp,signature,now),false);
  assert.equal(verifyRecoverySync(body,secret,timestamp,null,now),false);
});

test('delivery refuses redirects/configuration errors and requires matching applied ACK',async()=>{
  const secret='a'.repeat(32);
  assert.throws(()=>createSyncDelivery('http://example.test/api/fiscal/recovery-v1/events',secret));
  assert.throws(()=>createSyncDelivery('https://example.test/other',secret));
  let calls=0;
  const deliver=createSyncDelivery('https://example.test/api/fiscal/recovery-v1/events',secret,async(_url,options)=>{
    calls++;assert.equal(options?.redirect,'error');
    const headers=new Headers(options?.headers);
    assert.equal(verifyRecoverySync(String(options?.body),secret,headers.get('x-recovery-timestamp'),headers.get('x-recovery-signature')),true);
    return Response.json({eventId:event.eventId,appliedVersion:calls===1?2:4});
  });
  await assert.rejects(()=>deliver(event),/ACK_INVALID/);assert.equal(await deliver(event),4);
});

test('outbox drains on startup/reconnect, keeps failed ACK pending, and has no empty-queue polling',async()=>{
  let wake!:()=>void,disconnect!:()=>void;let claims=0,deliveries=0;const complete:unknown[]=[];
  const pending:Array<unknown>=[{lease:{token:'lease',attempt:1,event},nextWakeAt:null},{lease:null,nextWakeAt:null}];
  const timers=new Map<number,()=>void>();
  const worker=new RecoveryOutboxWorker({scopeIds:['scope'],
    database:{async rpc(name,args){if(name.includes('claim')){claims++;return {data:pending.shift()??{lease:null,nextWakeAt:null},error:null};}
      complete.push(args);return {data:true,error:null};}},
    source:{async subscribe(w,d){wake=w;disconnect=()=>d(Error());return async()=>{};}},
    deliver:async()=>{deliveries++;throw Error('lost response');},report:()=>{},now:()=>1000,
    setTimer:((callback:()=>void,delay:number)=>{timers.set(delay,callback);return delay;}) as unknown as typeof setTimeout,
    clearTimer:((id:number)=>{timers.delete(id);}) as unknown as typeof clearTimeout});
  await worker.start();assert.equal(deliveries,1);assert.equal(claims,2);assert.equal(timers.size,0);
  assert.equal((complete[0] as {p_applied_version:unknown}).p_applied_version,null);
  disconnect();assert.equal(worker.ready,false);wake();
  await new Promise(resolve=>setImmediate(resolve));assert.equal(worker.ready,true);assert.equal(claims,3);
  assert.equal(deliveries,1);assert.equal(timers.size,0);await worker.stop();wake();assert.equal(claims,3);
});
