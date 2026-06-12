import { createHash, randomInt } from "node:crypto";

import { DOMParser } from "@xmldom/xmldom";
import { SignedXml } from "xml-crypto";

type JsonObject = Record<string, unknown>;

export type SignedNfeResult = {
  accessKey: string;
  unsignedXml: string;
  signedXml: string;
  signatureValid: boolean;
};

export type NfceQrCodeConfig = {
  cscId: string;
  csc: string;
  qrCodeBaseUrl: string;
  consultationUrl: string;
};

export type ResponsibleTechnicalCsrtConfig = {
  idCSRT: string;
  csrt: string;
};

const XMLDSIG = "http://www.w3.org/2000/09/xmldsig#";
const C14N = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
const ENVELOPED = `${XMLDSIG}enveloped-signature`;
const SHA1 = `${XMLDSIG}sha1`;
const RSA_SHA1 = `${XMLDSIG}rsa-sha1`;
const HOMOLOGATION_RECIPIENT_NAME =
  "NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL";
const HOMOLOGATION_FIRST_ITEM_DESCRIPTION =
  "NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL";

function escapeXml(value: unknown) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function onlyDigits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function fixedDigits(value: unknown, length: number) {
  return onlyDigits(value).padStart(length, "0").slice(-length);
}

const elementOrder: Record<string, string[]> = {
  emit: [
    "CNPJ",
    "CPF",
    "xNome",
    "xFant",
    "enderEmit",
    "IE",
    "IEST",
    "IM",
    "CNAE",
    "CRT"
  ],
  enderEmit: [
    "xLgr",
    "nro",
    "xCpl",
    "xBairro",
    "cMun",
    "xMun",
    "UF",
    "CEP",
    "cPais",
    "xPais",
    "fone"
  ],
  dest: [
    "CNPJ",
    "CPF",
    "idEstrangeiro",
    "xNome",
    "enderDest",
    "indIEDest",
    "IE",
    "ISUF",
    "IM",
    "email"
  ],
  enderDest: [
    "xLgr",
    "nro",
    "xCpl",
    "xBairro",
    "cMun",
    "xMun",
    "UF",
    "CEP",
    "cPais",
    "xPais",
    "fone"
  ],
  det: ["prod", "imposto", "impostoDevol", "infAdProd", "obsItem"],
  prod: [
    "cProd",
    "cEAN",
    "xProd",
    "NCM",
    "NVE",
    "CEST",
    "indEscala",
    "CNPJFab",
    "cBenef",
    "gCred",
    "EXTIPI",
    "CFOP",
    "uCom",
    "qCom",
    "vUnCom",
    "vProd",
    "cEANTrib",
    "uTrib",
    "qTrib",
    "vUnTrib",
    "vFrete",
    "vSeg",
    "vDesc",
    "vOutro",
    "indTot",
    "xPed",
    "nItemPed",
    "nFCI",
    "rastro",
    "infProdNFF"
  ],
  imposto: [
    "vTotTrib",
    "ICMS",
    "IPI",
    "II",
    "ISSQN",
    "PIS",
    "PISST",
    "COFINS",
    "COFINSST",
    "ICMSUFDest",
    "IS",
    "IBSCBS"
  ],
  ICMSTot: [
    "vBC",
    "vICMS",
    "vICMSDeson",
    "vFCPUFDest",
    "vICMSUFDest",
    "vICMSUFRemet",
    "vFCP",
    "vBCST",
    "vST",
    "vFCPST",
    "vFCPSTRet",
    "qBCMono",
    "vICMSMono",
    "qBCMonoReten",
    "vICMSMonoReten",
    "qBCMonoRet",
    "vICMSMonoRet",
    "vProd",
    "vFrete",
    "vSeg",
    "vDesc",
    "vII",
    "vIPI",
    "vIPIDevol",
    "vPIS",
    "vCOFINS",
    "vOutro",
    "vNF",
    "vTotTrib"
  ],
  infRespTec: [
    "CNPJ",
    "xContato",
    "email",
    "fone",
    "idCSRT",
    "hashCSRT"
  ],
  detPag: ["indPag", "tPag", "xPag", "vPag", "card"]
};

function serializeObject(name: string, value: JsonObject) {
  const order = elementOrder[name];
  if (!order) {
    return Object.entries(value)
      .filter(([key]) => key !== "versao" && key !== "Id")
      .map(([key, child]) => serializeElement(key, child))
      .join("");
  }

  const known = new Set([...order, "versao", "Id", "nItem"]);
  return [
    ...order
      .filter((key) => key in value)
      .map((key) => serializeElement(key, value[key])),
    ...Object.entries(value)
      .filter(([key]) => !known.has(key))
      .map(([key, child]) => serializeElement(key, child))
  ].join("");
}

