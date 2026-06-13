import https from "node:https";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import tls from "node:tls";

import { DOMParser, type Element } from "@xmldom/xmldom";
import { SignedXml } from "xml-crypto";

import { decryptCertificateBundle, openEncryptedCertificate } from "./certificates.js";
import type { DocumentType, Environment } from "../types.js";

type SefazDocumentType = Extract<DocumentType, "NFe" | "NFCe">;

const XMLDSIG = "http://www.w3.org/2000/09/xmldsig#";
const C14N = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
const ENVELOPED = `${XMLDSIG}enveloped-signature`;
const SHA1 = `${XMLDSIG}sha1`;
const RSA_SHA1 = `${XMLDSIG}rsa-sha1`;

const endpoints: Record<string, Record<SefazDocumentType, Record<Environment, string>>> = {
  PR: {
    NFe: {
      homologacao: "https://homologacao.nfe.sefa.pr.gov.br/nfe/NFeInutilizacao4",
      producao: "https://nfe.sefa.pr.gov.br/nfe/NFeInutilizacao4"
    },
    NFCe: {
      homologacao: "https://homologacao.nfce.sefa.pr.gov.br/nfce/NFeInutilizacao4",
      producao: "https://nfce.sefa.pr.gov.br/nfce/NFeInutilizacao4"
    }
  }
};

const stateCodes: Record<string, string> = {
  PR: "41"
};

const soapAction =
  "http://www.portalfiscal.inf.br/nfe/wsdl/NFeInutilizacao4/nfeInutilizacaoNF";

export type InutilizationInput = {
  uf: string;
  ambiente: Environment;
  documentType: SefazDocumentType;
  cnpj: string;
  ano: number;
  serie: number;
  numeroInicial: number;
  numeroFinal: number;
  justificativa: string;
  encryptedCertificateBundle: string;
  encryptionSecret: string;
};

export type SignedInutilizationXml = {
  requestXml: string;
  signedXml: string;
  id: string;
};

export type SefazInutilizationResult = SignedInutilizationXml & {
  ambiente: Environment;
  uf: string;
  endpoint: string;
  httpStatus: number;
  statusCode: string;
  reason: string;
  protocol: string;
  receivedAt: string;
  applicationVersion: string;
  responseXml: string;
};

function escapeXml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
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

function firstElementByLocalName(document: ReturnType<DOMParser["parseFromString"]>, localName: string) {
  return document.getElementsByTagNameNS("*", localName).item(0) as Element | null;
}

export function buildInutilizationId(input: {
  stateCode: string;
  ano: number;
  cnpj: string;
  model: string;
  serie: number;
  numeroInicial: number;
  numeroFinal: number;
}) {
  return [
    "ID",
    input.stateCode.padStart(2, "0"),
    String(input.ano).padStart(2, "0"),
    input.cnpj.replace(/\D/g, "").padStart(14, "0"),
    input.model,
    String(input.serie).padStart(3, "0"),
    String(input.numeroInicial).padStart(9, "0"),
    String(input.numeroFinal).padStart(9, "0")
  ].join("");
}

