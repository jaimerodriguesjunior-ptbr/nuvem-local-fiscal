import http from "node:http";
import https from "node:https";
import { URL } from "node:url";

import { SignedXml } from "xml-crypto";

import { config } from "../config.js";
import type { InMemoryStore } from "../store.js";
import type { DocumentRecord, Issuer, ServiceConfig } from "../types.js";
import {
  decryptCertificateBundle,
  decryptSecretPayload,
  openEncryptedCertificate
} from "./certificates.js";

type RequestFormat = "soap" | "xml";

type ToledoConfig = {
  cnpj: string;
  inscricaoMunicipal: string;
  idEntidade: string;
  codigoMunicipioIbge: string;
  endpoint: string;
  soapAction: string;
  requestFormat: RequestFormat;
  rpsEmissor: string;
  defaultServiceCode: string;
  defaultServiceItem: string;
  defaultServiceSubItem: string;
  defaultAliquotaIss: number;
  optanteSimples: boolean;
  autoTransmit: boolean;
};

type ToledoDraft = {
  tomadorDocumento: string;
  tomadorRazaoSocial: string;
  tomadorEmail: string;
  tomadorTelefone: string;
  tomadorEndereco: string;
  tomadorNumero: string;
  tomadorComplemento: string;
  tomadorBairro: string;
  tomadorCodigoMunicipioIbge: string;
  tomadorUf: string;
  tomadorCep: string;
  tomadorPais: string;
  valorServico: number;
  aliquotaIss: number;
  discriminacaoServico: string;
  serviceCode: string;
  serviceItem: string;
  serviceSubItem: string;
  isIssRetido: boolean;
};

export type ToledoNfseProcessingResult = {
  document: DocumentRecord;
  transmitted: boolean;
  error: string | null;
};

function digitsOnly(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function escapeXml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function toMoney(value: unknown) {
  return Number(value || 0).toFixed(2);
}

function normalizeServiceCode(value: string) {
  const digits = digitsOnly(value);
  if (digits.length === 9) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4, 6)}.${digits.slice(6)}`;
  }
  if (digits.length === 6) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4)}`;
  }
  return value;
}

