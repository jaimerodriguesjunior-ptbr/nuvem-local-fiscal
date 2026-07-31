import { gunzipSync } from "node:zlib";
import https from "node:https";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import tls from "node:tls";

import { DOMParser, XMLSerializer, type Element } from "@xmldom/xmldom";
import { SignedXml } from "xml-crypto";

import { decryptCertificateBundle, openEncryptedCertificate } from "./certificates.js";
import { config } from "../config.js";
import type { DistributionMode, Environment } from "../types.js";

const DISTRIBUTION_ENDPOINT = "https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx";
const DISTRIBUTION_ACTION = "http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse";
const EVENT_ACTION = "http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento";
const EVENT_ENDPOINTS: Record<string, Record<Environment, string>> = {
  PR: { homologacao: "https://homologacao.nfe.sefa.pr.gov.br/nfe/NFeRecepcaoEvento4", producao: "https://nfe.sefa.pr.gov.br/nfe/NFeRecepcaoEvento4" }
};
const XMLDSIG = "http://www.w3.org/2000/09/xmldsig#";
const C14N = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";

export type SefazDistributionDocument = { nsu: string; schema: string; xml: string };
export type SefazDistributionResult = {
  cStat: string; xMotivo: string; ultNsu: string; maxNsu: string;
  responseXml: string; requestXml: string; documents: SefazDistributionDocument[];
};

function escapeXml(value: unknown) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}
function text(node: Element, name: string) {
  return (node.getElementsByTagNameNS("*", name).item(0)?.textContent ?? "").trim();
}
function rootCa() {
  return readFileSync(resolve(process.cwd(), "certificates", "icp-brasil-root-v10.pem"), "ascii");
}
function requestSoap(endpoint: string, action: string, body: string, encryptedCertificateBundle: string, encryptionSecret: string, timeoutMessage: string) {
  const certificate = decryptCertificateBundle(encryptedCertificateBundle, encryptionSecret);
  return new Promise<{ statusCode: number; body: string }>((resolvePromise, reject) => {
    const request = https.request(endpoint, {
      method: "POST", pfx: Buffer.from(certificate.pfxBase64, "base64"), passphrase: certificate.password,
      ca: [...tls.rootCertificates, rootCa()], minVersion: "TLSv1.2", timeout: 30_000,
      headers: { "content-type": `application/soap+xml; charset=utf-8; action="${action}"`, "content-length": Buffer.byteLength(body), accept: "application/soap+xml, text/xml" }
    }, (response) => {
      let responseBody = ""; response.setEncoding("utf8");
      response.on("data", (chunk) => { responseBody += chunk; });
      response.on("end", () => {
        const statusCode = response.statusCode ?? 0;
        if (statusCode < 200 || statusCode >= 300) {
          const detail = responseBody.replace(/\s+/g, " ").trim().slice(0, 500);
          return reject(new Error(`A SEFAZ respondeu HTTP ${statusCode}.${detail ? ` Retorno: ${detail}` : ""}`));
        }
        if (!responseBody.trim()) return reject(new Error("A SEFAZ retornou corpo vazio."));
        resolvePromise({ statusCode, body: responseBody });
      });
    });
    request.on("timeout", () => request.destroy(new Error(timeoutMessage)));
    request.on("error", reject); request.end(body);
  });
}

