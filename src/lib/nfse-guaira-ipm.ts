import {
  DOMParser,
  type Document as XmlDocument,
  type Element as XmlElement
} from "@xmldom/xmldom";
import { lookup, Resolver } from "node:dns/promises";
import { request as httpsRequest } from "node:https";

import { config } from "../config.js";
import type { InMemoryStore } from "../store.js";
import type { DocumentRecord, Issuer, ServiceConfig } from "../types.js";
import { decryptSecretPayload } from "./certificates.js";

export type GuairaIpmConfig = {
  cnpj: string;
  endpoint: string;
  tomCode: string;
  economicRegistration: string;
  rpsSeries: string;
  defaultServiceCode: string;
  defaultActivityCode: string;
  defaultTaxSituation: string;
  defaultAliquotaIss: number;
  requiresSignature: boolean;
  testMode: boolean;
  autoTransmit: boolean;
};

export type GuairaIpmDraft = {
  identifier: string;
  issuedAt: Date;
  serviceValue: number;
  discountValue: number;
  observation: string;
  customerType: "F" | "J" | "E";
  customerDocument: string;
  customerName: string;
  customerEmail: string;
  customerStreet: string;
  customerNumber: string;
  customerComplement: string;
  customerDistrict: string;
  customerCityCode: string;
  customerPostalCode: string;
  customerPhone: string;
  serviceLocationCode: string;
  serviceCode: string;
  activityCode: string;
  description: string;
  aliquotaIss: number;
  taxSituation: string;
  issWithheldValue: number;
};

export type GuairaIpmResponse = {
  success: boolean;
  number: string;
  series: string;
  verificationCode: string;
  pdfUrl: string;
  statusCode: string;
  statusDescription: string;
  messages: Array<{ codigo: string; descricao: string }>;
};

export type GuairaNfseProcessingResult = {
  document: DocumentRecord;
  transmitted: boolean;
  error: string | null;
};

export type GuairaIpmMultipartRequest = {
  body: Buffer;
  contentType: string;
  contentLength: number;
};