function asRecord(value: unknown) {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function nestedRecord(value: Record<string, unknown>, key: string) {
  return asRecord(value[key]);
}

function numberFrom(value: unknown, fallback = 0) {
  const normalized = typeof value === "string" ? value.replace(",", ".") : value;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function detectDocumentType(value: string) {
  const digits = digitsOnly(value);
  if (digits.length === 11) {
    return { type: "1", document: digits, foreignDocument: "" };
  }
  if (digits.length === 14) {
    return { type: "2", document: digits, foreignDocument: "" };
  }
  return { type: "3", document: "", foreignDocument: value.trim() };
}

function rootElementXPath(xml: string) {
  const match = xml.match(/<(?!!\?)(?:([\w.-]+):)?([\w.-]+)\b/);
  if (!match) {
    throw new Error("Nao foi possivel identificar o elemento raiz para assinatura NFS-e.");
  }
  return `/*[local-name(.)='${match[2]}']`;
}

function deriveSoapAction(configured: string, operation: string) {
  const trimmed = configured.trim();
  return trimmed ? trimmed.replace(/\/[^/]+$/, `/${operation}`) : "";
}

function providerFrom(serviceConfig: ServiceConfig | null) {
  return String(serviceConfig?.settings.nfseProvider ?? "").trim().toLowerCase();
}

export function isToledoNfseConfig(
  issuer: Issuer | null,
  serviceConfig: ServiceConfig | null
) {
  const provider = providerFrom(serviceConfig);
  const municipality = String(
    serviceConfig?.settings.nfseMunicipalityCode ??
      issuer?.metadata?.codigo_municipio ??
      (issuer?.metadata?.endereco as Record<string, unknown> | undefined)?.codigo_municipio ??
      ""
  ).replace(/\D/g, "");
  return (
    provider === "toledo-equiplano" ||
    provider === "equiplano" ||
    municipality === "4127700"
  );
}

function resolveToledoConfig(
  issuer: Issuer,
  serviceConfig: ServiceConfig
): ToledoConfig {
  const metadata = issuer.metadata ?? {};
  const endereco = asRecord(metadata.endereco);
  const settings = serviceConfig.settings;
  return {
    cnpj: issuer.cnpj,
    inscricaoMunicipal: firstText(
      settings.nfseInscricaoMunicipal,
      metadata.inscricao_municipal,
      settings.nfseLogin
    ),
    idEntidade: firstText(settings.nfseIdEntidade),
    codigoMunicipioIbge: firstText(
      settings.nfseMunicipalityCode,
      endereco.codigo_municipio,
      "4127700"
    ),
    endpoint: firstText(
      settings.nfseEndpoint,
      "https://www.esnfs.com.br:9443//homologacaows/services/Enfs"
    ),
    soapAction: firstText(
      settings.nfseSoapAction,
      "http://services.enfsws.es/esRecepcionarLoteRps"
    ),
    requestFormat: settings.nfseRequestFormat === "xml" ? "xml" : "soap",
    rpsEmissor: firstText(settings.nfseRpsEmissor, settings.nfseRpsSerie, "1"),
    defaultServiceCode: firstText(settings.nfseDefaultServiceCode, "17.19.01.000"),
    defaultServiceItem: firstText(settings.nfseDefaultServiceItem, "2"),
    defaultServiceSubItem: firstText(settings.nfseDefaultServiceSubItem, "01"),
    defaultAliquotaIss: numberFrom(settings.nfseDefaultAliquotaIss, 3),
    optanteSimples: ["1", "2", "4"].includes(issuer.crt),
    autoTransmit: settings.autoTransmit === true
  };
}

function resolveDraft(document: DocumentRecord, toledoConfig: ToledoConfig): ToledoDraft {
  const body = asRecord(document.payloadOriginal);
  const infDps = asRecord(body.infDPS);
  const toma = nestedRecord(infDps, "toma");
  const tomaEnd = nestedRecord(toma, "end");
  const endNac = nestedRecord(tomaEnd, "endNac");
  const serv = nestedRecord(infDps, "serv");
  const cServ = nestedRecord(serv, "cServ");
  const valores = nestedRecord(infDps, "valores");
  const vServPrest = nestedRecord(valores, "vServPrest");
  const trib = nestedRecord(valores, "trib");
  const tribMun = nestedRecord(trib, "tribMun");
  const serviceCode = firstText(
    cServ.cTribMun,
    cServ.cTribNac,
    toledoConfig.defaultServiceCode
  );

  return {
    tomadorDocumento: firstText(toma.CNPJ, toma.CPF, toma.cnpj, toma.cpf),
    tomadorRazaoSocial: firstText(toma.xNome, toma.nome, "TOMADOR NAO INFORMADO"),
    tomadorEmail: firstText(toma.email),
    tomadorTelefone: firstText(toma.fone, toma.telefone),
    tomadorEndereco: firstText(tomaEnd.xLgr, tomaEnd.logradouro, "Nao Informado"),
    tomadorNumero: firstText(tomaEnd.nro, tomaEnd.numero, "SN"),
    tomadorComplemento: firstText(tomaEnd.xCpl, tomaEnd.complemento),
    tomadorBairro: firstText(tomaEnd.xBairro, tomaEnd.bairro, "Centro"),
    tomadorCodigoMunicipioIbge: firstText(
      endNac.cMun,
      tomaEnd.codigo_municipio,
      toledoConfig.codigoMunicipioIbge
    ),
    tomadorUf: firstText(tomaEnd.UF, tomaEnd.uf, "PR"),
    tomadorCep: firstText(endNac.CEP, tomaEnd.cep),
    tomadorPais: "Brasil",
    valorServico: numberFrom(vServPrest.vServ, 0),
    aliquotaIss: numberFrom(tribMun.pAliq, toledoConfig.defaultAliquotaIss),
    discriminacaoServico: firstText(cServ.xDescServ, "Servico prestado"),
    serviceCode,
    serviceItem: toledoConfig.defaultServiceItem,
    serviceSubItem: toledoConfig.defaultServiceSubItem,
    isIssRetido: String(tribMun.tpRetISSQN ?? "") === "2"
  };
}

function buildServiceBlock(draft: ToledoDraft, valorIss: number) {
  const serviceCode = normalizeServiceCode(draft.serviceCode);
  const serviceIdentity = serviceCode
    ? `<nrServico>${escapeXml(serviceCode)}</nrServico>`
    : `<nrServicoItem>${escapeXml(draft.serviceItem)}</nrServicoItem>
                        <nrServicoSubItem>${escapeXml(draft.serviceSubItem)}</nrServicoSubItem>`;

  return `<servico>
                        ${serviceIdentity}
                        <vlServico>${toMoney(draft.valorServico)}</vlServico>
                        <vlAliquota>${draft.aliquotaIss.toFixed(2)}</vlAliquota>
                        <vlBaseCalculo>${toMoney(draft.valorServico)}</vlBaseCalculo>
                        <vlIssServico>${toMoney(valorIss)}</vlIssServico>
                        <dsDiscriminacaoServico>${escapeXml(draft.discriminacaoServico)}</dsDiscriminacaoServico>
                    </servico>`;
}

function buildLoteXml(input: {
  settings: ToledoConfig;
  draft: ToledoDraft;
  lotNumber: number;
  rpsNumber: number;
}) {
  const { settings, draft, lotNumber, rpsNumber } = input;
  const valorIss = Number(((draft.valorServico * draft.aliquotaIss) / 100).toFixed(2));
  const valorLiquido = Number(
    (draft.valorServico - (draft.isIssRetido ? valorIss : 0)).toFixed(2)
  );
  const document = detectDocumentType(draft.tomadorDocumento);
  const now = new Date().toISOString().slice(0, 19);
  const foreignDocument = document.foreignDocument
    ? `<dsDocumentoEstrangeiro>${escapeXml(document.foreignDocument)}</dsDocumentoEstrangeiro>`
    : "";
  const complemento = draft.tomadorComplemento
    ? `<dsComplemento>${escapeXml(draft.tomadorComplemento)}</dsComplemento>`
    : "";
  const email = draft.tomadorEmail
    ? `<dsEmail>${escapeXml(draft.tomadorEmail)}</dsEmail>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<es:enviarLoteRpsEnvio xmlns:es="http://www.equiplano.com.br/esnfs" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.equiplano.com.br/enfs esRecepcionarLoteRpsEnvio_v01.xsd">
    <lote xmlns="">
        <nrLote>${lotNumber}</nrLote>
        <qtRps>1</qtRps>
        <nrVersaoXml>1</nrVersaoXml>
        <prestador>
            <nrCnpj>${digitsOnly(settings.cnpj)}</nrCnpj>
            <nrInscricaoMunicipal>${escapeXml(settings.inscricaoMunicipal)}</nrInscricaoMunicipal>
            <isOptanteSimplesNacional>${settings.optanteSimples ? "1" : "2"}</isOptanteSimplesNacional>
            <idEntidade>${escapeXml(settings.idEntidade)}</idEntidade>
        </prestador>
        <listaRps>
            <rps>
                <nrRps>${rpsNumber}</nrRps>
                <nrEmissorRps>${escapeXml(settings.rpsEmissor)}</nrEmissorRps>
                <dtEmissaoRps>${now}</dtEmissaoRps>
                <stRps>1</stRps>
                <tpTributacao>1</tpTributacao>
                <nrCidadeIbgeServico>${escapeXml(settings.codigoMunicipioIbge)}</nrCidadeIbgeServico>
                <isIssRetido>${draft.isIssRetido ? "1" : "2"}</isIssRetido>
                <tomador>
                    <documento>
                        <nrDocumento>${escapeXml(document.document)}</nrDocumento>
                        <tpDocumento>${document.type}</tpDocumento>
                        ${foreignDocument}
                    </documento>
                    <nmTomador>${escapeXml(draft.tomadorRazaoSocial)}</nmTomador>
                    ${email}
                    <dsEndereco>${escapeXml(draft.tomadorEndereco)}</dsEndereco>
                    <nrEndereco>${escapeXml(draft.tomadorNumero)}</nrEndereco>
                    ${complemento}
                    <nmBairro>${escapeXml(draft.tomadorBairro)}</nmBairro>
                    <nrCidadeIbge>${escapeXml(draft.tomadorCodigoMunicipioIbge)}</nrCidadeIbge>
                    <nmUf>${escapeXml(draft.tomadorUf)}</nmUf>
                    <nmPais>${escapeXml(draft.tomadorPais)}</nmPais>
                    <nrCep>${escapeXml(digitsOnly(draft.tomadorCep))}</nrCep>
                    <nrTelefone>${escapeXml(digitsOnly(draft.tomadorTelefone))}</nrTelefone>
                </tomador>
                <listaServicos>
                    ${buildServiceBlock(draft, valorIss)}
                </listaServicos>
                <vlTotalRps>${toMoney(draft.valorServico)}</vlTotalRps>
                <vlLiquidoRps>${toMoney(valorLiquido)}</vlLiquidoRps>
            </rps>
        </listaRps>
    </lote>
</es:enviarLoteRpsEnvio>`;
}

function buildConsultarNfsePorRpsXml(input: {
  settings: ToledoConfig;
  rpsNumber: number;
}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<es:esConsultarNfsePorRpsEnvio xmlns:es="http://www.equiplano.com.br/esnfs"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.equiplano.com.br/enfs esConsultarNfsePorRpsEnvio_v01.xsd">
  <rps>
    <nrRps>${input.rpsNumber}</nrRps>
    <nrEmissorRps>${escapeXml(input.settings.rpsEmissor)}</nrEmissorRps>
  </rps>
  <prestador>
    <nrInscricaoMunicipal>${escapeXml(input.settings.inscricaoMunicipal)}</nrInscricaoMunicipal>
    <cnpj>${digitsOnly(input.settings.cnpj)}</cnpj>
    <idEntidade>${escapeXml(input.settings.idEntidade)}</idEntidade>
  </prestador>
</es:esConsultarNfsePorRpsEnvio>`;
}

function wrapRequestBody(xml: string, requestFormat: RequestFormat, operation = "esRecepcionarLoteRps") {
  if (requestFormat === "xml") {
    return xml;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:ser="http://services.enfsws.es"
               xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:xsd="http://www.w3.org/2001/XMLSchema"
               xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
    <soap:Body>
        <ser:${operation}>
            <ser:nrVersaoXml>1</ser:nrVersaoXml>
            <ser:xml>${escapeXml(xml)}</ser:xml>
        </ser:${operation}>
    </soap:Body>
</soap:Envelope>`;
}

function signXml(xml: string, privateKeyPem: string, certificatePem: string) {
  const signer = new SignedXml({
    privateKey: privateKeyPem,
    publicCert: certificatePem,
    getKeyInfoContent: SignedXml.getKeyInfoContent,
    getCertFromKeyInfo: () => null,
    signatureAlgorithm: "http://www.w3.org/2000/09/xmldsig#rsa-sha1",
    canonicalizationAlgorithm: "http://www.w3.org/TR/2001/REC-xml-c14n-20010315"
  });

  signer.addReference({
    xpath: rootElementXPath(xml),
    transforms: [
      "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
      "http://www.w3.org/TR/2001/REC-xml-c14n-20010315"
    ],
    digestAlgorithm: "http://www.w3.org/2000/09/xmldsig#sha1",
    isEmptyUri: true
  });

  signer.computeSignature(xml, {
    existingPrefixes: {
      es: "http://www.equiplano.com.br/esnfs",
      xsi: "http://www.w3.org/2001/XMLSchema-instance"
    }
  });

  return signer.getSignedXml();
}

async function postRawRequest(input: {
  settings: ToledoConfig;
  requestBody: string;
  operation: string;
  encryptedCertificateBundle: string;
}) {
  const endpoint = input.settings.endpoint.trim();
  const url = new URL(endpoint);
  const isHttps = url.protocol === "https:";
  const transport = isHttps ? https : http;
  const bundle = decryptCertificateBundle(
    input.encryptedCertificateBundle,
    config.certificateEncryptionKey
  );
  const pfx = Buffer.from(bundle.pfxBase64, "base64");

  return new Promise<{ status: number; body: string | null }>((resolve, reject) => {
    const headers: Record<string, string> = {
      "Content-Type":
        input.settings.requestFormat === "soap"
          ? "text/xml; charset=utf-8"
          : "application/xml",
      "Content-Length": Buffer.byteLength(input.requestBody).toString()
    };
    const soapAction =
      input.settings.requestFormat === "soap"
        ? deriveSoapAction(input.settings.soapAction, input.operation)
        : "";
    if (soapAction) {
      headers.SOAPAction = soapAction;
    }

    const request = transport.request(
      {
        hostname: url.hostname,
        port: url.port ? Number(url.port) : undefined,
        path: `${url.pathname}${url.search}`,
        method: "POST",
        headers,
        pfx: isHttps ? pfx : undefined,
        passphrase: bundle.password || undefined,
        rejectUnauthorized: true
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on("end", () => {
          const combined = Buffer.concat(chunks).toString("utf8");
          resolve({
            status: response.statusCode ?? 0,
            body: combined.trim() === "" ? null : combined
          });
        });
      }
    );

    request.on("error", reject);
    request.write(input.requestBody);
    request.end();
  });
}

function firstMatch(xml: string, tag: string) {
  const expression = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i");
  return xml.match(expression)?.[1]?.trim() ?? "";
}

function decodeXmlEntities(value: string) {
  return value
    .replaceAll("&#xd;", "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function extractBusinessXml(xml: string | null) {
  if (!xml) {
    return null;
  }
  const rawReturn = firstMatch(xml, "ns:return") || firstMatch(xml, "return");
  if (!rawReturn) {
    return xml;
  }
  return decodeXmlEntities(rawReturn).trim() || xml;
}

function summarizeXmlResponse(xml: string | null) {
  if (!xml) {
    return {
      status: "empty-response",
      detail: "Provider returned no body."
    };
  }

  const businessXml = extractBusinessXml(xml) ?? xml;
  const summary: Record<string, string> = {};
  for (const tag of [
    "codigo",
    "cdMensagem",
    "descricao",
    "dsMensagem",
    "mensagem",
    "mensagemRetorno",
    "nrNfse",
    "numeroNfse",
    "protocolo",
    "nrLote",
    "nrRps"
  ]) {
    const value = firstMatch(businessXml, tag);
    if (value) {
      summary[tag] = value;
    }
  }
  return summary;
}

function validateConfig(settings: ToledoConfig) {
  const missing: string[] = [];
  if (!digitsOnly(settings.cnpj)) missing.push("CNPJ");
  if (!settings.inscricaoMunicipal) missing.push("inscricao municipal");
  if (!settings.idEntidade) missing.push("idEntidade");
  if (!settings.codigoMunicipioIbge) missing.push("codigo municipio IBGE");
  if (!settings.endpoint) missing.push("endpoint");
  if (missing.length) {
    throw new Error(`Configuracao NFS-e Toledo incompleta: ${missing.join(", ")}.`);
  }
}

function validateDraft(draft: ToledoDraft) {
  const missing: string[] = [];
  if (!draft.tomadorDocumento) missing.push("documento do tomador");
  if (!draft.tomadorRazaoSocial) missing.push("nome do tomador");
  if (!draft.valorServico || draft.valorServico <= 0) missing.push("valor do servico");
  if (!draft.discriminacaoServico) missing.push("descricao do servico");
  if (!draft.serviceCode && (!draft.serviceItem || !draft.serviceSubItem)) {
    missing.push("codigo do servico");
  }
  if (missing.length) {
    throw new Error(`Payload NFS-e Toledo incompleto: ${missing.join(", ")}.`);
  }
}

export async function processToledoNfse(
  store: InMemoryStore,
  documentId: string
): Promise<ToledoNfseProcessingResult> {
  const document = store.findDocument(documentId, "NFSe");
  if (!document) {
    throw new Error("Documento NFS-e nao encontrado para processamento.");
  }
  if (document.ambiente !== "homologacao") {
    return { document, transmitted: false, error: null };
  }

  const issuer = store.findIssuerByCnpj(document.issuerCnpj, document.ambiente);
  const serviceConfig = store.findServiceConfigRecord(document.issuerCnpj, document.ambiente, "NFSE");
  if (!issuer || !serviceConfig?.active || !isToledoNfseConfig(issuer, serviceConfig)) {
    const message = "Configuracao NFS-e Toledo/Equiplano nao encontrada para este emitente.";
    const failed = store.failDocument(document.id, "CONFIGURACAO_NFSE", message);
    await store.waitForPersistence();
    return { document: failed ?? document, transmitted: false, error: message };
  }

  try {
    const settings = resolveToledoConfig(issuer, serviceConfig);
    const draft = resolveDraft(document, settings);
    validateConfig(settings);
    validateDraft(draft);

    const lotNumber =
      Number(serviceConfig.settings.nfseNextLotNumber) > 0
        ? Number(serviceConfig.settings.nfseNextLotNumber)
        : document.numero;
    const rpsNumber =
      Number(serviceConfig.settings.nfseNextRpsNumber) > 0
        ? Number(serviceConfig.settings.nfseNextRpsNumber)
        : document.numero;
    const unsignedXml = buildLoteXml({ settings, draft, lotNumber, rpsNumber });

    const certificate = store.findActiveCertificate(document.issuerCnpj);
    const openedCertificate = certificate?.encryptedBundle
      ? openEncryptedCertificate(
          certificate.encryptedBundle,
          config.certificateEncryptionKey
        )
      : null;
    const signedXml = openedCertificate
      ? signXml(
          unsignedXml,
          openedCertificate.privateKeyPem,
          openedCertificate.certificatePem
        )
      : unsignedXml;
    const requestBody = wrapRequestBody(signedXml, settings.requestFormat);

    if (!settings.autoTransmit) {
      const updated = store.saveMunicipalProcessingResult(document.id, {
        providerName: "toledo-equiplano",
        generatedXml: unsignedXml,
        signedXml,
        requestBody,
        providerReference: `${lotNumber}:${rpsNumber}`,
        status: "processamento",
        reason: "XML NFS-e Toledo gerado em dry-run. Transmissao municipal nao habilitada.",
        reasonCode: "NFSE_DRY_RUN",
        signatureValid: Boolean(certificate?.encryptedBundle),
        xsdValid: false,
        xsdErrors: []
      });
      store.addDocumentEvent(document.id, {
        eventType: "nfse_toledo_dry_run",
        message: "XML NFS-e Toledo gerado sem transmissao.",
        payload: {
          provider: "toledo-equiplano",
          endpoint: settings.endpoint,
          requestFormat: settings.requestFormat,
          lotNumber,
          rpsNumber,
          signed: Boolean(certificate?.encryptedBundle)
        }
      });
      await store.waitForPersistence();
      return { document: updated ?? document, transmitted: false, error: null };
    }

    if (!certificate?.encryptedBundle) {
      throw new Error("Cadastre um certificado A1 ativo para transmitir NFS-e Toledo.");
    }

    const response = await postRawRequest({
      settings,
      requestBody,
      operation: "esRecepcionarLoteRps",
      encryptedCertificateBundle: certificate.encryptedBundle
    });
    const responseSummary = summarizeXmlResponse(response.body);
    const businessXml = extractBusinessXml(response.body);
    const hasBusinessError =
      Boolean(responseSummary.cdMensagem) ||
      Boolean(responseSummary.dsMensagem) ||
      /<listaErros>/i.test(businessXml ?? "");
    const success =
      response.status >= 200 &&
      response.status < 300 &&
      response.body !== null &&
      !hasBusinessError;
    const nfseNumber = responseSummary.nrNfse || responseSummary.numeroNfse || "";
    const protocol = responseSummary.protocolo || responseSummary.nrLote || "";
    const updated = store.saveMunicipalProcessingResult(document.id, {
      providerName: "toledo-equiplano",
      generatedXml: unsignedXml,
      signedXml,
      requestBody,
      responseBody: response.body,
      providerReference: `${lotNumber}:${rpsNumber}`,
      status: success && nfseNumber ? "autorizado" : success ? "processamento" : "rejeitado",
      reason: success
        ? "Lote NFS-e Toledo recebido pelo provedor."
        : responseSummary.dsMensagem ||
          responseSummary.mensagemRetorno ||
          `Erro HTTP ${response.status}`,
      reasonCode: success ? String(response.status) : responseSummary.cdMensagem || String(response.status),
      protocol,
      providerDocumentNumber: nfseNumber || null,
      processedXml: success && nfseNumber ? businessXml ?? signedXml : undefined,
      signatureValid: true,
      xsdValid: false,
      xsdErrors: []
    });
    serviceConfig.settings.nfseNextLotNumber = Math.max(
      Number(serviceConfig.settings.nfseNextLotNumber ?? 1),
      lotNumber + 1
    );
    serviceConfig.settings.nfseNextRpsNumber = Math.max(
      Number(serviceConfig.settings.nfseNextRpsNumber ?? 1),
      rpsNumber + 1
    );
    store.upsertServiceConfig(document.issuerCnpj, document.ambiente, "NFSE", {
      active: true,
      settings: serviceConfig.settings,
      preserveSecrets: true
    });
    store.addDocumentEvent(document.id, {
      eventType: "nfse_toledo_transmission_completed",
      level: success ? "info" : "warn",
      message: updated?.motivo ?? "Transmissao NFS-e Toledo concluida.",
      payload: {
        provider: "toledo-equiplano",
        httpStatus: response.status,
        responseSummary,
        lotNumber,
        rpsNumber
      }
    });
    await store.waitForPersistence();
    return { document: updated ?? document, transmitted: true, error: success ? null : updated?.motivo ?? "NFS-e rejeitada." };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    store.addDocumentEvent(document.id, {
      eventType: "nfse_toledo_processing_failed",
      level: "error",
      message,
      payload: { provider: "toledo-equiplano" }
    });
    const failed = store.failDocument(document.id, "NFSE_TOLEDO", message);
    await store.waitForPersistence();
    return { document: failed ?? document, transmitted: false, error: message };
  }
}

export async function consultToledoNfse(
  store: InMemoryStore,
  documentId: string
): Promise<ToledoNfseProcessingResult> {
  const document = store.findDocument(documentId, "NFSe");
  if (!document) {
    throw new Error("Documento NFS-e nao encontrado para consulta.");
  }
  if (document.ambiente !== "homologacao" || document.status !== "processamento") {
    return { document, transmitted: false, error: null };
  }

  const issuer = store.findIssuerByCnpj(document.issuerCnpj, document.ambiente);
  const serviceConfig = store.findServiceConfigRecord(
    document.issuerCnpj,
    document.ambiente,
    "NFSE"
  );
  const certificate = store.findActiveCertificate(document.issuerCnpj);
  if (
    !issuer ||
    !serviceConfig?.active ||
    !serviceConfig.settings.autoTransmit ||
    !certificate?.encryptedBundle ||
    !isToledoNfseConfig(issuer, serviceConfig)
  ) {
    return { document, transmitted: false, error: null };
  }

  const reference = String(document.providerReference ?? "");
  const [, rpsText] = reference.split(":");
  const rpsNumber = Number(rpsText);
  if (!Number.isInteger(rpsNumber) || rpsNumber <= 0) {
    return { document, transmitted: false, error: null };
  }

  try {
    const settings = resolveToledoConfig(issuer, serviceConfig);
    validateConfig(settings);
    const unsignedXml = buildConsultarNfsePorRpsXml({ settings, rpsNumber });
    const opened = openEncryptedCertificate(
      certificate.encryptedBundle,
      config.certificateEncryptionKey
    );
    const signedXml = signXml(
      unsignedXml,
      opened.privateKeyPem,
      opened.certificatePem
    );
    const requestBody = wrapRequestBody(
      signedXml,
      settings.requestFormat,
      "esConsultarNfsePorRps"
    );
    const response = await postRawRequest({
      settings,
      requestBody,
      operation: "esConsultarNfsePorRps",
      encryptedCertificateBundle: certificate.encryptedBundle
    });
    const responseSummary = summarizeXmlResponse(response.body);
    const businessXml = extractBusinessXml(response.body);
    const isNilReturn = /xsi:nil="true"/i.test(response.body ?? "");
    const hasBusinessError =
      Boolean(responseSummary.cdMensagem) ||
      Boolean(responseSummary.dsMensagem) ||
      /<listaErros>/i.test(businessXml ?? "");
    const nfseNumber = responseSummary.nrNfse || responseSummary.numeroNfse || "";
    const authorized =
      response.status >= 200 &&
      response.status < 300 &&
      response.body !== null &&
      !isNilReturn &&
      !hasBusinessError &&
      Boolean(nfseNumber);
    const rejected = hasBusinessError;
    const updated = store.saveMunicipalProcessingResult(document.id, {
      providerName: "toledo-equiplano",
      requestBody,
      responseBody: response.body,
      status: authorized ? "autorizado" : rejected ? "rejeitado" : "processamento",
      reason: authorized
        ? "NFS-e Toledo autorizada."
        : responseSummary.dsMensagem ||
          responseSummary.mensagemRetorno ||
          (isNilReturn ? "Consulta NFS-e ainda sem retorno." : "NFS-e Toledo em processamento."),
      reasonCode: authorized
        ? "AUTORIZADA"
        : responseSummary.cdMensagem || (isNilReturn ? "PROCESSANDO" : String(response.status)),
      protocol: responseSummary.protocolo || document.protocolo,
      providerDocumentNumber: nfseNumber || document.chave,
      processedXml: authorized ? businessXml ?? undefined : undefined,
      signatureValid: true
    });
    store.addDocumentEvent(document.id, {
      eventType: "nfse_toledo_consultation_completed",
      level: rejected ? "warn" : "info",
      message: updated?.motivo ?? "Consulta NFS-e Toledo concluida.",
      payload: {
        provider: "toledo-equiplano",
        httpStatus: response.status,
        responseSummary,
        rpsNumber
      }
    });
    await store.waitForPersistence();
    return {
      document: updated ?? document,
      transmitted: true,
      error: rejected ? updated?.motivo ?? "NFS-e rejeitada." : null
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    store.addDocumentEvent(document.id, {
      eventType: "nfse_toledo_consultation_failed",
      level: "error",
      message,
      payload: { provider: "toledo-equiplano", rpsNumber }
    });
    await store.waitForPersistence();
    return { document, transmitted: true, error: message };
  }
}
