import type {ManagedScope} from './controller-types.js';
import {signRecoverySync} from './sync-auth.js';
import {validateOgScopes} from './consumer-routing.js';
export type OgScopeIdentity=Omit<ManagedScope,'id'>;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function decodeOgAutoTenants(value:string|undefined):string[]{
  const ids:unknown=JSON.parse(value??'[]');
  if(!Array.isArray(ids)||ids.length>100||ids.some(id=>typeof id!=='string'||!uuid.test(id))||new Set(ids).size!==ids.length)throw Error('RECOVERY_OG_AUTO_TENANTS_INVALID');
  return ids;
}
export function decodeOgScopeCatalog(value:unknown,clientId:string,organizationId:string):OgScopeIdentity[]{
  const r=value as {schema?:unknown;clientId?:unknown;organizationId?:unknown;scopes?:unknown};
  if(!r||r.schema!=='og-scope-catalog-v1'||r.clientId!==clientId||r.organizationId!==organizationId||!Array.isArray(r.scopes)||r.scopes.length>1000)throw Error('RECOVERY_OG_CATALOG_INVALID');
  const namespaces=new Set<string>();
  return r.scopes.map(v=>{
    const s=v as OgScopeIdentity;
    if(!s||s.organizationId!==organizationId||!Number.isSafeInteger(s.storeId)||s.storeId<1||!/^\d{14}$/.test(s.cnpj)||
      s.environment!=='producao'||!['NFe','NFCe'].includes(s.model)||!Number.isSafeInteger(s.series)||s.series<1||s.series>999||
      Object.keys(s).some(k=>!['organizationId','storeId','cnpj','environment','model','series'].includes(k)))throw Error('RECOVERY_OG_CATALOG_SCOPE_INVALID');
    const key=JSON.stringify([s.cnpj,s.model,s.series]);if(namespaces.has(key))throw Error('RECOVERY_OG_CATALOG_NAMESPACE_CONFLICT');namespaces.add(key);
    return {...s,clientId};
  });
}
export function sameOgScope(a:OgScopeIdentity,b:OgScopeIdentity){return a.clientId===b.clientId&&a.organizationId===b.organizationId&&
  a.storeId===b.storeId&&a.cnpj===b.cnpj&&a.environment===b.environment&&a.model===b.model&&a.series===b.series;}

/** A tenant policy permits discovery, never trusts caller-provided store ownership.
 * The signed ERP catalog supplies identities. The atomic RPC enforces the policy,
 * issuer authorization, namespace ownership and administrative pauses again.
 */
export function createOgAutoScopes(options:{tenantIds:readonly string[];clientId:string;eventUrl:string;secret:string;
  database:{rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}>};
  apply(scopes:ManagedScope[]):void;current():readonly ManagedScope[];fetch?:typeof fetch}){
  const target=new URL(options.eventUrl);
  if(!options.clientId||options.secret.length<32||target.protocol!=='https:'||target.username||target.password||target.search||target.hash||
    target.pathname!=='/api/fiscal/recovery-v1/events')throw Error('RECOVERY_OG_AUTO_CONFIG_INVALID');
  target.pathname='/api/fiscal/recovery-v1/scopes';
  let pending:Promise<void>|null=null;
  const refresh=()=>{
    if(pending)return pending;
    pending=(async()=>{
      const scopes:ManagedScope[]=[];
      for(const organizationId of options.tenantIds){
        const body=JSON.stringify({schema:'og-scope-catalog-v1',kind:'catalog',clientId:options.clientId,organizationId});
        const timestamp=String(Math.floor(Date.now()/1000));
        const response=await (options.fetch??fetch)(target.toString(),{method:'POST',body,headers:{'content-type':'application/json',
          'x-recovery-timestamp':timestamp,'x-recovery-signature':signRecoverySync(body,options.secret,timestamp)},
          redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
        if(!response.ok)throw Error('RECOVERY_OG_CATALOG_UNAVAILABLE');
        if(Number(response.headers.get('content-length')||0)>262144)throw Error('RECOVERY_OG_CATALOG_TOO_LARGE');
        if(!response.body)throw Error('RECOVERY_OG_CATALOG_INVALID');
        const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
        try{for(;;){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>262144){await reader.cancel();throw Error('RECOVERY_OG_CATALOG_TOO_LARGE');}chunks.push(r.value);}}finally{reader.releaseLock();}
        const proposed=decodeOgScopeCatalog(JSON.parse(Buffer.concat(chunks).toString('utf8')),options.clientId,organizationId);
        const result=await options.database.rpc('fiscal_recovery_og_ensure_scopes_v1',{p_client:options.clientId,p_organization:organizationId,
          p_scopes:proposed.map(({clientId:_client,...s})=>s)});
        if(result.error)throw Error('RECOVERY_OG_AUTO_STORAGE_UNAVAILABLE');
        const data=result.data as {scopes:ManagedScope[];blocked:unknown[]};
        if(!data||!Array.isArray(data.scopes)||!Array.isArray(data.blocked))throw Error('RECOVERY_OG_AUTO_RESULT_INVALID');
        const loaded=validateOgScopes(data.scopes,data.scopes.map(s=>s.id),options.clientId);
        if(loaded.some(s=>s.organizationId!==organizationId))throw Error('RECOVERY_OG_AUTO_TENANT_MISMATCH');
        scopes.push(...loaded);
      }
      options.apply(scopes);
    })().finally(()=>{pending=null;});
    return pending;
  };
  return {refresh,async ensure(identity:OgScopeIdentity){
    if(identity.clientId!==options.clientId||!options.tenantIds.includes(identity.organizationId))return false;
    if(options.current().some(s=>sameOgScope(s,identity)))return true;
    await refresh();return options.current().some(s=>sameOgScope(s,identity));
  }};
}
