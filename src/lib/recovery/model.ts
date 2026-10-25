/** Delivery A: this module deliberately has no transmission capability. */
export type RecoveryIdentity = {
  clientId: string;
  organizationId: string;
  storeId: number;
  cnpj: string;
  environment: "producao";
  model: "NFe" | "NFCe";
  series: number;
};

export type RecoveryDocument = RecoveryIdentity & {
  documentId: string;
  number: number;
  accessKey: string;
  signedXml: string;
  signedXmlSha256: string;
};

export type RecoveryDecision =
  | { state: "authorized"; origin: "sefaz"; code: "100" | "150";
      protocol: string; processedXml: string; evidenceXml: string }
  | { state: "pending"; origin: "transport" | "sefaz"; code: string }
  | { state: "manual_review"; origin: "local"; code: string };

export type RecoveryLease = {
  id: string;
  token: string;
  version: number;
  attempt: number;
  document: RecoveryDocument;
};

export type RecoveryClaim = {
  lease: RecoveryLease | null;
  /** Includes leases held by other workers, so their expiry can be recovered. */
  nextWakeAt: number | null;
};

export interface RecoveryRepository {
  claim(): Promise<RecoveryClaim>;
  /** false means stale lease/version: do not overwrite or repeat side effects. */
  complete(lease: RecoveryLease, decision: RecoveryDecision, nextAt: number | null): Promise<boolean>;
}

export interface RecoveryWakeSource {
  /** Must subscribe before the first drain. Reconnection MUST call wake. */
  subscribe(wake: () => void, disconnect: (error: unknown) => void): Promise<() => Promise<void>>;
}

export function matchesRecoveryScope(actual: RecoveryIdentity, allowed: RecoveryIdentity): boolean {
  return actual.clientId === allowed.clientId && actual.organizationId === allowed.organizationId &&
    actual.storeId === allowed.storeId && actual.cnpj === allowed.cnpj &&
    actual.environment === allowed.environment && actual.model === allowed.model &&
    actual.series === allowed.series;
}

export function recoveryDelay(attempt: number): number {
  // 30s, 1m, 2m, 4m, ... up to 30m. A pending job never releases the origin.
  return Math.min(30_000 * 2 ** Math.min(Math.max(0, attempt - 1), 6), 30 * 60_000);
}