export function buildDistributionRequest(input: { cnpj: string; ambiente: Environment; modo: DistributionMode; nsu?: string | null; chave?: string | null }) {
  const cnpj = input.cnpj.replace(/\D/g, "");
  if (cnpj.length !== 14) throw new Error("Informe um CNPJ valido para a distribuicao.");
  const tpAmb = input.ambiente === "producao" ? "1" : "2";
  const query = input.modo === "dist-nsu"
    ? `<distNSU><ultNSU>${escapeXml(String(input.nsu ?? "0").padStart(15, "0"))}</ultNSU></distNSU>`
    : input.modo === "cons-nsu"
      ? `<consNSU><NSU>${escapeXml(String(input.nsu ?? "").padStart(15, "0"))}</NSU></consNSU>`
      : `<consChNFe><chNFe>${escapeXml(String(input.chave ?? "").replace(/\D/g, ""))}</chNFe></consChNFe>`;
  if ((input.modo === "cons-nsu" && !input.nsu) || (input.modo === "cons-chave" && String(input.chave ?? "").replace(/\D/g, "").length !== 44)) throw new Error("Informe NSU ou chave de acesso valida para a consulta.");
  const requestXml = `<distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><tpAmb>${tpAmb}</tpAmb><cUFAutor>91</cUFAutor><CNPJ>${cnpj}</CNPJ>${query}</distDFeInt>`;
  const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body><nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe"><nfeDadosMsg>${requestXml}</nfeDadosMsg></nfeDistDFeInteresse></soap12:Body></soap12:Envelope>`;
  return { requestXml, soapEnvelope };
}

export function parseDistributionResponse(responseXml: string, requestXml = ""): SefazDistributionResult {
  const document = new DOMParser().parseFromString(responseXml, "application/xml");
  const result = document.getElementsByTagNameNS("*", "retDistDFeInt").item(0);
  if (!result) throw new Error("A resposta da SEFAZ nao contem retDistDFeInt.");
  const documents: SefazDistributionDocument[] = [];
  for (let index = 0; index < result.getElementsByTagNameNS("*", "docZip").length; index += 1) {
    const zip = result.getElementsByTagNameNS("*", "docZip").item(index) as Element;
    try { documents.push({ nsu: zip.getAttribute("NSU") || "", schema: zip.getAttribute("schema") || "", xml: gunzipSync(Buffer.from(zip.textContent?.trim() || "", "base64")).toString("utf8") }); }
    catch { throw new Error("A SEFAZ retornou um docZip invalido."); }
  }
  return { cStat: text(result, "cStat"), xMotivo: text(result, "xMotivo"), ultNsu: text(result, "ultNSU"), maxNsu: text(result, "maxNSU"), responseXml, requestXml, documents };
}

export async function distributeNfeAtSefaz(input: { cnpj: string; ambiente: Environment; modo: DistributionMode; nsu?: string | null; chave?: string | null; encryptedCertificateBundle: string; encryptionSecret: string }) {
  if (input.ambiente === "producao" && !config.fiscalProductionEnabled) throw new Error("Distribuicao em producao permanece bloqueada nesta etapa.");
  const built = buildDistributionRequest(input);
  const response = await requestSoap(DISTRIBUTION_ENDPOINT, DISTRIBUTION_ACTION, built.soapEnvelope, input.encryptedCertificateBundle, input.encryptionSecret, "Tempo esgotado ao distribuir documentos na SEFAZ.");
  return parseDistributionResponse(response.body, built.requestXml);
}

