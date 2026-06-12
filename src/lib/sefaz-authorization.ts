import https from "node:https";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import tls from "node:tls";

import {
  DOMParser,
  XMLSerializer,
  type Document,
  type Element
} from "@xmldom/xmldom";
import { parseXml } from "libxmljs2";

import { decryptCertificateBundle } from "./certificates.js";
import type { DocumentType, Environment } from "../types.js";

const endpoints: Record<
  string,
  Record<DocumentType, Record<Environment, string>>
> = {
  PR: {
    NFe: {
      homologacao: "https://homologacao.nfe.sefa.pr.gov.br/nfe/NFeAutorizacao4",
      producao: "https://nfe.sefa.pr.gov.br/nfe/NFeAutorizacao4"
    },
    NFCe: {
      homologacao: "https://homologacao.nfce.sefa.pr.gov.br/nfce/NFeAutorizacao4",
      producao: "https://nfce.sefa.pr.gov.br/nfce/NFeAutorizacao4"
    }
  }
};

const soapAction =
  "http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4/nfeAutorizacaoLote";
const consultationSoapAction =
  "http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4/nfeConsultaNF";

export type AuthorizationBatch = {
  idLote: string;
  batchXml: string;
  soapEnvelope: string;
};

export type AuthorizationValidation = {
  valid: boolean;
  errors: string[];
  schema: "PL_010c/TEnviNFe";
};

export type SefazAuthorizationResult = {
  ambiente: Environment;
  uf: string;
  endpoint: string;
  httpStatus: number;
  idLote: string;
  batchCStat: string;
  batchReason: string;
  receipt: string;
  protocolCStat: string;
  protocolReason: string;
  protocol: string;
  accessKey: string;
  receivedAt: string;
  applicationVersion: string;
  responseXml: string;
  processedXml: string;
};

export type SefazDocumentStatusResult = {
  ambiente: Environment;
  uf: string;
  documentType: DocumentType;
  endpoint: string;
  httpStatus: number;
  cStat: string;
  xMotivo: string;
  accessKey: string;
  protocolCStat: string;
  protocolReason: string;
  protocol: string;
  responseXml: string;
  processedXml: string;
};

function stripXmlDeclaration(xml: string) {
  return xml.replace(/^\s*<\?xml[^>]*\?>\s*/i, "");
}

function newBatchId() {
  return `${Date.now()}${Math.floor(Math.random() * 100)}`.slice(-15);
}

export function buildAuthorizationBatch(
  signedXml: string,
  idLote = newBatchId()
): AuthorizationBatch {
  const nfeXml = stripXmlDeclaration(signedXml);
  const batchXml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<enviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">` +
    `<idLote>${idLote}</idLote><indSinc>1</indSinc>${nfeXml}</enviNFe>`;
  const soapEnvelope =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
    `<soap12:Body>` +
    `<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4">` +
    `${stripXmlDeclaration(batchXml)}</nfeDadosMsg>` +
    `</soap12:Body>` +
    `</soap12:Envelope>`;

  return { idLote, batchXml, soapEnvelope };
}

