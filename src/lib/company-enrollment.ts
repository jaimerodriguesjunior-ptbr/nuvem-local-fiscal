import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import forge from "node-forge";
import { parsePfx, encryptCertificateBundle } from "./certificates.js";
import { certificateHolderCnpj } from "./certificate-holder-cnpj.js";
import type { ApiClient, Certificate, Environment, Issuer } from "../types.js";

export class EnrollmentError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export type EnrollmentReceipt = { success: true; request_id: string; cnpj: string; ambientes: Environment[]; fingerprint: string };
export type EnrollmentState = { receipt: EnrollmentReceipt; client: ApiClient; issuers: Issuer[]; certificate: Certificate };
export type EnrollmentInput = {
  clientId: string; clientVersion: string; requestId: string; externalCompanyId: string;
  fingerprint: string; company: Record<string, string>; environments: Environment[];
  certificate: { fileName: string; encryptedBundle: string; validFrom: string; validUntil: string;
    serialNumber: string; subject: string; holderCnpj: string; fingerprint: string };
};
export const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const invalid = (message: string): never => { throw new EnrollmentError(400, "invalid_enrollment", message); };
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid("Informe os dados do cadastro.");
  return value as Record<string, unknown>;
};
function cnpjValid(value: string) {
  if (!/^\d{14}$/.test(value) || /^(\d)\1+$/.test(value)) return false;
  const digit = (base: string) => {
    let weight = base.length - 7, sum = 0;
    for (const char of base) { sum += Number(char) * weight; weight = weight === 2 ? 9 : weight - 1; }
    return sum % 11 < 2 ? 0 : 11 - sum % 11;
  };
  return digit(value.slice(0, 12)) === Number(value[12]) && digit(value.slice(0, 13)) === Number(value[13]);
}

