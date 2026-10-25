import test from 'node:test';
import assert from 'node:assert/strict';
import type {DocumentRecord} from '../../types.js';
import {excludeAdoptedLegacyDocuments} from './legacy-writer.js';

test('snapshot filtering is bounded, cohort-specific, fails closed and leaves other consumers independent',async()=>{
  const note=(id:string,patch:Partial<DocumentRecord>={})=>({id,issuerCnpj:'01997929000108',ambiente:'producao',serie:2,tipoDocumento:'NFCe',...patch} as DocumentRecord);
  const rows=[note('old'),note('other',{issuerCnpj:'12345678000195'}),note('hom',{ambiente:'homologacao'}),note('rv1_new')];
  let calls=0;
  const rpc=async(name:string,args:Record<string,unknown>)=>{calls++;assert.equal(name,'fiscal_recovery_legacy_owned_v1');
    assert.deepEqual(args.p_ids,['old']);return {data:['old'],error:null};};
  assert.deepEqual(await excludeAdoptedLegacyDocuments(rows,false,rpc),rows);assert.equal(calls,0);
  assert.deepEqual(await excludeAdoptedLegacyDocuments(rows,true,rpc),rows.slice(1));assert.equal(calls,1);
  for(const response of [{data:[],error:'offline'},{data:null,error:null},{data:['unknown'],error:null},{data:['old','old'],error:null}])
    await assert.rejects(()=>excludeAdoptedLegacyDocuments(rows,true,async()=>response),/OWNERSHIP_UNAVAILABLE/);
  const many=Array.from({length:501},(_,n)=>note('id_'+n));let count=0;
  const result=await excludeAdoptedLegacyDocuments(many,true,async(_,args)=>{
    assert.ok((args.p_ids as string[]).length<=250);count++;return {data:[],error:null};});
  assert.equal(result.length,501);assert.equal(count,3);
});