export function buildSignedInutilizationXml(input: {
  uf: string;
  ambiente: Environment;
  documentType: DocumentType;
  cnpj: string;
  ano: number;
  serie: number;
  numeroInicial: number;
  numeroFinal: number;
  justificativa: string;
  privateKeyPem: string;
  certificatePem: string;
}): SignedInutilizationXml {
  const uf = input.uf.toUpperCase();
  const stateCode = stateCodes[uf];
  if (!stateCode) {
    throw new Error(`Inutilizacao ainda nao configurada para a UF ${uf || "(vazia)"}.`);
  }

  const model = input.documentType === "NFCe" ? "65" : "55";
  const tpAmb = input.ambiente === "producao" ? "1" : "2";
  const id = buildInutilizationId({
    stateCode,
    ano: input.ano,
    cnpj: input.cnpj,
    model,
    serie: input.serie,
    numeroInicial: input.numeroInicial,
    numeroFinal: input.numeroFinal
  });
  const requestXml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<inutNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">` +
    `<infInut Id="${id}">` +
    `<tpAmb>${tpAmb}</tpAmb>` +
    `<xServ>INUTILIZAR</xServ>` +
    `<cUF>${stateCode}</cUF>` +
    `<ano>${String(input.ano).padStart(2, "0")}</ano>` +
    `<CNPJ>${escapeXml(input.cnpj.replace(/\D/g, ""))}</CNPJ>` +
    `<mod>${model}</mod>` +
    `<serie>${input.serie}</serie>` +
    `<nNFIni>${input.numeroInicial}</nNFIni>` +
    `<nNFFin>${input.numeroFinal}</nNFFin>` +
    `<xJust>${escapeXml(input.justificativa)}</xJust>` +
    `</infInut></inutNFe>`;

  const signer = new SignedXml({
    privateKey: input.privateKeyPem,
    publicCert: input.certificatePem,
    getKeyInfoContent: () =>
      `<X509Data><X509Certificate>${certificateBody(input.certificatePem)}</X509Certificate></X509Data>`
  });
  signer.addReference({
    xpath: "//*[local-name(.)='infInut']",
    digestAlgorithm: SHA1,
    transforms: [ENVELOPED, C14N]
  });
  signer.canonicalizationAlgorithm = C14N;
  signer.signatureAlgorithm = RSA_SHA1;
  signer.computeSignature(requestXml, {
    location: {
      reference: "//*[local-name(.)='infInut']",
      action: "after"
    }
  });

  return {
    requestXml,
    signedXml: signer.getSignedXml(),
    id
  };
}

export function parseInutilizationResponse(
  responseXml: string,
  context: Pick<SefazInutilizationResult, "ambiente" | "uf" | "endpoint" | "httpStatus">,
  signed: SignedInutilizationXml
): SefazInutilizationResult {
  const document = new DOMParser().parseFromString(responseXml, "application/xml");
  if (document.getElementsByTagName("parsererror").length) {
    throw new Error("A SEFAZ retornou um XML invalido.");
  }

  const result = firstElementByLocalName(document, "infInut");
  const fault =
    firstElementByLocalName(document, "Text") ??
    firstElementByLocalName(document, "faultstring");
  if (!result) {
    throw new Error(
      fault?.textContent?.trim()
        ? `A SEFAZ retornou uma falha SOAP: ${fault.textContent.trim()}`
        : "A resposta da SEFAZ nao contem infInut."
    );
  }

  return {
    ...context,
    ...signed,
    statusCode: directChildText(result, "cStat"),
    reason: directChildText(result, "xMotivo"),
    protocol: directChildText(result, "nProt"),
    receivedAt: directChildText(result, "dhRecbto"),
    applicationVersion: directChildText(result, "verAplic"),
    responseXml
  };
}

export async function inutilizeNumberRangeAtSefaz(
  input: InutilizationInput
): Promise<SefazInutilizationResult> {
  const uf = input.uf.toUpperCase();
  const endpoint = endpoints[uf]?.[input.documentType]?.[input.ambiente];
  if (!endpoint) {
    throw new Error(
      `Inutilizacao de ${input.documentType} ainda nao configurada para a UF ${uf || "(vazia)"}.`
    );
  }
  if (input.ambiente !== "homologacao") {
    throw new Error("Transmissao em producao permanece bloqueada nesta etapa.");
  }

  const certificate = decryptCertificateBundle(
    input.encryptedCertificateBundle,
    input.encryptionSecret
  );
  const openedCertificate = openEncryptedCertificate(
    input.encryptedCertificateBundle,
    input.encryptionSecret
  );
  const signed = buildSignedInutilizationXml({
    ...input,
    privateKeyPem: openedCertificate.privateKeyPem,
    certificatePem: openedCertificate.certificatePem
  });
  const soapEnvelope =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
    `<soap12:Body>` +
    `<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeInutilizacao4">` +
    `${signed.signedXml.replace(/^\s*<\?xml[^>]*\?>\s*/i, "")}` +
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
            reject(new Error("A inutilizacao da SEFAZ retornou corpo vazio."));
            return;
          }

          try {
            resolvePromise(
              parseInutilizationResponse(
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
      request.destroy(new Error("Tempo esgotado ao inutilizar numeracao na SEFAZ."));
    });
    request.on("error", reject);
    request.end(soapEnvelope);
  });
}
