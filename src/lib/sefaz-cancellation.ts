import https from "node:https";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import tls from "node:tls";

import { DOMParser, XMLSerializer, type Element } from "@xmldom/xmldom";
import { SignedXml } from "xml-crypto";

import { decryptCertificateBundle, openEncryptedCertificate } from "./certificates.js";
import type { DocumentType, Environment } from "../types.js";

const XMLDSIG = "http://www.w3.org/2000/09/xmldsig#";
const C14N = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
const ENVELOPED = `${XMLDSIG}enveloped-signature`;
const SHA1 = `${XMLDSIG}sha1`;
const RSA_SHA1 = `${XMLDSIG}rsa-sha1`;
const CANCELLATION_EVENT = "110111";

const endpoints: Record<string, Record<DocumentType, Record<Environment, string>>> = {
  PR: {
    NFe: {
      homologacao: "https://homologacao.nfe.sefa.pr.gov.br/nfe/NFeRecepcaoEvento4",
      producao: "https://nfe.sefa.pr.gov.br/nfe/NFeRecepcaoEvento4"
    },
    NFCe: {
      homologacao: "https://homologacao.nfce.sefa.pr.gov.br/nfce/NFeRecepcaoEvento4",
      producao: "https://nfce.sefa.pr.gov.br/nfce/NFeRecepcaoEvento4"
    }
  }
};

const stateCodes: Record<string, string> = {
  PR: "41"
};

const soapAction =
  "http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento";

export type CancellationInput = {
  uf: string;
  ambiente: Environment;
  documentType: DocumentType;
  cnpj: string;
  accessKey: string;
  authorizationProtocol: string;
  justification: string;
  encryptedCertificateBundle: string;
  encryptionSecret: string;
};

export type SignedCancellationXml = {
  eventId: string;
  batchId: string;
  requestXml: string;
  signedEventXml: string;
  batchXml: string;
};

export type SefazCancellationResult = SignedCancellationXml & {
  ambiente: Environment;
  uf: string;
  endpoint: string;
  httpStatus: number;
  batchStatusCode: string;
  batchReason: string;
  statusCode: string;
  reason: string;
  protocol: string;
  receivedAt: string;
  applicationVersion: string;
  responseXml: string;
  processedEventXml: string;
};

function escapeXml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function stripXmlDeclaration(xml: string) {
  return xml.replace(/^\s*<\?xml[^>]*\?>\s*/i, "");
}

function certificateBody(certificatePem: string) {
  return certificatePem
    .replace(/-----BEGIN CERTIFICATE-----/g, "")
    .replace(/-----END CERTIFICATE-----/g, "")
    .replace(/\s+/g, "");
}

function directChildText(parent: Element | null, localName: string) {
  if (!parent) return "";
  for (let index = 0; index < parent.childNodes.length; index += 1) {
    const child = parent.childNodes.item(index);
    if (child?.nodeType === 1 && child.localName === localName) {
      return child.textContent?.trim() ?? "";
    }
  }
  return "";
}

function firstElementByLocalName(
  document: ReturnType<DOMParser["parseFromString"]>,
  localName: string
) {
  return document.getElementsByTagNameNS("*", localName).item(0) as Element | null;
}

