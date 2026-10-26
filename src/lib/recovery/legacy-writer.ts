import type {DocumentRecord} from '../../types.js';

/** Exclude explicitly adopted historical rows from legacy snapshot writes.
 * A missing/malformed ownership read fails closed. The SQL trigger still
 * protects an adoption committed after this read; no bypass is granted here.
 * Called only on actual persistence demand, never by an idle timer. */
export async function excludeAdoptedLegacyDocuments(documents:DocumentRecord[],enabled:boolean,
  rpc:(name:string,args:Record<string,unknown>)=>Promise<{data:unknown;error:unknown}>) {
  if(!enabled)return documents;
  const ids=documents.filter(d=>d.ambiente==='producao'&&
    ['NFe','NFCe'].includes(d.tipoDocumento)&&!d.id.startsWith('rv1_')).map(d=>d.id);
  if(ids.length===0)return documents;
  const owned=new Set<string>();
  for(let offset=0;offset<ids.length;offset+=250){
    const batch=[...new Set(ids.slice(offset,offset+250))];
    const {data,error}=await rpc('fiscal_recovery_legacy_owned_v1',{p_ids:batch});
    if(error||!Array.isArray(data)||data.some(id=>typeof id!=='string'||!batch.includes(id))||new Set(data).size!==data.length)
      throw Error('RECOVERY_LEGACY_OWNERSHIP_UNAVAILABLE');
    for(const id of data)owned.add(id);
  }
  return documents.filter(d=>!owned.has(d.id));
}
