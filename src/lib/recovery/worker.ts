import { matchesRecoveryScope, recoveryDelay } from "./model.js";
import type { RecoveryDecision, RecoveryDocument, RecoveryIdentity, RecoveryRepository, RecoveryWakeSource } from "./model.js";
import { reconcileConsultation, validateRecoveryDocument } from "./evidence.js";

export type RecoveryWorkerOptions = {
  enabled: boolean;
  scopes: readonly RecoveryIdentity[];
  repository: RecoveryRepository;
  wakeSource: RecoveryWakeSource;
  /** Adapter MUST perform only consultation, with a bounded transport timeout. */
  consult: (document: RecoveryDocument) => Promise<string>;
  report: (code: "RECOVERY_STORAGE_UNAVAILABLE" | "RECOVERY_WAKE_DISCONNECTED") => void;
  now?: () => number;
  setTimer?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
};

export class RecoveryWorker {
  private stopped = true;
  private connected = false;
  private storageHealthy = true;
  private dirty = false;
  private running: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private unsubscribe: (() => Promise<void>) | undefined;
  private readonly now;
  private readonly setTimer;
  private readonly clearTimer;

  constructor(private readonly options: RecoveryWorkerOptions) {
    this.now = options.now ?? Date.now;
    this.setTimer = options.setTimer ?? setTimeout;
    this.clearTimer = options.clearTimer ?? clearTimeout;
  }

  get ready(): boolean { return !this.stopped && this.connected && this.storageHealthy; }

  async start(): Promise<void> {
    if (!this.options.enabled) return;
    if (!this.stopped) throw new Error("Recovery worker already started");
    if (!this.options.scopes.length) throw new Error("Recovery scope allowlist is empty");
    this.stopped = false;
    let disconnectedDuringSubscription = false;
    try {
      this.unsubscribe = await this.options.wakeSource.subscribe(
        () => { disconnectedDuringSubscription = false; this.connected = true; this.wake(); },
        () => {
          disconnectedDuringSubscription = true;
          this.connected = false;
          this.cancelTimer();
          this.options.report("RECOVERY_WAKE_DISCONNECTED");
        }
      );
      if (this.stopped) {
        await this.unsubscribe();
        this.unsubscribe = undefined;
        return;
      }
      this.connected = !disconnectedDuringSubscription;
      // Subscribe first, then drain. Reconnect must do the same; NOTIFY alone is
      // not durable and is never the source of truth.
      this.wake();
      await this.running;
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  wake(): void {
    if (this.stopped || !this.connected) return;
    this.dirty = true;
    this.cancelTimer();
    if (!this.running) {
      this.running = this.drain().finally(() => {
        this.running = null;
        if (this.dirty && !this.stopped && this.connected) this.wake();
      });
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.connected = false;
    this.cancelTimer();
    await this.running;
    await this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  private cancelTimer(): void {
    if (this.timer !== undefined) this.clearTimer(this.timer);
    this.timer = undefined;
  }

  private schedule(at: number | null): void {
    if (at === null || this.stopped || !this.connected) return;
    this.cancelTimer();
    this.timer = this.setTimer(() => { this.timer = undefined; this.wake(); },
      Math.min(2_147_483_647, Math.max(100, at - this.now())));
  }

  private async drain(): Promise<void> {
    try {
      do {
        this.dirty = false;
        while (!this.stopped && this.connected) {
          const claim = await this.options.repository.claim();
          this.storageHealthy = true;
          if (!claim.lease) {
            // The final claim checks the queue, not every completed invoice.
            this.schedule(claim.nextWakeAt);
            break;
          }
          const lease = claim.lease;
          // Shutdown/disconnection can happen while the claim RPC is pending.
          // Leave that lease to expire rather than starting new external I/O.
          if (this.stopped || !this.connected) break;
          let decision: RecoveryDecision;
          if (!this.options.scopes.some(scope => matchesRecoveryScope(lease.document, scope))) {
            decision = { state: "manual_review", origin: "local", code: "RECOVERY_SCOPE_MISMATCH" };
          } else {
            try {
              validateRecoveryDocument(lease.document);
              try {
                const response = await this.options.consult(lease.document);
                decision = reconcileConsultation(lease.document, response);
              } catch {
                decision = { state: "pending", origin: "transport", code: "RECOVERY_COMMUNICATION_FAILURE" };
              }
            } catch {
              decision = { state: "manual_review", origin: "local", code: "RECOVERY_DOCUMENT_INVALID" };
            }
          }
          await this.options.repository.complete(lease, decision,
            decision.state === "pending" ? this.now() + recoveryDelay(lease.attempt) : null);
        }
      } while (this.dirty && !this.stopped && this.connected);
    } catch {
      this.storageHealthy = false;
      // Leave the lease intact; its expiry fences a late result. Storage errors
      // never turn into a fiscal rejection or release an origin/number.
      this.options.report("RECOVERY_STORAGE_UNAVAILABLE");
      this.dirty = false;
      this.schedule(this.now() + 30_000);
    }
  }
}