function saoPauloDateTime(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}:${value("second")}-03:00`;
}

function newBatchId() {
  return `${Date.now()}${Math.floor(Math.random() * 100)}`.slice(-15);
}

export function buildCancellationEventId(accessKey: string, sequence = 1) {
  return `ID${CANCELLATION_EVENT}${accessKey.replace(/\D/g, "")}${String(sequence).padStart(2, "0")}`;
}

export function buildSignedCancellationXml(input: {
  uf: string;
  ambiente: Environment;
  cnpj: string;
  accessKey: string;
  authorizationProtocol: string;
  justification: string;
  privateKeyPem: string;
  certificatePem: string;
  eventDate?: Date;
  batchId?: string;
}): SignedCancellationXml {
  const uf = input.uf.toUpperCase();
  const stateCode = stateCodes[uf];
  if (!stateCode) {
    throw new Error(`Cancelamento ainda nao configurado para a UF ${uf || "(vazia)"}.`);
  }

  const cnpj = input.cnpj.replace(/\D/g, "");
  const accessKey = input.accessKey.replace(/\D/g, "");
  const authorizationProtocol = input.authorizationProtocol.replace(/\D/g, "");
  const justification = input.justification.trim();
  if (cnpj.length !== 14 || accessKey.length !== 44 || !authorizationProtocol) {
    throw new Error("CNPJ, chave de acesso ou protocolo de autorizacao invalidos.");
  }
  if (justification.length < 15 || justification.length > 255) {
    throw new Error("A justificativa deve ter entre 15 e 255 caracteres.");
  }

  const eventId = buildCancellationEventId(accessKey);
  const batchId = input.batchId ?? newBatchId();
  const tpAmb = input.ambiente === "producao" ? "1" : "2";
  const requestXml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<evento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">` +
    `<infEvento Id="${eventId}">` +
    `<cOrgao>${stateCode}</cOrgao>` +
    `<tpAmb>${tpAmb}</tpAmb>` +
    `<CNPJ>${cnpj}</CNPJ>` +
    `<chNFe>${accessKey}</chNFe>` +
    `<dhEvento>${saoPauloDateTime(input.eventDate)}</dhEvento>` +
    `<tpEvento>${CANCELLATION_EVENT}</tpEvento>` +
    `<nSeqEvento>1</nSeqEvento>` +
    `<verEvento>1.00</verEvento>` +
    `<detEvento versao="1.00">` +
    `<descEvento>Cancelamento</descEvento>` +
    `<nProt>${authorizationProtocol}</nProt>` +
    `<xJust>${escapeXml(justification)}</xJust>` +
    `</detEvento>` +
    `</infEvento></evento>`;

  const signer = new SignedXml({
    privateKey: input.privateKeyPem,
    publicCert: input.certificatePem,
    getKeyInfoContent: () =>
      `<X509Data><X509Certificate>${certificateBody(input.certificatePem)}</X509Certificate></X509Data>`
  });
  signer.addReference({
    xpath: "//*[local-name(.)='infEvento']",
    digestAlgorithm: SHA1,
    transforms: [ENVELOPED, C14N]
  });
  signer.canonicalizationAlgorithm = C14N;
  signer.signatureAlgorithm = RSA_SHA1;
  signer.computeSignature(requestXml, {
    location: {
      reference: "//*[local-name(.)='infEvento']",
      action: "after"
    }
  });
  const signedEventXml = signer.getSignedXml();
  const batchXml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">` +
    `<idLote>${batchId}</idLote>${stripXmlDeclaration(signedEventXml)}</envEvento>`;

  return {
    eventId,
    batchId,
    requestXml,
    signedEventXml,
    batchXml
  };
}

