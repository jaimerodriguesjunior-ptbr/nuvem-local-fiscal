import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createOgAutoScopes,decodeOgAutoTenants,decodeOgScopeCatalog} from './og-auto-scopes.js';
import {verifyRecoverySync} from './sync-auth.js';
import type {ManagedScope} from './controller-types.js';
const tenant='00000000-0000-0000-0000-000000000001',other='00000000-0000-0000-0000-000000000002';
const scope:ManagedScope={id:'00000000-0000-0000-0000-000000000010',clientId:'client',organizationId:tenant,storeId:99,
  cnpj:'31734498000140',environment:'producao',model:'NFCe',series:1};
const {id:_id,clientId:_client,...proposal}=scope;
const catalog={schema:'og-scope-catalog-v1',clientId:'client',organizationId:tenant,scopes:[proposal]};
test('automatic enrollment uses a signed ERP identity and coalesces concurrent discovery',async()=>{
  let calls=0,rpcs=0,current:ManagedScope[]=[];
  const auto=createOgAutoScopes({tenantIds:[tenant],clientId:'client',eventUrl:'https://erp.example/api/fiscal/recovery-v1/events',secret:'s'.repeat(32),
    current:()=>current,apply:s=>{current=s},fetch:async(url,init)=>{
      calls++;assert.equal(String(url),'https://erp.example/api/fiscal/recovery-v1/scopes');
      const headers=init!.headers as Record<string,string>;
      assert.equal(verifyRecoverySync(String(init!.body),'s'.repeat(32),headers['x-recovery-timestamp'],headers['x-recovery-signature']),true);
      assert.equal(JSON.parse(String(init!.body)).organizationId,tenant);
      await new Promise(resolve=>setTimeout(resolve,5));return Response.json(catalog);
    },database:{async rpc(name,args){rpcs++;assert.equal(name,'fiscal_recovery_og_ensure_scopes_v1');assert.equal(args.p_organization,tenant);
      assert.deepEqual(args.p_scopes,[proposal]);return {data:{scopes:[scope],blocked:[]},error:null}}}});
  assert.deepEqual(await Promise.all([auto.ensure(scope),auto.ensure(scope)]),[true,true]);assert.equal(calls,1);assert.equal(rpcs,1);
  assert.equal(await auto.ensure(scope),true);assert.equal(calls,1);
  assert.equal(await auto.ensure({...scope,organizationId:other}),false);assert.equal(calls,1);
  assert.equal(await auto.ensure({...scope,clientId:'foreign'}),false);assert.equal(calls,1);
});
test('a spoofed tenant or store in the catalog cannot create a scope',()=>{
  for(const bad of [{...catalog,organizationId:other},{...catalog,scopes:[{...proposal,organizationId:other}]},
    {...catalog,scopes:[{...proposal,clientId:'injected'}]},{...catalog,scopes:[{...proposal,storeId:-1}]},
    {...catalog,scopes:[proposal,proposal]}])assert.throws(()=>decodeOgScopeCatalog(bad,'client',tenant));
  assert.throws(()=>decodeOgAutoTenants('["*"]'));assert.throws(()=>decodeOgAutoTenants(JSON.stringify([tenant,tenant])));
});
test('catalog failures preserve the current worker scopes and never call the mutation RPC',async()=>{
  let writes=0,applies=0;
  const auto=createOgAutoScopes({tenantIds:[tenant],clientId:'client',eventUrl:'https://erp.example/api/fiscal/recovery-v1/events',secret:'s'.repeat(32),
    current:()=>[],apply:()=>{applies++},fetch:async()=>Response.json({error:'UNAUTHORIZED'},{status:401}),
    database:{async rpc(){writes++;return {data:null,error:null}}}});
  await assert.rejects(auto.ensure(scope),/CATALOG_UNAVAILABLE/);assert.equal(writes,0);assert.equal(applies,0);
});
test('a paused or unauthorized new scope remains blocked without dropping retained historical scopes',async()=>{
  const retained={...scope,id:'00000000-0000-0000-0000-000000000011',storeId:7,cnpj:'08214081000134'};let current:ManagedScope[]=[];
  const auto=createOgAutoScopes({tenantIds:[tenant],clientId:'client',eventUrl:'https://erp.example/api/fiscal/recovery-v1/events',secret:'s'.repeat(32),
    current:()=>current,apply:s=>{current=s},fetch:async()=>Response.json(catalog),
    database:{async rpc(){return {data:{scopes:[retained],blocked:[{storeId:99,code:'BINDING_PAUSED'}]},error:null}}}});
  assert.equal(await auto.ensure(scope),false);assert.deepEqual(current,[retained]);
});
