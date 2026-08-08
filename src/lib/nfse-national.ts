import { DOMParser } from "@xmldom/xmldom";
import { SignedXml } from "xml-crypto";

import { config } from "../config.js";
import type { InMemoryStore } from "../store.js";
import type {
  DocumentRecord,
  Environment,
  Issuer,
  ServiceConfig
} from "../types.js";
import { resolveNfseProvider, validateNfseRuntimePolicy } from "./nfse-rules.js";
import { openEncryptedCertificate } from "./certificates.js";
import {
  consultNationalDps as consultNationalDpsAtSefin,
  consultNationalNfse as consultNationalNfseAtSefin,
  transmitNationalCancellation,
  transmitNationalDps
} from "./nfse-national-sefin.js";
import {
  validateNationalCancellationEventXml,
  validateNationalDpsXml
} from "./nfse-national-xsd-validator.js";

export const NFSE_NATIONAL_LAYOUT_VERSION = "1.01";
export const NFSE_NATIONAL_SCHEMA_RELEASE = "20260727";
export const NFSE_NATIONAL_NAMESPACE =
  "http://www.sped.fazenda.gov.br/nfse";
export const NFSE_NATIONAL_RESTRICTED_ENDPOINT =
  "https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional";
export const NFSE_NATIONAL_PRODUCTION_ENDPOINT =
  "https://sefin.nfse.gov.br/SefinNacional";

const XMLDSIG = "http://www.w3.org/2000/09/xmldsig#";
const C14N = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
const ENVELOPED = `${XMLDSIG}enveloped-signature`;
const SHA256 = "http://www.w3.org/2001/04/xmlenc#sha256";
const RSA_SHA256 = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";

export type NationalNfseConfig = {
  environment: Environment;
  municipalityCode: string;
  municipalRegistration: string;
  dpsSeries: string;
  layoutVersion: string;
  nationalTaxCode: string;
  municipalTaxCode: string;
  nbsCode: string;
  simpleOption: "1" | "2" | "3";
  simpleTaxRegime: "1" | "2" | "3" | "";
  specialTaxRegime: "0" | "1" | "2" | "3" | "4" | "5" | "6" | "9";
  issTaxation: "1" | "2" | "3" | "4";
  issRetention: "1" | "2" | "3";
};

export type NationalNfseDraft = {
  id: string;
  environmentType: "1" | "2";
  issuedAt: string;
  competenceDate: string;
  applicationVersion: string;
  series: string;
  number: string;
  municipalityCode: string;
  issuerCnpj: string;
  municipalRegistration: string;
  simpleOption: NationalNfseConfig["simpleOption"];
  simpleTaxRegime: NationalNfseConfig["simpleTaxRegime"];
  specialTaxRegime: NationalNfseConfig["specialTaxRegime"];
  customerDocument: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerMunicipalityCode: string;
  customerPostalCode: string;
  customerStreet: string;
  customerNumber: string;
  customerComplement: string;
  customerDistrict: string;
  serviceMunicipalityCode: string;
  nationalTaxCode: string;
  municipalTaxCode: string;
  description: string;
  nbsCode: string;
  internalServiceCode: string;
  serviceValue: number;
  issTaxation: NationalNfseConfig["issTaxation"];
  issRetention: NationalNfseConfig["issRetention"];
  issRate: number;
};

export type NationalNfseProcessingResult = {
  document: DocumentRecord;
  transmitted: boolean;
  error: string | null;
};

export type SignedNationalDpsResult = {
  unsignedXml: string;
  signedXml: string;
  signatureValid: boolean;
};

export type NationalCancellationResult = {
  document: DocumentRecord;
  transmitted: boolean;
  error: string | null;
};

function asRecord(value: unknown) {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function digitsOnly(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function numberFrom(value: unknown, fallback = 0) {
  const normalized = typeof value === "string" ? value.replace(",", ".") : value;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function validDigits(value: unknown, length: number, fallback = "") {
  const candidate = digitsOnly(value);
  if (candidate.length === length) return candidate;

  const configured = digitsOnly(fallback);
  return configured.length === length ? configured : "";
}

function escapeXml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function optionalTag(name: string, value: unknown) {
  const text = String(value ?? "").trim();
  return text ? `<${name}>${escapeXml(text)}</${name}>` : "";
}

function certificateBody(certificatePem: string) {
  return certificatePem
    .replace(/-----BEGIN CERTIFICATE-----/g, "")
    .replace(/-----END CERTIFICATE-----/g, "")
    .replace(/\s+/g, "");
}

function localDateTime(value: unknown) {
  const text = String(value ?? "").trim();
  const match = text.match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2}))?([+-]\d{2}:\d{2})$/
  );
  if (match) return `${match[1]}:${match[2] ?? "00"}${match[3]}`;

  const parsed = text ? new Date(text) : new Date();
  const valid = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const saoPaulo = new Date(valid.getTime() - 3 * 60 * 60 * 1000);
  return `${saoPaulo.toISOString().slice(0, 19)}-03:00`;
}

function makeDpsId(input: {
  municipalityCode: string;
  issuerCnpj: string;
  series: string;
  number: string;
}) {
  return [
    "DPS",
    input.municipalityCode,
    "2",
    input.issuerCnpj.toUpperCase().padStart(14, "0"),
    input.series.padStart(5, "0"),
    input.number.padStart(15, "0")
  ].join("");
}

export function resolveNationalSefinEndpoint(
  environment: Environment,
  _configuredEndpoint?: unknown
) {
  // O endpoint da SEFIN Nacional nao e parametrizavel por empresa: aceitar
  // uma URL arbitraria aqui permitiria enviar DPS e certificado para terceiro.
  return environment === "homologacao"
    ? NFSE_NATIONAL_RESTRICTED_ENDPOINT
    : NFSE_NATIONAL_PRODUCTION_ENDPOINT;
}

