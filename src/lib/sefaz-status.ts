import https from "node:https";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import tls from "node:tls";

import { DOMParser } from "@xmldom/xmldom";

import { decryptCertificateBundle } from "./certificates.js";
import type { Environment } from "../types.js";

const endpoints: Record<string, Record<Environment, string>> = {
  PR: {
    homologacao: "https://homologacao.nfe.sefa.pr.gov.br/nfe/NFeStatusServico4",
    producao: "https://nfe.sefa.pr.gov.br/nfe/NFeStatusServico4"
  }
};

const stateCodes: Record<string, string> = {
  PR: "41"
};

const soapAction =
  "http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4/nfeStatusServicoNF";

export type SefazStatusResult = {
  ambiente: Environment;
  uf: string;
  endpoint: string;
  statusCode: number;
  cStat: string;
  xMotivo: string;
  tpAmb: string;
  verAplic: string;
  cUF: string;
  dhRecbto: string;
  tMed: string;
};

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function buildStatusSoapEnvelope(environment: Environment, stateCode: string) {
  const tpAmb = environment === "producao" ? "1" : "2";
  const requestXml =
    `<consStatServ xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">` +
    `<tpAmb>${tpAmb}</tpAmb><cUF>${escapeXml(stateCode)}</cUF><xServ>STATUS</xServ>` +
    `</consStatServ>`;

  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
    `<soap12:Body>` +
    `<nfeStatusServicoNF xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4">` +
    `<nfeDadosMsg>${requestXml}</nfeDadosMsg>` +
    `</nfeStatusServicoNF>` +
    `</soap12:Body>` +
    `</soap12:Envelope>`
  );
}

function textContentByLocalName(
  xml: ReturnType<DOMParser["parseFromString"]>,
  name: string
) {
  const nodes = xml.getElementsByTagNameNS("*", name);
  return nodes.item(0)?.textContent?.trim() ?? "";
}

export function parseStatusSoapResponse(
  responseXml: string,
  context: Pick<SefazStatusResult, "ambiente" | "uf" | "endpoint" | "statusCode">
): SefazStatusResult {
  const xml = new DOMParser().parseFromString(responseXml, "application/xml");
  const parserError = xml.getElementsByTagName("parsererror").item(0);
  if (parserError) {
    throw new Error("A SEFAZ retornou um XML invalido.");
  }

  const faultReason =
    textContentByLocalName(xml, "Text") || textContentByLocalName(xml, "faultstring");
  const cStat = textContentByLocalName(xml, "cStat");
  const xMotivo = textContentByLocalName(xml, "xMotivo");

  if (!cStat) {
    throw new Error(
      faultReason
        ? `A SEFAZ retornou uma falha SOAP: ${faultReason}`
        : "A resposta da SEFAZ nao contem cStat."
    );
  }

  return {
    ...context,
    cStat,
    xMotivo,
    tpAmb: textContentByLocalName(xml, "tpAmb"),
    verAplic: textContentByLocalName(xml, "verAplic"),
    cUF: textContentByLocalName(xml, "cUF"),
    dhRecbto: textContentByLocalName(xml, "dhRecbto"),
    tMed: textContentByLocalName(xml, "tMed")
  };
}

export async function querySefazStatus(input: {
  uf: string;
  ambiente: Environment;
  encryptedCertificateBundle: string;
  encryptionSecret: string;
}): Promise<SefazStatusResult> {
  const uf = input.uf.toUpperCase();
  const endpoint = endpoints[uf]?.[input.ambiente];
  const stateCode = stateCodes[uf];
  if (!endpoint || !stateCode) {
    throw new Error(`Consulta de status ainda nao configurada para a UF ${uf || "(vazia)"}.`);
  }

  const certificate = decryptCertificateBundle(
    input.encryptedCertificateBundle,
    input.encryptionSecret
  );
  const rootCa = readFileSync(
    resolve(process.cwd(), "certificates", "icp-brasil-root-v10.pem"),
    "ascii"
  );
  const body = buildStatusSoapEnvelope(input.ambiente, stateCode);
  const url = new URL(endpoint);

  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: "POST",
        pfx: Buffer.from(certificate.pfxBase64, "base64"),
        passphrase: certificate.password,
        ca: [...tls.rootCertificates, rootCa],
        minVersion: "TLSv1.2",
        timeout: 15_000,
        headers: {
          "content-type": `application/soap+xml; charset=utf-8; action="${soapAction}"`,
          "content-length": Buffer.byteLength(body),
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
          const statusCode = response.statusCode ?? 0;
          if (statusCode < 200 || statusCode >= 300) {
            reject(new Error(`A SEFAZ respondeu HTTP ${statusCode}.`));
            return;
          }

          try {
            resolve(
              parseStatusSoapResponse(responseBody, {
                ambiente: input.ambiente,
                uf,
                endpoint,
                statusCode
              })
            );
          } catch (error) {
            reject(error);
          }
        });
      }
    );

    request.on("timeout", () => {
      request.destroy(new Error("Tempo esgotado ao consultar a SEFAZ."));
    });
    request.on("error", reject);
    request.end(body);
  });
}
