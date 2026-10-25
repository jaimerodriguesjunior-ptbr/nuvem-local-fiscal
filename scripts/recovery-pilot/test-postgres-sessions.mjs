/** Native PostgreSQL 17.6, loopback TLS, private disposable data directory.
 * Install (test-only): npm install --prefix .test-tools --ignore-scripts --no-audit --no-fund --package-lock=false embedded-postgres@17.6.0-beta.15
 * No Docker/global service, hosted database, .env or fiscal network is used.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createServer} from 'node:net';
import {randomUUID,createHash} from 'node:crypto';
import forge from 'node-forge';
import pg from 'pg';
import {createRequire} from 'node:module';
import {createCatalogFixture,insertTestDocument} from './database-fixture.mjs';
import {createGopFixture,org,actor,cnpj} from '../../../piloto-gop/scripts/recovery-pilot/gop-database-fixture.mjs';
import {createOrderDeleteFixture} from '../../../piloto-gop/scripts/recovery-pilot/order-delete-fixture.mjs';
const require=createRequire(import.meta.url);
const {RecoveryController}=require('../../dist/lib/recovery/controller.js');
const {recoveryDatabaseTls}=require('../../dist/lib/recovery/database-tls.js');
const {SupabaseManagedRepository}=require('../../dist/lib/recovery/managed-repository.js');
const {SupabaseRecoveryRepository}=require('../../dist/lib/recovery/supabase-repository.js');
const {PostgresRecoveryWakeSource}=require('../../dist/lib/recovery/postgres-wake-source.js');
const {fixtureScope,fixtureKey,fixtureSignedXml}=require('../../dist/lib/recovery/test-fixtures.js');
const {configureTransmissionFence,assertTransmissionPermit}=require('../../dist/lib/recovery/transmission-fence.js');

function command(exe,args){return new Promise((done,fail)=>{
  const child=spawn(exe,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';
  child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>output+=c);child.on('error',fail);
  child.on('exit',code=>code===0?done(output):fail(Error('Local PostgreSQL command failed: '+output.slice(-2000))));
});}
function boundedSignal(){let signal;const promise=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('notification timeout')),15000);
  signal=()=>{clearTimeout(timer);resolve();};});return {promise,signal};}
function rpc(client){return {async rpc(name,args){
  assert.match(name,/^(fiscal_recovery|gop_recovery)_[a-z0-9_]+$/);const keys=Object.keys(args);
  try{const result=await client.query(`select public.${name}(${keys.map((key,i)=>key+' => $'+(i+1)).join(',')}) as r`,keys.map(key=>args[key]));
    return {data:result.rows[0].r,error:null};}catch(error){return {data:null,error:{message:error.message}};}
}};}
test('native sessions: concurrent admission/claim, CAS, TLS and LISTEN commit/reconnect',async()=>{
  const root=resolve('.test-tools/native-pg');await mkdir(root,{recursive:true});const directory=await mkdtemp(join(root,'sessions-'));
  assert.ok(directory.startsWith(root+'\\')||directory.startsWith(root+'/'));
  const bin=resolve('.test-tools/node_modules/@embedded-postgres/windows-x64/native/bin');
  const password='local-disposable-'+randomUUID(),passwordFile=join(directory,'init-password.txt'),data=join(directory,'data');
  const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
  const clients=[];let source,closeSource,serverStarted=false;
  const tlsKeys=forge.pki.rsa.generateKeyPair(2048),certificate=forge.pki.createCertificate();certificate.publicKey=tlsKeys.publicKey;
  certificate.serialNumber='10';certificate.validity.notBefore=new Date(Date.now()-60000);certificate.validity.notAfter=new Date(Date.now()+86400000);
  certificate.setSubject([{name:'commonName',value:'localhost'}]);certificate.setIssuer(certificate.subject.attributes);
  certificate.setExtensions([{name:'basicConstraints',cA:true},{name:'subjectAltName',altNames:[{type:2,value:'localhost'},{type:7,ip:'127.0.0.1'}]}]);
  certificate.sign(tlsKeys.privateKey,forge.md.sha256.create());const ca=forge.pki.certificateToPem(certificate);
  const config={host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:{ca,rejectUnauthorized:true},connectionTimeoutMillis:10000};
  const connect=async(database='postgres')=>{const client=new pg.Client({...config,database});await client.connect();clients.push(client);return client;};
  const logs=[];
  try{
    await writeFile(passwordFile,password+'\n');await writeFile(join(directory,'trusted-ca.crt'),ca);
    await command(join(bin,'initdb.exe'),['-D',data,'-U','postgres','--auth=scram-sha-256','--pwfile='+passwordFile,'--encoding=UTF8','--locale=C','--no-sync']);
    await rm(passwordFile,{force:true});await writeFile(join(data,'test.crt'),ca);await writeFile(join(data,'test.key'),forge.pki.privateKeyToPem(tlsKeys.privateKey));
    // pg_ctl starts only this private cluster, with a log inside its data tree.
    await command(join(bin,'pg_ctl.exe'),['-D',data,'-l',join(directory,'postgres.log'),'-o',
      `-h 127.0.0.1 -p ${port} -c ssl=on -c ssl_cert_file=test.crt -c ssl_key_file=test.key -c fsync=off -c full_page_writes=off`,'-w','start']);serverStarted=true;
    const admin=await connect();assert.match((await admin.query('select version() as version')).rows[0].version,/PostgreSQL 17\.6/);
    await admin.query('create database recovery_central');await admin.query('create database recovery_gop');
    const a=await connect('recovery_central'),b=await connect('recovery_central');
    await createCatalogFixture({exec:sql=>a.query(sql)});
    for(const name of ['20261024_recovery_v1_PREPARE_ONLY.sql','20261024_recovery_controller_PREPARE_ONLY.sql',
      '20261024_recovery_sync_PREPARE_ONLY.sql','20261024_recovery_manual_PREPARE_ONLY.sql','20261024_recovery_cancellation_PREPARE_ONLY.sql','20261024_recovery_legacy_adoption_PREPARE_ONLY.sql','20261025_recovery_legacy_queue_PREPARE_ONLY.sql'])
      await a.query(await readFile(new URL('../../migrations/'+name,import.meta.url),'utf8'));
    const scope={...fixtureScope,id:randomUUID()};
    await a.query(`insert into fiscal_recovery.scopes(id,client_id,organization_id,store_id,cnpj,environment,model,series,enabled)
      values($1,$2,$3,1,$4,'producao','NFCe',2,true)`,[scope.id,scope.clientId,scope.organizationId,scope.cnpj]);
    let sends=0,preparations=0;configureTransmissionFence([scope]);
    const transport={async prepare(){preparations++;return {accessKey:fixtureKey,signedXml:fixtureSignedXml,unsignedXml:'fixture',
      signatureValid:true,xsdValid:true,xsdErrors:[],certificateId:randomUUID()};},async consult(){return `<retConsSitNFe xmlns="http://www.portalfiscal.inf.br/nfe"><tpAmb>1</tpAmb><cStat>217</cStat><chNFe>${fixtureKey}</chNFe></retConsSitNFe>`;},
      async authorize(document){assertTransmissionPermit(document.xmlSigned,'producao','NFCe');sends++;throw Error('lost response');}};
    const repoA=new SupabaseManagedRepository(rpc(a)),repoB=new SupabaseManagedRepository(rpc(b));
    const controllerA=new RecoveryController(repoA,transport),controllerB=new RecoveryController(repoB,transport),request=randomUUID();
    const payload={infNFe:{ide:{mod:65,tpAmb:1,serie:2,nNF:123,cNF:'01234567'},emit:{CNPJ:scope.cnpj}}};
    await Promise.all([controllerA.submit(scope,request,'sale:session',payload,{},null),controllerB.submit(scope,request,'sale:session',payload,{},null)]);
    assert.equal(preparations,1);assert.equal(sends,1);assert.equal((await repoA.get(request)).phase,'pending');
    const qA=new SupabaseRecoveryRepository(rpc(a),'session-a',[scope.id],true),qB=new SupabaseRecoveryRepository(rpc(b),'session-b',[scope.id],true);
    await a.query("update fiscal_recovery.requests set next_at=clock_timestamp()-interval '1 second' where request_id=$1",[request]);
    const claims=await Promise.all([qA.claim(),qB.claim()]);assert.equal(claims.filter(c=>c.lease).length,1);
    const first=claims.find(c=>c.lease).lease;
    assert.notEqual(claims.find(c=>!c.lease).nextWakeAt,null);
    assert.ok((await qA.claim()).nextWakeAt>Date.now()+60000);
    await a.query("update fiscal_recovery.requests set claim_until=clock_timestamp()-interval '1 second' where request_id=$1",[request]);
    const replacement=(await qB.claim()).lease;assert.ok(replacement);assert.notEqual(replacement.token,first.token);
    const decision={state:'pending',origin:'transport',code:'SESSION_TEST'};
    assert.equal(await qA.complete(first,decision,Date.now()+60000),false);assert.equal(await qB.complete(replacement,decision,Date.now()+60000),true);
    // Two independent sessions associate the same historical identity. This
    // exercises SQL/CAS only; cryptographic proof has its own real-signature
    // test and no fiscal transport is available to this fixture operation.
    let old43=fixtureKey.slice(0,25)+'000000124'+fixtureKey.slice(34,43),oldSum=0;
    for(let i=42,w=2;i>=0;i--,w=w===9?2:w+1)oldSum+=Number(old43[i])*w;
    const oldRemainder=oldSum%11,oldKey=old43+(oldRemainder<2?0:11-oldRemainder),legacy='native_legacy';
    const oldXml=fixtureSignedXml.replaceAll(fixtureKey,oldKey).replace('<nNF>123</nNF>','<nNF>124</nNF>');
    await insertTestDocument(a,legacy,124,oldKey,'autorizado');
    await a.query('update public.fiscal_documents set signed_xml=$1,protocol=$2 where id=$3',[oldXml,'141260000000001',legacy]);
    const oldSource=(await rpc(a).rpc('fiscal_recovery_legacy_source_v1',{p_legacy:legacy,p_scope:scope.id,p_client:scope.clientId})).data;
    const oldRequest=randomUUID(),associationArgs={p_legacy:legacy,p_scope:scope.id,p_client:scope.clientId,p_request:oldRequest,
      p_origin:'legacy-invoice:session',p_source_sha256:oldSource.sourceSha256,p_proof:{legacyId:legacy,scopeId:scope.id,
        signedXmlSha256:createHash('sha256').update(oldXml).digest('hex'),authorizationProtocol:'141260000000001',authorizationCode:'100',
        processedXml:'<synthetic-authorized/>',evidenceXml:'<synthetic-consultation/>',adoptionMethod:'legacy_authorized_consultation_v1'}};
    const associated=await Promise.all([rpc(a).rpc('fiscal_recovery_legacy_associate_v1',associationArgs),
      rpc(b).rpc('fiscal_recovery_legacy_associate_v1',associationArgs)]);
    for(const result of associated){assert.equal(result.error,null);assert.equal(result.data.requestId,oldRequest);assert.equal(result.data.sendStartedAt,null);}
    assert.equal((await a.query('select count(*)::int as n from fiscal_recovery.legacy_links')).rows[0].n,1);
    await assert.rejects(()=>b.query("update public.fiscal_documents set status='erro' where id=$1",[legacy]),/LEGACY_DOCUMENT_OWNED/);
    const ga=await connect('recovery_gop'),gb=await connect('recovery_gop');
    await createGopFixture({exec:sql=>ga.query(sql.replace(/create role (?:anon|authenticated|service_role);/g,''))});
    const reserve=(client)=>rpc(client).rpc('gop_recovery_reserve_v1',{p_request:randomUUID(),p_org:org,p_store:1,p_cnpj:cnpj,
      p_model:'NFCe',p_series:2,p_origin:'sale:77',p_work_order:77,p_actor:actor,p_client:'test-client'});
    const reserved=await Promise.all([reserve(ga),reserve(gb)]);reserved.forEach(r=>assert.equal(r.error,null));
    assert.equal(reserved[0].data.attempt.requestId,reserved[1].data.attempt.requestId);
    assert.equal((await ga.query("select n from public.test_counters where model='NFCe'")).rows[0].n,123);
    await ga.query('insert into public.vendas(id,store_id) values(79,1),(80,1)');
    await ga.query('insert into public.service_orders(id,venda_id) values(89,79)');
    const reserveSale=async(client,sale)=>rpc(client).rpc('gop_recovery_reserve_v1',{p_request:randomUUID(),p_org:org,p_store:1,p_cnpj:cnpj,
      p_model:'NFCe',p_series:2,p_origin:'sale:'+sale,p_work_order:sale,p_actor:actor,p_client:'test-client'});
    await ga.query('begin');assert.equal((await reserveSale(ga,79)).error,null);
    let deleted=false;
    const deletion=gb.query('delete from public.service_orders where id=89').then(()=>{deleted=true;},error=>{throw error;});
    // Attach the rejection handler before committing so a fast server rejection
    // never becomes an unhandled promise rejection in the test process.
    const refused=assert.rejects(()=>deletion,/FISCAL_ORIGIN_OWNED/);
    await new Promise(r=>setTimeout(r,100));assert.equal(deleted,false);await ga.query('commit');await refused;
    assert.equal((await ga.query('select count(*)::int as n from public.service_orders where id=89')).rows[0].n,1);
    await gb.query('begin');await gb.query('delete from public.vendas where id=80');
    let admitted=false;const admission=reserveSale(ga,80).then(result=>{admitted=true;return result;});
    await new Promise(r=>setTimeout(r,100));assert.equal(admitted,false);await gb.query('commit');
    assert.match((await admission).error.message,/SALE_ORIGIN_INVALID/);
    assert.equal((await ga.query("select n from public.test_counters where model='NFCe'")).rows[0].n,124);
    await createOrderDeleteFixture({exec:sql=>ga.query(sql)});
    await ga.query('insert into public.vendas(id,store_id) values(82,1)');await ga.query('insert into public.service_orders(id,venda_id) values(92,82)');
    await ga.query('insert into public.products(id,estoque_atual) values(2,10)');
    await ga.query(`insert into public.stock_movements(tenant_id,store_id,product_id,tipo,quantidade,motivo,related_os_id,related_venda_id)
      values($1,1,2,'Saida',3,'Reserva manual teste',92,82)`,[org]);
    await ga.query('begin');assert.equal((await reserveSale(ga,82)).error,null);
    const atomicDeletion=gb.query('select public.gop_recovery_delete_order_v1(82,92,1,$1)',[actor]);
    const atomicRefused=assert.rejects(()=>atomicDeletion,/FISCAL_ORIGIN_OWNED/);
    await new Promise(r=>setTimeout(r,100));await ga.query('commit');await atomicRefused;
    assert.equal(Number((await ga.query('select estoque_atual from public.products where id=2')).rows[0].estoque_atual),10);
    assert.equal((await ga.query('select count(*)::int as n from public.stock_movements where related_os_id=92')).rows[0].n,1);
    const reserveDraft=async(client)=>{const result=await rpc(client).rpc('gop_recovery_reserve_v1',{p_request:randomUUID(),p_org:org,p_store:1,p_cnpj:cnpj,
      p_model:'NFe',p_series:2,p_origin:'draft:'+randomUUID(),p_work_order:null,p_actor:actor,p_client:'test-client'});assert.equal(result.error,null);return result.data.attempt;};
    const drafts=await Promise.all([reserveDraft(ga),reserveDraft(gb)]),reference='8'.repeat(44);
    const prepareReference=(client,attempt)=>rpc(client).rpc('gop_recovery_prepare_v1',{p_request:attempt.requestId,p_version:attempt.version,
      p_payload:{ambiente:'producao',_shipment_origin_key:reference,infNFe:{ide:{mod:55,tpAmb:1,serie:2,nNF:attempt.number,NFref:[{refNFe:reference}]},emit:{CNPJ:cnpj}}},p_snapshot:{}});
    const special=await Promise.all([prepareReference(ga,drafts[0]),prepareReference(gb,drafts[1])]);
    assert.equal(special.filter(result=>result.error===null).length,1);
    assert.match(special.find(result=>result.error).error.message,/SPECIAL_REFERENCE_RESERVED/);
    let listener,wakes=0;const disconnected=boundedSignal(),reconnected=boundedSignal(),notification=boundedSignal();
    source=new PostgresRecoveryWakeSource({createConnection:()=>{
      listener=new pg.Client({...config,database:'recovery_central'});const query=listener.query.bind(listener);
      listener.query=(sql)=>{logs.push(sql);return query(sql);};return listener;
    }});
    closeSource=await source.subscribe(()=>{wakes++;if(wakes===2)notification.signal();if(wakes>=3)reconnected.signal();},()=>disconnected.signal());
    assert.equal(wakes,1);await a.query('begin');await a.query('update fiscal_recovery.scopes set enabled=enabled where id=$1',[scope.id]);
    await new Promise(r=>setTimeout(r,100));assert.equal(wakes,1);await a.query('commit');await notification.promise;assert.equal(wakes,2);
    const oldPid=listener.processID;await b.query('select pg_terminate_backend($1)',[oldPid]);await disconnected.promise;
    await a.query('update fiscal_recovery.scopes set pause_until=clock_timestamp()+interval \'1 minute\' where id=$1',[scope.id]);
    await reconnected.promise;assert.notEqual(listener.processID,oldPid);assert.ok(wakes>=3);
    assert.deepEqual(logs,['LISTEN fiscal_recovery_v1','LISTEN fiscal_recovery_v1']);
    await new Promise(r=>setTimeout(r,100));assert.equal(logs.length,2);
    const untrusted=new pg.Client({...config,ssl:{rejectUnauthorized:true},connectionTimeoutMillis:3000});
    await assert.rejects(()=>untrusted.connect());await untrusted.end();
  }finally{
    await closeSource?.();configureTransmissionFence([]);await Promise.allSettled(clients.map(c=>c.end()));
    if(serverStarted)await command(join(bin,'pg_ctl.exe'),['-D',data,'-m','fast','-w','stop']);
    await rm(passwordFile,{force:true});
    // Data/logs intentionally retained under the verified, ignored test root;
    // no recursive shell deletion or global service management is performed.
  }
});