export function isNationalNfseConfig(
  issuer: Issuer | null,
  serviceConfig: ServiceConfig | null
) {
  return resolveNfseProvider({ issuer, serviceConfig }) === "nfse-nacional";
}

export function resolveNationalNfseConfig(
  issuer: Issuer,
  serviceConfig: ServiceConfig
): NationalNfseConfig {
  const settings = serviceConfig.settings;
  return {
    environment: serviceConfig.ambiente,
    municipalityCode: digitsOnly(settings.nfseMunicipalityCode),
    municipalRegistration: firstText(settings.nfseInscricaoMunicipal),
    dpsSeries: firstText(settings.nfseNationalDpsSerie, settings.nfseRpsSerie, "1"),
    layoutVersion: firstText(
      settings.nfseNationalLayoutVersion,
      NFSE_NATIONAL_LAYOUT_VERSION
    ),
    nationalTaxCode: digitsOnly(settings.nfseNationalTaxCode),
    municipalTaxCode: digitsOnly(settings.nfseNationalMunicipalTaxCode),
    nbsCode: digitsOnly(settings.nfseNationalNbsCode),
    simpleOption: settings.nfseNationalSimpleOption ?? "3",
    simpleTaxRegime: settings.nfseNationalSimpleTaxRegime ?? "1",
    specialTaxRegime: settings.nfseNationalSpecialTaxRegime ?? "0",
    issTaxation: settings.nfseNationalIssTaxation ?? "1",
    issRetention: settings.nfseNationalIssRetention ?? "1"
  };
}

export function normalizeNationalNfseDraft(
  document: Pick<
    DocumentRecord,
    "ambiente" | "issuerCnpj" | "numero" | "serie" | "payloadOriginal"
  >,
  config: NationalNfseConfig
): NationalNfseDraft {
  const body = asRecord(document.payloadOriginal);
  const infDpsCandidate = asRecord(body.infDPS);
  const infDps = Object.keys(infDpsCandidate).length ? infDpsCandidate : body;
  const prest = asRecord(infDps.prest ?? infDps.prestador);
  const regTrib = asRecord(prest.regTrib);
  const toma = asRecord(infDps.toma ?? infDps.tomador);
  const address = asRecord(toma.end ?? toma.endereco);
  const nationalAddress = asRecord(address.endNac);
  const service = asRecord(infDps.serv ?? infDps.servico);
  const serviceLocation = asRecord(service.locPrest);
  const serviceCode = asRecord(service.cServ);
  const values = asRecord(infDps.valores);
  const serviceValues = asRecord(values.vServPrest);
  const taxes = asRecord(values.trib);
  const municipalTaxes = asRecord(taxes.tribMun);
  const issuedAt = localDateTime(infDps.dhEmi);
  const series = digitsOnly(firstText(infDps.serie, config.dpsSeries, document.serie));
  const number = digitsOnly(firstText(infDps.nDPS, document.numero));
  const issuerCnpj = String(document.issuerCnpj).replace(/[^0-9A-Za-z]/g, "");
  const municipalityCode = digitsOnly(firstText(infDps.cLocEmi, config.municipalityCode));
  const customerDocument = digitsOnly(
    firstText(toma.CNPJ, toma.CPF, toma.cnpj, toma.cpf, toma.cpf_cnpj)
  );
  const simpleOption = (firstText(regTrib.opSimpNac, config.simpleOption) || "3") as NationalNfseConfig["simpleOption"];
  const simpleTaxRegime = firstText(
    regTrib.regApTribSN,
    config.simpleTaxRegime
  ) as NationalNfseConfig["simpleTaxRegime"];
  const issTaxation = (firstText(
    municipalTaxes.tribISSQN,
    config.issTaxation
  ) || "1") as NationalNfseConfig["issTaxation"];
  const issRetention = (firstText(
    municipalTaxes.tpRetISSQN,
    config.issRetention
  ) || "1") as NationalNfseConfig["issRetention"];
  // RTC: para ME/EPP do Simples que apura ISS pelo Simples e nao tem
  // retencao, a SEFIN rejeita pAliq (E0625). O payload municipal legado
  // costuma enviar essa aliquota, portanto ela deve ser descartada aqui.
  const omitsIssRateForSimpleNational =
    simpleOption === "3" &&
    simpleTaxRegime === "1" &&
    issTaxation === "1" &&
    issRetention === "1";

  return {
    id: makeDpsId({ municipalityCode, issuerCnpj, series, number }),
    environmentType: document.ambiente === "producao" ? "1" : "2",
    issuedAt,
    competenceDate: firstText(infDps.dCompet, issuedAt.slice(0, 10)),
    applicationVersion: firstText(infDps.verAplic, "NuvemLocalFiscal-0.1"),
    series,
    number,
    municipalityCode,
    issuerCnpj,
    municipalRegistration: firstText(prest.IM, config.municipalRegistration),
    simpleOption,
    simpleTaxRegime,
    specialTaxRegime: (firstText(
      regTrib.regEspTrib,
      config.specialTaxRegime
    ) || "0") as NationalNfseConfig["specialTaxRegime"],
    customerDocument,
    customerName: firstText(toma.xNome, toma.nome, toma.razao_social),
    customerEmail: firstText(toma.email),
    customerPhone: digitsOnly(firstText(toma.fone, toma.telefone)),
    customerMunicipalityCode: digitsOnly(
      firstText(nationalAddress.cMun, address.cMun, address.codigo_municipio)
    ),
    customerPostalCode: digitsOnly(
      firstText(nationalAddress.CEP, address.CEP, address.cep)
    ),
    customerStreet: firstText(address.xLgr, address.logradouro),
    customerNumber: firstText(address.nro, address.numero),
    customerComplement: firstText(address.xCpl, address.complemento),
    customerDistrict: firstText(address.xBairro, address.bairro),
    serviceMunicipalityCode: digitsOnly(
      firstText(
        serviceLocation.cLocPrestacao,
        municipalTaxes.cLocIncid,
        municipalityCode
      )
    ),
    // Os clientes mantêm os códigos do conector municipal no payload comum
    // (por exemplo, cTribNac=14.01 e cTribMun=14.01.01.000). A DPS Nacional
    // exige, respectivamente, 6 e 3 dígitos. Quando o recebido não pertence
    // ao leiaute Nacional, a configuração da empresa é a fonte de verdade;
    // código municipal inválido simplesmente não é levado para a DPS.
    nationalTaxCode: validDigits(
      firstText(serviceCode.cTribNac, serviceCode.codigo_tributacao_nacional),
      6,
      config.nationalTaxCode
    ),
    municipalTaxCode: validDigits(
      firstText(serviceCode.cTribMun, serviceCode.codigo_tributacao_municipal),
      3,
      config.municipalTaxCode
    ),
    description: firstText(
      serviceCode.xDescServ,
      serviceCode.descricao,
      "Servico prestado"
    ),
    nbsCode: digitsOnly(
      firstText(
        serviceCode.cNBS,
        serviceCode.codigo_nbs,
        serviceCode.nbs,
        config.nbsCode
      )
    ),
    internalServiceCode: firstText(
      serviceCode.cIntContrib,
      serviceCode.codigo_interno
    ).replace(/[^0-9A-Za-z]/g, ""),
    serviceValue: numberFrom(
      serviceValues.vServ ?? values.valor_servico ?? service.valor
    ),
    issTaxation,
    issRetention,
    issRate: omitsIssRateForSimpleNational ? 0 : numberFrom(municipalTaxes.pAliq)
  };
}

