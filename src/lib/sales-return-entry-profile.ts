type Json = Record<string, any>;
const object=(v:unknown):Json=>v&&typeof v==='object'&&!Array.isArray(v)?v as Json:{};
const text=(v:unknown)=>String(v??'');
const zero=(v:unknown)=>v==null||(Number.isFinite(Number(v))&&Number(v)===0);
export const SALES_RETURN_ENTRY_PROFILE='consumer_sales_return_entry_v1';

/** Explicit opt-in only. tpNF=0 alone belongs to the existing consumer contract. */
export function requestsSalesReturnEntry(payload:Json):boolean {
  const metadata=object(payload.metadados),nested=object(object(payload.infNFe).metadados);
  return payload.operacao==='sales_return_entry'||payload.sales_return_entry!=null||
    [metadata,nested].some(m=>m.operacao==='sales_return_entry'||object(m.devolucao).salesReturnEntryV1===true);
}

/** Versioned inbound sales return. Never run the supplier-return CFOP fallback. */
export function validSalesReturnEntry(payload:Json):boolean {
  const n=object(payload.infNFe),ide=object(n.ide),emit=object(n.emit),dest=object(n.dest),metadata=object(payload.metadados),profile=object(payload.sales_return_entry);
  const refs=ide.NFref,key=text(profile.sourceKey);
  if(profile.profile!==SALES_RETURN_ENTRY_PROFILE||object(metadata.devolucao).salesReturnEntryV1!==true||
    metadata.operacao!=='sales_return_entry'||payload.operacao!=='sales_return_entry'||
    !Number.isSafeInteger(profile.sourceInvoiceId)||profile.sourceInvoiceId<1||!/^[a-f0-9]{32}$/.test(text(profile.sourceFingerprint))||
    !/^\d{44}$/.test(key)||key.slice(6,20)!==text(emit.CNPJ)||!['55','65'].includes(key.slice(20,22))||
    !['NFe','NFCe'].includes(profile.sourceModel)||(profile.sourceModel==='NFe'?'55':'65')!==key.slice(20,22)||
    !Array.isArray(refs)||refs.length!==1||refs[0]?.refNFe!==key||
    Number(ide.mod)!==55||Number(ide.tpNF)!==0||Number(ide.finNFe)!==4||Number(ide.idDest)!==1||ide.natOp!=='DEVOLUCAO DE VENDA'||
    !/^\d{14}$/.test(text(emit.CNPJ))||Number(emit.CRT)!==1||
    !/^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$/.test(text(object(emit.enderEmit).UF))||
    Number(dest.indIEDest)!==9||object(dest.enderDest).UF!==object(emit.enderEmit).UF||
    !Array.isArray(n.det)||!n.det.length||n.det.length>100||text(profile.reason).length<15||text(profile.reason).length>500)return false;
  let total=0;
  for(const d of n.det){
    const p=object(d?.prod),tax=object(d?.imposto),icms=object(tax.ICMS),sn=object(icms.ICMSSN900),q=Number(p.qCom),u=Number(p.vUnCom);
    if(p.CFOP!=='1202'||Number(sn.orig)!==0||text(sn.CSOSN)!=='900'||Object.keys(icms).length!==1||
      Object.entries(sn).some(([k,v])=>!['orig','CSOSN','modBC'].includes(k)&&!zero(v))||
      !Number.isSafeInteger(q)||q<1||!Number.isFinite(u)||u<=0||Math.abs(u*100-Math.round(u*100))>0.000001||
      Math.round(Number(p.vProd)*100)!==q*Math.round(u*100)||Number(p.qTrib)!==q||Number(p.vUnTrib)!==u||p.uCom!==p.uTrib||
      ['vFrete','vSeg','vDesc','vOutro'].some(k=>!zero(p[k]))||d.impostoDevol||
      Object.keys(tax).some(k=>!['ICMS','PIS','COFINS','vTotTrib'].includes(k)))return false;
    for(const [group,detail]of [['PIS','PISOutr'],['COFINS','COFINSOutr']]){
      const g=object(tax[group]),body=object(g[detail]);
      if(Object.keys(g).length!==1||text(body.CST)!=='99'||Object.entries(body).some(([k,v])=>k!=='CST'&&!zero(v)))return false;
    }
    total+=q*Math.round(u*100);
  }
  const totals=object(object(n.total).ICMSTot),payments=object(n.pag).detPag;
  if(!Number.isSafeInteger(total)||Math.round(Number(totals.vNF)*100)!==total||Math.round(Number(totals.vProd)*100)!==total||
    ['vBC','vICMS','vICMSDeson','vFCP','vBCST','vST','vFCPST','vFCPSTRet','vFrete','vSeg','vDesc','vII','vIPI','vIPIDevol','vPIS','vCOFINS','vOutro'].some(k=>!zero(totals[k]))||
    !Array.isArray(payments)||payments.length!==1||text(payments[0]?.tPag)!=='90'||Number(payments[0]?.vPag)!==0||Number(object(n.transp).modFrete)!==9)return false;
  return true;
}
