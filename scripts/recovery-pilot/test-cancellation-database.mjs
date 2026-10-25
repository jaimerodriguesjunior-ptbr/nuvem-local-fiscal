/** Compiled cancellation controller + actual prepared SQL; no .env/network. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {PGlite} from '../../.test-tools/node_modules/@electric-sql/pglite/dist/index.js';
import {createCatalogFixture} from './database-fixture.mjs';
const require=createRequire(import.meta.url),forge=require('node-forge');
process.env.SUPABASE_URL='';process.env.NEXT_PUBLIC_SUPABASE_URL='';process.env.SUPABASE_SERVICE_ROLE_KEY='';
process.env.STATE_FILE=`./storage/cancellation-http-${process.pid}.json`;
process.env.JWT_SECRET='synthetic-cancellation-test';process.env.CERTIFICATE_ENCRYPTION_KEY='synthetic-cancellation-test';
process.env.RECOVERY_V1_ENABLED='false';
const {CancellationController}=require('../../dist/lib/recovery/cancellation-controller.js');
const {SupabaseCancellationRepository}=require('../../dist/lib/recovery/cancellation-repository.js');
const {drainCancellation}=require('../../dist/lib/recovery/cancellation-drain.js');
const {buildSignedCancellationXml}=require('../../dist/lib/sefaz-cancellation.js');
const {configureTransmissionFence,assertCancellationTransmissionPermit}=require('../../dist/lib/recovery/transmission-fence.js');
const {fixtureKey,fixtureScope,fixtureSignedXml}=require('../../dist/lib/recovery/test-fixtures.js');

test('durable cancellation controller: one event send, safe uncertainty, immutable note and CAS',async()=>{
  const db=new PGlite();
  let app;
  try{
    await createCatalogFixture(db);
    for(const name of ['20261024_recovery_v1_PREPARE_ONLY.sql','20261024_recovery_controller_PREPARE_ONLY.sql',
      '20261024_recovery_sync_PREPARE_ONLY.sql','20261024_recovery_manual_PREPARE_ONLY.sql','20261024_recovery_cancellation_PREPARE_ONLY.sql','20261024_recovery_legacy_adoption_PREPARE_ONLY.sql','20261025_recovery_legacy_queue_PREPARE_ONLY.sql'])
      await db.exec(await readFile(new URL('../../migrations/'+name,import.meta.url),'utf8'));
    const q=async(sql,args=[])=>(await db.query(sql,args)).rows,scopeId=randomUUID();
    await q(`insert into fiscal_recovery.scopes(id,client_id,organization_id,store_id,cnpj,environment,model,series,enabled)
      values($1,$2,$3,1,$4,'producao','NFCe',2,true)`,[scopeId,fixtureScope.clientId,fixtureScope.organizationId,fixtureScope.cnpj]);
    configureTransmissionFence([fixtureScope]);
    const keypair=forge.pki.rsa.generateKeyPair(1024),cert=forge.pki.createCertificate();cert.publicKey=keypair.publicKey;
    cert.serialNumber='05';cert.validity.notBefore=new Date(Date.now()-60000);cert.validity.notAfter=new Date(Date.now()+86400000);
    cert.setSubject([{name:'commonName',value:'Disposable cancellation SQL test'}]);cert.setIssuer(cert.subject.attributes);cert.sign(keypair.privateKey,forge.md.sha256.create());
    const pem={privateKeyPem:forge.pki.privateKeyToPem(keypair.privateKey),certificatePem:forge.pki.certificateToPem(cert)};
    const names={fiscal_recovery_cancel_claim_v1:['p_scopes'],fiscal_recovery_cancel_get_v1:['p_intent'],fiscal_recovery_cancel_accept_v1:['p_request','p_intent','p_client','p_scopes','p_justification','p_token'],
      fiscal_recovery_cancel_step_v1:['p_intent','p_version','p_token','p_step','p_snapshot'],fiscal_recovery_cancel_finish_v1:['p_intent','p_version','p_token','p_decision']};
    const behavior={mode:'ok',commitLost:false,dbFailure:false};let prepared=0,sent=0;
    const client={async rpc(name,args){
      if(!names[name])throw Error('Unexpected RPC');
      if(name.includes('step')&&args.p_step==='send_started'&&behavior.dbFailure)return {data:null,error:{message:'RECOVERY_SYNTHETIC_STORAGE_FAILURE'}};
      try{
        const params=names[name].map(key=>args[key]),rows=await q(`select public.${name}(${params.map((_,i)=>'$'+(i+1)).join(',')}) as r`,params);
        if(name.includes('step')&&args.p_step==='send_started'&&behavior.commitLost)return {data:null,error:{message:'RECOVERY_SYNTHETIC_COMMIT_RESPONSE_LOST'}};
        return {data:rows[0].r,error:null};
      }catch(error){return {data:null,error:{message:error.message}};}
    }};
    const repository=new SupabaseCancellationRepository(client);
    const controller=new CancellationController(repository,{
      async prepare(record,justification){prepared++;if(behavior.mode==='prepareFailed')throw Error('Local certificate unavailable');
        const signed=buildSignedCancellationXml({uf:'PR',ambiente:'producao',cnpj:record.scope.cnpj,accessKey:record.document.chave,
          authorizationProtocol:record.document.protocolo,justification,...pem,eventDate:new Date('2026-10-24T12:00:00Z'),batchId:'123456789012345'});
        return {...signed,signedEventSha256:createHash('sha256').update(signed.signedEventXml).digest('hex'),batchSha256:createHash('sha256').update(signed.batchXml).digest('hex')};},
      async transmit(record,snapshot){assertCancellationTransmissionPermit(snapshot.batchXml,'producao','NFCe',record.document.chave);sent++;
        if(behavior.mode==='lost')throw Error('Response lost');const code=behavior.mode==='136'?'136':behavior.mode==='rejected'?'501':'135';
        return `<retEnvEvento xmlns="http://www.portalfiscal.inf.br/nfe"><tpAmb>1</tpAmb><cOrgao>41</cOrgao><cStat>128</cStat><retEvento><infEvento><tpAmb>1</tpAmb><cOrgao>41</cOrgao><cStat>${code}</cStat><chNFe>${record.document.chave}</chNFe><tpEvento>110111</tpEvento><nSeqEvento>1</nSeqEvento><nProt>141260000000002</nProt><dhRegEvento>2026-10-24T09:01:00-03:00</dhRegEvento></infEvento></retEvento></retEnvEvento>`;}
    });
    let number=122;
    const note=async()=>{
      number++;let first43=fixtureKey.slice(0,25)+String(number).padStart(9,'0')+fixtureKey.slice(34,43);let sum=0;
      for(let i=42,w=2;i>=0;i--,w=w===9?2:w+1)sum+=Number(first43[i])*w;
      const remainder=sum%11,key=first43+(remainder<2?0:11-remainder),request=randomUUID();
      const document={id:'rv1_'+request,providerLikeId:'rv1_'+request,issuerCnpj:fixtureScope.cnpj,ambiente:'producao',tipoDocumento:'NFCe',
        numero:number,serie:2,status:'autorizado',chave:key,xmlSigned:fixtureSignedXml.replaceAll(fixtureKey,key).replace('<nNF>123',`<nNF>${number}`),
        xml:'original authorized XML',protocolo:'141260000000001',motivoStatus:'100',payloadOriginal:{synthetic:true},createdAt:new Date().toISOString()};
      await q(`insert into fiscal_recovery.requests(request_id,scope_id,origin_id,request_hash,number,document,phase,send_started_at)
        values($1,$2,$3,$4,$5,$6,'authorized',clock_timestamp())`,[request,scopeId,'sale:'+number,'a'.repeat(64),number,document]);return {request,document};
    };
    const just='Erro no preenchimento da venda de teste';
    const cancel=(n,intent,client=fixtureScope.clientId)=>controller.cancel(n.request,intent,client,[scopeId],just);
    const first=await note(),id=randomUUID();
    await assert.rejects(()=>cancel(first,id,'other'),/SCOPE_INVALID/);assert.equal(prepared,0);
    await Promise.all([cancel(first,id),cancel(first,id)]);assert.equal(sent,1);assert.equal(prepared,1);
    let saved=await repository.get(id);assert.equal(saved.record.phase,'cancelled');assert.equal(saved.record.document.status,'cancelado');
    assert.equal(saved.record.document.protocolo,first.document.protocolo);assert.equal(saved.record.document.xml,first.document.xml);
    assert.equal(saved.record.document.xmlSigned,first.document.xmlSigned);assert.equal(saved.intent.phase,'confirmed');
    await cancel(first,id);assert.equal(sent,1);
    const uncertain=await note(),pendingId=randomUUID();behavior.mode='lost';
    const pending=await cancel(uncertain,pendingId);assert.equal(pending.phase,'cancel_pending');assert.equal(pending.document.status,'autorizado');
    const frozen=(await repository.get(pendingId)).intent.snapshot;
    await cancel(uncertain,pendingId);assert.equal(sent,2);assert.deepEqual((await repository.get(pendingId)).intent.snapshot,frozen);
    await assert.rejects(()=>cancel(uncertain,randomUUID()),/NOT_AVAILABLE|ALREADY_PENDING/);
    behavior.mode='136';const unlinked=await note();assert.equal((await cancel(unlinked,randomUUID())).phase,'cancel_pending');
    const rejected=await note(),rejectedId=randomUUID();behavior.mode='rejected';
    assert.equal((await cancel(rejected,rejectedId)).document.cancellationState,'rejeitado');
    behavior.mode='ok';await cancel(rejected,rejectedId);const beforeRetry=sent;
    assert.equal((await cancel(rejected,randomUUID())).phase,'cancelled');assert.equal(sent,beforeRetry+1);
    assert.equal((await q('select count(*)::int as n from fiscal_recovery.cancellation_intents where request_id=$1',[rejected.request]))[0].n,2);
    const local=await note(),localId=randomUUID();behavior.mode='prepareFailed';const beforeLocal=sent;
    assert.equal((await cancel(local,localId)).document.cancellationState,'bloqueado_local');assert.equal(sent,beforeLocal);
    behavior.mode='ok';assert.equal((await cancel(local,randomUUID())).phase,'cancelled');
    const noCommit=await note(),noCommitId=randomUUID();behavior.dbFailure=true;const beforeDb=sent;
    await assert.rejects(()=>cancel(noCommit,noCommitId),/STORAGE_FAILURE/);assert.equal(sent,beforeDb);
    assert.equal((await repository.get(noCommitId)).intent.sendStartedAt,null);behavior.dbFailure=false;
    const lostCommit=await note(),lostCommitId=randomUUID();behavior.commitLost=true;
    await assert.rejects(()=>cancel(lostCommit,lostCommitId),/COMMIT_RESPONSE_LOST/);assert.equal(sent,beforeDb);
    assert.ok((await repository.get(lostCommitId)).intent.sendStartedAt);behavior.commitLost=false;
    await cancel(lostCommit,lostCommitId);assert.equal(sent,beforeDb);
    const uncertainIntent=await repository.get(lostCommitId);
    await assert.rejects(()=>repository.finish(uncertainIntent,uncertainIntent.record.ownerToken,
      {state:'blocked_local',origin:'local',code:'FALSE_BEFORE_SEND'}),/BEFORE_SEND_UNPROVEN/);
    await assert.rejects(()=>repository.step(uncertainIntent,uncertainIntent.record.ownerToken,'send_started'),/SEND_ALREADY_STARTED/);
    await assert.rejects(()=>repository.finish(uncertainIntent,uncertainIntent.record.ownerToken,{state:'cancelled',origin:'sefaz',code:'135',
      protocol:'invalid',receivedAt:'2026-10-24T09:01:00-03:00',processedEventXml:'fixture',evidenceXml:'fixture'}),/PROTOCOL_UNVERIFIED/);
    const stale=await repository.get(noCommitId);assert.equal(await repository.step(stale,randomUUID(),'send_started'),null);
    assert.equal(await repository.step(stale,null,'send_started'),null);
    await assert.rejects(()=>repository.finish(stale,stale.record.ownerToken,{state:'cancelled',origin:'sefaz',code:'135',
      protocol:'141260000000002',receivedAt:'2026-10-24T09:01:00-03:00',processedEventXml:'fixture',evidenceXml:'fixture'}),/SEND_INTENT_MISSING/);
    await q("update fiscal_recovery.requests set owner_until=clock_timestamp()-interval '1 second' where request_id=$1",[noCommit.request]);
    assert.equal(await repository.step(stale,stale.record.ownerToken,'send_started'),null);
    await db.exec('set role anon');
    await assert.rejects(()=>q('select public.fiscal_recovery_cancel_get_v1($1)',[id]),/permission denied/);
    await assert.rejects(()=>repository.get(id),/STORAGE_UNAVAILABLE/);await db.exec('reset role');
    const paused=await note(),pausedId=randomUUID(),beforePause=prepared;
    await q("update fiscal_recovery.scopes set pause_until=clock_timestamp()+interval '1 hour' where id=$1",[scopeId]);
    await assert.rejects(()=>cancel(paused,pausedId),/SERVICE_PAUSED/);assert.equal(prepared,beforePause);
    await q('update fiscal_recovery.scopes set pause_until=null where id=$1',[scopeId]);
    assert.equal((await cancel(paused,pausedId)).phase,'cancelled');
    // Isolate queue scheduling without changing frozen fiscal bytes or outcomes.
    await q("update fiscal_recovery.requests set next_at=null where phase in ('cancel_started','cancel_pending')");
    const makeDue=async(request)=>q("update fiscal_recovery.requests set next_at=clock_timestamp()-interval '1 second',owner_until=clock_timestamp()-interval '1 second' where request_id=$1",[request]);
    const drainScopes=[{...fixtureScope,id:scopeId}];let consultationCount=0;
    const recoveredIntent=await repository.get(pendingId);
    const procEvent=recoveredIntent.intent.snapshot.signedEventXml.replace(/^<\?xml[^?]*\?>/,'');
    const recoveredResponse=`<retConsSitNFe xmlns="http://www.portalfiscal.inf.br/nfe"><tpAmb>1</tpAmb><chNFe>${recoveredIntent.record.document.chave}</chNFe><cStat>101</cStat><procEventoNFe>${procEvent}<retEvento><infEvento><tpAmb>1</tpAmb><cOrgao>41</cOrgao><chNFe>${recoveredIntent.record.document.chave}</chNFe><tpEvento>110111</tpEvento><nSeqEvento>1</nSeqEvento><cStat>135</cStat><nProt>141260000000002</nProt><dhRegEvento>2026-10-24T09:01:00-03:00</dhRegEvento></infEvento></retEvento></procEventoNFe></retConsSitNFe>`;
    await makeDue(uncertain.request);const sentBeforeRecovery=sent;
    const drain=()=>drainCancellation({database:client,repository,scopes:drainScopes,consult:async record=>{
      consultationCount++;assert.equal(record.document.xmlSigned,recoveredIntent.record.document.xmlSigned);return recoveredResponse;}});
    assert.ok(await drain());assert.equal((await repository.get(pendingId)).record.phase,'cancelled');
    assert.equal(await drain(),null);assert.equal(sent,sentBeforeRecovery);assert.equal(consultationCount,1);
    // Interrupted preparation is closed before-send without consultation.
    await makeDue(noCommit.request);await drain();
    assert.equal((await repository.get(noCommitId)).intent.phase,'blocked_local');assert.equal(consultationCount,1);
    // Even the first cancellation lookup shares authorization's 3/hour budget.
    await makeDue(lostCommit.request);
    await q("update fiscal_recovery.requests set query_times=array[clock_timestamp()-interval '40 minutes',clock_timestamp()-interval '20 minutes',clock_timestamp()-interval '1 minute'] where request_id=$1",[lostCommit.request]);
    const budgetNext=await drain();assert.ok(budgetNext>Date.now()+19*60*1000);assert.equal(consultationCount,1);
    await q('update fiscal_recovery.requests set query_times=\'{}\' where request_id=$1',[lostCommit.request]);
    await makeDue(lostCommit.request);
    const transportDrain=()=>drainCancellation({database:client,repository,scopes:drainScopes,consult:async()=>{consultationCount++;throw Error('timeout');}});
    await transportDrain();assert.equal((await repository.get(lostCommitId)).record.phase,'cancel_pending');
    const retryAt=(await q('select next_at from fiscal_recovery.requests where request_id=$1',[lostCommit.request]))[0].next_at;
    assert.ok(new Date(retryAt).getTime()>Date.now()+50000);assert.equal(sent,sentBeforeRecovery);
    await makeDue(lostCommit.request);const claim=(await client.rpc('fiscal_recovery_cancel_claim_v1',{p_scopes:[scopeId]})).data;
    assert.ok(claim.lease);assert.equal((await client.rpc('fiscal_recovery_cancel_claim_v1',{p_scopes:[scopeId]})).data.lease,null);
    const late=await repository.get(lostCommitId);
    await makeDue(lostCommit.request);const replacement=(await client.rpc('fiscal_recovery_cancel_claim_v1',{p_scopes:[scopeId]})).data;
    assert.notEqual(replacement.lease.token,claim.lease.token);
    assert.equal(await repository.finish(late,claim.lease.token,{state:'pending',origin:'transport',code:'LATE_RESPONSE'}),null);
    await makeDue(lostCommit.request);
    await q('update fiscal_recovery.requests set query_times=\'{}\' where request_id=$1',[lostCommit.request]);
    const beforeStop=consultationCount;
    await drainCancellation({database:client,repository,scopes:drainScopes,active:()=>false,consult:async()=>{consultationCount++;return '';}});
    assert.equal(consultationCount,beforeStop);
    await makeDue(lostCommit.request);
    await drainCancellation({database:client,repository,scopes:drainScopes,consult:async record=>{
      consultationCount++;return `<retConsSitNFe xmlns="http://www.portalfiscal.inf.br/nfe"><tpAmb>1</tpAmb><chNFe>${record.document.chave}</chNFe><cStat>656</cStat></retConsSitNFe>`;}});
    assert.equal((await repository.get(lostCommitId)).record.document.status,'autorizado');
    const pausedScope=(await q('select pause_until from fiscal_recovery.scopes where id=$1',[scopeId]))[0];
    assert.ok(new Date(pausedScope.pause_until).getTime()>Date.now()+59*60*1000);
    await makeDue(lostCommit.request);const beforePauseQuery=consultationCount;
    assert.ok(await transportDrain()>Date.now()+59*60*1000);assert.equal(consultationCount,beforePauseQuery);
    await q('update fiscal_recovery.scopes set pause_until=null where id=$1',[scopeId]);
    await q('update fiscal_recovery.requests set query_times=\'{}\' where request_id=$1',[lostCommit.request]);
    await makeDue(lostCommit.request);
    // Corruption is a review condition, never a chance to regenerate/resend.
    await q(`update fiscal_recovery.cancellation_intents set snapshot=jsonb_set(snapshot,'{signedEventSha256}','"invalid"') where intent_id=$1`,[lostCommitId]);
    await transportDrain();assert.equal(consultationCount,beforePauseQuery);
    const review=await repository.get(lostCommitId);assert.equal(review.record.phase,'cancel_pending');assert.equal(review.record.errorOrigin,'central');
    assert.equal((await q('select next_at from fiscal_recovery.requests where request_id=$1',[lostCommit.request]))[0].next_at,null);
    assert.equal(await transportDrain(),null);assert.equal(sent,sentBeforeRecovery);
    const manual=(await q('select public.fiscal_recovery_request_query_v1($1,$2,$3) as r',
      [lostCommit.request,fixtureScope.clientId,[scopeId]]))[0].r;
    assert.equal(manual.scheduled,true);assert.equal((await repository.get(lostCommitId)).record.phase,'cancel_pending');
    assert.ok(await transportDrain()>Date.now()+20000);assert.equal(consultationCount,beforePauseQuery);
    await makeDue(lostCommit.request);
    await transportDrain();assert.equal(consultationCount,beforePauseQuery);assert.equal(sent,sentBeforeRecovery);
    assert.equal(await transportDrain(),null);
    const {buildApp}=require('../../dist/app.js'),{publicManagedDocument}=require('../../dist/lib/recovery/runtime.js');
    const runtime={scopes:[{...fixtureScope,id:scopeId}],ready:true,controller:null,async start(){},async stop(){},
      async findDocument(id){const row=(await q('select public.fiscal_recovery_request_get_v1($1) as r',[id.slice(4)]))[0].r;return row?publicManagedDocument(row):null;},
      async cancel(id,intent,client,justification){return publicManagedDocument(await controller.cancel(id.slice(4),intent,client,[scopeId],justification));}};
    app=buildApp({recovery:runtime});await app.ready();
    const apiClient=app.store.upsertApiClient({name:'Cancellation fixture',clientId:fixtureScope.clientId,clientSecret:'test-only',
      allowedScopes:['nfce'],allowedEnvironments:['producao'],allowedCnpjs:[fixtureScope.cnpj],active:true});
    const token=app.store.createAccessToken(apiClient.clientId,['nfce'],['producao'],[fixtureScope.cnpj],apiClient.updatedAt).token;
    const httpNote=await note(),httpIntent=randomUUID(),url=`/nfce/rv1_${httpNote.request}/cancelar`;
    const missing=await app.inject({method:'POST',url,headers:{authorization:`Bearer ${token}`},payload:{justificativa:just}});
    assert.equal(missing.statusCode,400,missing.body);
    const beforeHttp=sent;const headers={authorization:`Bearer ${token}`,'x-recovery-cancel-id':httpIntent};
    const response=await app.inject({method:'POST',url,headers,payload:{justificativa:just}});
    assert.equal(response.statusCode,200,response.body);assert.equal(response.json().status,'cancelado');assert.equal(sent,beforeHttp+1);
    assert.equal(response.json().recovery.cancellationIntentId,httpIntent);
    const repeated=await app.inject({method:'POST',url,headers,payload:{justificativa:just}});
    assert.equal(repeated.statusCode,200,repeated.body);assert.equal(sent,beforeHttp+1);
    const eventUrl=new URL(response.json().cancelamento.xml_evento_url);
    assert.equal((await app.inject({method:'GET',url:eventUrl.pathname+eventUrl.search})).statusCode,401);
    const artifact=await app.inject({method:'GET',url:eventUrl.pathname+eventUrl.search,headers:{authorization:`Bearer ${token}`}});
    assert.equal(artifact.statusCode,200,artifact.body);assert.ok(artifact.body.includes('procEventoNFe'));
    const other=app.store.upsertApiClient({name:'Other fixture',clientId:'other-fixture',clientSecret:'test-only',
      allowedScopes:['nfce'],allowedEnvironments:['producao'],allowedCnpjs:['*'],active:true});
    const otherToken=app.store.createAccessToken(other.clientId,['nfce'],['producao'],['*'],other.updatedAt).token;
    assert.equal((await app.inject({method:'POST',url,headers:{...headers,authorization:`Bearer ${otherToken}`},payload:{justificativa:just}})).statusCode,403);
    behavior.mode='lost';const lostHttp=await note();
    const uncertainResponse=await app.inject({method:'POST',url:`/nfce/rv1_${lostHttp.request}/cancelar`,
      headers:{authorization:`Bearer ${token}`,'x-recovery-cancel-id':randomUUID()},payload:{justificativa:just}});
    assert.equal(uncertainResponse.statusCode,202,uncertainResponse.body);assert.equal(uncertainResponse.json().status,'autorizado');
    assert.equal(uncertainResponse.json().recovery.phase,'cancel_pending');
  }finally{await app?.close();configureTransmissionFence([]);await db.close();await rm(process.env.STATE_FILE,{force:true});}
});