export function buildManifestationXml(input: { cnpj: string; ambiente: Environment; chave: string; tipoEvento: string; justificativa?: string | null; privateKeyPem: string; certificatePem: string; sequence?: number }) {
  const cnpj = input.cnpj.replace(/\D/g, ""); const chave = input.chave.replace(/\D/g, "");
  if (cnpj.length !== 14 || chave.length !== 44) throw new Error("CNPJ ou chave de acesso invalidos para manifestacao.");
  const descriptions: Record<string, string> = { "210210": "Ciencia da Operacao", "210200": "Confirmacao da Operacao", "210220": "Desconhecimento da Operacao", "210240": "Operacao nao Realizada" };
  const description = descriptions[input.tipoEvento]; if (!description) throw new Error("Tipo de manifestacao nao suportado.");
  const sequence = input.sequence ?? 1; const eventId = `ID${input.tipoEvento}${chave}${String(sequence).padStart(2, "0")}`;
  const date = new Date().toISOString().replace("Z", "-03:00");
  const details = input.tipoEvento === "210240" ? `<xJust>${escapeXml(input.justificativa ?? "")}</xJust>` : "";
  if (input.tipoEvento === "210240" && String(input.justificativa ?? "").trim().length < 15) throw new Error("A justificativa de operacao nao realizada deve ter ao menos 15 caracteres.");
  const requestXml = `<evento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><infEvento Id="${eventId}"><cOrgao>91</cOrgao><tpAmb>${input.ambiente === "producao" ? "1" : "2"}</tpAmb><CNPJ>${cnpj}</CNPJ><chNFe>${chave}</chNFe><dhEvento>${date}</dhEvento><tpEvento>${input.tipoEvento}</tpEvento><nSeqEvento>${sequence}</nSeqEvento><verEvento>1.00</verEvento><detEvento versao="1.00"><descEvento>${description}</descEvento>${details}</detEvento></infEvento></evento>`;
  const certificateBody = input.certificatePem.replace(/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\s+/g, "");
  const signer = new SignedXml({ privateKey: input.privateKeyPem, publicCert: input.certificatePem, getKeyInfoContent: () => `<X509Data><X509Certificate>${certificateBody}</X509Certificate></X509Data>` });
  signer.addReference({ xpath: "//*[local-name(.)='infEvento']", digestAlgorithm: `${XMLDSIG}sha1`, transforms: [`${XMLDSIG}enveloped-signature`, C14N] }); signer.canonicalizationAlgorithm = C14N; signer.signatureAlgorithm = `${XMLDSIG}rsa-sha1`;
  signer.computeSignature(requestXml, { location: { reference: "//*[local-name(.)='infEvento']", action: "after" } });
  const signedXml = signer.getSignedXml(); const batchXml = `<envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><idLote>${`${Date.now()}`.slice(-15)}</idLote>${signedXml}</envEvento>`;
  return { eventId, requestXml, signedXml, batchXml };
}

export async function manifestNfeAtSefaz(input: { uf: string; cnpj: string; ambiente: Environment; chave: string; tipoEvento: string; justificativa?: string | null; encryptedCertificateBundle: string; encryptionSecret: string }) {
  if (input.ambiente === "producao" && !config.fiscalProductionEnabled) throw new Error("Manifestacao em producao permanece bloqueada nesta etapa.");
  const endpoint = EVENT_ENDPOINTS[input.uf.toUpperCase()]?.[input.ambiente]; if (!endpoint) throw new Error(`Manifestacao ainda nao configurada para a UF ${input.uf}.`);
  const certificate = openEncryptedCertificate(input.encryptedCertificateBundle, input.encryptionSecret);
  const built = buildManifestationXml({ ...input, privateKeyPem: certificate.privateKeyPem, certificatePem: certificate.certificatePem });
  const envelope = `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body><nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4">${built.batchXml}</nfeDadosMsg></soap12:Body></soap12:Envelope>`;
  const response = await requestSoap(endpoint, EVENT_ACTION, envelope, input.encryptedCertificateBundle, input.encryptionSecret, "Tempo esgotado ao manifestar NF-e na SEFAZ.");
  const parsed = new DOMParser().parseFromString(response.body, "application/xml"); const info = parsed.getElementsByTagNameNS("*", "infEvento").item(0);
  if (!info) throw new Error("A resposta da SEFAZ nao contem infEvento.");
  const event = parsed.getElementsByTagNameNS("*", "retEvento").item(0);
  const processedXml = event ? `<?xml version="1.0" encoding="UTF-8"?><procEventoNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">${built.signedXml}${new XMLSerializer().serializeToString(event)}</procEventoNFe>` : null;
  return { ...built, responseXml: response.body, codigoStatus: text(info, "cStat"), motivoStatus: text(info, "xMotivo"), protocolo: text(info, "nProt"), processedXml };
}
