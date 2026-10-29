import assert from 'node:assert/strict';
import test from 'node:test';
import {requestsSalesReturnEntry,validSalesReturnEntry} from './sales-return-entry-profile.js';
import {validateNfeEmissionPayload} from './nfe-rules.js';
import {resolveReturnCfop} from './return-cfop-resolver.js';

function fixture(model='55'):any {
  const key=`41261008214081000134${model}0010000000421000000001`;
  return {operacao:'sales_return_entry',sales_return_entry:{profile:'consumer_sales_return_entry_v1',sourceInvoiceId:80,sourceFingerprint:'a'.repeat(32),sourceKey:key,sourceModel:model==='55'?'NFe':'NFCe',reason:'Mercadoria devolvida pelo consumidor'},
    metadados:{operacao:'sales_return_entry',devolucao:{salesReturnEntryV1:true}},
    infNFe:{ide:{mod:55,tpImp:1,tpNF:0,finNFe:4,idDest:1,natOp:'DEVOLUCAO DE VENDA',NFref:[{refNFe:key}]},emit:{CNPJ:'08214081000134',CRT:1,enderEmit:{UF:'PR'}},dest:{CPF:'52998224725',indIEDest:9,enderDest:{UF:'PR'}},
      det:[{nItem:1,prod:{CFOP:'1202',qCom:1,qTrib:1,uCom:'UN',uTrib:'UN',vUnCom:100,vUnTrib:100,vProd:100},imposto:{ICMS:{ICMSSN900:{orig:0,CSOSN:'900',modBC:3,vBC:0,pICMS:0,vICMS:0}},PIS:{PISOutr:{CST:'99',vBC:0,pPIS:0,vPIS:0}},COFINS:{COFINSOutr:{CST:'99',vBC:0,pCOFINS:0,vCOFINS:0}}}}],total:{ICMSTot:{vNF:100,vProd:100}},pag:{detPag:[{tPag:'90',vPag:0}]},transp:{modFrete:9}}};
}
for(const model of ['55','65'])test(`entry referencing model ${model} passes rules and keeps CFOP 1202`,()=>{
  const p=fixture(model);assert.equal(validSalesReturnEntry(p),true);assert.equal(validateNfeEmissionPayload(p).ok,true);
  const result=resolveReturnCfop(p,'PR',[]);assert.equal(result.shouldBlock,false);assert.equal(result.items[0].outputCfop,'1202');assert.equal(result.items[0].fallbackApplied,false);
});
test('same profile supports another issuer and UF while binding the original key to its emitter',()=>{
  for(const [cnpj,uf]of [['35181069000143','PR'],['11222333000181','SP']]){
    const p=fixture(),key=(uf==='SP'?'35':'41')+p.sales_return_entry.sourceKey.slice(2,6)+cnpj+p.sales_return_entry.sourceKey.slice(20);
    p.sales_return_entry.sourceKey=key;p.infNFe.ide.NFref=[{refNFe:key}];
    p.infNFe.emit.CNPJ=cnpj;p.infNFe.emit.enderEmit.UF=uf;p.infNFe.dest.enderDest.UF=uf;
    assert.equal(validSalesReturnEntry(p),true);assert.equal(validateNfeEmissionPayload(p).ok,true);
    assert.equal(resolveReturnCfop(p,uf,[]).items[0].outputCfop,'1202');
    p.infNFe.emit.CNPJ='08214081000134';assert.equal(validSalesReturnEntry(p),false);
  }
});
test('unsupported entry variants are blocked before any supplier CFOP fallback',()=>{
  for(const mutate of [(p:any)=>p.infNFe.emit.CRT=3,(p:any)=>p.infNFe.dest.enderDest.UF='SP',(p:any)=>p.infNFe.det[0].prod.CFOP='5202',(p:any)=>p.infNFe.det[0].imposto.ICMS.ICMSSN900.vICMS=1,(p:any)=>p.infNFe.det[0].prod.qCom=.5,(p:any)=>p.infNFe.total.ICMSTot.vNF=1,(p:any)=>p.infNFe.ide.NFref=[],(p:any)=>p.sales_return_entry.profile='unknown']){
    const p=fixture();mutate(p);assert.equal(validSalesReturnEntry(p),false);assert.equal(validateNfeEmissionPayload(p).ok,false);assert.equal(resolveReturnCfop(p,'PR',[]).shouldBlock,true);
  }
});
test('ordinary entries without opt-in preserve the existing validation and CFOP path',()=>{
  for(const tpNF of [0,1])for(const finNFe of [1,4]){
    const p:any={infNFe:{ide:{mod:55,tpImp:1,tpNF,finNFe,NFref:finNFe===4?[{refNFe:fixture().sales_return_entry.sourceKey}]:undefined},
      det:[{nItem:1,prod:{CFOP:finNFe===4?'5202':'5102'}}]}};
    assert.equal(requestsSalesReturnEntry(p),false);
    assert.equal(validateNfeEmissionPayload(p).ok,true);
    const r=resolveReturnCfop(p,'PR',[]);
    assert.equal(r.isReturn,finNFe===4);
    assert.ok(r.items.every(i=>i.profile!=='consumer_sales_return_entry_v1'));
  }
});
test('each explicit entry marker blocks malformed requests including a forged output type',()=>{
  const markers=[{operacao:'sales_return_entry'},{sales_return_entry:{}},
    {metadados:{operacao:'sales_return_entry'}},{metadados:{devolucao:{salesReturnEntryV1:true}}},
    {infNFe:{metadados:{operacao:'sales_return_entry'}}},
    {infNFe:{metadados:{devolucao:{salesReturnEntryV1:true}}}}];
  for(const marker of markers){
    const p:any={...marker,infNFe:{...marker.infNFe,ide:{mod:55,tpImp:1,tpNF:1,finNFe:1},det:[{prod:{CFOP:'5102'}}]}};
    assert.equal(requestsSalesReturnEntry(p),true);
    assert.ok(validateNfeEmissionPayload(p).issues.some(i=>i.code==='unsupported_sales_return_entry_profile'));
    assert.equal(resolveReturnCfop(p,'PR',[]).shouldBlock,true);
  }
});
