import { validateRecoveryDocument } from "./evidence.js";
import type { RecoveryClaim, RecoveryDocument } from "./model.js";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function identifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256;
}
function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** Do not cast an untrusted/old RPC shape into a lease or timer. Fail closed. */
export function decodeRecoveryClaim(value: unknown): RecoveryClaim {
  const invalid = () => new Error("RECOVERY_CLAIM_INVALID");
  if (!record(value) || !("lease" in value) || !("nextWakeAt" in value) ||
      (value.nextWakeAt !== null && !positiveInteger(value.nextWakeAt))) throw invalid();
  if (value.lease === null) return { lease: null, nextWakeAt: value.nextWakeAt as number | null };
  const lease = value.lease;
  if (!record(lease) || typeof lease.id !== "string" || !uuid.test(lease.id) ||
      typeof lease.token !== "string" || !uuid.test(lease.token) || !positiveInteger(lease.version) ||
      !positiveInteger(lease.attempt) || !record(lease.document)) throw invalid();
  const doc = lease.document;
  if (!identifier(doc.clientId) || !identifier(doc.organizationId) || !uuid.test(doc.organizationId) ||
      !identifier(doc.documentId) || !positiveInteger(doc.storeId) || typeof doc.cnpj !== "string" ||
      doc.environment !== "producao" || !["NFe", "NFCe"].includes(String(doc.model)) ||
      !positiveInteger(doc.series) || !positiveInteger(doc.number) || typeof doc.accessKey !== "string" ||
      typeof doc.signedXml !== "string" || typeof doc.signedXmlSha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(doc.signedXmlSha256)) throw invalid();
  const document: RecoveryDocument = {
    clientId: doc.clientId, organizationId: doc.organizationId, documentId: doc.documentId,
    storeId: doc.storeId, cnpj: doc.cnpj, environment: "producao", model: doc.model as "NFe" | "NFCe",
    series: doc.series, number: doc.number, accessKey: doc.accessKey,
    signedXml: doc.signedXml, signedXmlSha256: doc.signedXmlSha256
  };
  try { validateRecoveryDocument(document); } catch { throw invalid(); }
  return { lease: { id: lease.id, token: lease.token, version: lease.version, attempt: lease.attempt, document },
    nextWakeAt: value.nextWakeAt as number | null };
}