export function prepareEnrollment(body: unknown, clientId: string, clientVersion: string,
  allowedEnvironments: Environment[], encryptionKey: string, trustPem: string, intermediatesPem = ""): EnrollmentInput {
  const input = object(body), data = object(input.empresa);
  const requestId = String(input.request_id ?? "");
  const externalCompanyId = String(input.externalCompanyId ?? "").trim();
  if (!requestIdPattern.test(requestId) || !externalCompanyId || externalCompanyId.length > 200) invalid("Informe a identificação da solicitação e da empresa de origem.");
  const company: Record<string, string> = {};
  for (const key of ["cnpj", "razao_social", "nome_fantasia", "codigo_municipio_ibge", "uf", "inscricao_estadual",
    "regime_tributario", "logradouro", "numero", "complemento", "bairro", "cidade", "cep", "email_contato", "inscricao_municipal"]) {
    if (data[key] !== undefined && typeof data[key] !== "string") invalid(`Campo inválido: ${key}.`);
    company[key] = String(data[key] ?? "").trim();
    if (company[key].length > 250) invalid(`Campo muito longo: ${key}.`);
  }
  company.cnpj = company.cnpj.replace(/[.\-/\s]/g, "");
  company.cep = company.cep.replace(/[-\s]/g, "");
  company.uf = company.uf.toUpperCase();
  company.nome_fantasia ||= company.razao_social;
  if (!cnpjValid(company.cnpj) || !/^\d{7}$/.test(company.codigo_municipio_ibge)) invalid("Informe CNPJ e código IBGE válidos.");
  if (!["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"].includes(company.uf)) invalid("Informe uma UF válida.");
  if (!company.razao_social || !company.logradouro || !company.numero || !company.bairro || !company.cidade || !/^\d{8}$/.test(company.cep) || !["1","2","3","4"].includes(company.regime_tributario)) invalid("Complete a razão social, endereço e regime tributário da empresa.");
  const environments = Array.isArray(input.ambientes) ? [...new Set(input.ambientes)].sort() : [];
  if (!environments.length || environments.some(e => typeof e !== "string" || !allowedEnvironments.includes(e as Environment))) {
    throw new EnrollmentError(403, "environment_not_allowed", "Ambiente de cadastro não permitido para esta integração.");
  }
  const base64 = input.pfxBase64;
  if (typeof base64 !== "string" || !base64.length || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64) || Buffer.byteLength(base64, "base64") > 2 * 1024 * 1024 || typeof input.password !== "string" || input.password.length > 1024) invalid("Envie o certificado A1 de até 2 MB e sua senha.");
  if (!trustPem.trim()) throw new EnrollmentError(503, "enrollment_trust_unavailable", "A confiança dos certificados de cadastro ainda não foi configurada no serviço fiscal.");
  let parsed: ReturnType<typeof parsePfx>;
  try {
    parsed = parsePfx(Buffer.from(base64 as string, "base64"), input.password as string);
    const pemBlocks = parsed.certificateChainPem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
    const extraBlocks = intermediatesPem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
    const certificates = [...pemBlocks, ...extraBlocks].map(pem => forge.pki.certificateFromPem(pem));
    if (certificates.length > 1000) throw new Error("Certificate candidate limit exceeded");
    const roots = trustPem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
    if (!roots.length) throw new Error("No configured trust anchors");
    // Intermediates are path candidates, never additional trust anchors. A PFX
    // containing only the leaf can use the operator's verified offline CA set.
    const caStore = forge.pki.createCaStore(roots);
    let attempts = 0;
    const trustedPath = (chain: forge.pki.Certificate[]): boolean => {
      if (++attempts > 128 || chain.length > 12) return false;
      try { forge.pki.verifyCertificateChain(caStore, chain); return true; } catch { /* try an intermediate */ }
      const tail = chain[chain.length - 1];
      for (const parent of certificates) {
        if (chain.includes(parent) || !tail.isIssuer(parent)) continue;
        try { if (parent.verify(tail) && trustedPath([...chain, parent])) return true; } catch { /* different key or unsupported signature */ }
      }
      return false;
    };
    const leaf = certificates[0];
    if (!trustedPath([leaf])) throw new Error("No path to a configured root");
    if ((leaf.getExtension("basicConstraints") as { cA?: boolean } | null)?.cA) throw new Error("CA certificate");
    const usage = leaf.getExtension("keyUsage") as { digitalSignature?: boolean } | null;
    if (!usage?.digitalSignature) throw new Error("Signing key usage required");
    if (certificateHolderCnpj(parsed.certificatePem) !== company.cnpj) throw new Error("CNPJ mismatch");
  } catch { throw new EnrollmentError(400, "invalid_certificate", "Certificado recusado: confira senha, titularidade, validade e cadeia de confiança do A1."); }
  const fingerprint = createHash("sha256").update(forge.asn1.toDer(forge.pki.certificateToAsn1(forge.pki.certificateFromPem(parsed.certificatePem))).getBytes(), "binary").digest("hex");
  return { clientId, clientVersion, requestId: requestId.toLowerCase(), externalCompanyId, company,
    environments: environments as Environment[],
    fingerprint: createHash("sha256").update(JSON.stringify({ company, environments, externalCompanyId, certificate: fingerprint })).digest("hex"),
    certificate: { fileName: String(input.fileName || "certificado.pfx").slice(0, 200),
      encryptedBundle: encryptCertificateBundle({ pfxBase64: base64 as string, password: input.password as string }, encryptionKey),
      validFrom: parsed.validFrom, validUntil: parsed.validUntil, serialNumber: parsed.serialNumber,
      subject: parsed.subject, holderCnpj: company.cnpj, fingerprint } };
}

export function readEnrollmentTrust(path: string) {
  if (!path) return "";
  try { return readFileSync(path, "utf8"); }
  catch { throw new EnrollmentError(503, "enrollment_trust_unavailable", "Não foi possível carregar as autoridades de certificado configuradas."); }
}
