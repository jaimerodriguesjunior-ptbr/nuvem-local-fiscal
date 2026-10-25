import { createRequire } from "node:module";
import { randomUUID,createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { config } from "../../config.js";
import type { InMemoryStore } from "../../store.js";
import type { DocumentRecord } from "../../types.js";
import { openEncryptedCertificate } from "../certificates.js";
import { resolveQrCodeConfig, resolveResponsibleTechnicalCsrtConfig } from "../document-processing.js";
import { generateAndSignNfeXml } from "../nfe-xml.js";
import { validateNfeXml } from "../xsd-validator.js";
import { authorizeNfeAtSefaz, querySefazDocumentStatus } from "../sefaz-authorization.js";
import { RecoveryController } from "./controller.js";
import type { ManagedDocument, ManagedScope } from "./controller-types.js";
import { SupabaseManagedRepository,decodeManagedDocument } from "./managed-repository.js";
import { SupabaseRecoveryRepository } from "./supabase-repository.js";
import { PostgresRecoveryWakeSource, type RecoveryNotificationConnection } from "./postgres-wake-source.js";
import { RecoveryWorker } from "./worker.js";
import { configureTransmissionFence } from "./transmission-fence.js";
import {RecoveryOutboxWorker,createSyncDelivery} from './outbox.js';
import {recoveryListenUrl} from './listen-url.js';
import {RecoveryGopDrainPump,RecoveryDemandPump,createGopDrain} from './gop-drain.js';
import {recoveryDatabaseTls} from './database-tls.js';
import {drainCancellation} from './cancellation-drain.js';
import {drainLegacy,associateLegacy} from './legacy-drain.js';
import {CancellationController} from './cancellation-controller.js';
import {SupabaseCancellationRepository} from './cancellation-repository.js';
import {buildSignedCancellationXml,transmitSignedCancellationAtSefaz} from '../sefaz-cancellation.js';

export type RecoveryDocumentMetadata = {
  schema: 'recovery-v1'; requestId:string; originId:string; version:number; phase:ManagedDocument['phase'];
  organizationId:string;storeId:number;clientId:string;errorOrigin:ManagedDocument['errorOrigin'];code:string;
  sendState:'not_started_proven'|'possibly_sent';
  cancellationIntentId:string|null;
};
export type ManagedPublicDocument = DocumentRecord & {recovery:RecoveryDocumentMetadata};
export interface RecoveryRuntime {
  controller: RecoveryController;
  scopes: readonly ManagedScope[];
  ready: boolean;
  start():Promise<void>;
  stop():Promise<void>;
  findDocument(id:string):Promise<ManagedPublicDocument|null>;
  requestQuery(id:string,clientId:string):Promise<{scheduled:boolean;nextAt:string|null;reason:string}>;
  cancel(id:string,intentId:string,clientId:string,justification:string):Promise<ManagedPublicDocument>;
  associateLegacy(id:string,requestId:string,originId:string,clientId:string,model:'NFe'|'NFCe'):Promise<{document:ManagedPublicDocument|null;check:unknown}>;
}
export function publicManagedDocument(record:ManagedDocument):ManagedPublicDocument {
  return {...record.document,recovery:{schema:'recovery-v1',requestId:record.requestId,originId:record.originId,
    version:record.version,phase:record.phase,organizationId:record.scope.organizationId,storeId:record.scope.storeId,
    clientId:record.scope.clientId,errorOrigin:record.errorOrigin,code:record.code,
    sendState:record.sendStartedAt||record.provenance==='legacy_authorized_consultation_v1'?'possibly_sent':'not_started_proven',cancellationIntentId:record.document.cancellationAttemptId??null}};
}

export function createRecoveryRuntime(store:InMemoryStore):RecoveryRuntime|null {
  if (process.env.RECOVERY_V1_ENABLED!=='true') return null;
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey || !config.fiscalProductionEnabled) throw new Error('RECOVERY_CONFIG_INCOMPLETE');
  const scopeIds:unknown=JSON.parse(process.env.RECOVERY_V1_SCOPE_IDS ?? '[]');
  const databaseUrl=process.env.RECOVERY_V1_DATABASE_URL;
  if (!databaseUrl || !Array.isArray(scopeIds) || scopeIds.length<1 || scopeIds.length>2 ||
      scopeIds.some(id=>typeof id!=='string'||!/^[a-f0-9-]{36}$/i.test(id))) throw new Error('RECOVERY_SCOPE_CONFIG_REQUIRED');
  const database=recoveryListenUrl(databaseUrl,config.supabaseUrl);
  const gopProject=process.env.RECOVERY_V1_GOP_SUPABASE_URL??'';
  const gopDatabase=recoveryListenUrl(process.env.RECOVERY_V1_GOP_DATABASE_URL??'',gopProject);
  const databaseTls=recoveryDatabaseTls();
  if(new URL(gopProject).hostname===new URL(config.supabaseUrl).hostname)throw new Error('RECOVERY_GOP_DATABASE_PROJECT_MISMATCH');
  const client=createClient(config.supabaseUrl,config.supabaseServiceRoleKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const repository=new SupabaseManagedRepository(client);
  const deliver=createSyncDelivery(process.env.RECOVERY_V1_GOP_EVENT_URL??'',process.env.RECOVERY_V1_SYNC_SECRET??'');
  const certificate=(document:DocumentRecord)=>{
    const issuer=store.findIssuerByCnpj(document.issuerCnpj,document.ambiente);
    const cert=store.findActiveCertificate(document.issuerCnpj);
    if (!issuer || !cert?.encryptedBundle) throw new Error('RECOVERY_CERTIFICATE_UNAVAILABLE');
    return {issuer,cert};
  };
  const controller=new RecoveryController(repository,{
    async prepare(document) {
      if(process.env.RECOVERY_V1_FIRST_SEND_ENABLED!=='true')throw Error('RECOVERY_SERVICE_PAUSED');
      const {cert}=certificate(document);
      const opened=openEncryptedCertificate(cert.encryptedBundle,config.certificateEncryptionKey);
      const signed=generateAndSignNfeXml(document.payloadOriginal as Record<string,unknown>,opened.privateKeyPem,
        opened.certificatePem,resolveQrCodeConfig(document),resolveResponsibleTechnicalCsrtConfig(document));
      const xsd=validateNfeXml(signed.signedXml);
      return {...signed,xsdValid:xsd.valid,xsdErrors:xsd.errors,certificateId:cert.id};
    },
    async consult(document) {
      const {issuer,cert}=certificate(document);
      return (await querySefazDocumentStatus({uf:issuer.uf,ambiente:document.ambiente,documentType:document.tipoDocumento as 'NFe'|'NFCe',
        accessKey:document.chave!,encryptedCertificateBundle:cert.encryptedBundle,encryptionSecret:config.certificateEncryptionKey})).responseXml;
    },
    async authorize(document) {
      const {issuer,cert}=certificate(document);
      return (await authorizeNfeAtSefaz({uf:issuer.uf,ambiente:document.ambiente,documentType:document.tipoDocumento as 'NFe'|'NFCe',
        signedXml:document.xmlSigned!,encryptedCertificateBundle:cert.encryptedBundle,encryptionSecret:config.certificateEncryptionKey})).responseXml;
    }
  });
  const cancellationRepository=new SupabaseCancellationRepository(client);
  const cancellation=new CancellationController(cancellationRepository,{
    async prepare(record,justification){
      if(process.env.RECOVERY_V1_CANCELLATION_SEND_ENABLED!=='true')throw Error('RECOVERY_SERVICE_PAUSED');
      const {issuer,cert}=certificate(record.document);
      const opened=openEncryptedCertificate(cert.encryptedBundle,config.certificateEncryptionKey);
      const signed=buildSignedCancellationXml({uf:issuer.uf,ambiente:'producao',cnpj:record.scope.cnpj,
        accessKey:record.document.chave!,authorizationProtocol:record.document.protocolo!,justification,
        privateKeyPem:opened.privateKeyPem,certificatePem:opened.certificatePem});
      return {...signed,signedEventSha256:createHash('sha256').update(signed.signedEventXml).digest('hex'),
        batchSha256:createHash('sha256').update(signed.batchXml).digest('hex')};
    },
    async transmit(record,snapshot){
      const {issuer,cert}=certificate(record.document);
      return (await transmitSignedCancellationAtSefaz({uf:issuer.uf,ambiente:'producao',documentType:record.scope.model,
        cnpj:record.scope.cnpj,accessKey:record.document.chave!,authorizationProtocol:record.document.protocolo!,
        justification:record.document.cancellationJustification!,encryptedCertificateBundle:cert.encryptedBundle,
        encryptionSecret:config.certificateEncryptionKey},snapshot)).responseXml;
    }
  });
  let worker:RecoveryWorker|undefined;
  let outbox:RecoveryOutboxWorker|undefined;
  let gopDrain:RecoveryGopDrainPump|undefined;
  let cancellationPump:RecoveryDemandPump|undefined;
  let cancellationActive=false;
  let started=false;
  const consultLegacy=async(document:DocumentRecord)=>{
    const {issuer,cert}=certificate(document);
    return (await querySefazDocumentStatus({uf:issuer.uf,ambiente:'producao',documentType:document.tipoDocumento as 'NFe'|'NFCe',
      accessKey:document.chave!,encryptedCertificateBundle:cert.encryptedBundle,
      encryptionSecret:config.certificateEncryptionKey})).responseXml;
  };
  const runtime:RecoveryRuntime={controller,scopes:[],get ready(){return started&&Boolean(worker?.ready)&&Boolean(outbox?.ready)&&Boolean(gopDrain?.ready)&&Boolean(cancellationPump?.ready);},
    async start() {
      const {data,error}=await client.rpc('fiscal_recovery_scopes_v1',{p_scopes:scopeIds});
      if(error || !Array.isArray(data)||data.length!==scopeIds.length) throw new Error('RECOVERY_SCOPE_NOT_READY');
      for(const s of data as ManagedScope[]) {
        if (!scopeIds.includes(s.id)||s.cnpj!=='01997929000108'||s.environment!=='producao'||s.storeId!==1||s.series!==2||
          s.organizationId!=='40b34e90-4c9d-4446-b775-770a3e77d6c0'||!['NFe','NFCe'].includes(s.model)||!s.clientId) throw new Error('RECOVERY_PILOT_SCOPE_MISMATCH');
      }
      runtime.scopes=data as ManagedScope[];
      if(new Set(runtime.scopes.map(s=>s.clientId)).size!==1)throw new Error('RECOVERY_GOP_CLIENT_MISMATCH');
      const legacyOwnership=await client.rpc('fiscal_recovery_legacy_owned_v1',{p_ids:[]});
      if(legacyOwnership.error||!Array.isArray(legacyOwnership.data)||legacyOwnership.data.length!==0)
        throw Error('RECOVERY_LEGACY_SCHEMA_NOT_READY');
      const legacyQueue=await client.rpc('fiscal_recovery_legacy_claim_v1',{p_scopes:[]});
      // Empty scope is rejected by the installed RPC; a missing RPC is not that rejection.
      if(!legacyQueue.error?.message?.includes('RECOVERY_LEGACY_SCOPE_REQUIRED'))throw Error('RECOVERY_LEGACY_QUEUE_NOT_READY');
      configureTransmissionFence(runtime.scopes);
      const pg=createRequire(__filename)('pg') as {Client:new(options:Record<string,unknown>)=>RecoveryNotificationConnection};
      const source=new PostgresRecoveryWakeSource({createConnection:()=>new pg.Client({connectionString:database,
        ssl:databaseTls,connectionTimeoutMillis:10_000,query_timeout:15_000,application_name:'recovery-v1'})});
      const outboxSource=new PostgresRecoveryWakeSource({createConnection:()=>new pg.Client({connectionString:database,
        ssl:databaseTls,connectionTimeoutMillis:10_000,query_timeout:15_000,application_name:'recovery-v1-outbox'})});
      outbox=new RecoveryOutboxWorker({database:client,scopeIds:scopeIds as string[],source:outboxSource,deliver,
        report(code){console.error(`[Recovery] ${code}`);}});
      const gopSource=new PostgresRecoveryWakeSource({createConnection:()=>new pg.Client({connectionString:gopDatabase,
        ssl:databaseTls,connectionTimeoutMillis:10_000,query_timeout:15_000,application_name:'recovery-v1-gop'})});
      gopDrain=new RecoveryGopDrainPump({source:gopSource,drain:createGopDrain(process.env.RECOVERY_V1_GOP_EVENT_URL??'',
        process.env.RECOVERY_V1_SYNC_SECRET??'',runtime.scopes[0].clientId),report(code){console.error(`[Recovery] ${code}`);}});
      const cancellationSource=new PostgresRecoveryWakeSource({createConnection:()=>new pg.Client({connectionString:database,
        ssl:databaseTls,connectionTimeoutMillis:10_000,query_timeout:15_000,application_name:'recovery-v1-cancellation'})});
      cancellationActive=true;
      cancellationPump=new RecoveryDemandPump({source:cancellationSource,codePrefix:'RECOVERY_CANCEL',
        drain:async()=>{
          const legacyNext=await drainLegacy({database:client,scopes:runtime.scopes,consult:consultLegacy,
            active:()=>cancellationActive&&Boolean(cancellationPump?.acceptingWork)});
          const cancelNext=await drainCancellation({database:client,repository:cancellationRepository,scopes:runtime.scopes,
          active:()=>cancellationActive&&Boolean(cancellationPump?.acceptingWork),
          async consult(record){const {issuer,cert}=certificate(record.document);
            return (await querySefazDocumentStatus({uf:issuer.uf,ambiente:'producao',documentType:record.scope.model,
              accessKey:record.document.chave!,encryptedCertificateBundle:cert.encryptedBundle,
              encryptionSecret:config.certificateEncryptionKey})).responseXml;}});
          const times=[legacyNext,cancelNext].filter((x):x is number=>x!==null);
          return times.length?Math.min(...times):null;
        },report(code){console.error(`[Recovery] ${code}`);}});
      worker=new RecoveryWorker({enabled:true,scopes:runtime.scopes,repository:new SupabaseRecoveryRepository(client,randomUUID(),scopeIds as string[],true),
        wakeSource:source,async consult(document) {
          const record=await repository.get(document.documentId.slice(4));
          if (!record||record.document.chave!==document.accessKey||record.document.xmlSigned!==document.signedXml) throw new Error('RECOVERY_DOCUMENT_CHANGED');
          const {issuer,cert}=certificate(record.document);
          return (await querySefazDocumentStatus({uf:issuer.uf,ambiente:'producao',documentType:record.scope.model,accessKey:document.accessKey,
            encryptedCertificateBundle:cert.encryptedBundle,encryptionSecret:config.certificateEncryptionKey})).responseXml;
        },report(code){console.error(`[Recovery] ${code}`);}});
      try{await outbox.start();await gopDrain.start();await cancellationPump.start();await worker.start();}catch(error){cancellationActive=false;await worker.stop();await cancellationPump.stop();await gopDrain.stop();await outbox.stop();throw error;}
      started=true;
    },
    async stop(){started=false;cancellationActive=false;await worker?.stop();await cancellationPump?.stop();await gopDrain?.stop();await outbox?.stop();},
    async findDocument(id) {
      if(!/^rv1_[a-f0-9-]{36}$/i.test(id)){
        if(id.startsWith('rv1_'))return null;
        const legacy=store.findDocument(id);
        if(!legacy||!runtime.scopes.some(s=>s.cnpj===legacy.issuerCnpj&&s.environment===legacy.ambiente&&
          s.model===legacy.tipoDocumento&&s.series===legacy.serie))return null;
        const {data,error}=await client.rpc('fiscal_recovery_legacy_lookup_v1',{p_legacy:id,p_scopes:scopeIds});
        if(error)throw Error('RECOVERY_LEGACY_LOOKUP_UNAVAILABLE');
        return data===null?null:publicManagedDocument(decodeManagedDocument(data));
      }
      const record=await repository.get(id.slice(4));
      return record?publicManagedDocument(record):null;
    },
    async requestQuery(id,clientId){
      if(!/^rv1_[a-f0-9-]{36}$/i.test(id))throw new Error('RECOVERY_QUERY_ID_INVALID');
      const {data,error}=await client.rpc('fiscal_recovery_request_query_v1',{p_request:id.slice(4),p_client:clientId,p_scopes:scopeIds});
      if(error||!data||typeof data.scheduled!=='boolean'||typeof data.reason!=='string'||
        (data.nextAt!==null&&(typeof data.nextAt!=='string'||!Number.isFinite(Date.parse(data.nextAt)))))throw new Error('RECOVERY_QUERY_UNAVAILABLE');
      return data as {scheduled:boolean;nextAt:string|null;reason:string};
    },
    async cancel(id,intentId,clientId,justification){
      if(!/^rv1_[a-f0-9-]{36}$/i.test(id))throw new Error('RECOVERY_CANCEL_ID_INVALID');
      return publicManagedDocument(await cancellation.cancel(id.slice(4),intentId,clientId,scopeIds as string[],justification));
    },
    async associateLegacy(id,requestId,originId,clientId,model){
      if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(requestId)||
        !originId||originId.length>200)throw Error('RECOVERY_LEGACY_REQUEST_INVALID');
      const source=store.findDocument(id,model);
      const scope=source&&runtime.scopes.find(s=>s.clientId===clientId&&s.cnpj===source.issuerCnpj&&
        s.environment===source.ambiente&&s.model===source.tipoDocumento&&s.series===source.serie);
      if(!scope)throw Error('RECOVERY_LEGACY_SCOPE_INVALID');
      const result=await associateLegacy({database:client,scope,legacyId:id,requestId,originId,consult:consultLegacy,active:()=>runtime.ready});
      return {document:result.record?publicManagedDocument(result.record):null,check:result.check};
    }
  };
  return runtime;
}