export function validateNationalNfseDraft(draft: NationalNfseDraft) {
  const errors: string[] = [];
  if (!/^DPS[0-9]{7}2[0-9A-Z]{14}[0-9]{20}$/.test(draft.id)) {
    errors.push("identificador DPS invalido");
  }
  if (!/^[0-9]{7}$/.test(draft.municipalityCode)) {
    errors.push("codigo IBGE do municipio emissor");
  }
  if (!/^[0-9A-Z]{14}$/.test(draft.issuerCnpj)) errors.push("CNPJ do prestador");
  if (draft.municipalRegistration.length > 15) {
    errors.push("inscricao municipal do prestador");
  }
  if (!/^(?:[0-9]{1,4}|[0-8][0-9]{4})$/.test(draft.series)) {
    errors.push("serie da DPS");
  }
  if (!/^[1-9][0-9]{0,14}$/.test(draft.number)) errors.push("numero da DPS");
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:-(?:0[0-9]|10|11):00|\+(?:0[0-9]|10|11):00|\+12:00)$/.test(
      draft.issuedAt
    )
  ) {
    errors.push("data e hora de emissao com fuso horario valido");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.competenceDate)) {
    errors.push("data de competencia");
  }
  if (!/^[0-9]{7}$/.test(draft.serviceMunicipalityCode)) {
    errors.push("municipio da prestacao");
  }
  if (!/^[0-9]{6}$/.test(draft.nationalTaxCode)) {
    errors.push("codigo de tributacao nacional com 6 digitos");
  }
  if (draft.municipalTaxCode && !/^[0-9]{3}$/.test(draft.municipalTaxCode)) {
    errors.push("codigo de tributacao municipal com 3 digitos");
  }
  if (draft.nbsCode && !/^[0-9]{9}$/.test(draft.nbsCode)) {
    errors.push("codigo NBS com 9 digitos");
  }
  if (!draft.description) errors.push("descricao do servico");
  if (draft.description.length > 2000) errors.push("descricao do servico com no maximo 2000 caracteres");
  if (!(draft.serviceValue > 0)) errors.push("valor do servico");
  if (!Number.isFinite(draft.issRate) || draft.issRate < 0 || draft.issRate > 9.99) {
    errors.push("aliquota ISS entre 0,00 e 9,99");
  }
  if (draft.customerPhone && !/^[0-9]{6,20}$/.test(draft.customerPhone)) {
    errors.push("telefone do tomador com 6 a 20 digitos");
  }
  if (draft.customerEmail && (draft.customerEmail.length > 80 || /\s/.test(draft.customerEmail))) {
    errors.push("email do tomador com no maximo 80 caracteres e sem espacos");
  }
  if (draft.customerDocument && ![11, 14].includes(draft.customerDocument.length)) {
    errors.push("CPF/CNPJ do tomador");
  }
  if (draft.customerDocument && !draft.customerName) errors.push("nome do tomador");
  if (errors.length) {
    throw new Error(`Payload NFS-e Nacional incompleto: ${errors.join(", ")}.`);
  }
}

function buildCustomerXml(draft: NationalNfseDraft) {
  if (!draft.customerDocument) return "";
  const documentTag = draft.customerDocument.length === 14 ? "CNPJ" : "CPF";
  const addressComplete =
    /^[0-9]{7}$/.test(draft.customerMunicipalityCode) &&
    /^[0-9]{8}$/.test(draft.customerPostalCode) &&
    draft.customerStreet &&
    draft.customerNumber &&
    draft.customerDistrict;
  const addressXml = addressComplete
    ? `<end><endNac><cMun>${draft.customerMunicipalityCode}</cMun><CEP>${draft.customerPostalCode}</CEP></endNac><xLgr>${escapeXml(draft.customerStreet)}</xLgr><nro>${escapeXml(draft.customerNumber)}</nro>${optionalTag("xCpl", draft.customerComplement)}<xBairro>${escapeXml(draft.customerDistrict)}</xBairro></end>`
    : "";
  return `<toma><${documentTag}>${draft.customerDocument}</${documentTag}><xNome>${escapeXml(draft.customerName)}</xNome>${addressXml}${optionalTag("fone", draft.customerPhone)}${optionalTag("email", draft.customerEmail)}</toma>`;
}

