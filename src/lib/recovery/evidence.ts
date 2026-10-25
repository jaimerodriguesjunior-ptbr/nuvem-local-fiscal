import { createHash } from "node:crypto";
import { DOMParser, XMLSerializer, type Document, type Element } from "@xmldom/xmldom";
import type { RecoveryDecision, RecoveryDocument } from "./model.js";

const NFE = "http://www.portalfiscal.inf.br/nfe";
const DS = "http://www.w3.org/2000/09/xmldsig#";

function parse(xml: string) {
  if (!xml || xml.length > 4_000_000 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("unsafe_xml");
  return new DOMParser({ onError: () => { throw new Error("invalid_xml"); } })
    .parseFromString(xml, "application/xml");
}

function one(parent: Document | Element, namespace: string, name: string): Element {
  const nodes = parent.getElementsByTagNameNS(namespace, name);
  if (nodes.length !== 1) throw new Error(`ambiguous_${name}`);
  return nodes.item(0)!;
}

function text(parent: Element, namespace: string, name: string): string {
  const nodes: Element[] = [];
  for (let child = parent.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 1 && (child as Element).namespaceURI === namespace && (child as Element).localName === name) {
      nodes.push(child as Element);
    }
  }
  const node = nodes[0];
  if (nodes.length !== 1 || node.childNodes.length !== 1 || node.firstChild?.nodeType !== 3) {
    throw new Error(`invalid_${name}`);
  }
  return node.textContent?.trim() ?? "";
}

export function validateRecoveryDocument(document: RecoveryDocument): void {
  if (document.environment !== "producao" || !/^\d{14}$/.test(document.cnpj) ||
      !/^\d{44}$/.test(document.accessKey) || !Number.isSafeInteger(document.number) || document.number < 1 ||
      !Number.isSafeInteger(document.series) || document.series < 1 || document.series > 999 ||
      !Number.isSafeInteger(document.storeId) || document.storeId < 1 ||
      !document.clientId || !document.organizationId || !document.documentId) throw new Error("invalid_identity");
  const key = document.accessKey;
  const model = document.model === "NFe" ? "55" : document.model === "NFCe" ? "65" : "";
  let sum = 0;
  for (let i = 42, weight = 2; i >= 0; i--, weight = weight === 9 ? 2 : weight + 1) sum += Number(key[i]) * weight;
  const remainder = sum % 11;
  if (Number(key[43]) !== (remainder < 2 ? 0 : 11 - remainder) || key.slice(6, 20) !== document.cnpj ||
      key.slice(20, 22) !== model || Number(key.slice(22, 25)) !== document.series ||
      Number(key.slice(25, 34)) !== document.number) throw new Error("access_key_identity_mismatch");
  if (createHash("sha256").update(document.signedXml).digest("hex") !== document.signedXmlSha256) {
    throw new Error("signed_xml_changed");
  }
  const xml = parse(document.signedXml);
  const root = xml.documentElement;
  if (!root || root.namespaceURI !== NFE || root.localName !== "NFe") throw new Error("invalid_signed_root");
  const info = one(xml, NFE, "infNFe");
  if (info.parentNode !== root || info.getAttribute("Id") !== `NFe${key}`) throw new Error("signed_key_mismatch");
  const ide = one(info, NFE, "ide");
  const emit = one(info, NFE, "emit");
  if (text(ide, NFE, "tpAmb") !== "1" || text(ide, NFE, "mod") !== model ||
      Number(text(ide, NFE, "serie")) !== document.series ||
      Number(text(ide, NFE, "nNF")) !== document.number || text(emit, NFE, "CNPJ") !== document.cnpj) {
    throw new Error("signed_identity_mismatch");
  }
  const signature = one(xml, DS, "Signature");
  if (signature.parentNode !== root) throw new Error("invalid_signature_location");
  const reference = one(signature, DS, "Reference");
  if (reference.getAttribute("URI") !== `#NFe${key}`) throw new Error("signature_reference_mismatch");
  // Enrollment must separately validate signature/XSD against the saved certificate.
  // Here we pin exactly those persisted bytes, never regenerate/re-sign them.
  text(reference, DS, "DigestValue");
}

/** Only the authenticated consultation's matching infProt can prove authorization.
 * 217, 204, 539 and arbitrary SOAP/status errors never become a rejection here.
 */