export function validateAuthorizationBatchXml(
  batchXml: string
): AuthorizationValidation {
  const schemaDirectory = resolve(
    process.cwd(),
    "schemas",
    "nfe",
    "official-010c",
    "PL_010c_NT2022_002v1.30"
  );
  const wrapperSchema = `<?xml version="1.0" encoding="UTF-8"?>
    <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
      xmlns="http://www.portalfiscal.inf.br/nfe"
      targetNamespace="http://www.portalfiscal.inf.br/nfe"
      elementFormDefault="qualified">
      <xs:include schemaLocation="leiauteNFe_v4.00.xsd"/>
      <xs:element name="enviNFe" type="TEnviNFe"/>
    </xs:schema>`;

  try {
    const schema = parseXml(wrapperSchema, {
      baseUrl: resolve(schemaDirectory, "enviNFe_v4.00.xsd")
    });
    const document = parseXml(batchXml, { nonet: true });
    const valid = document.validate(schema);
    return {
      valid,
      errors: document.validationErrors.map((error) => {
        const line = error.line ? `linha ${error.line}: ` : "";
        return `${line}${error.message.trim()}`;
      }),
      schema: "PL_010c/TEnviNFe"
    };
  } catch (error) {
    return {
      valid: false,
      errors: [
        error instanceof Error
          ? `Falha ao validar lote: ${error.message}`
          : `Falha ao validar lote: ${String(error)}`
      ],
      schema: "PL_010c/TEnviNFe"
    };
  }
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

function firstElementByLocalName(document: Document, localName: string) {
  return document.getElementsByTagNameNS("*", localName).item(0) as Element | null;
}

export function getSefazEndpoint(input: {
  uf: string;
  documentType: DocumentType;
  ambiente: Environment;
  service: "authorization" | "consultation";
}) {
  const authorizationEndpoint =
    endpoints[input.uf.toUpperCase()]?.[input.documentType]?.[input.ambiente];
  if (!authorizationEndpoint) {
    return null;
  }
  return input.service === "authorization"
    ? authorizationEndpoint
    : authorizationEndpoint.replace("NFeAutorizacao4", "NFeConsultaProtocolo4");
}

export function parseAuthorizationResponse(
  responseXml: string,
  context: Pick<
    SefazAuthorizationResult,
    "ambiente" | "uf" | "endpoint" | "httpStatus" | "idLote"
  >,
  signedXml: string
): SefazAuthorizationResult {
  const document = new DOMParser().parseFromString(responseXml, "application/xml");
  if (document.getElementsByTagName("parsererror").length) {
    throw new Error("A SEFAZ retornou um XML invalido.");
  }

  const result = firstElementByLocalName(document, "retEnviNFe");
  const fault =
    firstElementByLocalName(document, "Text") ??
    firstElementByLocalName(document, "faultstring");
  if (!result) {
    throw new Error(
      fault?.textContent?.trim()
        ? `A SEFAZ retornou uma falha SOAP: ${fault.textContent.trim()}`
        : "A resposta da SEFAZ nao contem retEnviNFe."
    );
  }

  const protocolNode = firstElementByLocalName(document, "protNFe");
  const protocolInfo = protocolNode
    ? (protocolNode.getElementsByTagNameNS("*", "infProt").item(0) as Element | null)
    : null;
  const receiptInfo = result.getElementsByTagNameNS("*", "infRec").item(0) as Element | null;
  const protocolCStat = directChildText(protocolInfo, "cStat");
  const protocol = directChildText(protocolInfo, "nProt");
  const serializer = new XMLSerializer();
  const processedXml =
    protocolNode && ["100", "150"].includes(protocolCStat)
      ? `<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">${stripXmlDeclaration(signedXml)}${serializer.serializeToString(protocolNode)}</nfeProc>`
      : "";

  return {
    ...context,
    batchCStat: directChildText(result, "cStat"),
    batchReason: directChildText(result, "xMotivo"),
    receipt: directChildText(receiptInfo, "nRec"),
    protocolCStat,
    protocolReason: directChildText(protocolInfo, "xMotivo"),
    protocol,
    accessKey: directChildText(protocolInfo, "chNFe"),
    receivedAt: directChildText(result, "dhRecbto"),
    applicationVersion: directChildText(result, "verAplic"),
    responseXml,
    processedXml
  };
}

export async function authorizeNfeAtSefaz(input: {
  uf: string;
  ambiente: Environment;
  documentType: DocumentType;
  signedXml: string;
  encryptedCertificateBundle: string;
  encryptionSecret: string;
}): Promise<SefazAuthorizationResult> {
  const uf = input.uf.toUpperCase();
  const endpoint = getSefazEndpoint({
    uf,
    documentType: input.documentType,
    ambiente: input.ambiente,
    service: "authorization"
  });
  if (!endpoint) {
    throw new Error(
      `Autorizacao de ${input.documentType} ainda nao configurada para a UF ${uf || "(vazia)"}.`
    );
  }
  if (input.ambiente !== "homologacao") {
    throw new Error("Transmissao em producao permanece bloqueada nesta etapa.");
  }

  const batch = buildAuthorizationBatch(input.signedXml);
  const validation = validateAuthorizationBatchXml(batch.batchXml);
  if (!validation.valid) {
    throw new Error(`Lote reprovado no XSD: ${validation.errors.join(" | ")}`);
  }

  const certificate = decryptCertificateBundle(
    input.encryptedCertificateBundle,
    input.encryptionSecret
  );
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
          "content-length": Buffer.byteLength(batch.soapEnvelope),
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
            reject(
              new Error(
                `A SEFAZ respondeu HTTP ${httpStatus}, mas o corpo da resposta veio vazio.`
              )
            );
            return;
          }

          try {
            resolvePromise(
              parseAuthorizationResponse(
                responseBody,
                {
                  ambiente: input.ambiente,
                  uf,
                  endpoint,
                  httpStatus,
                  idLote: batch.idLote
                },
                input.signedXml
              )
            );
          } catch (error) {
            reject(error);
          }
        });
      }
    );

    request.on("timeout", () => {
      request.destroy(new Error("Tempo esgotado ao transmitir para a SEFAZ."));
    });
    request.on("error", reject);
    request.end(batch.soapEnvelope);
  });
}