export function buildNationalDpsXml(
  config: NationalNfseConfig,
  draft: NationalNfseDraft
) {
  if (config.layoutVersion !== NFSE_NATIONAL_LAYOUT_VERSION) {
    throw new Error(
      `Versao de leiaute NFS-e Nacional nao suportada: ${config.layoutVersion}.`
    );
  }
  validateNationalNfseDraft(draft);
  const simpleTaxRegime =
    draft.simpleOption === "3" && draft.simpleTaxRegime
      ? `<regApTribSN>${draft.simpleTaxRegime}</regApTribSN>`
      : "";
  const municipalTaxCode = optionalTag("cTribMun", draft.municipalTaxCode);
  const municipalRegistration = optionalTag("IM", draft.municipalRegistration);
  const nbsCode = optionalTag("cNBS", draft.nbsCode);
  const internalServiceCode = optionalTag("cIntContrib", draft.internalServiceCode);
  const issRate = draft.issRate > 0 ? `<pAliq>${draft.issRate.toFixed(2)}</pAliq>` : "";
  const totalTaxes = draft.simpleOption === "3"
    ? "<totTrib><pTotTribSN>0.00</pTotTribSN></totTrib>"
    : "<totTrib><indTotTrib>0</indTotTrib></totTrib>";

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<DPS xmlns="${NFSE_NATIONAL_NAMESPACE}" versao="${escapeXml(config.layoutVersion)}">`,
    `<infDPS Id="${draft.id}">`,
    `<tpAmb>${draft.environmentType}</tpAmb>`,
    `<dhEmi>${draft.issuedAt}</dhEmi>`,
    `<verAplic>${escapeXml(draft.applicationVersion)}</verAplic>`,
    `<serie>${draft.series}</serie>`,
    `<nDPS>${draft.number}</nDPS>`,
    `<dCompet>${draft.competenceDate}</dCompet>`,
    "<tpEmit>1</tpEmit>",
    `<cLocEmi>${draft.municipalityCode}</cLocEmi>`,
    `<prest><CNPJ>${draft.issuerCnpj}</CNPJ>${municipalRegistration}<regTrib><opSimpNac>${draft.simpleOption}</opSimpNac>${simpleTaxRegime}<regEspTrib>${draft.specialTaxRegime}</regEspTrib></regTrib></prest>`,
    buildCustomerXml(draft),
    `<serv><locPrest><cLocPrestacao>${draft.serviceMunicipalityCode}</cLocPrestacao></locPrest><cServ><cTribNac>${draft.nationalTaxCode}</cTribNac>${municipalTaxCode}<xDescServ>${escapeXml(draft.description)}</xDescServ>${nbsCode}${internalServiceCode}</cServ></serv>`,
    `<valores><vServPrest><vServ>${draft.serviceValue.toFixed(2)}</vServ></vServPrest><trib><tribMun><tribISSQN>${draft.issTaxation}</tribISSQN><tpRetISSQN>${draft.issRetention}</tpRetISSQN>${issRate}</tribMun>${totalTaxes}</trib></valores>`,
    "</infDPS>",
    "</DPS>"
  ].join("");
}

export function signNationalDpsXml(input: {
  unsignedXml: string;
  privateKeyPem: string;
  certificatePem: string;
}): SignedNationalDpsResult {
  const signer = new SignedXml({
    privateKey: input.privateKeyPem,
    publicCert: input.certificatePem,
    getKeyInfoContent: () =>
      `<X509Data><X509Certificate>${certificateBody(input.certificatePem)}</X509Certificate></X509Data>`
  });
  signer.addReference({
    xpath: "//*[local-name(.)='infDPS']",
    digestAlgorithm: SHA256,
    transforms: [ENVELOPED, C14N]
  });
  signer.canonicalizationAlgorithm = C14N;
  signer.signatureAlgorithm = RSA_SHA256;
  signer.computeSignature(input.unsignedXml, {
    location: { reference: "//*[local-name(.)='infDPS']", action: "after" }
  });
  const signedXml = signer.getSignedXml();
  const xml = new DOMParser().parseFromString(signedXml, "application/xml");
  const signatureNode = xml.getElementsByTagNameNS(XMLDSIG, "Signature").item(0);
  if (!signatureNode) {
    throw new Error("A assinatura XML da DPS nao foi inserida.");
  }
  const verifier = new SignedXml({
    publicCert: input.certificatePem,
    getCertFromKeyInfo: () => null
  });
  verifier.loadSignature(signatureNode);
  return {
    unsignedXml: input.unsignedXml,
    signedXml,
    signatureValid: verifier.checkSignature(signedXml)
  };
}

export function buildNationalCancellationEventXml(input: {
  environmentType: "1" | "2";
  eventAt: string;
  applicationVersion: string;
  issuerCnpj: string;
  accessKey: string;
  reasonCode: "1" | "2" | "9";
  reason: string;
}) {
  const eventId = `PRE${input.accessKey}101101`;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<pedRegEvento xmlns="${NFSE_NATIONAL_NAMESPACE}" versao="1.01">`,
    `<infPedReg Id="${eventId}">`,
    `<tpAmb>${input.environmentType}</tpAmb>`,
    `<verAplic>${escapeXml(input.applicationVersion)}</verAplic>`,
    `<dhEvento>${escapeXml(input.eventAt)}</dhEvento>`,
    `<CNPJAutor>${input.issuerCnpj}</CNPJAutor>`,
    `<chNFSe>${input.accessKey}</chNFSe>`,
    "<e101101>",
    "<xDesc>Cancelamento de NFS-e</xDesc>",
    `<cMotivo>${input.reasonCode}</cMotivo>`,
    `<xMotivo>${escapeXml(input.reason)}</xMotivo>`,
    "</e101101>",
    "</infPedReg>",
    "</pedRegEvento>"
  ].join("");
}

