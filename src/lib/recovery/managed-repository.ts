import type { SupabaseClient } from "@supabase/supabase-js";
import type { DocumentRecord } from "../../types.js";
import type { ManagedDocument, ManagedPhase, ManagedRepository, ManagedScope } from "./controller-types.js";

export function decodeManagedDocument(value: unknown): ManagedDocument {
  if (!value || typeof value!=='object' || Array.isArray(value)) throw new Error('RECOVERY_AGGREGATE_INVALID');
  const r=value as ManagedDocument;
  if (!Number.isSafeInteger(r.version) || r.version<1 || !r.scope?.id || !r.requestId ||
      (r.provenance!==undefined&&!['recovery-v1','legacy_authorized_consultation_v1','legacy_pending_consultation_v1'].includes(r.provenance)) ||
      r.document?.id!==`rv1_${r.requestId}` || r.document.issuerCnpj!==r.scope.cnpj ||
      r.document.ambiente!==r.scope.environment || r.document.tipoDocumento!==r.scope.model ||
      r.document.serie!==r.scope.series) throw new Error('RECOVERY_AGGREGATE_INVALID');
  return r;
}
export class SupabaseManagedRepository implements ManagedRepository {
  constructor(private readonly client: SupabaseClient) {}
  private async rpc(name:string,args:Record<string,unknown>):Promise<unknown> {
    const {data,error}=await this.client.rpc(name,args);
    if (error) throw new Error(error.message.includes('RECOVERY_')?error.message:'RECOVERY_STORAGE_UNAVAILABLE');
    return data;
  }
  async get(requestId:string):Promise<ManagedDocument|null> {
    const data=await this.rpc('fiscal_recovery_request_get_v1',{p_request:requestId});
    return data===null?null:decodeManagedDocument(data);
  }
  async accept(scope:ManagedScope,requestId:string,originId:string,hash:string,document:DocumentRecord,token:string,resumeLocal=false) {
    const data=await this.rpc('fiscal_recovery_request_accept_v1',{p_scope:scope.id,p_request:requestId,
      p_origin:originId,p_hash:hash,p_document:document,p_token:token,p_resume_local:resumeLocal}) as {created:boolean;record:unknown};
    if (!data || typeof data.created!=='boolean') throw new Error('RECOVERY_ACCEPT_INVALID');
    return {created:data.created,record:decodeManagedDocument(data.record)};
  }
  async transition(current:ManagedDocument,phase:ManagedPhase,document:DocumentRecord,
    origin:ManagedDocument['errorOrigin'],code:string,token:string):Promise<ManagedDocument|null> {
    const data=await this.rpc('fiscal_recovery_request_transition_v1',{p_request:current.requestId,p_version:current.version,
      p_token:token,p_phase:phase,p_document:document,p_origin:origin,p_code:code});
    return data===null?null:decodeManagedDocument(data);
  }
}
