// Disposable loopback PostgreSQL and synthetic data. No .env or fiscal transport.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import path from 'node:path';
import {createCatalogFixture} from './database-fixture.mjs';
const require=createRequire(import.meta.url),arg=n=>process.argv.find(v=>v.startsWith('--'+n+'='))?.split('=').slice(1).join('=');
const bin=arg('postgres-bin');assert.ok(bin&&path.isAbsolute(bin));const pg=require(arg('pg-module')||'pg');
const {decodeManagedDocument}=require('../../dist/lib/recovery/managed-repository.js');
const {publicManagedDocument}=require('../../dist/lib/recovery/runtime.js');
const work=path.resolve('tmp','administrative-closure-pg-'+randomUUID());await mkdir(work,{recursive:true});
const run=(exe,args)=>new Promise((resolve,reject)=>{const p=spawn(path.join(bin,exe+(process.platform==='win32'?'.exe':'')),args,{windowsHide:true,stdio:['ignore','pipe','pipe']});let out='';p.stdout.on('data',v=>out+=v);p.stderr.on('data',v=>out+=v);p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(Error(out)));});
const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
const data=path.join(work,'pg'),pass=path.join(work,'password'),password=randomBytes(24).toString('hex');await writeFile(pass,password);
const options={host:'127.0.0.1',port,user:'postgres',database:'postgres',password};const db=new pg.Client(options),other=new pg.Client(options);
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),request=id(10),next=id(20),unrelated=id(30),scope=id(1),tenant=id(2),checks=[];
let started=false;
const sql=n=>readFile(new URL('../../migrations/'+n,import.meta.url),'utf8').then(s=>s.replace(/\r\n/g,'\n'));
const call=async(evidence,version=8)=>(await db.query('select public.fiscal_recovery_close_og_number_conflict_v1($1,$2,$3,$4) result',[request,next,version,evidence])).rows[0].result;
const one=async(id=request)=>(await db.query('select * from fiscal_recovery.requests where request_id=$1',[id])).rows[0];
const failed=async(name,setup,action,pattern)=>{await db.query('begin');try{await setup();await assert.rejects(action,pattern);checks.push(name);}finally{await db.query('rollback');}};
try{
  await run('initdb',['--pgdata='+data,'--auth=password','--username=postgres','--pwfile='+pass,'--lc-messages=C','--encoding=UTF8','--no-sync']);await rm(pass);
  await run('pg_ctl',['-D',data,'-l',path.join(work,'server.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']);started=true;
  await db.connect();await other.connect();await createCatalogFixture({exec:s=>db.query(s),query:(...a)=>db.query(...a)});
  for(const n of ['20261024_recovery_v1_PREPARE_ONLY.sql','20261024_recovery_controller_PREPARE_ONLY.sql',
    '20261024_recovery_sync_PREPARE_ONLY.sql','20261024_recovery_manual_PREPARE_ONLY.sql','20261024_recovery_cancellation_PREPARE_ONLY.sql',
    '20261024_recovery_legacy_adoption_PREPARE_ONLY.sql','20261025_recovery_legacy_queue_PREPARE_ONLY.sql','20261026_recovery_og_scopes_PREPARE_ONLY.sql',
    'manual/20261109_admin_managed_documents_READ_ONLY.sql'])await db.query(await sql(n));
  await db.query(`insert into fiscal_recovery.scopes(id,client_id,organization_id,store_id,cnpj,environment,model,series,enabled)
    values($1,'client',$2,7,'12345678000195','producao','NFe',1,true);`,[scope,tenant]);
  await db.query('insert into fiscal_recovery.og_scope_bindings(scope_id,enabled) values($1,true)',[scope]);
  const doc=(r,n)=>({id:'rv1_'+r,providerLikeId:'rv1_'+r,tipoDocumento:'NFe',issuerCnpj:'12345678000195',ambiente:'producao',numero:n,serie:1,
    status:'processamento',chave:String(n===2499?1:2).repeat(44),protocolo:null,motivoStatus:'539',motivo:'Resultado ainda não confirmado.',xml:'',xmlSigned:'<synthetic/>',
    payloadOriginal:{infNFe:{ide:{tpNF:0,finNFe:4},total:{ICMSTot:{vNF:5398}}}},payloadNormalizado:{},createdAt:'2026-10-30T12:00:00Z',updatedAt:'2026-10-30T12:01:00Z'});
  for(const [r,n]of [[request,2499],[next,2500],[unrelated,2501]]){
    const d=doc(r,n);if(r===next)Object.assign(d,{status:'autorizado',motivoStatus:'100',xml:'<authorized-synthetic/>',protocolo:'141260000000001'});
    await db.query(`insert into fiscal_recovery.requests(request_id,scope_id,origin_id,request_hash,number,document,phase,origin,code,version,send_started_at,next_at,created_at,updated_at)
      values($1,$2,$3,$4,$5,$6,$7,'sefaz',$8,8,'2026-10-30T12:00:00Z',case when $7='authorized' then null else now()-interval '1 minute' end,'2026-10-30','2026-10-30')`,
      [r,scope,'og:invoice:'+(r===request?39:r===next?40:41),'a'.repeat(64),n,d,r===next?'authorized':'pending',r===next?'100':'539']);
  }
  const before=await one(),successorBefore=await one(next),otherBefore=await one(unrelated);
  await db.query(await sql('manual/20261110_og_administrative_closure.sql'));
  assert.deepEqual(await one(),before);assert.deepEqual(await one(next),successorBefore);assert.deepEqual(await one(unrelated),otherBefore);
  assert.equal((await db.query('select count(*)::int n from fiscal_recovery.administrative_closures')).rows[0].n,0);checks.push('installation is additive and leaves all requests untouched');
  const signature='public.fiscal_recovery_close_og_number_conflict_v1(uuid,uuid,bigint,jsonb)';
  const acl=(await db.query(`select has_function_privilege('anon',$1,'execute') anon,has_function_privilege('authenticated',$1,'execute') authenticated,
    has_function_privilege('service_role',$1,'execute') service,has_table_privilege('service_role','fiscal_recovery.administrative_closures','select') direct_table`,[signature])).rows[0];
  assert.deepEqual(acl,{anon:false,authenticated:false,service:true,direct_table:false});checks.push('service-only RPC and private RLS ledger');
  const evidence={schema:'og-number-conflict-resolution-v1',erpProject:'lyidtxcngbdjxudbljca',tenantId:tenant,storeId:7,clientId:'client',
    requestId:request,successorRequestId:next,invoiceId:39,successorInvoiceId:40,sourceInvoiceId:19,originalKey:'1'.repeat(44),originalNumber:2499,
    successorNumber:2500,successorDraftKey:id(50),amount:5398,resolvedAt:'2026-10-30T13:00:00Z',invoiceState:'rejected',attemptState:'completed',recoveryState:'settled',requiresReview:false};
  for(const bad of [{tenantId:id(99)},{storeId:9},{requestId:id(99)},{originalKey:'3'.repeat(44)},{successorInvoiceId:99},
    {requiresReview:true},{attemptState:'processing'},{amount:1},{erpProject:'foreign'}]){
    await failed('rejects evidence '+Object.keys(bad).join(),async()=>{},()=>call({...evidence,...bad}),/CLOSURE_EVIDENCE_INVALID/);
  }
  await failed('rejects stale canonical version',async()=>{},()=>call(evidence,7),/VERSION_CHANGED/);
  for(const expired of [false,true])await failed('refuses '+(expired?'expired':'active')+' non-cleared query leases',
    ()=>db.query(`update fiscal_recovery.requests set claim_token=$2,claim_until=now()+($3||' seconds')::interval where request_id=$1`,[request,id(99),expired?'-1':'90']),
    ()=>call(evidence),/OPERATION_IN_PROGRESS/);
  await failed('requires an authorized successor',()=>db.query("update fiscal_recovery.requests set phase='pending' where request_id=$1",[next]),()=>call(evidence),/SUCCESSOR_INVALID/);
  await failed('rejects altered fiscal totals',()=>db.query(`update fiscal_recovery.requests set document=jsonb_set(document,'{payloadOriginal,infNFe,total,ICMSTot,vNF}','1') where request_id=$1`,[next]),()=>call(evidence),/SUCCESSOR_INVALID/);
  await failed('rejects an already authorized original',()=>db.query("update fiscal_recovery.requests set phase='authorized' where request_id=$1",[request]),()=>call(evidence),/FISCAL_STATE_CHANGED/);
  await failed('anonymous role is actually denied',()=>db.query('set local role anon'),()=>call(evidence),/permission denied/);
  // Concurrent worker wins a row lock/version change; closure cannot race through it.
  await other.query('begin');await other.query('select 1 from fiscal_recovery.requests where request_id=$1 for update',[request]);
  const concurrent=call(evidence).then(()=>{throw Error('Expected closure to reject a changed version');},error=>assert.match(error.message,/VERSION_CHANGED/));
  await new Promise(resolve=>setTimeout(resolve,30));await other.query('update fiscal_recovery.requests set version=version+1 where request_id=$1',[request]);await other.query('commit');await concurrent;
  await db.query('update fiscal_recovery.requests set version=8 where request_id=$1',[request]);checks.push('concurrent canonical update is fenced by row lock and version');
  await db.query('begin');await db.query('set local role service_role');const closed=await call(evidence);await db.query('commit');
  const after=await one();assert.equal(after.next_at,null);assert.equal(after.version,'9');
  for(const key of Object.keys(before).filter(k=>!['next_at','version'].includes(k)))assert.deepEqual(after[key],before[key],key);
  assert.deepEqual(await one(next),successorBefore);assert.deepEqual(await one(unrelated),otherBefore);
  const archived=(await db.query('select * from fiscal_recovery.administrative_closures where request_id=$1',[request])).rows[0];
  assert.deepEqual(archived.fiscal_snapshot.document,before.document);assert.equal(archived.fiscal_snapshot.code,'539');
  assert.equal(closed.administrativeClosure.successorNumber,2500);assert.equal(closed.phase,'pending');assert.equal(closed.document.status,'processamento');checks.push('closure cancels scheduling only; fiscal bytes, status, code, successor and unrelated request preserved');
  const again=await call(evidence,8);assert.deepEqual(again,closed);
  assert.equal((await db.query('select count(*)::int n from fiscal_recovery.request_outbox where request_id=$1',[request])).rows[0].n,1);checks.push('idempotent application creates exactly one durable notification');
  await failed('conflicting second disposition is rejected',async()=>{},()=>call({...evidence,sourceInvoiceId:99}),/CLOSURE_CONFLICT/);
  for(const action of [()=>db.query('update fiscal_recovery.requests set next_at=now() where request_id=$1',[request]),
    ()=>db.query("update fiscal_recovery.requests set document=document||'{\"status\":\"autorizado\"}'::jsonb where request_id=$1",[request]),
    ()=>db.query('delete from fiscal_recovery.requests where request_id=$1',[request])]){
    await failed('closed request cannot be rearmed/rewritten/deleted',async()=>{},action,/ADMINISTRATIVELY_CLOSED/);
  }
  const manual=(await db.query('select public.fiscal_recovery_request_query_v1($1,$2,$3) result',[request,'client',[scope]])).rows[0].result;
  assert.deepEqual(manual,{scheduled:false,nextAt:null,reason:'ADMINISTRATIVELY_CLOSED'});checks.push('manual lookup explicitly reports closed without scheduling');
  await failed('scope authorization is checked before closed disposition',async()=>{},()=>db.query('select public.fiscal_recovery_request_query_v1($1,$2,$3)',[request,'foreign',[scope]]),/SCOPE_INVALID/);
  const claim=(await db.query('select public.fiscal_recovery_managed_claim_v1($1,$2) result',['local-test',[scope]])).rows[0].result;
  assert.equal(claim.lease.id,unrelated);assert.equal((await one()).query_attempt,before.query_attempt);checks.push('worker skips closed request and continues unrelated recovery');
  const page=(await db.query('select public.fiscal_recovery_admin_documents_v1(null,100,now()) result')).rows[0].result;
  const projection=publicManagedDocument(decodeManagedDocument(page.items.find(x=>x.record.requestId===request).record));
  assert.equal(projection.recovery.administrativeClosure.successorNumber,2500);checks.push('canonical GET/admin projection exposes safe closure metadata');
  const report={at:new Date().toISOString(),localOnly:true,nativePostgres:true,syntheticOnly:true,passed:checks.length,checks};
  await mkdir('docs/validation',{recursive:true});await writeFile('docs/validation/og-administrative-closure-sql-20261110.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{await db.query('rollback').catch(()=>{});await other.query('rollback').catch(()=>{});await Promise.allSettled([db.end(),other.end()]);if(started)await run('pg_ctl',['-D',data,'-m','fast','-w','stop']);}