export function signNationalCancellationEventXml(input: {
  unsignedXml: string;
  privateKeyPem: string;
  certificatePem: string;
}): SignedNationalDpsResult {
  const signer = new SignedXml({
    privateKey: input.privateKeyPem,
    publicCert: input.certificatePem,
    getKeyInfoContent: () =>
      `<X509Data><X509Certificate>${certificateBody(input.certificatePem)}</X509Certificate></X509Data>`
  });
  signer.addReference({
    xpath: "//*[local-name(.)='infPedReg']",
    digestAlgorithm: SHA256,
    transforms: [ENVELOPED, C14N]
  });
  signer.canonicalizationAlgorithm = C14N;
  signer.signatureAlgorithm = RSA_SHA256;
  signer.computeSignature(input.unsignedXml, {
    location: { reference: "//*[local-name(.)='infPedReg']", action: "after" }
  });
  const signedXml = signer.getSignedXml();
  const xml = new DOMParser().parseFromString(signedXml, "application/xml");
  const signatureNode = xml.getElementsByTagNameNS(XMLDSIG, "Signature").item(0);
  if (!signatureNode) throw new Error("A assinatura XML do evento Nacional nao foi inserida.");
  const verifier = new SignedXml({
    publicCert: input.certificatePem,
    getCertFromKeyInfo: () => null
  });
  verifier.loadSignature(signatureNode);
  return {
    unsignedXml: input.unsignedXml,
    signedXml,
    signatureValid: verifier.checkSignature(signedXml)
  };
}

function cancellationReasonCode(value: unknown): "1" | "2" | "9" {
  const code = String(value ?? "9").trim();
  if (code === "1" || code === "2" || code === "9") return code;
  throw new Error("Codigo de motivo Nacional invalido. Use 1, 2 ou 9.");
}

export async function cancelNationalNfse(
  store: InMemoryStore,
  documentId: string,
  reason: string,
  reasonCode: unknown = "9"
): Promise<NationalCancellationResult> {
  const document = store.findDocument(documentId, "NFSe");
  if (!document) throw new Error("Documento NFS-e nao encontrado para cancelamento.");
  if (document.status === "cancelado") return { document, transmitted: false, error: null };
  if (document.status !== "autorizado") {
    throw new Error("Somente uma NFS-e autorizada pode ser cancelada.");
  }
  const runtimePolicy = validateNfseRuntimePolicy({
    provider: "nfse-nacional",
    ambiente: document.ambiente,
    operation: "cancelamento"
  });
  if (!runtimePolicy.allowed) {
    throw new Error(runtimePolicy.reason ?? "Cancelamento Nacional bloqueado pelo motor de regras.");
  }
  const issuer = store.findIssuerByCnpj(document.issuerCnpj, document.ambiente);
  const serviceConfig = store.findServiceConfigRecord(document.issuerCnpj, document.ambiente, "NFSE");
  const certificate = store.findActiveCertificate(document.issuerCnpj);
  if (!issuer || !serviceConfig?.active || !isNationalNfseConfig(issuer, serviceConfig)) {
    throw new Error("Configuracao NFS-e Nacional nao encontrada.");
  }
  if (!certificate?.encryptedBundle) {
    throw new Error("Certificado A1 ativo nao encontrado para cancelar NFS-e Nacional.");
  }
  const accessKey = String(document.chave ?? "").trim();
  if (!/^\d{50}$/.test(accessKey)) {
    throw new Error("Chave de acesso da NFS-e Nacional invalida para cancelamento.");
  }
  const cleanReason = String(reason ?? "").trim();
  if (cleanReason.length < 15 || cleanReason.length > 255) {
    throw new Error("O motivo do cancelamento deve ter entre 15 e 255 caracteres.");
  }
  const code = cancellationReasonCode(reasonCode);
  const opened = openEncryptedCertificate(certificate.encryptedBundle, config.certificateEncryptionKey);
  const unsignedXml = buildNationalCancellationEventXml({
    environmentType: document.ambiente === "producao" ? "1" : "2",
    eventAt: localDateTime(new Date().toISOString()),
    applicationVersion: "NuvemLocalFiscal_1",
    issuerCnpj: document.issuerCnpj,
    accessKey,
    reasonCode: code,
    reason: cleanReason
  });
  const signed = signNationalCancellationEventXml({
    unsignedXml,
    privateKeyPem: opened.privateKeyPem,
    certificatePem: opened.certificatePem
  });
  if (!signed.signatureValid) throw new Error("A assinatura do evento Nacional nao foi validada.");
  const xsd = validateNationalCancellationEventXml(signed.signedXml);
  if (!xsd.valid) {
    throw new Error(`Evento Nacional de cancelamento reprovado no XSD: ${xsd.errors.join(" | ")}`);
  }

  // Persiste o XML assinado antes de qualquer I/O externo. Assim, timeout ou
  // reinicio nao permitem retransmitir cegamente o mesmo evento.
  const prepared = store.prepareNationalCancellationAttempt({
    id: document.id,
    justification: cleanReason,
    requestXml: unsignedXml,
    signedXml: signed.signedXml
  });
  if (!prepared.document || !prepared.prepared) {
    return {
      document: prepared.document ?? document,
      transmitted: false,
      error: prepared.reason ?? "Nao foi possivel preparar o cancelamento Nacional."
    };
  }
  await store.waitForPersistence();

  try {
    const response = await transmitNationalCancellation({
      endpoint: resolveNationalSefinEndpoint(document.ambiente, serviceConfig.settings.nfseEndpoint),
      accessKey,
      signedEventXml: signed.signedXml,
      privateKeyPem: opened.privateKeyPem,
      certificatePem: opened.certificatePem,
      certificateChainPem: opened.certificateChainPem
    });
    const message = response.errors.map((item) => `${item.code}: ${item.description}`).join(" | ") ||
      response.eventReason ||
      `SEFIN Nacional retornou HTTP ${response.statusCode} no cancelamento.`;
    const responseHasUnconfirmedSuccess =
      response.statusCode >= 200 &&
      response.statusCode < 300 &&
      response.errors.some((item) => item.code.startsWith("SEFIN_EVENTO_STATUS_"));
    const saved = store.saveCancellationResult(document.id, {
      justification: cleanReason,
      requestXml: unsignedXml,
      signedXml: signed.signedXml,
      responseXml: response.rawBody,
      processedXml: response.processedXml ?? response.rawBody,
      statusCode: response.eventStatusCode || `HTTP_${response.statusCode}`,
      reason: response.accepted ? "NFS-e Nacional cancelada." : message,
      protocol: response.protocol ?? "",
      cancelledAt: response.accepted ? new Date().toISOString() : null,
      success: response.accepted,
      status: response.accepted ? undefined : "autorizado",
      state: response.accepted
        ? "confirmado"
        : responseHasUnconfirmedSuccess
          ? "pendente_confirmacao"
          : "rejeitado"
    });
    store.addDocumentEvent(document.id, {
      eventType: "nfse_nacional_cancellation_completed",
      level: response.accepted ? "info" : "warn",
      message: response.accepted ? "NFS-e Nacional cancelada." : message,
      payload: {
        provider: "nfse-nacional",
        eventCode: "101101",
        reasonCode: code,
        accessKey,
        httpStatus: response.statusCode,
        statusCode: response.eventStatusCode,
        success: response.accepted
      }
    });
    await store.waitForPersistence();
    return { document: saved ?? document, transmitted: true, error: response.accepted ? null : message };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const saved = store.saveCancellationResult(document.id, {
      justification: cleanReason,
      requestXml: unsignedXml,
      signedXml: signed.signedXml,
      responseXml: "",
      processedXml: "",
      statusCode: "PENDING_CONFIRMATION",
      reason: "Transmissao do cancelamento interrompida antes da confirmacao da SEFIN: " + message,
      protocol: "",
      success: false,
      status: "autorizado",
      state: "pendente_confirmacao"
    });
    store.addDocumentEvent(document.id, {
      eventType: "nfse_nacional_cancellation_failed",
      level: "error",
      message,
      payload: { provider: "nfse-nacional", eventCode: "101101", accessKey }
    });
    await store.waitForPersistence();
    return { document: saved ?? document, transmitted: true, error: message };
  }
}

