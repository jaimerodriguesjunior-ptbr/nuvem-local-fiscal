import { createHash } from "node:crypto";
import type { RecoveryDocument, RecoveryIdentity } from "./model.js";

export const fixtureScope: RecoveryIdentity = {
  clientId: "test-client", organizationId: "11111111-1111-1111-1111-111111111111", storeId: 1,
  cnpj: "12345678000195", environment: "producao", model: "NFCe", series: 2
};
const first43 = "41" + "2610" + fixtureScope.cnpj + "65" + "002" + "000000123" + "1" + "01234567";
let sum = 0;
for (let i = 42, weight = 2; i >= 0; i--, weight = weight === 9 ? 2 : weight + 1) sum += Number(first43[i]) * weight;
const remainder = sum % 11;
export const fixtureKey = first43 + (remainder < 2 ? 0 : 11 - remainder);
// Synthetic XML, never transmitted; signature validation is an admission concern.
export const fixtureSignedXml = `<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe${fixtureKey}"><ide><tpAmb>1</tpAmb><mod>65</mod><serie>2</serie><nNF>123</nNF></ide><emit><CNPJ>${fixtureScope.cnpj}</CNPJ></emit></infNFe><Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo><Reference URI="#NFe${fixtureKey}"><DigestValue>dGVzdA==</DigestValue></Reference></SignedInfo></Signature></NFe>`;
export const fixtureDocument: RecoveryDocument = {
  ...fixtureScope, documentId: "test-doc", number: 123, accessKey: fixtureKey, signedXml: fixtureSignedXml,
  signedXmlSha256: createHash("sha256").update(fixtureSignedXml).digest("hex")
};

export function fixtureResponse(code = "100", digest: string | null = "dGVzdA==", key = fixtureKey): string {
  return `<retConsSitNFe xmlns="http://www.portalfiscal.inf.br/nfe"><tpAmb>1</tpAmb><cStat>${code}</cStat><chNFe>${key}</chNFe>${["100","150"].includes(code)
    ? `<protNFe><infProt><tpAmb>1</tpAmb><chNFe>${key}</chNFe><cStat>${code}</cStat><nProt>141260000000001</nProt>${digest === null ? "" : `<digVal>${digest}</digVal>`}</infProt></protNFe>` : ""}</retConsSitNFe>`;
}
