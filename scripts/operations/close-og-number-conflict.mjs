// Default preview. Explicit --apply registers only a verified existing ERP resolution.
// --central-env=... --erp-env=... --invoice=39 [--apply]
import fs from 'node:fs';
import {parseEnv} from 'node:util';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {decodeManagedDocument}=require('../../dist/lib/recovery/managed-repository.js');
const {buildOgNumberConflictClosureEvidence}=require('../../dist/lib/recovery/og-number-conflict-closure.js');
const value=name=>process.argv.find(v=>v.startsWith('--'+name+'='))?.split('=').slice(1).join('=');
const invoiceId=Number(value('invoice'));assert.ok(Number.isSafeInteger(invoiceId)&&invoiceId>0);
const central=parseEnv(fs.readFileSync(value('central-env'),'utf8')),erp=parseEnv(fs.readFileSync(value('erp-env'),'utf8'));
assert.equal(new URL(central.SUPABASE_URL||central.NEXT_PUBLIC_SUPABASE_URL).hostname,'kfebaoocbgmcvveumlem.supabase.co');
assert.equal(new URL(erp.SUPABASE_URL||erp.NEXT_PUBLIC_SUPABASE_URL).hostname,'lyidtxcngbdjxudbljca.supabase.co');
async function request(e,table,params={},body){
  const url=new URL('/rest/v1/'+table,e.SUPABASE_URL||e.NEXT_PUBLIC_SUPABASE_URL);
  for(const[k,v]of Object.entries(params))url.searchParams.set(k,v);
  const response=await fetch(url,{method:body?'POST':'GET',headers:{apikey:e.SUPABASE_SERVICE_ROLE_KEY,
    Authorization:'Bearer '+e.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
  const data=await response.json();if(!response.ok)throw Error(table+' HTTP '+response.status+' '+(data.code||'')+' '+(data.message||'').slice(0,180));return data;
}
const one=rows=>{assert.equal(rows.length,1);return rows[0];};
const resolution=one(await request(erp,'fiscal_sales_return_number_conflicts',{select:'invoice_id,tenant_id,store_id,source_invoice_id,attempt_id,request_id,client_id,original_key,original_number,provider_version,successor_invoice_id,successor_request_id,requires_review,created_at,late_result,late_xml',invoice_id:'eq.'+invoiceId}));
const columns='id,tenant_id,store_id,tipo_documento,environment,direction,status,numero,serie,valor_total,chave_acesso,nuvemfiscal_uuid,recovery_request_id,nfe_request_key,current_attempt_id,error_message';
const invoices=await request(erp,'fiscal_invoices',{select:columns,id:'in.('+invoiceId+','+resolution.successor_invoice_id+')',tenant_id:'eq.'+resolution.tenant_id});
const invoice=one(invoices.filter(i=>i.id===invoiceId)),replacement=one(invoices.filter(i=>i.id===resolution.successor_invoice_id));
const attempt=one(await request(erp,'fiscal_operation_attempts',{select:'id,invoice_id,operation,state,recovery_state,recovery_due_at',id:'eq.'+resolution.attempt_id}));
const get=id=>request(central,'rpc/fiscal_recovery_request_get_v1',{}, {p_request:id}).then(decodeManagedDocument);
assert.ok(replacement.recovery_request_id);
const [current,successor]=await Promise.all([get(resolution.request_id),get(replacement.recovery_request_id)]);
const evidence=buildOgNumberConflictClosureEvidence(resolution,invoice,replacement,attempt,current,successor);
const applying=process.argv.includes('--apply');let record=current;
if(applying)record=decodeManagedDocument(await request(central,'rpc/fiscal_recovery_close_og_number_conflict_v1',{},
  {p_request:current.requestId,p_successor:successor.requestId,p_version:current.version,p_evidence:evidence}));
const report={at:new Date().toISOString(),mode:applying?'apply':'preview',invoiceId,number:current.document.numero,
  successorInvoiceId:replacement.id,successorNumber:successor.document.numero,requestId:current.requestId,
  expectedVersion:current.version,resultVersion:record.version,fiscalPhase:record.phase,fiscalCode:record.code,
  administrativeClosure:record.administrativeClosure??null,evidenceVerified:true,fiscalIoPerformed:false};
if(value('report'))fs.writeFileSync(value('report'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