export function parseCancellationResponse(
  responseXml: string,
  context: Pick<
    SefazCancellationResult,
    "ambiente" | "uf" | "endpoint" | "httpStatus"
  >,
  signed: SignedCancellationXml
): SefazCancellationResult {
  const document = new DOMParser().parseFromString(responseXml, "application/xml");
  if (document.getElementsByTagName("parsererror").length) {
    throw new Error("A SEFAZ retornou um XML invalido.");
  }

  const batchResult = firstElementByLocalName(document, "retEnvEvento");
  const eventResult = firstElementByLocalName(document, "infEvento");
  const eventEnvelope = firstElementByLocalName(document, "retEvento");
  const fault =
    firstElementByLocalName(document, "Text") ??
    firstElementByLocalName(document, "faultstring");
  if (!batchResult || !eventResult || !eventEnvelope) {
    throw new Error(
      fault?.textContent?.trim()
        ? `A SEFAZ retornou uma falha SOAP: ${fault.textContent.trim()}`
        : "A resposta da SEFAZ nao contem o resultado do evento de cancelamento."
    );
  }

  const serializer = new XMLSerializer();
  const processedEventXml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<procEventoNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">` +
    `${stripXmlDeclaration(signed.signedEventXml)}` +
    `${serializer.serializeToString(eventEnvelope)}` +
    `</procEventoNFe>`;

  return {
    ...context,
    ...signed,
    batchStatusCode: directChildText(batchResult, "cStat"),
    batchReason: directChildText(batchResult, "xMotivo"),
    statusCode: directChildText(eventResult, "cStat"),
    reason: directChildText(eventResult, "xMotivo"),
    protocol: directChildText(eventResult, "nProt"),
    receivedAt: directChildText(eventResult, "dhRegEvento"),
    applicationVersion: directChildText(eventResult, "verAplic"),
    responseXml,
    processedEventXml
  };
}

export async function cancelDocumentAtSefaz(
  input: CancellationInput
): Promise<SefazCancellationResult> {
  const uf = input.uf.toUpperCase();
  const endpoint = endpoints[uf]?.[input.documentType]?.[input.ambiente];
  if (!endpoint) {
    throw new Error(
      `Cancelamento de ${input.documentType} ainda nao configurado para a UF ${uf || "(vazia)"}.`
    );
  }
  if (input.ambiente !== "homologacao") {
    throw new Error("Cancelamento em producao permanece bloqueado nesta etapa.");
  }

  const certificate = decryptCertificateBundle(
    input.encryptedCertificateBundle,
    input.encryptionSecret
  );
  const openedCertificate = openEncryptedCertificate(
    input.encryptedCertificateBundle,
    input.encryptionSecret
  );
  const signed = buildSignedCancellationXml({
    ...input,
    privateKeyPem: openedCertificate.privateKeyPem,
    certificatePem: openedCertificate.certificatePem
  });
  const soapEnvelope =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
    `<soap12:Body>` +
    `<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4">` +
    `${stripXmlDeclaration(signed.batchXml)}` +
    `</nfeDadosMsg>` +
    `</soap12:Body></soap12:Envelope>`;
  const rootCa = readFileSync(
    resolve(process.cwd(), "certificates", "icp-brasil-root-v10.pem"),
    "ascii"
  );

  return new Promise((resolvePromise, reject) => {
    const request = https.request(
      endpoint,
      {
        method: "POST",
        pfx: Buffer.from(certificate.pfxBase64, "base64"),
        passphrase: certificate.password,
        ca: [...tls.rootCertificates, rootCa],
        minVersion: "TLSv1.2",
        timeout: 30_000,
        headers: {
          "content-type": `application/soap+xml; charset=utf-8; action="${soapAction}"`,
          "content-length": Buffer.byteLength(soapEnvelope),
          accept: "application/soap+xml, text/xml"
        }
      },
      (response) => {
        let responseBody = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          responseBody += chunk;
        });
        response.on("end", () => {
          const httpStatus = response.statusCode ?? 0;
          if (httpStatus < 200 || httpStatus >= 300) {
            reject(new Error(`A SEFAZ respondeu HTTP ${httpStatus}.`));
            return;
          }
          if (!responseBody.trim()) {
            reject(new Error("O cancelamento da SEFAZ retornou corpo vazio."));
            return;
          }

          try {
            resolvePromise(
              parseCancellationResponse(
                responseBody,
                {
                  ambiente: input.ambiente,
                  uf,
                  endpoint,
                  httpStatus
                },
                signed
              )
            );
          } catch (error) {
            reject(error);
          }
        });
      }
    );

    request.on("timeout", () => {
      request.destroy(new Error("Tempo esgotado ao cancelar documento na SEFAZ."));
    });
    request.on("error", reject);
    request.end(soapEnvelope);
  });
}
