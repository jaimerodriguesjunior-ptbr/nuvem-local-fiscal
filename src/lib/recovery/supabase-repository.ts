import type { SupabaseClient } from "@supabase/supabase-js";
import type { RecoveryClaim, RecoveryDecision, RecoveryLease, RecoveryRepository } from "./model.js";
import { decodeRecoveryClaim } from "./claim-validation.js";

/** Service-role backend only. No network I/O occurs inside a database claim. */
export class SupabaseRecoveryRepository implements RecoveryRepository {
  constructor(private readonly client: SupabaseClient, private readonly workerId: string,
    private readonly scopeIds: readonly string[], private readonly managed = false) {
    if (!workerId) throw new Error("Recovery worker id is required");
    if (!scopeIds.length || scopeIds.some(id => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) throw new Error("Recovery scope ids are required");
  }

  async claim(): Promise<RecoveryClaim> {
    const { data, error } = await this.client.rpc(this.managed ? "fiscal_recovery_managed_claim_v1" : "fiscal_recovery_claim_v1", { p_worker: this.workerId, p_scopes: this.scopeIds });
    if (error) throw new Error("RECOVERY_CLAIM_FAILED");
    return decodeRecoveryClaim(data);
  }

  async complete(lease: RecoveryLease, decision: RecoveryDecision, nextAt: number | null): Promise<boolean> {
    const { data, error } = await this.client.rpc(this.managed ? "fiscal_recovery_managed_complete_v1" : "fiscal_recovery_complete_v1", {
      p_job: lease.id, p_token: lease.token, p_version: lease.version,
      p_decision: decision, p_next_at: nextAt === null ? null : new Date(nextAt).toISOString()
    });
    if (error) throw new Error("RECOVERY_COMPLETE_FAILED");
    if (typeof data !== "boolean") throw new Error("RECOVERY_COMPLETE_INVALID");
    return data;
  }
}