export async function querySefazDocumentStatus(input: {
  uf: string;
  ambiente: Environment;
  documentType: DocumentType;
  accessKey: string;
  encryptedCertificateBundle: string;
  encryptionSecret: string;
  signedXml?: string;
}): Promise<SefazDocumentStatusResult> {
  const uf = input.uf.toUpperCase();
  const endpoint = getSefazEndpoint({
    uf,
    documentType: input.documentType,
    ambiente: input.ambiente,
    service: "consultation"
  });
  if (!endpoint) {
    throw new Error(
      `Consulta de ${input.documentType} ainda nao configurada para a UF ${uf || "(vazia)"}.`
    );
  }

  const certificate = decryptCertificateBundle(
    input.encryptedCertificateBundle,
    input.encryptionSecret
  );
  const rootCa = readFileSync(
    resolve(process.cwd(), "certificates", "icp-brasil-root-v10.pem"),
    "ascii"
  );
  const tpAmb = input.ambiente === "producao" ? "1" : "2";
  const consultationXml =
    `<consSitNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">` +
    `<tpAmb>${tpAmb}</tpAmb><xServ>CONSULTAR</xServ>` +
    `<chNFe>${input.accessKey}</chNFe></consSitNFe>`;
  const soapEnvelope =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
    `<soap12:Body>` +
    `<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4">` +
    `${consultationXml}</nfeDadosMsg>` +
    `</soap12:Body></soap12:Envelope>`;

  return new Promise((resolvePromise, reject) => {
    const request = https.request(
      endpoint,
      {
        method: "POST",
        pfx: Buffer.from(certificate.pfxBase64, "base64"),
        passphrase: certificate.password,
        ca: [...tls.rootCertificates, rootCa],
        minVersion: "TLSv1.2",
        timeout: 20_000,
        headers: {
          "content-type": `application/soap+xml; charset=utf-8; action="${consultationSoapAction}"`,
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
            reject(new Error("A consulta da SEFAZ retornou corpo vazio."));
            return;
          }

          try {
            resolvePromise(
              parseDocumentStatusResponse(
                responseBody,
                {
                  ambiente: input.ambiente,
                  uf,
                  documentType: input.documentType,
                  endpoint,
                  httpStatus,
                  accessKey: input.accessKey
                },
                input.signedXml ?? ""
              )
            );
          } catch (error) {
            reject(error);
          }
        });
      }
    );

    request.on("timeout", () => {
      request.destroy(new Error("Tempo esgotado ao consultar a chave na SEFAZ."));
    });
    request.on("error", reject);
    request.end(soapEnvelope);
  });
}

export function parseDocumentStatusResponse(
  responseXml: string,
  context: Pick<
    SefazDocumentStatusResult,
    "ambiente" | "uf" | "documentType" | "endpoint" | "httpStatus" | "accessKey"
  >,
  signedXml: string
): SefazDocumentStatusResult {
  const document = new DOMParser().parseFromString(responseXml, "application/xml");
  const result = firstElementByLocalName(document, "retConsSitNFe");
  if (!result) {
    throw new Error("A resposta da consulta nao contem retConsSitNFe.");
  }
  const protocolNode = firstElementByLocalName(document, "protNFe");
  const protocolInfo = protocolNode
    ? (protocolNode.getElementsByTagNameNS("*", "infProt").item(0) as Element | null)
    : null;
  const protocolCStat = directChildText(protocolInfo, "cStat");
  const serializer = new XMLSerializer();
  const processedXml =
    signedXml &&
    protocolNode &&
    ["100", "150"].includes(protocolCStat)
      ? `<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">${stripXmlDeclaration(signedXml)}${serializer.serializeToString(protocolNode)}</nfeProc>`
      : "";

  return {
    ...context,
    cStat: directChildText(result, "cStat"),
    xMotivo: directChildText(result, "xMotivo"),
    accessKey: directChildText(result, "chNFe") || context.accessKey,
    protocolCStat,
    protocolReason: directChildText(protocolInfo, "xMotivo"),
    protocol: directChildText(protocolInfo, "nProt"),
    responseXml,
    processedXml
  };
}