export function reconcileConsultation(document: RecoveryDocument, responseXml: string): RecoveryDecision {
  try {
    validateRecoveryDocument(document);
    const response = parse(responseXml);
    const result = one(response, NFE, "retConsSitNFe");
    if (text(result, NFE, "tpAmb") !== "1" || text(result, NFE, "chNFe") !== document.accessKey) {
      throw new Error("consultation_identity_mismatch");
    }
    const code = text(result, NFE, "cStat");
    const protocols = result.getElementsByTagNameNS(NFE, "protNFe");
    if (protocols.length === 0) {
      return { state: "pending", origin: "sefaz", code };
    }
    const protocolNode = one(result, NFE, "protNFe");
    if (protocolNode.parentNode !== result) throw new Error("invalid_protocol_location");
    const info = one(protocolNode, NFE, "infProt");
    if (info.parentNode !== protocolNode || text(info, NFE, "tpAmb") !== "1" ||
        text(info, NFE, "chNFe") !== document.accessKey) throw new Error("protocol_identity_mismatch");
    const protocolCode = text(info, NFE, "cStat");
    if (!["100", "150"].includes(protocolCode)) return { state: "pending", origin: "sefaz", code: protocolCode };
    if (!["100", "150"].includes(code)) throw new Error("inconsistent_consultation_status");
    const protocol = text(info, NFE, "nProt");
    if (!/^\d{15}$/.test(protocol)) throw new Error("invalid_protocol");
    const signed = parse(document.signedXml);
    const digest = text(one(signed, DS, "Reference"), DS, "DigestValue");
    if (text(info, NFE, "digVal") !== digest || !digest) throw new Error("protocol_digest_mismatch");
    const serializer = new XMLSerializer();
    return { state: "authorized", origin: "sefaz", code: protocolCode as "100" | "150", protocol,
      processedXml: `<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="${NFE}" versao="4.00">${serializer.serializeToString(signed.documentElement!)}${serializer.serializeToString(protocolNode)}</nfeProc>`,
      evidenceXml: responseXml };
  } catch {
    // Persist a bounded internal code, not XML/payload/secret-bearing exceptions.
    return { state: "manual_review", origin: "local", code: "RECOVERY_EVIDENCE_INVALID" };
  }
}

/** Initial synchronous submission only. A receipt/batch error is not a keyed
 * rejection. Reuse the same protocol/digest verifier used for consultation;
 * retain the actual authorization response as evidence, never the adapter's
 * preassembled nfeProc.
 */
export function reconcileInitialAuthorization(document: RecoveryDocument, responseXml: string):
  RecoveryDecision | { state: "rejected"; origin: "sefaz"; code: string; evidenceXml: string } {
  try {
    validateRecoveryDocument(document);
    const response = parse(responseXml);
    const batch = one(response, NFE, "retEnviNFe");
    if (text(batch,NFE,"tpAmb")!=="1") throw new Error("wrong_environment");
    const batchCode=text(batch,NFE,'cStat');
    if(batchCode!=='104') return {state:'pending',origin:'sefaz',code:batchCode};
    const protocols = batch.getElementsByTagNameNS(NFE,"protNFe");
    if (protocols.length===0) return {state:"pending",origin:"sefaz",code:text(batch,NFE,"cStat")};
    const protocol = one(batch,NFE,"protNFe");
    const info = one(protocol,NFE,"infProt");
    if (protocol.parentNode!==batch || info.parentNode!==protocol || text(info,NFE,"tpAmb")!=="1" ||
        text(info,NFE,"chNFe")!==document.accessKey) throw new Error("wrong_protocol_identity");
    const code = text(info,NFE,"cStat");
    if (["100","150"].includes(code)) {
      const serializer = new XMLSerializer();
      const verified = reconcileConsultation(document,
        `<retConsSitNFe xmlns="${NFE}"><tpAmb>1</tpAmb><cStat>${code}</cStat><chNFe>${document.accessKey}</chNFe>${serializer.serializeToString(protocol)}</retConsSitNFe>`);
      return verified.state==="authorized" ? {...verified,evidenceXml:responseXml} : verified;
    }
    if (/^[2-9]\d\d$/.test(code) && !["204","217","301","302","303","539","656","999"].includes(code)) {
      return {state:"rejected",origin:"sefaz",code,evidenceXml:responseXml};
    }
    return {state:"pending",origin:"sefaz",code};
  } catch {
    return {state:"manual_review",origin:"local",code:"RECOVERY_EVIDENCE_INVALID"};
  }
}
