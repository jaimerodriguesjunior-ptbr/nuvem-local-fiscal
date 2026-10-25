import {readFileSync} from 'node:fs';
import {X509Certificate} from 'node:crypto';

/** Keep verification enabled. An optional explicitly trusted CA is scoped to
 * these database clients; do not modify global/system trust or TLS defaults. */
export function recoveryDatabaseTls(caFile:string|undefined=process.env.RECOVERY_V1_DATABASE_CA_FILE):
  {rejectUnauthorized:true;ca?:string} {
  if(caFile===undefined)return {rejectUnauthorized:true};
  try{
    if(!caFile.trim())throw Error();
    const ca=readFileSync(caFile,'utf8');
    if(ca.length>64_000||(ca.match(/-----BEGIN CERTIFICATE-----/g)??[]).length!==1)throw Error();
    const certificate=new X509Certificate(ca),now=Date.now();
    if(!certificate.ca||Date.parse(certificate.validFrom)>now||Date.parse(certificate.validTo)<=now)throw Error();
    return {rejectUnauthorized:true,ca};
  }catch{throw Error('RECOVERY_DATABASE_CA_INVALID');}
}
