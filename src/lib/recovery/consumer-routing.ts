import type {ManagedScope} from './controller-types.js';
import type {SyncEvent} from './outbox.js';

export function decodeOgScopeIds(value:string|undefined):string[] {
  const ids:unknown=JSON.parse(value??'[]');
  if(!Array.isArray(ids)||ids.length>100||ids.some(id=>typeof id!=='string'||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id))||new Set(ids).size!==ids.length)
    throw Error('RECOVERY_OG_SCOPE_CONFIG_INVALID');
  return ids;
}
export function validateOgScopes(value:unknown,ids:readonly string[],clientId:string):ManagedScope[] {
  if(!clientId||!Array.isArray(value)||value.length!==ids.length)throw Error('RECOVERY_OG_SCOPE_NOT_READY');
  const seen=new Set<string>();
  for(const s of value as ManagedScope[]){
    if(!s||!ids.includes(s.id)||seen.has(s.id)||s.clientId!==clientId||s.environment!=='producao'||
      !/^[a-f0-9-]{36}$/i.test(s.organizationId)||!Number.isSafeInteger(s.storeId)||s.storeId<1||
      !/^\d{14}$/.test(s.cnpj)||!['NFe','NFCe'].includes(s.model)||!Number.isSafeInteger(s.series)||s.series<1||s.series>999)
      throw Error('RECOVERY_OG_SCOPE_MISMATCH');seen.add(s.id);
  }
  return value as ManagedScope[];
}
export function routeRecoveryDelivery(routes:readonly {scopes:readonly ManagedScope[];deliver:(event:SyncEvent)=>Promise<number>}[]) {
  const recipients=new Map<string,(event:SyncEvent)=>Promise<number>>();
  const key=(s:{clientId:string;organizationId:string;storeId:number})=>JSON.stringify([s.clientId,s.organizationId,s.storeId]);
  for(const route of routes)for(const scope of route.scopes){
    const k=key(scope),existing=recipients.get(k);
    if(existing&&existing!==route.deliver)throw Error('RECOVERY_CONSUMER_ROUTE_AMBIGUOUS');recipients.set(k,route.deliver);
  }
  return (event:SyncEvent)=>{const deliver=recipients.get(key(event));
    if(!deliver)throw Error('RECOVERY_CONSUMER_ROUTE_MISSING');return deliver(event);};
}