function serializeElement(name: string, value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return "";
  }
  if (Array.isArray(value)) {
    return value.map((item) => serializeElement(name, item)).join("");
  }
  if (typeof value === "object") {
    if (name === "ide") {
      return serializeIde(value as JsonObject);
    }
    if (name === "det") {
      const item = value as JsonObject;
      const nItem = onlyDigits(item.nItem).replace(/^0+/, "") || "1";
      const content = serializeObject(name, item);
      return `<det nItem="${escapeXml(nItem)}">${content}</det>`;
    }
    const content = serializeObject(name, value as JsonObject);
    return `<${name}>${content}</${name}>`;
  }
  if (typeof value === "boolean") {
    return `<${name}>${value ? "1" : "0"}</${name}>`;
  }
  return `<${name}>${escapeXml(value)}</${name}>`;
}

const ideOrder = [
  "cUF",
  "cNF",
  "natOp",
  "mod",
  "serie",
  "nNF",
  "dhEmi",
  "dhSaiEnt",
  "tpNF",
  "idDest",
  "cMunFG",
  "tpImp",
  "tpEmis",
  "cDV",
  "tpAmb",
  "finNFe",
  "indFinal",
  "indPres",
  "indIntermed",
  "procEmi",
  "verProc",
  "dhCont",
  "xJust",
  "NFref"
];

const infNFeOrder = [
  "ide",
  "emit",
  "avulsa",
  "dest",
  "retirada",
  "entrega",
  "autXML",
  "det",
  "total",
  "transp",
  "cobr",
  "pag",
  "infAdic",
  "exporta",
  "compra",
  "cana",
  "infRespTec",
  "infSolicNFF",
  "agropecuario"
];

function serializeIde(ide: JsonObject) {
  const known = new Set(ideOrder);
  const content = [
    ...ideOrder
      .filter((key) => key in ide)
      .map((key) => serializeElement(key, ide[key])),
    ...Object.entries(ide)
      .filter(([key]) => !known.has(key))
      .map(([key, value]) => serializeElement(key, value))
  ].join("");
  return `<ide>${content}</ide>`;
}

function serializeInfNFe(infNFe: JsonObject) {
  const known = new Set([...infNFeOrder, "versao", "Id"]);
  return [
    ...infNFeOrder
      .filter((key) => key in infNFe)
      .map((key) => serializeElement(key, infNFe[key])),
    ...Object.entries(infNFe)
      .filter(([key]) => !known.has(key))
      .map(([key, value]) => serializeElement(key, value))
  ].join("");
}

