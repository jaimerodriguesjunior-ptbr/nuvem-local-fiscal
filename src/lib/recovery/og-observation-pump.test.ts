import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createOgObservationDrain,createOgObservationPump} from './og-observation-pump.js';
import {verifyRecoverySync} from './sync-auth.js';
test('OG bridge is opt-in and does not require configuration when disabled',()=>{
  assert.equal(createOgObservationPump({}),null);
  assert.throws(()=>createOgObservationPump({RECOVERY_OG_OBSERVER_ENABLED:'true'}));
});
test('OG uses its own signed purpose/client and no hard-coded GOP store or organization',async()=>{
  const secret='s'.repeat(64);let valid=true;
  const drain=createOgObservationDrain('https://og.example/api/fiscal/recovery-v1/drain',secret,'og-fixture',async(url,options)=>{
    assert.equal(String(url),'https://og.example/api/fiscal/recovery-v1/drain');assert.equal(options?.method,'POST');
    const h=new Headers(options?.headers),body=String(options?.body);
    assert.equal(verifyRecoverySync(body,secret,h.get('x-recovery-timestamp'),h.get('x-recovery-signature')),true);
    assert.deepEqual(JSON.parse(body),{schema:'og-observation-v1',kind:'drain',clientId:'og-fixture'});
    return Response.json({nextWakeAt:valid?null:'invalid'});
  });
  assert.equal(await drain(),null);valid=false;await assert.rejects(()=>drain());
  assert.throws(()=>createOgObservationDrain('http://og.example/api/fiscal/recovery-v1/drain',secret,'og'));
  assert.throws(()=>createOgObservationDrain('https://og.example/api/another',secret,'og'));
});
