import type { DocumentRecord } from "../../types.js";
import type { RecoveryIdentity } from "./model.js";

export type ManagedPhase = "accepted" | "prepared" | "send_started" | "pending" | "authorized" |
  "rejected" | "blocked_local" | "manual_review" | "cancel_started" | "cancel_pending" | "cancelled";
export type ManagedScope = RecoveryIdentity & { id: string };
export type ManagedDocument = {
  scope: ManagedScope;
  requestId: string;
  originId: string;
  requestHash: string;
  version: number;
  phase: ManagedPhase;
  document: DocumentRecord;
  errorOrigin: "consumer" | "central" | "transport" | "sefaz";
  code: string;
  sendStartedAt: string | null;
  ownerToken: string | null;
  provenance?: 'recovery-v1'|'legacy_authorized_consultation_v1';
};
export interface ManagedRepository {
  accept(scope: ManagedScope, requestId: string, originId: string, hash: string, document: DocumentRecord,
    token: string,resumeLocal?:boolean): Promise<{ created: boolean; record: ManagedDocument }>;
  get(requestId: string): Promise<ManagedDocument | null>;
  transition(current: ManagedDocument, phase: ManagedPhase, document: DocumentRecord,
    origin: ManagedDocument["errorOrigin"], code: string, token: string): Promise<ManagedDocument | null>;
}
