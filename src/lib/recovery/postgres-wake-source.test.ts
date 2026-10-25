import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PostgresRecoveryWakeSource, type RecoveryNotificationConnection } from "./postgres-wake-source.js";

class Connection extends EventEmitter implements RecoveryNotificationConnection {
  queries: string[] = [];
  closed = false;
  connectFailure = false;
  async connect() { if (this.connectFailure) throw Error('offline'); }
  async query(sql: string) { this.queries.push(sql); }
  async end() { this.closed = true; this.emit('end'); }
}

test("listener stays idle without database polling; reconnect catches missed notifications", async () => {
  const connections: Connection[] = [];
  const timers = new Map<number, () => void>();
  let wakes = 0, disconnected = 0;
  const source = new PostgresRecoveryWakeSource({
    createConnection() { const conn = new Connection(); connections.push(conn); return conn; },
    setTimer(callback, delay) { timers.set(delay, callback); return delay as unknown as ReturnType<typeof setTimeout>; },
    clearTimer(timer) { timers.delete(timer as unknown as number); }
  });
  const stop = await source.subscribe(() => { wakes++; }, () => { disconnected++; });
  assert.equal(wakes, 1);
  assert.deepEqual(connections[0].queries, ['LISTEN fiscal_recovery_v1']);
  assert.equal(timers.size, 0);
  connections[0].emit('notification', {channel:'other'});
  assert.equal(wakes, 1);
  connections[0].emit('notification', {channel:'fiscal_recovery_v1',payload:'wake'});
  assert.equal(wakes, 2);
  connections[0].emit('error', Error('connection dropped'));
  connections[0].emit('end');
  assert.equal(disconnected, 1);
  assert.deepEqual([...timers.keys()], [1_000]);
  const callback = timers.get(1_000)!;
  timers.clear(); callback();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(connections.length, 2);
  assert.equal(connections[0].closed, true);
  assert.deepEqual(connections[1].queries, ['LISTEN fiscal_recovery_v1']);
  assert.equal(wakes, 3); // no NOTIFY required after reconnect
  assert.equal(timers.size, 0);
  await stop();
  assert.equal(connections[1].closed, true);
  assert.equal(disconnected, 1);
  assert.equal(timers.size, 0);
});

test("failure to establish the initial listener fails startup closed", async () => {
  const connection = new Connection(); connection.connectFailure = true;
  const timers: number[] = [];
  const source = new PostgresRecoveryWakeSource({
    createConnection: () => connection,
    setTimer(_callback, delay) { timers.push(delay); return delay as unknown as ReturnType<typeof setTimeout>; }
  });
  let wakes = 0;
  await assert.rejects(() => source.subscribe(() => { wakes++; }, () => {}), /START_FAILED/);
  assert.equal(wakes, 0);
  assert.equal(connection.closed, true);
  assert.deepEqual(timers, []);
});