function asRecord(value: unknown) {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function digitsOnly(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function numberFrom(value: unknown, fallback = 0) {
  const normalized = typeof value === "string" ? value.replace(",", ".") : value;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function escapeXml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function toIpmDecimal(value: number) {
  return value.toFixed(2).replace(".", ",");
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function toIpmDate(value: Date) {
  return `${pad(value.getUTCDate())}/${pad(value.getUTCMonth() + 1)}/${value.getUTCFullYear()}`;
}

function parseDate(value: unknown) {
  const text = String(value ?? "");
  const parts = text.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/
  );
  if (parts) {
    return new Date(
      Date.UTC(
        Number(parts[1]),
        Number(parts[2]) - 1,
        Number(parts[3]),
        Number(parts[4]),
        Number(parts[5]),
        Number(parts[6] ?? 0)
      )
    );
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function providerFrom(serviceConfig: ServiceConfig | null) {
  return String(serviceConfig?.settings.nfseProvider ?? "").trim().toLowerCase();
}

export function isGuairaIpmConfig(
  issuer: Issuer | null,
  serviceConfig: ServiceConfig | null
) {
  const provider = providerFrom(serviceConfig);
  const municipality = digitsOnly(
    serviceConfig?.settings.nfseMunicipalityCode ??
      issuer?.metadata?.codigo_municipio ??
      asRecord(issuer?.metadata?.endereco).codigo_municipio
  );
  return (
    provider === "guaira-ipm" ||
    provider === "ipm" ||
    provider === "atende-net" ||
    municipality === "4108809"
  );
}

function resolveConfig(issuer: Issuer, serviceConfig: ServiceConfig): GuairaIpmConfig {
  const settings = serviceConfig.settings;
  return {
    cnpj: issuer.cnpj,
    endpoint: firstText(settings.nfseEndpoint),
    tomCode: firstText(settings.nfseTomCode, "7571"),
    economicRegistration: firstText(
      settings.nfseEconomicRegistration,
      settings.nfseInscricaoMunicipal
    ),
    rpsSeries: firstText(settings.nfseRpsSerie, "1"),
    defaultServiceCode: digitsOnly(settings.nfseDefaultServiceCode || "140101"),
    defaultActivityCode: digitsOnly(settings.nfseDefaultActivityCode || "4520007"),
    defaultTaxSituation: firstText(settings.nfseDefaultTaxSituation, "0"),
    defaultAliquotaIss: numberFrom(settings.nfseDefaultAliquotaIss, 2.01),
    requiresSignature: settings.nfseRequiresSignature === true,
    testMode: settings.nfseTestMode !== false,
    autoTransmit: settings.autoTransmit === true
  };
}

export function normalizeGuairaIpmDraft(
  document: Pick<DocumentRecord, "providerLikeId" | "payloadOriginal">,
  config: GuairaIpmConfig
): GuairaIpmDraft {
  const body = asRecord(document.payloadOriginal);
  const infDps = asRecord(body.infDPS);
  const toma = asRecord(infDps.toma);
  const address = asRecord(toma.end);
  const nationalAddress = asRecord(address.endNac);
  const serv = asRecord(infDps.serv);
  const serviceCode = asRecord(serv.cServ);
  const serviceLocation = asRecord(serv.locPrest);
  const values = asRecord(infDps.valores);
  const serviceValues = asRecord(values.vServPrest);
  const tax = asRecord(values.trib);
  const municipalTax = asRecord(tax.tribMun);
  const customerDocument = firstText(toma.CNPJ, toma.CPF, toma.cnpj, toma.cpf);
  const customerType =
    digitsOnly(customerDocument).length === 14
      ? "J"
      : digitsOnly(customerDocument).length === 11
        ? "F"
        : "E";
  const serviceValue = numberFrom(serviceValues.vServ);
  const retained =
    String(municipalTax.tpRetISSQN ?? "") === "2"
      ? numberFrom(municipalTax.vISSQN)
      : 0;

  return {
    identifier: firstText(document.providerLikeId).slice(0, 80),
    issuedAt: parseDate(infDps.dhEmi),
    serviceValue,
    discountValue: numberFrom(serviceValues.vDescCondIncond),
    observation: firstText(serviceCode.xDescServ, "Servico prestado").slice(0, 1000),
    customerType,
    customerDocument: digitsOnly(customerDocument),
    customerName: firstText(toma.xNome, toma.nome),
    customerEmail: firstText(toma.email),
    customerStreet: firstText(address.xLgr, address.logradouro),
    customerNumber: firstText(address.nro, address.numero),
    customerComplement: firstText(address.xCpl, address.complemento),
    customerDistrict: firstText(address.xBairro, address.bairro),
    customerCityCode: firstText(nationalAddress.cMun, address.codigo_municipio, config.tomCode),
    customerPostalCode: digitsOnly(nationalAddress.CEP ?? address.cep),
    customerPhone: digitsOnly(toma.fone ?? toma.telefone),
    serviceLocationCode: firstText(
      serviceLocation.cLocPrestacao,
      municipalTax.cLocIncid,
      config.tomCode
    ),
    serviceCode: digitsOnly(
      firstText(serviceCode.cTribMun, serviceCode.cTribNac, config.defaultServiceCode)
    ),
    activityCode: digitsOnly(firstText(serviceCode.CNAE, config.defaultActivityCode)),
    description: firstText(serviceCode.xDescServ, "Servico prestado"),
    aliquotaIss: numberFrom(municipalTax.pAliq, config.defaultAliquotaIss),
    taxSituation: firstText(serviceCode.cSitTrib, config.defaultTaxSituation),
    issWithheldValue: retained
  };
}

function localCode(value: string, config: GuairaIpmConfig) {
  const digits = digitsOnly(value);
  return digits === "4108809" ? config.tomCode : digits || config.tomCode;
}

function optionalTag(name: string, value: string) {
  return value ? `\n    <${name}>${escapeXml(value)}</${name}>` : "";
}

export function buildGuairaIpmEmissionXml(
  config: GuairaIpmConfig,
  draft: GuairaIpmDraft
) {
  const phone = draft.customerPhone;
  const ddd = phone.length > 9 ? phone.slice(0, phone.length - 9) : "";
  const number = phone.length > 9 ? phone.slice(-9) : phone;
  const signatureId = config.requiresSignature ? ' id="nota"' : "";
  const testTag = config.testMode ? "\n  <nfse_teste>1</nfse_teste>" : "";
  const customerEmail = optionalTag("email", draft.customerEmail);
  const customerComplement = optionalTag("complemento", draft.customerComplement);
  const customerDdd = optionalTag("ddd_fone_comercial", ddd);
  const customerPhone = optionalTag("fone_comercial", number);

  return `<?xml version="1.0" encoding="UTF-8"?>
<nfse${signatureId}>${testTag}
  <identificador>${escapeXml(draft.identifier)}</identificador>
  <nf>
    <serie_nfse>${escapeXml(config.rpsSeries)}</serie_nfse>
    <data_fato_gerador>${toIpmDate(draft.issuedAt)}</data_fato_gerador>
    <valor_total>${toIpmDecimal(draft.serviceValue)}</valor_total>
    <valor_desconto>${toIpmDecimal(draft.discountValue)}</valor_desconto>
    <valor_ir>0,00</valor_ir>
    <valor_inss>0,00</valor_inss>
    <valor_contribuicao_social>0,00</valor_contribuicao_social>
    <valor_rps>0,00</valor_rps>
    <valor_pis>0,00</valor_pis>
    <valor_cofins>0,00</valor_cofins>
    <observacao>${escapeXml(draft.observation)}</observacao>
  </nf>
  <prestador>
    <cpfcnpj>${digitsOnly(config.cnpj)}</cpfcnpj>
    <cidade>${escapeXml(config.tomCode)}</cidade>
  </prestador>
  <tomador>
    <endereco_informado>S</endereco_informado>
    <tipo>${draft.customerType}</tipo>
    <cpfcnpj>${escapeXml(draft.customerDocument)}</cpfcnpj>
    <nome_razao_social>${escapeXml(draft.customerName)}</nome_razao_social>
    <logradouro>${escapeXml(draft.customerStreet)}</logradouro>${customerEmail}
    <numero_residencia>${escapeXml(draft.customerNumber)}</numero_residencia>
    ${customerComplement.trimStart()}
    <bairro>${escapeXml(draft.customerDistrict)}</bairro>
    <cidade>${escapeXml(localCode(draft.customerCityCode, config))}</cidade>
    <cep>${escapeXml(draft.customerPostalCode)}</cep>${customerDdd}${customerPhone}
  </tomador>
  <itens>
    <lista>
      <tributa_municipio_prestador>S</tributa_municipio_prestador>
      <codigo_local_prestacao_servico>${escapeXml(localCode(draft.serviceLocationCode, config))}</codigo_local_prestacao_servico>
      <codigo_item_lista_servico>${escapeXml(draft.serviceCode)}</codigo_item_lista_servico>
      <codigo_atividade>${escapeXml(draft.activityCode)}</codigo_atividade>
      <descritivo>${escapeXml(draft.description)}</descritivo>
      <aliquota_item_lista_servico>${toIpmDecimal(draft.aliquotaIss)}</aliquota_item_lista_servico>
      <situacao_tributaria>${escapeXml(draft.taxSituation)}</situacao_tributaria>
      <valor_tributavel>${toIpmDecimal(draft.serviceValue)}</valor_tributavel>
      <valor_deducao>0,00</valor_deducao>
      <valor_issrf>${toIpmDecimal(draft.issWithheldValue)}</valor_issrf>
    </lista>
  </itens>
</nfse>`;
}

export function buildGuairaIpmConsultationXml(verificationCode: string) {
  const normalizedCode = verificationCode.trim();
  if (!/^[A-Za-z0-9]{40}$/.test(normalizedCode)) {
    throw new Error("Codigo de autenticidade IPM invalido para consulta.");
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<nfse>
  <pesquisa>
    <codigo_autenticidade>${escapeXml(normalizedCode)}</codigo_autenticidade>
  </pesquisa>
</nfse>`;
}

function elementsByLocalName(xml: XmlDocument, name: string) {
  const result: XmlElement[] = [];
  const all = xml.getElementsByTagName("*");
  for (let index = 0; index < all.length; index += 1) {
    const element = all.item(index);
    if (element && (element.localName || element.nodeName.split(":").pop()) === name) {
      result.push(element);
    }
  }
  return result;
}

function firstElementText(xml: XmlDocument, name: string) {
  return elementsByLocalName(xml, name)[0]?.textContent?.trim() ?? "";
}

export function parseGuairaIpmResponse(xml: string): GuairaIpmResponse {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (elementsByLocalName(document, "parsererror").length > 0) {
    throw new Error("Resposta XML IPM invalida.");
  }

  const messages = elementsByLocalName(document, "codigo")
    .map((element) => element.textContent?.trim() ?? "")
    .filter(Boolean)
    .map((message) => {
      const match = message.match(/^\[?0*(\d+)\]?\s*[-:]?\s*(.*)$/);
      return {
        codigo: match?.[1] || "IPM",
        descricao: match?.[2] || message
      };
    });
  const number = firstElementText(document, "numero_nfse");
  const statusCode = firstElementText(document, "situacao_codigo_nfse");
  const explicitlyIssued = statusCode === "1";
  const nonSuccessMessages = messages.filter(
    (message) =>
      message.codigo !== "1" &&
      message.codigo !== "01" &&
      !(explicitlyIssued && message.codigo === "IPM")
  );

  return {
    success: Boolean(number) && explicitlyIssued && nonSuccessMessages.length === 0,
    number,
    series: firstElementText(document, "serie_nfse"),
    verificationCode: firstElementText(document, "cod_verificador_autenticidade"),
    pdfUrl: firstElementText(document, "link_nfse"),
    statusCode,
    statusDescription: firstElementText(document, "situacao_descricao_nfse"),
    messages
  };
}

export function buildGuairaIpmBasicAuthorization(username: string, password: string) {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

export function buildGuairaIpmMultipartRequest(
  xml: string,
  boundary = `----nuvem-local-fiscal-${Date.now().toString(16)}`
): GuairaIpmMultipartRequest {
  const prefix = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="xml"; filename="nota_envio.xml"',
    "Content-Type: application/xml; charset=utf-8",
    "",
    ""
  ].join("\r\n");
  const suffix = `\r\n--${boundary}--\r\n`;
  const body = Buffer.concat([
    Buffer.from(prefix, "utf8"),
    Buffer.from(xml, "utf8"),
    Buffer.from(suffix, "utf8")
  ]);
  return {
    body,
    contentType: `multipart/form-data; boundary=${boundary}`,
    contentLength: body.length
  };
}

export function extractGuairaIpmSessionCookie(
  setCookie: string | string[] | undefined
) {
  const values = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  for (const value of values) {
    const match = value.match(/(?:^|;\s*)PHPSESSID=([^;]+)/i);
    if (match?.[1]) return `PHPSESSID=${match[1]}`;
  }
  return null;
}

function validateConfig(config: GuairaIpmConfig) {
  const missing: string[] = [];
  if (digitsOnly(config.cnpj).length !== 14) missing.push("CNPJ");
  if (!config.tomCode) missing.push("codigo TOM");
  if (!config.defaultServiceCode) missing.push("codigo de servico");
  if (!config.defaultActivityCode) missing.push("codigo de atividade");
  if (!config.defaultTaxSituation) missing.push("situacao tributaria");
  if (!config.endpoint) missing.push("endpoint");
  if (config.requiresSignature) {
    missing.push("assinatura digital IPM ainda nao implementada");
  }
  if (missing.length) {
    throw new Error(`Configuracao NFS-e Guaira/IPM incompleta: ${missing.join(", ")}.`);
  }
}

function validateIpmEndpoint(endpoint: string) {
  const url = new URL(endpoint);
  if (url.protocol !== "https:" || !/(^|\.)atende\.net$/i.test(url.hostname)) {
    throw new Error("Endpoint IPM deve usar HTTPS em um dominio atende.net.");
  }
  return url.toString();
}

async function postIpmRequest(
  endpoint: string,
  request: GuairaIpmMultipartRequest,
  authorization: string
) {
  const url = new URL(endpoint);
  let address = "";
  try {
    address = (await lookup(url.hostname, { family: 4 })).address;
  } catch {
    const resolver = new Resolver();
    resolver.setServers(["1.1.1.1", "8.8.8.8"]);
    address = (await resolver.resolve4(url.hostname))[0] ?? "";
  }
  if (!address) {
    throw new Error(`DNS publico nao encontrou ${url.hostname}.`);
  }

  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const outgoing = httpsRequest(
      {
        protocol: "https:",
        hostname: address,
        port: url.port ? Number(url.port) : 443,
        path: `${url.pathname}${url.search}`,
        method: "POST",
        servername: url.hostname,
        headers: {
          Host: url.hostname,
          Authorization: authorization,
          "Content-Type": request.contentType,
          "Content-Length": String(request.contentLength),
          Accept: "application/xml, text/xml, */*"
        },
        timeout: 30_000
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => {
          const body = Buffer.concat(chunks);
          const xmlHeader = body.subarray(0, 160).toString("ascii");
          const encoding = /encoding=["']ISO-8859-1["']/i.test(xmlHeader)
            ? "latin1"
            : "utf8";
          resolve({
            status: response.statusCode ?? 0,
            body: body.toString(encoding)
          });
        });
      }
    );
    outgoing.on("timeout", () => {
      outgoing.destroy(new Error("Tempo esgotado ao conectar ao IPM."));
    });
    outgoing.on("error", reject);
    outgoing.end(request.body);
  });
}

export async function transmitGuairaIpmTest(
  store: InMemoryStore,
  documentId: string
): Promise<GuairaNfseProcessingResult> {
  const document = store.findDocument(documentId, "NFSe");
  if (!document) {
    throw new Error("Documento NFS-e nao encontrado para transmissao.");
  }
  if (document.ambiente !== "homologacao") {
    throw new Error("A transmissao IPM esta liberada somente em homologacao.");
  }

  const issuer = store.findIssuerByCnpj(document.issuerCnpj, document.ambiente);
  const serviceConfig = store.findServiceConfigRecord(
    document.issuerCnpj,
    document.ambiente,
    "NFSE"
  );
  if (!issuer || !serviceConfig?.active || !isGuairaIpmConfig(issuer, serviceConfig)) {
    throw new Error("Configuracao NFS-e Guaira/IPM nao encontrada para este emitente.");
  }

  const settings = resolveConfig(issuer, serviceConfig);
  validateConfig(settings);
  if (!settings.testMode) {
    throw new Error("O modo nfse_teste=1 deve estar ativo para esta transmissao.");
  }
  if (!serviceConfig.secretsEncrypted) {
    throw new Error("Senha municipal IPM nao configurada.");
  }

  const draft = normalizeGuairaIpmDraft(document, settings);
  validateDraft(draft);
  const generatedXml = buildGuairaIpmEmissionXml(settings, draft);
  if (!generatedXml.includes("<nfse_teste>1</nfse_teste>")) {
    throw new Error("XML de teste IPM sem a tag nfse_teste=1.");
  }

  const secret = decryptSecretPayload<{ senha?: string }>(
    serviceConfig.secretsEncrypted,
    config.certificateEncryptionKey
  );
  const password = String(secret.senha ?? "");
  if (!password) {
    throw new Error("Senha municipal IPM vazia.");
  }

  const request = buildGuairaIpmMultipartRequest(generatedXml);
  const endpoint = validateIpmEndpoint(settings.endpoint);
  let response: { status: number; body: string };
  try {
    response = await postIpmRequest(
      endpoint,
      request,
      buildGuairaIpmBasicAuthorization(settings.cnpj, password)
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Falha de conexao com IPM: ${message}`);
  }

  const responseBody = response.body;
  const responseOk = response.status >= 200 && response.status < 300;
  let parsed: GuairaIpmResponse | null = null;
  try {
    parsed = responseBody.trim() ? parseGuairaIpmResponse(responseBody) : null;
  } catch {
    parsed = null;
  }

  const explicitSuccess = parsed?.success === true;
  const hasProviderError = Boolean(parsed && parsed.messages.length && !parsed.success);
  const status = explicitSuccess
    ? "autorizado"
    : responseOk && !hasProviderError
      ? "processamento"
      : "rejeitado";
  const reason =
    parsed?.statusDescription ||
    parsed?.messages.map((message) => `${message.codigo} - ${message.descricao}`).join("; ") ||
    (responseOk
      ? "Teste IPM recebido sem confirmacao explicita de autorizacao."
      : `IPM respondeu HTTP ${response.status}.`);
  const reasonCode =
    parsed?.statusCode ||
    parsed?.messages[0]?.codigo ||
    `HTTP_${response.status}`;

  const updated = store.saveMunicipalProcessingResult(document.id, {
    providerName: "guaira-ipm",
    generatedXml,
    requestBody: generatedXml,
    responseBody,
    providerReference: draft.identifier,
    status,
    reason,
    reasonCode,
    protocol: parsed?.verificationCode || null,
    providerDocumentNumber: parsed?.number || null,
    processedXml: explicitSuccess ? responseBody : undefined,
    signatureValid: false,
    xsdValid: false,
    xsdErrors: []
  });
  if (updated) {
    updated.mensagens = parsed?.messages ?? [];
  }
  store.addDocumentEvent(document.id, {
    eventType: "nfse_guaira_ipm_test_transmission",
    level: explicitSuccess ? "info" : status === "rejeitado" ? "warn" : "info",
    message: reason,
    payload: {
      provider: "guaira-ipm",
      httpStatus: response.status,
      testMode: true,
      explicitSuccess,
      statusCode: reasonCode,
      providerDocumentNumber: parsed?.number || null
    }
  });
  await store.waitForPersistence();

  return {
    document: updated ?? document,
    transmitted: true,
    error: status === "rejeitado" ? reason : null
  };
}

export async function consultGuairaIpmNfse(
  store: InMemoryStore,
  documentId: string
): Promise<GuairaNfseProcessingResult> {
  const document = store.findDocument(documentId, "NFSe");
  if (!document) {
    throw new Error("Documento NFS-e nao encontrado para consulta.");
  }
  if (document.ambiente !== "homologacao") {
    return { document, transmitted: false, error: null };
  }

  const issuer = store.findIssuerByCnpj(document.issuerCnpj, document.ambiente);
  const serviceConfig = store.findServiceConfigRecord(
    document.issuerCnpj,
    document.ambiente,
    "NFSE"
  );
  if (!issuer || !serviceConfig?.active || !isGuairaIpmConfig(issuer, serviceConfig)) {
    return {
      document,
      transmitted: false,
      error: "Configuracao NFS-e Guaira/IPM nao encontrada para consulta."
    };
  }
  if (!serviceConfig.secretsEncrypted) {
    return {
      document,
      transmitted: false,
      error: "Senha municipal IPM nao configurada para consulta."
    };
  }

  const settings = resolveConfig(issuer, serviceConfig);
  const verificationCode = String(document.protocolo ?? "").trim();
  let requestXml = "";
  try {
    validateConfig(settings);
    requestXml = buildGuairaIpmConsultationXml(verificationCode);
    const secret = decryptSecretPayload<{ senha?: string }>(
      serviceConfig.secretsEncrypted,
      config.certificateEncryptionKey
    );
    const password = String(secret.senha ?? "");
    if (!password) {
      throw new Error("Senha municipal IPM vazia.");
    }

    const response = await postIpmRequest(
      validateIpmEndpoint(settings.endpoint),
      buildGuairaIpmMultipartRequest(requestXml),
      buildGuairaIpmBasicAuthorization(settings.cnpj, password)
    );
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`IPM respondeu HTTP ${response.status} na consulta.`);
    }
    const parsed = parseGuairaIpmResponse(response.body);
    const issued = parsed.success && parsed.statusCode === "1";
    const cancelled =
      Boolean(parsed.number) &&
      parsed.statusCode === "2" &&
      /cancelad/i.test(parsed.statusDescription);
    if (!issued && !cancelled) {
      const providerMessage =
        parsed.messages.map((message) => message.descricao).join("; ") ||
        parsed.statusDescription ||
        "Resposta IPM sem confirmacao explicita da situacao da NFS-e.";
      throw new Error(providerMessage);
    }

    const reason = parsed.statusDescription || (cancelled ? "Cancelada" : "Emitida");
    const updated = store.saveMunicipalProcessingResult(document.id, {
      providerName: "guaira-ipm",
      requestBody: requestXml,
      responseBody: response.body,
      status: cancelled ? "cancelado" : "autorizado",
      reason,
      reasonCode: parsed.statusCode,
      protocol: parsed.verificationCode || verificationCode,
      providerDocumentNumber: parsed.number || document.chave,
      processedXml: response.body
    });
    if (updated) {
      updated.mensagens = parsed.messages;
    }
    store.addDocumentEvent(document.id, {
      eventType: "nfse_guaira_ipm_consultation_completed",
      message: `Consulta IPM confirmou NFS-e ${reason.toLowerCase()}.`,
      payload: {
        provider: "guaira-ipm",
        statusCode: parsed.statusCode,
        providerDocumentNumber: parsed.number || document.chave
      }
    });
    await store.waitForPersistence();
    return { document: updated ?? document, transmitted: true, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    store.addDocumentEvent(document.id, {
      eventType: "nfse_guaira_ipm_consultation_failed",
      level: "warn",
      message,
      payload: { provider: "guaira-ipm" }
    });
    await store.waitForPersistence();
    return { document, transmitted: false, error: message };
  }
}

function validateDraft(draft: GuairaIpmDraft) {
  const missing: string[] = [];
  if (!draft.customerDocument) missing.push("documento do tomador");
  if (!draft.customerName) missing.push("nome do tomador");
  if (!draft.customerStreet) missing.push("logradouro do tomador");
  if (!draft.customerNumber) missing.push("numero do tomador");
  if (!draft.customerDistrict) missing.push("bairro do tomador");
  if (!draft.customerCityCode) missing.push("cidade do tomador");
  if (draft.customerPostalCode.length !== 8) missing.push("CEP do tomador");
  if (draft.serviceValue <= 0) missing.push("valor do servico");
  if (!draft.serviceCode) missing.push("codigo do servico");
  if (!draft.activityCode) missing.push("codigo de atividade");
  if (!draft.description) missing.push("descricao do servico");
  if (draft.aliquotaIss <= 0) missing.push("aliquota ISS");
  if (missing.length) {
    throw new Error(`Payload NFS-e Guaira/IPM incompleto: ${missing.join(", ")}.`);
  }
}

export async function processGuairaIpmNfse(
  store: InMemoryStore,
  documentId: string
): Promise<GuairaNfseProcessingResult> {
  const document = store.findDocument(documentId, "NFSe");
  if (!document) {
    throw new Error("Documento NFS-e nao encontrado para processamento.");
  }
  if (document.ambiente !== "homologacao") {
    return { document, transmitted: false, error: null };
  }

  const issuer = store.findIssuerByCnpj(document.issuerCnpj, document.ambiente);
  const serviceConfig = store.findServiceConfigRecord(
    document.issuerCnpj,
    document.ambiente,
    "NFSE"
  );
  if (!issuer || !serviceConfig?.active || !isGuairaIpmConfig(issuer, serviceConfig)) {
    const message = "Configuracao NFS-e Guaira/IPM nao encontrada para este emitente.";
    const failed = store.failDocument(document.id, "CONFIGURACAO_NFSE", message);
    await store.waitForPersistence();
    return { document: failed ?? document, transmitted: false, error: message };
  }

  try {
    const settings = resolveConfig(issuer, serviceConfig);
    const draft = normalizeGuairaIpmDraft(document, settings);
    validateConfig(settings);
    validateDraft(draft);
    const generatedXml = buildGuairaIpmEmissionXml(settings, draft);
    const reason = settings.autoTransmit
      ? "XML NFS-e Guaira/IPM gerado, mas a transmissao permanece bloqueada ate autorizacao explicita."
      : "XML NFS-e Guaira/IPM gerado em dry-run.";
    const updated = store.saveMunicipalProcessingResult(document.id, {
      providerName: "guaira-ipm",
      generatedXml,
      requestBody: generatedXml,
      providerReference: draft.identifier,
      status: "processamento",
      reason,
      reasonCode: settings.autoTransmit
        ? "NFSE_IPM_TRANSMISSION_BLOCKED"
        : "NFSE_IPM_DRY_RUN",
      signatureValid: false,
      xsdValid: false,
      xsdErrors: []
    });
    store.addDocumentEvent(document.id, {
      eventType: "nfse_guaira_ipm_dry_run",
      message: reason,
      payload: {
        provider: "guaira-ipm",
        endpointConfigured: Boolean(settings.endpoint),
        tomCode: settings.tomCode,
        serviceCode: draft.serviceCode,
        activityCode: draft.activityCode,
        taxSituation: draft.taxSituation,
        aliquotaIss: draft.aliquotaIss,
        testMode: settings.testMode,
        transmissionRequested: settings.autoTransmit
      }
    });
    await store.waitForPersistence();
    return { document: updated ?? document, transmitted: false, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    store.addDocumentEvent(document.id, {
      eventType: "nfse_guaira_ipm_processing_failed",
      level: "error",
      message,
      payload: { provider: "guaira-ipm" }
    });
    const failed = store.failDocument(document.id, "NFSE_GUAIRA_IPM", message);
    await store.waitForPersistence();
    return { document: failed ?? document, transmitted: false, error: message };
  }
}