export async function processNationalNfse(
  store: InMemoryStore,
  documentId: string
): Promise<NationalNfseProcessingResult> {
  const document = store.findDocument(documentId, "NFSe");
  if (!document) throw new Error("Documento NFS-e nao encontrado para processamento.");

  const runtimePolicy = validateNfseRuntimePolicy({
    provider: "nfse-nacional",
    ambiente: document.ambiente,
    operation: "emissao"
  });
  if (!runtimePolicy.allowed) {
    return {
      document,
      transmitted: false,
      error: runtimePolicy.reason ?? "Emissao nacional bloqueada pelo motor de regras."
    };
  }

  const issuer = store.findIssuerByCnpj(document.issuerCnpj, document.ambiente);
  const serviceConfig = store.findServiceConfigRecord(
    document.issuerCnpj,
    document.ambiente,
    "NFSE"
  );
  if (!issuer || !serviceConfig?.active || !isNationalNfseConfig(issuer, serviceConfig)) {
    const message = "Configuracao do Sistema Nacional NFS-e nao encontrada para este emitente.";
    const failed = store.failDocument(document.id, "CONFIGURACAO_NFSE", message);
    await store.waitForPersistence();
    return { document: failed ?? document, transmitted: false, error: message };
  }

  try {
    const nationalConfig = resolveNationalNfseConfig(issuer, serviceConfig);
    const draft = normalizeNationalNfseDraft(document, nationalConfig);
    const generatedXml = buildNationalDpsXml(nationalConfig, draft);
    const certificate = store.findActiveCertificate(document.issuerCnpj);
    if (!certificate?.encryptedBundle) {
      throw new Error("Certificado A1 ativo nao encontrado para assinar a DPS Nacional.");
    }
    const openedCertificate = openEncryptedCertificate(
      certificate.encryptedBundle,
      config.certificateEncryptionKey
    );
    const signed = signNationalDpsXml({
      unsignedXml: generatedXml,
      privateKeyPem: openedCertificate.privateKeyPem,
      certificatePem: openedCertificate.certificatePem
    });
    const xsd = validateNationalDpsXml(signed.signedXml);
    store.saveSignedXml(document.id, {
      accessKey: draft.id,
      unsignedXml: signed.unsignedXml,
      signedXml: signed.signedXml,
      signatureValid: signed.signatureValid,
      xsdValid: xsd.valid,
      xsdErrors: xsd.errors,
      certificateId: certificate.id
    });
    if (!signed.signatureValid) {
      throw new Error("A assinatura digital da DPS Nacional nao foi validada.");
    }
    if (!xsd.valid) {
      throw new Error(`DPS Nacional reprovada no XSD: ${xsd.errors.join(" | ")}`);
    }
    const autoTransmit = serviceConfig.settings.autoTransmit === true;
    let transmitted = false;
    let responseBody: string | null = null;
    let processedXml: string | null = null;
    let providerDocumentNumber: string | null = null;
    let reason =
      "DPS nacional gerada, assinada e validada localmente; transmissao ainda nao executada.";
    let reasonCode = "NFSE_NACIONAL_DPS_GENERATED";
    if (autoTransmit) {
      const transmission = await transmitNationalDps({
        endpoint: resolveNationalSefinEndpoint(document.ambiente, serviceConfig.settings.nfseEndpoint),
        signedDpsXml: signed.signedXml,
        privateKeyPem: openedCertificate.privateKeyPem,
        certificatePem: openedCertificate.certificatePem,
        certificateChainPem: openedCertificate.certificateChainPem
      });
      responseBody = transmission.rawBody;
      processedXml = transmission.nfseXml;
      providerDocumentNumber = transmission.accessKey;
      if (!transmission.accepted) {
        const errors = transmission.errors
          .map((item) => `${item.code}: ${item.description}${item.detail ? ` (${item.detail})` : ""}`)
          .join(" | ");
        throw new Error(errors || `SEFIN Nacional retornou HTTP ${transmission.statusCode}.`);
      }
      transmitted = true;
      reason = processedXml
        ? "NFS-e Nacional gerada pela SEFIN."
        : "DPS Nacional transmitida para a SEFIN; aguardando consulta de processamento.";
      reasonCode = processedXml
        ? "NFSE_NACIONAL_AUTHORIZED"
        : "NFSE_NACIONAL_DPS_TRANSMITTED";
    }
    const saved = store.saveMunicipalProcessingResult(document.id, {
      providerName: "nfse-nacional",
      generatedXml,
      signedXml: signed.signedXml,
      requestBody: generatedXml,
      responseBody,
      providerReference: draft.id,
      providerDocumentNumber,
      processedXml,
      status: processedXml ? "autorizado" : "processamento",
      reason,
      reasonCode
    });
    store.addDocumentEvent(document.id, {
      eventType: "nfse_nacional_dps_generated",
      message: reason,
      payload: {
        provider: "nfse-nacional",
        layoutVersion: nationalConfig.layoutVersion,
        schemaRelease: NFSE_NATIONAL_SCHEMA_RELEASE,
        municipalityCode: draft.municipalityCode,
        nationalTaxCode: draft.nationalTaxCode,
        nbsCode: draft.nbsCode || null,
        signatureValid: signed.signatureValid,
        xsdValid: xsd.valid,
        xsdSchema: xsd.schema,
        transmitted
      }
    });
    await store.waitForPersistence();
    return { document: saved ?? document, transmitted, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const reasonCode = /timeout|timed out|econn|enotfound|eai_again|socket|tls|certificate/i.test(message)
      ? "NFSE_NACIONAL_TRANSPORT_ERROR"
      : "NFSE_NACIONAL_PAYLOAD_INVALIDO";
    store.addDocumentEvent(document.id, {
      eventType: "nfse_nacional_processing_failed",
      level: "error",
      message,
      payload: { provider: "nfse-nacional" }
    });
    const failed = store.failDocument(document.id, reasonCode, message);
    await store.waitForPersistence();
    return { document: failed ?? document, transmitted: false, error: message };
  }
}

/**
 * Transmite uma DPS que ja foi gerada, assinada e validada localmente.
 * Esta operacao e deliberadamente separada do processamento normal: ela e
 * usada apenas pelo comando manual de homologacao e nunca habilita envio
 * automatico por configuracao.
 */
export async function transmitPreparedNationalDps(
  store: InMemoryStore,
  documentId: string
): Promise<NationalNfseProcessingResult> {
  const document = store.findDocument(documentId, "NFSe");
  if (!document) throw new Error("Documento NFS-e nao encontrado para transmissao.");
  if (document.ambiente !== "homologacao") {
    throw new Error("A transmissao manual da DPS Nacional e permitida somente em homologacao.");
  }
  if (document.status !== "processamento" || document.providerName !== "nfse-nacional") {
    throw new Error("Somente uma DPS Nacional pendente e assinada pode ser transmitida.");
  }
  if (!document.xmlSigned || !document.providerReference?.startsWith("DPS")) {
    throw new Error("DPS Nacional assinada ou seu identificador nao esta disponivel para transmissao.");
  }
  if (document.motivoStatus === "NFSE_NACIONAL_DPS_TRANSMITTED") {
    throw new Error("Esta DPS Nacional ja foi transmitida; consulte o processamento antes de nova tentativa.");
  }

  const issuer = store.findIssuerByCnpj(document.issuerCnpj, document.ambiente);
  const serviceConfig = store.findServiceConfigRecord(
    document.issuerCnpj,
    document.ambiente,
    "NFSE"
  );
  const certificate = store.findActiveCertificate(document.issuerCnpj);
  if (!issuer || !serviceConfig?.active || !isNationalNfseConfig(issuer, serviceConfig)) {
    throw new Error("Configuracao do Sistema Nacional NFS-e nao encontrada para este emitente.");
  }
  if (!certificate?.encryptedBundle) {
    throw new Error("Certificado A1 ativo nao encontrado para transmitir a DPS Nacional.");
  }

  try {
    const opened = openEncryptedCertificate(certificate.encryptedBundle, config.certificateEncryptionKey);
    const transmission = await transmitNationalDps({
      endpoint: resolveNationalSefinEndpoint(document.ambiente, serviceConfig.settings.nfseEndpoint),
      signedDpsXml: document.xmlSigned,
      privateKeyPem: opened.privateKeyPem,
      certificatePem: opened.certificatePem,
      certificateChainPem: opened.certificateChainPem
    });
    const errors = transmission.errors
      .map((item) => `${item.code}: ${item.description}${item.detail ? ` (${item.detail})` : ""}`)
      .join(" | ");
    if (!transmission.accepted) {
      const reason = errors || `SEFIN Nacional retornou HTTP ${transmission.statusCode}.`;
      const saved = store.saveMunicipalProcessingResult(document.id, {
        providerName: "nfse-nacional",
        responseBody: transmission.rawBody,
        status: "erro",
        reason,
        reasonCode: "NFSE_NACIONAL_DPS_REJECTED"
      });
      store.addDocumentEvent(document.id, {
        eventType: "nfse_nacional_dps_transmission_rejected",
        level: "error",
        message: reason,
        payload: { provider: "nfse-nacional", environment: "homologacao", statusCode: transmission.statusCode }
      });
      await store.waitForPersistence();
      return { document: saved ?? document, transmitted: false, error: reason };
    }

    const processed = Boolean(transmission.nfseXml);
    const reason = processed
      ? "NFS-e Nacional gerada pela SEFIN em homologacao."
      : "DPS Nacional transmitida para a SEFIN em homologacao; aguardando consulta de processamento.";
    const saved = store.saveMunicipalProcessingResult(document.id, {
      providerName: "nfse-nacional",
      responseBody: transmission.rawBody,
      providerDocumentNumber: transmission.accessKey,
      processedXml: transmission.nfseXml,
      status: processed ? "autorizado" : "processamento",
      reason,
      reasonCode: processed ? "NFSE_NACIONAL_AUTHORIZED" : "NFSE_NACIONAL_DPS_TRANSMITTED"
    });
    store.addDocumentEvent(document.id, {
      eventType: "nfse_nacional_dps_transmitted",
      message: reason,
      payload: {
        provider: "nfse-nacional",
        environment: "homologacao",
        dpsId: document.providerReference,
        accessKey: transmission.accessKey,
        immediateNfse: processed
      }
    });
    await store.waitForPersistence();
    return { document: saved ?? document, transmitted: true, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const saved = store.saveMunicipalProcessingResult(document.id, {
      providerName: "nfse-nacional",
      status: "processamento",
      reason: "Falha de transporte ao transmitir DPS Nacional; consulte a SEFIN antes de tentar novamente.",
      reasonCode: "NFSE_NACIONAL_TRANSPORT_UNCONFIRMED"
    });
    store.addDocumentEvent(document.id, {
      eventType: "nfse_nacional_dps_transmission_unconfirmed",
      level: "error",
      message,
      payload: { provider: "nfse-nacional", environment: "homologacao" }
    });
    await store.waitForPersistence();
    return { document: saved ?? document, transmitted: false, error: message };
  }
}

export async function consultNationalNfse(
  store: InMemoryStore,
  documentId: string
): Promise<NationalNfseProcessingResult> {
  const document = store.findDocument(documentId, "NFSe");
  if (!document) throw new Error("Documento NFS-e nao encontrado para consulta.");
  const issuer = store.findIssuerByCnpj(document.issuerCnpj, document.ambiente);
  const serviceConfig = store.findServiceConfigRecord(
    document.issuerCnpj,
    document.ambiente,
    "NFSE"
  );
  const certificate = store.findActiveCertificate(document.issuerCnpj);
  if (!issuer || !serviceConfig?.active || !isNationalNfseConfig(issuer, serviceConfig)) {
    return { document, transmitted: false, error: "Configuracao do Sistema Nacional NFS-e nao encontrada." };
  }
  if (!certificate?.encryptedBundle) {
    return { document, transmitted: false, error: "Certificado A1 ativo nao encontrado para consultar a SEFIN." };
  }
  const dpsId = String(document.providerReference ?? document.chave ?? "").trim();
  if (!dpsId.startsWith("DPS")) {
    return { document, transmitted: false, error: "Identificador DPS indisponivel para consulta." };
  }
  try {
    const opened = openEncryptedCertificate(certificate.encryptedBundle, config.certificateEncryptionKey);
    const endpoint = resolveNationalSefinEndpoint(document.ambiente, serviceConfig.settings.nfseEndpoint);
    const dps = await consultNationalDpsAtSefin({
      endpoint,
      dpsId,
      privateKeyPem: opened.privateKeyPem,
      certificatePem: opened.certificatePem,
      certificateChainPem: opened.certificateChainPem
    });
    if (!dps.accepted || !dps.accessKey) {
      const reason = dps.errors.map((item) => `${item.code}: ${item.description}`).join(" | ") ||
        "A SEFIN ainda nao disponibilizou a chave da NFS-e para esta DPS.";
      const saved = store.saveMunicipalProcessingResult(document.id, {
        providerName: "nfse-nacional",
        responseBody: dps.rawBody,
        status: "processamento",
        reason,
        reasonCode: "NFSE_NACIONAL_DPS_PENDING"
      });
      await store.waitForPersistence();
      return { document: saved ?? document, transmitted: false, error: null };
    }
    const nfse = await consultNationalNfseAtSefin({
      endpoint,
      accessKey: dps.accessKey,
      privateKeyPem: opened.privateKeyPem,
      certificatePem: opened.certificatePem,
      certificateChainPem: opened.certificateChainPem
    });
    if (!nfse.accepted || !nfse.nfseXml) {
      const reason = nfse.errors.map((item) => `${item.code}: ${item.description}`).join(" | ") ||
        "A chave foi localizada, mas o XML da NFS-e ainda nao foi disponibilizado.";
      const saved = store.saveMunicipalProcessingResult(document.id, {
        providerName: "nfse-nacional",
        responseBody: nfse.rawBody,
        providerDocumentNumber: dps.accessKey,
        status: "processamento",
        reason,
        reasonCode: "NFSE_NACIONAL_NFSE_PENDING"
      });
      await store.waitForPersistence();
      return { document: saved ?? document, transmitted: false, error: null };
    }
    const saved = store.saveMunicipalProcessingResult(document.id, {
      providerName: "nfse-nacional",
      responseBody: nfse.rawBody,
      providerDocumentNumber: dps.accessKey,
      processedXml: nfse.nfseXml,
      status: "autorizado",
      reason: "NFS-e Nacional recuperada da SEFIN.",
      reasonCode: "NFSE_NACIONAL_AUTHORIZED"
    });
    store.addDocumentEvent(document.id, {
      eventType: "nfse_nacional_consulted",
      message: "Consulta da DPS e da NFS-e concluida na SEFIN Nacional.",
      payload: { dpsId, accessKey: dps.accessKey }
    });
    await store.waitForPersistence();
    return { document: saved ?? document, transmitted: false, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { document, transmitted: false, error: message };
  }
}