export function calculateAccessKeyDigit(first43Digits: string) {
  if (!/^\d{43}$/.test(first43Digits)) {
    throw new Error("A base da chave de acesso deve conter 43 digitos.");
  }

  let weight = 2;
  let total = 0;
  for (let index = first43Digits.length - 1; index >= 0; index -= 1) {
    total += Number(first43Digits[index]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const remainder = total % 11;
  const digit = 11 - remainder;
  return digit === 10 || digit === 11 ? 0 : digit;
}

function accessKeyFromInfNFe(infNFe: JsonObject) {
  const ide = infNFe.ide as JsonObject;
  const emit = infNFe.emit as JsonObject;
  const issuedAt = String(ide.dhEmi ?? ide.dEmi ?? new Date().toISOString());
  const dateMatch = issuedAt.match(/^(\d{4})-(\d{2})/);
  const yearMonth = dateMatch ? `${dateMatch[1].slice(-2)}${dateMatch[2]}` : "0000";
  const cNF = fixedDigits(ide.cNF || randomInt(0, 100_000_000), 8);
  ide.cNF = cNF;

  const first43 = [
    fixedDigits(ide.cUF, 2),
    yearMonth,
    fixedDigits(emit.CNPJ, 14),
    fixedDigits(ide.mod, 2),
    fixedDigits(ide.serie, 3),
    fixedDigits(ide.nNF, 9),
    fixedDigits(ide.tpEmis || 1, 1),
    cNF
  ].join("");
  const digit = calculateAccessKeyDigit(first43);
  ide.cDV = digit;
  return `${first43}${digit}`;
}

function applyHomologationRequiredText(infNFe: JsonObject) {
  const ide = infNFe.ide as JsonObject;
  if (String(ide.tpAmb ?? "") !== "2") {
    return;
  }

  if (typeof infNFe.dest === "object" && infNFe.dest !== null) {
    (infNFe.dest as JsonObject).xNome = HOMOLOGATION_RECIPIENT_NAME;
  }

  const details = Array.isArray(infNFe.det)
    ? infNFe.det
    : infNFe.det
      ? [infNFe.det]
      : [];
  const firstDetail = details[0];
  if (typeof firstDetail !== "object" || firstDetail === null) {
    return;
  }
  const product = (firstDetail as JsonObject).prod;
  if (typeof product === "object" && product !== null) {
    (product as JsonObject).xProd = HOMOLOGATION_FIRST_ITEM_DESCRIPTION;
  }
}

function certificateBody(certificatePem: string) {
  return certificatePem
    .replace(/-----BEGIN CERTIFICATE-----/g, "")
    .replace(/-----END CERTIFICATE-----/g, "")
    .replace(/\s+/g, "");
}

function buildNfceSupplement(
  accessKey: string,
  infNFe: JsonObject,
  config: NfceQrCodeConfig
) {
  const ide = infNFe.ide as JsonObject;
  if (String(ide.mod) !== "65") {
    return "";
  }

  const environment = String(ide.tpAmb);
  const tokenId = String(Number(config.cscId));
  if (!/^[1-9]\d{0,5}$/.test(tokenId)) {
    throw new Error("O ID do CSC deve ser numerico e ter de 1 a 6 digitos.");
  }
  if (!config.csc.trim()) {
    throw new Error("O CSC da NFC-e nao foi informado.");
  }

  const qrPayload = `${accessKey}|2|${environment}|${tokenId}`;
  const hash = createHash("sha1")
    .update(`${qrPayload}${config.csc.trim()}`, "utf8")
    .digest("hex")
    .toUpperCase();
  const qrCode = `${config.qrCodeBaseUrl}?p=${qrPayload}|${hash}`;

  return (
    `<infNFeSupl>` +
    `<qrCode><![CDATA[${qrCode}]]></qrCode>` +
    `<urlChave>${escapeXml(config.consultationUrl)}</urlChave>` +
    `</infNFeSupl>`
  );
}

function applyResponsibleTechnicalCsrt(
  infNFe: JsonObject,
  accessKey: string,
  config?: ResponsibleTechnicalCsrtConfig
) {
  if (typeof infNFe.infRespTec !== "object" || infNFe.infRespTec === null) {
    return;
  }
  if (!config?.idCSRT || !config.csrt) {
    return;
  }

  const idCSRT = fixedDigits(config.idCSRT, 2);
  if (!/^\d{2}$/.test(idCSRT)) {
    throw new Error("O idCSRT deve conter 2 digitos.");
  }
  if (!config.csrt.trim()) {
    throw new Error("O CSRT do responsavel tecnico nao foi informado.");
  }

  const infRespTec = infNFe.infRespTec as JsonObject;
  infRespTec.idCSRT = idCSRT;
  infRespTec.hashCSRT = createHash("sha1")
    .update(`${config.csrt.trim()}${accessKey}`, "utf8")
    .digest("base64");
}

export function generateAndSignNfeXml(
  payload: JsonObject,
  privateKeyPem: string,
  certificatePem: string,
  nfceQrCodeConfig?: NfceQrCodeConfig,
  responsibleTechnicalCsrtConfig?: ResponsibleTechnicalCsrtConfig
): SignedNfeResult {
  const rawInfNFe =
    typeof payload.infNFe === "object" && payload.infNFe !== null
      ? (payload.infNFe as JsonObject)
      : payload;
  const infNFe = structuredClone(rawInfNFe);
  if (
    typeof infNFe.ide !== "object" ||
    infNFe.ide === null ||
    typeof infNFe.emit !== "object" ||
    infNFe.emit === null
  ) {
    throw new Error("O payload precisa conter infNFe.ide e infNFe.emit.");
  }

  applyHomologationRequiredText(infNFe);
  const accessKey = accessKeyFromInfNFe(infNFe);
  applyResponsibleTechnicalCsrt(infNFe, accessKey, responsibleTechnicalCsrtConfig);
  const version = String(infNFe.versao ?? "4.00");
  const content = serializeInfNFe(infNFe);
  const model = String((infNFe.ide as JsonObject).mod ?? "");
  if (model === "65" && !nfceQrCodeConfig) {
    throw new Error(
      "Configure o CSC e o ID Token de NFC-e para gerar o QR Code."
    );
  }
  const supplement = nfceQrCodeConfig
    ? buildNfceSupplement(accessKey, infNFe, nfceQrCodeConfig)
    : "";
  const unsignedXml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<NFe xmlns="http://www.portalfiscal.inf.br/nfe">` +
    `<infNFe Id="NFe${accessKey}" versao="${escapeXml(version)}">${content}</infNFe>` +
    supplement +
    `</NFe>`;

  const signer = new SignedXml({
    privateKey: privateKeyPem,
    publicCert: certificatePem,
    getKeyInfoContent: () =>
      `<X509Data><X509Certificate>${certificateBody(certificatePem)}</X509Certificate></X509Data>`
  });
  signer.addReference({
    xpath: "//*[local-name(.)='infNFe']",
    digestAlgorithm: SHA1,
    transforms: [ENVELOPED, C14N]
  });
  signer.canonicalizationAlgorithm = C14N;
  signer.signatureAlgorithm = RSA_SHA1;
  signer.computeSignature(unsignedXml, {
    location: {
      reference: supplement
        ? "//*[local-name(.)='infNFeSupl']"
        : "//*[local-name(.)='infNFe']",
      action: "after"
    }
  });
  const signedXml = signer.getSignedXml();

  const document = new DOMParser().parseFromString(signedXml, "application/xml");
  const signatureNode = document.getElementsByTagNameNS(XMLDSIG, "Signature").item(0);
  if (!signatureNode) {
    throw new Error("A assinatura XML nao foi inserida.");
  }
  const verifier = new SignedXml({
    publicCert: certificatePem,
    getCertFromKeyInfo: () => null
  });
  verifier.loadSignature(signatureNode);
  const signatureValid = verifier.checkSignature(signedXml);

  return {
    accessKey,
    unsignedXml,
    signedXml,
    signatureValid
  };
}
