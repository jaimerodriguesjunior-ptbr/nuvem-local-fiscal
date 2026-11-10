import type { ManagedDocument } from './controller-types.js';

export type ErpConflictInvoice = {
  id:number;tenant_id:string;store_id:number;tipo_documento:string;environment:string;direction:string;status:string;
  numero:number;serie:number|string;valor_total:number;chave_acesso:string|null;nuvemfiscal_uuid:string|null;
  recovery_request_id:string|null;nfe_request_key:string|null;current_attempt_id:string|null;error_message:string|null;
};
export type ErpConflictResolution = {
  invoice_id:number;tenant_id:string;store_id:number;source_invoice_id:number;attempt_id:string;request_id:string;
  client_id:string;original_key:string;original_number:number;provider_version:number;successor_invoice_id:number;
  successor_request_id:string;requires_review:boolean;created_at:string;late_result:unknown;late_xml:string|null;
};
export type ErpConflictAttempt = {
  id:string;invoice_id:number;operation:string;state:string;recovery_state:string|null;recovery_due_at:string|null;
};

/** Service-side evidence builder. Source is the ERP resolution ledger, never caller headers. */
export function buildOgNumberConflictClosureEvidence(resolution:ErpConflictResolution,invoice:ErpConflictInvoice,
  replacement:ErpConflictInvoice,attempt:ErpConflictAttempt,current:ManagedDocument,successor:ManagedDocument) {
  const invalid=()=>{throw Error('OG_CLOSURE_EVIDENCE_INVALID');};
  const s=current.scope;
  if(!resolution||!invoice||!replacement||!attempt||resolution.requires_review!==false||
    resolution.late_result!==null||resolution.late_xml!==null||
    resolution.invoice_id!==invoice.id||resolution.successor_invoice_id!==replacement.id||
    resolution.invoice_id===resolution.successor_invoice_id||!Number.isSafeInteger(resolution.source_invoice_id)||resolution.source_invoice_id<1||
    resolution.tenant_id!==s.organizationId||resolution.store_id!==s.storeId||resolution.client_id!==s.clientId||
    successor.scope.id!==s.id||resolution.request_id!==current.requestId||
    resolution.successor_request_id!==replacement.nfe_request_key||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(resolution.successor_request_id)||
    invoice.nuvemfiscal_uuid!==current.document.id||replacement.nuvemfiscal_uuid!==successor.document.id||
    invoice.recovery_request_id!==current.requestId||replacement.recovery_request_id!==successor.requestId||
    resolution.original_key!==current.document.chave||invoice.chave_acesso!==current.document.chave||
    replacement.chave_acesso!==successor.document.chave||resolution.original_number!==current.document.numero||
    invoice.numero!==current.document.numero||replacement.numero!==successor.document.numero||
    Number(invoice.serie)!==s.series||Number(replacement.serie)!==s.series||
    !Number.isSafeInteger(resolution.provider_version)||resolution.provider_version<1||resolution.provider_version>current.version||
    invoice.current_attempt_id!==attempt.id||resolution.attempt_id!==attempt.id||attempt.invoice_id!==invoice.id||
    attempt.operation!=='submission'||attempt.state!=='completed'||attempt.recovery_state!=='settled'||attempt.recovery_due_at!==null||
    invoice.status!=='rejected'||!invoice.error_message?.startsWith('NUMBER_CONFLICT_RESOLVED:')||
    replacement.status!=='authorized'||!Number.isFinite(Number(invoice.valor_total))||Number(invoice.valor_total)<=0||
    Number(invoice.valor_total)!==Number(replacement.valor_total)||
    !['pending','manual_review'].includes(current.phase)||current.code!=='539'||current.document.status!=='processamento'||current.document.protocolo||
    successor.phase!=='authorized'||successor.document.status!=='autorizado'||!['100','150'].includes(successor.code)||
    !/^\d{15}$/.test(successor.document.protocolo??'')||!successor.document.xml||
    !Number.isFinite(Date.parse(resolution.created_at))) invalid();
  for(const inv of [invoice,replacement]) if(inv.tenant_id!==s.organizationId||inv.store_id!==s.storeId||
    inv.tipo_documento!=='NFe'||inv.environment!=='production'||inv.direction!=='output') invalid();
  return {schema:'og-number-conflict-resolution-v1',erpProject:'lyidtxcngbdjxudbljca',tenantId:s.organizationId,
    storeId:s.storeId,clientId:s.clientId,requestId:current.requestId,successorRequestId:successor.requestId,
    invoiceId:invoice.id,successorInvoiceId:replacement.id,sourceInvoiceId:resolution.source_invoice_id,
    successorDraftKey:resolution.successor_request_id,
    originalKey:resolution.original_key,originalNumber:invoice.numero,successorNumber:replacement.numero,
    amount:Number(invoice.valor_total),resolvedAt:resolution.created_at,invoiceState:'rejected',attemptState:'completed',
    recoveryState:'settled',requiresReview:false};
}
