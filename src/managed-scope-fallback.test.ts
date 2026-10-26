import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {registerDocumentRoutes} from './routes/documents.js';
import {configureTransmissionFence} from './lib/recovery/transmission-fence.js';
import type {InMemoryStore} from './store.js';
test('a managed caller without an enabled namespace is refused before any legacy creation or transmission path',async()=>{
  configureTransmissionFence([]);let issuerLookups=0,creations=0;
  const cnpj='12345678000195';
  const store={findToken:()=>({clientId:'og-fixture',scopes:['nfe'],environments:['producao'],allowedCnpjs:[cnpj]}),
    findIssuerByCnpj:()=>{issuerLookups++;return null;},createDocument:()=>{creations++;throw Error('unexpected legacy writer');}} as unknown as InMemoryStore;
  const app=Fastify({logger:false});app.decorate('store',store);await app.register(registerDocumentRoutes);
  const payload={ambiente:'producao',infNFe:{ide:{mod:55,serie:1,nNF:1,tpAmb:1},emit:{CNPJ:cnpj}}};
  try{
    const denied=await app.inject({method:'POST',url:'/nfe',headers:{authorization:'Bearer fixture',
      'x-recovery-request-id':'11111111-1111-4111-8111-111111111111','x-recovery-origin-id':'og:invoice:1'},payload});
    assert.equal(denied.statusCode,409);assert.equal(denied.json().message,'RECOVERY_SCOPE_NOT_ENABLED');
    assert.equal(issuerLookups,0);assert.equal(creations,0);
    assert.equal((await app.inject({method:'POST',url:'/nfe',headers:{authorization:'Bearer fixture'},payload})).statusCode,404);
    assert.equal(issuerLookups,1);assert.equal(creations,0);
  }finally{await app.close();configureTransmissionFence([]);}
});
