import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RecoveryGopDrainPump,createGopDrain} from './gop-drain.js';
import {verifyRecoverySync} from './sync-auth.js';
import {recoveryListenUrl} from './listen-url.js';

test('LISTEN pins the project and session port and cannot accept URL SSL overrides',()=>{
  const project='abcdefghijklmnopqrst',base=`https://${project}.supabase.co`;
  const valid=recoveryListenUrl(`postgres://postgres:fixture@db.${project}.supabase.co/postgres?sslmode=disable`,base);
  assert.equal(new URL(valid).searchParams.has('sslmode'),false);
  assert.doesNotThrow(()=>recoveryListenUrl(`postgres://postgres.${project}:fixture@aws-0.example.pooler.supabase.com:5432/postgres`,base));
  for(const url of [`postgres://postgres:fixture@db.other.supabase.co/postgres`,
    `postgres://postgres.other:fixture@aws-0.example.pooler.supabase.com:5432/postgres`,
    `postgres://postgres.${project}:fixture@aws-0.example.pooler.supabase.com:6543/postgres`]){
    assert.throws(()=>recoveryListenUrl(url,base),/PROJECT_MISMATCH/);
  }
});

test('remote drain uses a signed fixed endpoint and accepts only a valid next wake',async()=>{
  const secret='x'.repeat(32);let valid=true;
  const drain=createGopDrain('https://gop.example.test/api/fiscal/recovery-v1/events',secret,'fixture',async(url,options)=>{
    assert.equal(String(url),'https://gop.example.test/api/fiscal/recovery-v1/drain');
    assert.equal(options?.redirect,'error');const h=new Headers(options?.headers),body=String(options?.body);
    assert.equal(verifyRecoverySync(body,secret,h.get('x-recovery-timestamp'),h.get('x-recovery-signature')),true);
    assert.equal(JSON.parse(body).kind,'drain');
    return Response.json({nextWakeAt:valid?null:'invalid'});
  });
  assert.equal(await drain(),null);valid=false;await assert.rejects(()=>drain(),/RESPONSE_INVALID/);
});

test('GOP pump is idle without pending work; reconnect drains durable work and failure retries progressively',async()=>{
  let wake!:()=>void,disconnect!:()=>void;let count=0,failed=false;
  const timers=new Map<number,()=>void>();
  const pump=new RecoveryGopDrainPump({source:{async subscribe(w,d){wake=w;disconnect=()=>d(Error());return async()=>{};}},
    drain:async()=>{count++;if(failed)throw Error();return null;},report:()=>{},now:()=>1000,
    setTimer:((callback:()=>void,delay:number)=>{timers.set(delay,callback);return delay;}) as unknown as typeof setTimeout,
    clearTimer:((id:number)=>{timers.delete(id);}) as unknown as typeof clearTimeout});
  await pump.start();assert.equal(count,1);assert.equal(timers.size,0);assert.equal(pump.ready,true);
  disconnect();assert.equal(pump.ready,false);assert.equal(pump.acceptingWork,false);wake();await new Promise(r=>setImmediate(r));
  assert.equal(count,2);assert.equal(timers.size,0);
  failed=true;wake();await new Promise(r=>setImmediate(r));assert.equal(pump.ready,false);assert.equal(pump.acceptingWork,true);assert.ok(timers.has(30000));
  timers.get(30000)!();timers.delete(30000);await new Promise(r=>setImmediate(r));assert.ok(timers.has(60000));
  failed=false;wake();await new Promise(r=>setImmediate(r));assert.equal(pump.ready,true);assert.equal(timers.size,0);
  await pump.stop();const before=count;wake();assert.equal(count,before);
});

test('a notification during an empty response is not lost',async()=>{
  let wake!:()=>void;let count=0;
  const pump=new RecoveryGopDrainPump({source:{async subscribe(w){wake=w;return async()=>{};}},
    drain:async()=>{count++;if(count===1)wake();return null;},report:()=>{}});
  await pump.start();assert.equal(count,2);await pump.stop();
});
