import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decodeOgScopeIds,validateOgScopes,routeRecoveryDelivery} from './consumer-routing.js';
import {fixtureScope} from './test-fixtures.js';
test('OG scopes require explicit IDs, matching client and valid complete identity',()=>{
  const id='11111111-1111-4111-8111-111111111111',s={...fixtureScope,id,storeId:23};
  assert.deepEqual(decodeOgScopeIds(undefined),[]);assert.deepEqual(validateOgScopes([s],[id],s.clientId),[s]);
  for(const value of ['["bad"]',JSON.stringify([id,id]),'{}'])assert.throws(()=>decodeOgScopeIds(value));
  for(const value of [[],[{...s,clientId:'other'}],[{...s,environment:'homologacao'}],[{...s,storeId:0}],[{...s,series:0}]])
    assert.throws(()=>validateOgScopes(value,[id],s.clientId));
});
test('events cannot cross recipient/client/tenant/store bindings, including a shared client ID',async()=>{
  const a={...fixtureScope,id:'a'},b={...fixtureScope,id:'b',organizationId:'22222222-2222-4222-8222-222222222222',storeId:23};
  const sent:string[]=[];const deliver=routeRecoveryDelivery([{scopes:[a],deliver:async()=>{sent.push('gop');return 5;}},
    {scopes:[b],deliver:async()=>{sent.push('og');return 7;}}]);
  const event={schema:'recovery-v1' as const,eventId:'event',requestId:'request',version:1,clientId:a.clientId,organizationId:a.organizationId,storeId:1};
  assert.equal(await deliver(event),5);assert.equal(await deliver({...event,organizationId:b.organizationId,storeId:23}),7);
  assert.deepEqual(sent,['gop','og']);assert.throws(()=>deliver({...event,storeId:23}));
  assert.throws(()=>routeRecoveryDelivery([{scopes:[a],deliver:async()=>1},{scopes:[a],deliver:async()=>2}]));
});
