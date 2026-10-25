import type { RecoveryWakeSource } from "./model.js";

/** Compatible with a dedicated node-postgres Client. Do not supply a pooled
 * transaction connection: LISTEN needs one stable session, outside a transaction.
 * The composition root must enforce TLS and pin the intended database/project.
 */
export interface RecoveryNotificationConnection {
  connect(): Promise<void>;
  query(sql: string): Promise<unknown>;
  end(): Promise<void>;
  on(event: "notification", listener: (message: { channel: string; payload?: string }) => void): this;
  on(event: "error" | "end", listener: (error?: unknown) => void): this;
  removeAllListeners(event: string): this;
}

export type PostgresWakeOptions = {
  createConnection: () => RecoveryNotificationConnection;
  setTimer?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
};

/** Idle means an open LISTEN session, without repeated SELECT/claim polling.
 * A reconnect subscribes first and then wakes the durable queue, so NOTIFY loss
 * during a broken connection does not depend on the next sale/browser opening.
 */
export class PostgresRecoveryWakeSource implements RecoveryWakeSource {
  private active = false;
  private current: RecoveryNotificationConnection | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private connecting: Promise<void> | null = null;
  private attempt = 0;
  private readonly setTimer;
  private readonly clearTimer;

  constructor(private readonly options: PostgresWakeOptions) {
    this.setTimer = options.setTimer ?? setTimeout;
    this.clearTimer = options.clearTimer ?? clearTimeout;
  }

  async subscribe(wake: () => void, disconnect: (error: unknown) => void): Promise<() => Promise<void>> {
    if (this.active) throw new Error("RECOVERY_LISTENER_ALREADY_STARTED");
    this.active = true;
    const closeConnection = async (connection: RecoveryNotificationConnection) => {
      connection.removeAllListeners("notification");
      connection.removeAllListeners("end");
      // Retain the error handler until end settles: EventEmitter error events
      // must never become an uncaught exception during a failed connection.
      try { await connection.end(); } catch { /* no fiscal state is changed */ }
      connection.removeAllListeners("error");
    };
    const schedule = () => {
      if (!this.active || this.timer !== undefined) return;
      const delay = Math.min(1_000 * 2 ** Math.min(this.attempt++, 6), 60_000);
      this.timer = this.setTimer(() => {
        this.timer = undefined;
        if (!this.active) return;
        this.connecting = connect(false).finally(() => { this.connecting = null; });
      }, delay);
    };
    const connect = async (initial: boolean) => {
      let connection: RecoveryNotificationConnection | null = null;
      let lost = false;
      const fail = (error?: unknown) => {
        if (lost || !this.active || this.current !== connection) return;
        lost = true;
        this.current = null;
        disconnect(error);
        if (connection) void closeConnection(connection);
        if (!initial) schedule();
      };
      try {
        connection = this.options.createConnection();
        this.current = connection;
        connection.on("error", fail);
        connection.on("end", fail);
        connection.on("notification", message => {
          if (this.active && this.current === connection && !lost && message.channel === "fiscal_recovery_v1") wake();
        });
        await connection.connect();
        if (!this.active || lost || this.current !== connection) throw new Error("RECOVERY_LISTENER_CONNECTION_LOST");
        await connection.query('LISTEN fiscal_recovery_v1');
        if (!this.active || lost || this.current !== connection) throw new Error("RECOVERY_LISTENER_CONNECTION_LOST");
        this.attempt = 0;
        // Subsequent loss of the initial connection also requires reconnection.
        initial = false;
        wake();
      } catch (error) {
        fail(error);
        if (initial) throw new Error("RECOVERY_LISTENER_START_FAILED");
        schedule();
      }
    };
    try {
      this.connecting = connect(true);
      await this.connecting;
      this.connecting = null;
    } catch (error) {
      this.active = false;
      this.connecting = null;
      throw error;
    }
    return async () => {
      this.active = false;
      if (this.timer !== undefined) this.clearTimer(this.timer);
      this.timer = undefined;
      const connection = this.current;
      this.current = null;
      if (connection) await closeConnection(connection);
      await this.connecting;
      this.connecting = null;
    };
  }
}
