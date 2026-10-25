/** Local SQL + compiled controller integration. No .env, sockets or fiscal I/O.
 * npm run build
 * node --test scripts/recovery-pilot/test-controller-database.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { PGlite } from '../../.test-tools/node_modules/@electric-sql/pglite/dist/index.js';
import { createCatalogFixture } from './database-fixture.mjs';
const require=createRequire(import.meta.url);
const {RecoveryController}=require('../../dist/lib/recovery/controller.js');
const {SupabaseManagedRepository}=require('../../dist/lib/recovery/managed-repository.js');
const {SupabaseRecoveryRepository}=require('../../dist/lib/recovery/supabase-repository.js');
const {configureTransmissionFence,assertTransmissionPermit}=require('../../dist/lib/recovery/transmission-fence.js');
const {RecoveryWorker}=require('../../dist/lib/recovery/worker.js');
const {fixtureDocument,fixtureResponse,fixtureScope,fixtureKey}=require('../../dist/lib/recovery/test-fixtures.js');

const payload={infNFe:{ide:{mod:65,tpAmb:1,serie:2,nNF:123,cNF:'01234567'},emit:{CNPJ:fixtureScope.cnpj}}};
function authorization(code='100') {
  if(code==='100')return fixtureResponse().replaceAll('retConsSitNFe','retEnviNFe').replace('<cStat>100</cStat>','<cStat>104</cStat>');
  return `<retEnviNFe xmlns="http://www.portalfiscal.inf.br/nfe"><tpAmb>1</tpAmb><cStat>104</cStat><protNFe><infProt><tpAmb>1</tpAmb><chNFe>${fixtureKey}</chNFe><cStat>${code}</cStat></infProt></protNFe></retEnviNFe>`;
}

async function setup() {
  const db=new PGlite();await createCatalogFixture(db);
  for(const name of ['20261024_recovery_v1_PREPARE_ONLY.sql','20261024_recovery_controller_PREPARE_ONLY.sql',
    '20261024_recovery_sync_PREPARE_ONLY.sql','20261024_recovery_manual_PREPARE_ONLY.sql','20261024_recovery_cancellation_PREPARE_ONLY.sql','20261024_recovery_legacy_adoption_PREPARE_ONLY.sql','20261025_recovery_legacy_queue_PREPARE_ONLY.sql']) {
    await db.exec(await readFile(new URL('../../migrations/'+name,import.meta.url),'utf8'));
  }
  const scope={...fixtureScope,id:randomUUID()};
  await db.query(`insert into fiscal_recovery.scopes(id,client_id,organization_id,store_id,cnpj,environment,model,series,enabled)
    values($1,$2,$3,$4,$5,$6,$7,$8,true)`,[scope.id,scope.clientId,scope.organizationId,scope.storeId,scope.cnpj,scope.environment,scope.model,scope.series]);
  const names={fiscal_recovery_request_accept_v1:['p_scope','p_request','p_origin','p_hash','p_document','p_token','p_resume_local'],
    fiscal_recovery_request_get_v1:['p_request'],fiscal_recovery_request_transition_v1:['p_request','p_version','p_token','p_phase','p_document','p_origin','p_code'],
    fiscal_recovery_managed_claim_v1:['p_worker','p_scopes'],fiscal_recovery_managed_complete_v1:['p_job','p_token','p_version','p_decision','p_next_at'],
    fiscal_recovery_request_query_v1:['p_request','p_client','p_scopes']};
  const client={async rpc(name,args) {
    if(!names[name])throw Error('Unlisted test RPC');
    try {const params=names[name].map(key=>args[key]);
      const result=await db.query(`select public.${name}(${params.map((_,i)=>'$'+(i+1)).join(',')}) as result`,params);
      return {data:result.rows[0].result,error:null};
    }catch(error){return {data:null,error:{message:error.message}};}
  }};
  const repository=new SupabaseManagedRepository(client);
  let prepared=0,sent=0,queries=0;
  const behavior={lose:false,rejection:'100',localFailure:false};
  const transport={async prepare(){prepared++;if(behavior.localFailure)throw Error('XSD failure');return {
    accessKey:fixtureKey,signedXml:fixtureDocument.signedXml,unsignedXml:'synthetic',signatureValid:true,
    xsdValid:true,xsdErrors:[],certificateId:randomUUID()};},
    async consult(){queries++;return fixtureResponse('217');},
    async authorize(document){assertTransmissionPermit(document.xmlSigned,'producao','NFCe');sent++;if(behavior.lose)throw Error('response lost');return authorization(behavior.rejection);}
  };
  configureTransmissionFence([scope]);
  const controller=new RecoveryController(repository,transport);
  return {db,scope,client,repository,controller,behavior,transport,counts:()=>({prepared,sent,queries}),
    close:async()=>{configureTransmissionFence([]);await db.close();}};
}

test('common controller: real SQL admission, one-time send and recovery, never a fiscal network call',async t=>{
  await t.test('normal authorization and concurrent duplicate POST preserve one request and one send',async()=>{
    const h=await setup();try{
      const request=randomUUID();
      await Promise.all([h.controller.submit(h.scope,request,'sale:1',payload,{},null),h.controller.submit(h.scope,request,'sale:1',payload,{},null)]);
      const saved=await h.repository.get(request);
      assert.equal(saved.phase,'authorized');assert.equal(saved.document.status,'autorizado');assert.ok(saved.sendStartedAt);
      assert.deepEqual(h.counts(),{prepared:1,sent:1,queries:1});
      await h.controller.submit(h.scope,request,'sale:1',payload,{},null);
      assert.equal(h.counts().sent,1);
      await assert.rejects(()=>h.controller.submit(h.scope,request,'sale:1',{...payload,extra:'changed'}, {},null),/CONFLICT/);
      assert.equal((await h.db.query('select count(*)::int as n from public.fiscal_documents')).rows[0].n,0);
    }finally{await h.close();}
  });
  await t.test('lost response remains pending; restart queries frozen XML and never authorizes again',async()=>{
    const h=await setup();try{
      h.behavior.lose=true;const request=randomUUID();
      const first=await h.controller.submit(h.scope,request,'sale:2',payload,{},null);
      assert.equal(first.phase,'pending');assert.equal(first.errorOrigin,'transport');assert.ok(first.sendStartedAt);
      const hash=first.document.xmlSigned;
      await h.controller.submit(h.scope,request,'sale:2',payload,{},null);
      await h.controller.submit(h.scope,request,'sale:2',payload,{},null,true);
      await assert.rejects(()=>h.controller.submit(h.scope,request,'sale:2',{...payload,changed:true},{},null,true),/CONFLICT/);
      assert.equal(h.counts().sent,1);
      const queue=new SupabaseRecoveryRepository(h.client,'restarted-worker',[h.scope.id],true);
      // Only the test clock/bookkeeping is moved; no fiscal data is rewritten.
      await h.db.query("update fiscal_recovery.requests set next_at=clock_timestamp()-interval '1 second' where request_id=$1",[request]);
      let query=0;
      const source={async subscribe(){return async()=>{};}};
      let worker=new RecoveryWorker({enabled:true,scopes:[h.scope],repository:queue,wakeSource:source,
        consult:async()=>{query++;return fixtureResponse('217');},report:()=>{throw Error('unexpected worker storage failure');}});
      await worker.start();await worker.stop();
      assert.equal((await h.repository.get(request)).phase,'pending');assert.equal(query,1);
      await h.db.query("update fiscal_recovery.requests set next_at=clock_timestamp()-interval '1 second' where request_id=$1",[request]);
      worker=new RecoveryWorker({enabled:true,scopes:[h.scope],repository:queue,wakeSource:source,
        consult:async document=>{assert.equal(document.signedXml,hash);return fixtureResponse();},report:()=>{throw Error('unexpected storage failure');}});
      await worker.start();await worker.stop();
      const saved=await h.repository.get(request);assert.equal(saved.phase,'authorized');assert.equal(saved.document.xmlSigned,hash);
      assert.equal(h.counts().sent,1);
    }finally{await h.close();}
  });
  await t.test('SEFAZ keyed rejection is distinct from local validation and duplicity',async()=>{
    for(const [code,expected] of [['591','rejected'],['539','pending'],['204','pending']]){
      const h=await setup();try{
        h.behavior.rejection=code;const record=await h.controller.submit(h.scope,randomUUID(),'sale:3',payload,{},null);
        assert.equal(record.phase,expected);assert.equal(record.errorOrigin,'sefaz');assert.equal(record.code,code);
      }finally{await h.close();}
    }
    const h=await setup();try{
      h.behavior.localFailure=true;const request=randomUUID();const record=await h.controller.submit(h.scope,request,'sale:4',payload,{},null);
      assert.equal(record.phase,'blocked_local');assert.equal(record.errorOrigin,'central');assert.equal(record.sendStartedAt,null);
      assert.equal(h.counts().sent,0);assert.equal(h.counts().queries,0);
      const blockedQuery=await h.client.rpc('fiscal_recovery_request_query_v1',
        {p_request:request,p_client:h.scope.clientId,p_scopes:[h.scope.id]});
      assert.equal(blockedQuery.error,null);assert.equal(blockedQuery.data.scheduled,false);
      assert.equal(h.counts().queries,0);
      h.behavior.localFailure=false;
      const corrected=await h.controller.submit(h.scope,request,'sale:4',{...payload,correction:'user corrected local data'}, {},null);
      assert.equal(corrected.phase,'authorized');assert.equal(corrected.document.numero,record.document.numero);
      assert.equal(corrected.document.id,record.document.id);assert.equal(h.counts().sent,1);
    }finally{await h.close();}
  });
  await t.test('same-content local resume is explicit, preserves the snapshot and cannot revive a possibly sent note',async()=>{
    const h=await setup();try{
      const request=randomUUID();h.behavior.localFailure=true;
      const blocked=await h.controller.submit(h.scope,request,'sale:resume',payload,{},null);
      h.behavior.localFailure=false;
      assert.equal((await h.controller.submit(h.scope,request,'sale:resume',payload,{},null)).phase,'blocked_local');
      assert.equal(h.counts().prepared,1);assert.equal(h.counts().sent,0);
      const results=await Promise.all([h.controller.submit(h.scope,request,'sale:resume',payload,{},null,true),
        h.controller.submit(h.scope,request,'sale:resume',payload,{},null,true)]);
      const saved=await h.repository.get(request);assert.equal(saved.phase,'authorized');assert.equal(h.counts().sent,1);
      assert.deepEqual(saved.document.payloadOriginal,blocked.document.payloadOriginal);assert.equal(saved.document.createdAt,blocked.document.createdAt);
      await h.controller.submit(h.scope,request,'sale:resume',payload,{},null,true);assert.equal(h.counts().sent,1);
    }finally{await h.close();}
  });
  await t.test('scope pause is enforced before consultation and again after preflight; explicit resume shares query budget',async()=>{
    const h=await setup();try{
      const request=randomUUID();
      await h.db.query("update fiscal_recovery.scopes set pause_until=clock_timestamp()+interval '1 hour' where id=$1",[h.scope.id]);
      const blocked=await h.controller.submit(h.scope,request,'sale:paused',payload,{},null);
      assert.equal(blocked.phase,'blocked_local');assert.equal(blocked.code,'RECOVERY_SERVICE_PAUSED');assert.equal(h.counts().queries,0);assert.equal(h.counts().sent,0);
      await h.db.query('update fiscal_recovery.scopes set pause_until=null where id=$1',[h.scope.id]);
      let pauseOnce=true;const originalConsult=h.transport.consult;
      h.transport.consult=async()=>{const result=await originalConsult();if(pauseOnce){pauseOnce=false;
        await h.db.query("update fiscal_recovery.scopes set pause_until=clock_timestamp()+interval '1 hour' where id=$1",[h.scope.id]);}return result;};
      const between=request,before=h.counts().sent;
      const mid=await h.controller.submit(h.scope,between,'sale:paused',payload,{},null,true);
      assert.equal(mid.phase,'blocked_local');assert.equal(mid.code,'RECOVERY_SERVICE_PAUSED');assert.equal(mid.sendStartedAt,null);assert.equal(h.counts().sent,before);
      await h.db.query('update fiscal_recovery.scopes set pause_until=null where id=$1',[h.scope.id]);
      const waited=await h.controller.submit(h.scope,between,'sale:paused',payload,{},null,true);
      assert.equal(waited.phase,'blocked_local');assert.equal(waited.code,'RECOVERY_QUERY_BUDGET_WAIT');assert.equal(h.counts().sent,before);
      await h.db.query("update fiscal_recovery.requests set query_times=array[clock_timestamp()-interval '40 minutes',clock_timestamp()-interval '20 minutes',clock_timestamp()-interval '1 minute'] where request_id=$1",[between]);
      assert.equal((await h.controller.submit(h.scope,between,'sale:paused',payload,{},null,true)).code,'RECOVERY_QUERY_BUDGET_WAIT');
      await h.db.query("update fiscal_recovery.requests set query_times=array[clock_timestamp()-interval '31 seconds'] where request_id=$1",[between]);
      assert.equal((await h.controller.submit(h.scope,between,'sale:paused',payload,{},null,true)).phase,'authorized');assert.equal(h.counts().sent,before+1);
    }finally{await h.close();}
  });
  await t.test('durable send-intent failure cannot reach the authorization transport',async()=>{
    const h=await setup();try{
      const original=h.repository.transition.bind(h.repository);
      h.repository.transition=async(...args)=>{if(args[1]==='send_started')throw Error('db unavailable');return original(...args);};
      const record=await h.controller.submit(h.scope,randomUUID(),'sale:5',payload,{},null);
      assert.equal(record.phase,'pending');assert.equal(h.counts().sent,0);assert.equal(record.sendStartedAt,null);
    }finally{await h.close();}
  });
  await t.test('manual query cannot bypass the shared budget, pause, lease or frozen XML',async()=>{
    const h=await setup();try{
      h.behavior.lose=true;const request=randomUUID();
      await h.controller.submit(h.scope,request,'sale:manual',payload,{},null);
      const ask=async(client=h.scope.clientId)=>{
        const {data,error}=await h.client.rpc('fiscal_recovery_request_query_v1',{p_request:request,p_client:client,p_scopes:[h.scope.id]});
        if(error)throw Error(error.message);return data;
      };
      await assert.rejects(()=>ask('other'),/QUERY_SCOPE_INVALID/);
      const frozen=(await h.repository.get(request)).document.xmlSigned;
      for(let i=0;i<5;i++){
        const queued=await ask();assert.equal(queued.scheduled,true);assert.ok(Date.parse(queued.nextAt)>Date.now()+20000);
      }
      assert.equal(h.counts().queries,1);assert.equal(h.counts().sent,1);
      assert.equal((await h.db.query('select cardinality(query_times) as n from fiscal_recovery.requests where request_id=$1',[request])).rows[0].n,1);
      await h.db.query(`update fiscal_recovery.requests set query_times=array[clock_timestamp()-interval '40 minutes',
        clock_timestamp()-interval '20 minutes',clock_timestamp()-interval '1 minute'] where request_id=$1`,[request]);
      const limited=await ask();assert.ok(Date.parse(limited.nextAt)>Date.now()+19*60_000);
      const queue=new SupabaseRecoveryRepository(h.client,'manual-worker',[h.scope.id],true);
      assert.equal((await queue.claim()).lease,null);
      await h.db.query("update fiscal_recovery.scopes set pause_until=clock_timestamp()+interval '2 hours' where id=$1",[h.scope.id]);
      assert.ok(Date.parse((await ask()).nextAt)>Date.now()+119*60_000);
      await h.db.query('update fiscal_recovery.scopes set pause_until=null where id=$1',[h.scope.id]);
      await h.db.query("update fiscal_recovery.requests set phase='manual_review',next_at=null,query_times=array[clock_timestamp()-interval '2 minutes'] where request_id=$1",[request]);
      assert.equal((await ask()).scheduled,true);
      assert.equal((await h.repository.get(request)).phase,'pending');
      let queried=0;
      const worker=new RecoveryWorker({enabled:true,scopes:[h.scope],repository:queue,
        wakeSource:{async subscribe(){return async()=>{};}},consult:async doc=>{queried++;assert.equal(doc.signedXml,frozen);return fixtureResponse();},
        report:()=>{throw Error('unexpected storage error');}});
      await worker.start();await worker.stop();assert.equal(queried,1);
      assert.equal((await h.repository.get(request)).phase,'authorized');assert.equal(h.counts().sent,1);
      assert.equal((await ask()).scheduled,false);
      await h.db.exec('set role anon');await assert.rejects(()=>ask(),/permission denied/);await h.db.exec('reset role');
    }finally{await h.close();}
  });
  await t.test('HTTP POST and GET use the durable controller; XML and scope checks survive an empty legacy cache',async()=>{
    const h=await setup();let app;
    try {
      process.env.SUPABASE_URL='';process.env.NEXT_PUBLIC_SUPABASE_URL='';process.env.SUPABASE_SERVICE_ROLE_KEY='';
      process.env.STATE_FILE=`./storage/recovery-http-${process.pid}.json`;
      process.env.JWT_SECRET='recovery-test';process.env.CERTIFICATE_ENCRYPTION_KEY='recovery-test';
      process.env.FISCAL_PRODUCTION_ENABLED='true';process.env.RECOVERY_V1_ENABLED='false';
      process.env.AUTO_TRANSMIT_HOMOLOGATION='false';
      const {buildApp}=require('../../dist/app.js');
      const {publicManagedDocument}=require('../../dist/lib/recovery/runtime.js');
      const runtime={controller:h.controller,scopes:[h.scope],ready:true,async start(){},async stop(){},
        async requestQuery(id,clientId){const {data,error}=await h.client.rpc('fiscal_recovery_request_query_v1',
          {p_request:id.slice(4),p_client:clientId,p_scopes:[h.scope.id]});if(error)throw Error(error.message);return data;},
        async findDocument(id){const r=await h.repository.get(id.slice(4));return r?publicManagedDocument(r):null;}};
      app=buildApp({recovery:runtime});await app.ready();
      app.store.issuers.push({id:'test-prod',cnpj:h.scope.cnpj,razaoSocial:'Test',nomeFantasia:'Test',ambiente:'producao',uf:'PR',
        ie:'123',crt:'1',serieNfe:2,serieNfce:2,ativo:true});
      app.store.certificates.push({id:randomUUID(),issuerId:'test-prod',cnpj:h.scope.cnpj,active:true,encryptedBundle:'synthetic'});
      const client=app.store.upsertApiClient({name:'Controller test',clientId:h.scope.clientId,clientSecret:'test-only',
        allowedScopes:['nfce','nfe'],allowedEnvironments:['producao','homologacao'],allowedCnpjs:[h.scope.cnpj],active:true});
      const token=app.store.createAccessToken(client.clientId,['nfce','nfe'],['producao','homologacao'],[h.scope.cnpj],client.updatedAt).token;
      const headers={authorization:`Bearer ${token}`,'x-recovery-request-id':randomUUID(),'x-recovery-origin-id':'sale:http',
        'x-recovery-store-id':'1','x-recovery-organization-id':h.scope.organizationId};
      const body={ambiente:'producao',nuvemLocalFiscal:{cscId:'1',csc:'synthetic'},infNFe:{...payload.infNFe,
        ide:{...payload.infNFe.ide,cUF:41,natOp:'VENDA',dhEmi:'2026-10-24T12:00:00-03:00',tpNF:1,idDest:1,cMunFG:4108809,
          tpImp:4,tpEmis:1,finNFe:1,indFinal:1,indPres:1,procEmi:0,verProc:'Test'},
        emit:{...payload.infNFe.emit,xNome:'Test',IE:'123',CRT:1},
        det:[{nItem:1,prod:{cProd:'1',cEAN:'SEM GTIN',xProd:'Synthetic',NCM:'00000000',CFOP:'5102',uCom:'UN',qCom:1,vUnCom:30,vProd:30,
          cEANTrib:'SEM GTIN',uTrib:'UN',qTrib:1,vUnTrib:30,indTot:1},imposto:{ICMS:{ICMSSN102:{orig:0,CSOSN:'102'}},
          PIS:{PISOutr:{CST:'99',vBC:0,pPIS:0,vPIS:0}},COFINS:{COFINSOutr:{CST:'99',vBC:0,pCOFINS:0,vCOFINS:0}}}}],
        total:{ICMSTot:{vNF:30}},pag:{detPag:[{tPag:'01',vPag:30}]}}};
      const first=await app.inject({method:'POST',url:'/nfce',headers,payload:body});
      assert.equal(first.statusCode,202,first.body);assert.equal(first.json().status,'autorizado');
      const id=first.json().id;assert.ok(id.startsWith('rv1_'));assert.equal(app.store.documents.length,0);
      const duplicate=await app.inject({method:'POST',url:'/nfce',headers,payload:body});
      assert.equal(duplicate.statusCode,202,duplicate.body);assert.equal(duplicate.json().id,id);assert.equal(h.counts().sent,1);
      const saved=await app.inject({method:'GET',url:`/nfce/${id}`,headers:{authorization:headers.authorization}});
      assert.equal(saved.statusCode,200,saved.body);assert.equal(saved.json().recovery.requestId,headers['x-recovery-request-id']);
      const xml=await app.inject({method:'GET',url:saved.json().xml_url.replace('http://localhost:80','')});
      assert.equal(xml.statusCode,200,xml.body);assert.ok(xml.body.includes('nfeProc'));
      const otherClient=app.store.upsertApiClient({name:'Other test integration',clientId:'other-test-client',clientSecret:'test-only',
        allowedScopes:['nfce'],allowedEnvironments:['producao'],allowedCnpjs:['*'],active:true});
      const otherToken=app.store.createAccessToken(otherClient.clientId,['nfce'],['producao'],['*'],otherClient.updatedAt).token;
      const forbidden=await app.inject({method:'GET',url:`/nfce/${id}`,headers:{authorization:`Bearer ${otherToken}`}});
      assert.equal(forbidden.statusCode,403,forbidden.body);
      const deniedQuery=await app.inject({method:'POST',url:`/nfce/${id}/consultar`,headers:{authorization:`Bearer ${otherToken}`}});
      assert.equal(deniedQuery.statusCode,403);
      const completedQuery=await app.inject({method:'POST',url:`/nfce/${id}/consultar`,headers:{authorization:headers.authorization}});
      assert.equal(completedQuery.statusCode,202,completedQuery.body);assert.equal(completedQuery.json().consulta.scheduled,false);
      assert.equal(h.counts().queries,1);assert.equal(h.counts().sent,1);
      const legacyPost=await app.inject({method:'POST',url:'/nfce',headers:{authorization:headers.authorization},payload:body});
      assert.equal(legacyPost.statusCode,409,legacyPost.body);assert.equal(h.counts().sent,1);
      const admin=await app.inject({method:'POST',url:`/admin/api/documents/${id}/sefaz-authorize`,payload:{}});
      assert.equal(admin.statusCode,409,admin.body);assert.equal(h.counts().sent,1);
      const hom=await app.inject({method:'POST',url:'/nfce',headers:{authorization:headers.authorization},payload:{...body,
        ambiente:'homologacao',mockStatus:'autorizado',infNFe:{...body.infNFe,ide:{...body.infNFe.ide,tpAmb:2}}}});
      assert.equal(hom.statusCode,202,hom.body);assert.ok(!hom.json().id.startsWith('rv1_'));assert.equal(h.counts().sent,1);
      assert.equal((await app.inject({method:'GET',url:'/ready'})).statusCode,200);
      runtime.ready=false;assert.equal((await app.inject({method:'GET',url:'/ready'})).statusCode,503);
    } finally {
      await app?.close();await h.close();
      const {rm}=await import('node:fs/promises');await rm(`./storage/recovery-http-${process.pid}.json`,{force:true});
    }
  });
});
