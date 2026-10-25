import { test } from "node:test";
import assert from "node:assert/strict";
import type { RecoveryClaim, RecoveryDecision, RecoveryLease, RecoveryRepository, RecoveryWakeSource } from "./model.js";
import { RecoveryWorker } from "./worker.js";
import { fixtureDocument, fixtureResponse, fixtureScope } from "./test-fixtures.js";

const lease: RecoveryLease = { id: "job", token: "lease", version: 2, attempt: 1, document: fixtureDocument };

function harness(claims: RecoveryClaim[], consult = async () => fixtureResponse()) {
  let wake!: () => void;
  let disconnect!: (error: unknown) => void;
  let reads = 0, queries = 0, subscriptions = 0;
  const timers = new Map<number, () => void>();
  const completed: { decision: RecoveryDecision; nextAt: number | null }[] = [];
  const faults: string[] = [];
  const repository: RecoveryRepository = {
    async claim() { reads++; return claims.shift() ?? { lease: null, nextWakeAt: null }; },
    async complete(_lease, decision, nextAt) { completed.push({ decision, nextAt }); return true; }
  };
  const source: RecoveryWakeSource = {
    async subscribe(w, d) { subscriptions++; wake = w; disconnect = d; return async () => {}; }
  };
  const options = { enabled: true, scopes: [fixtureScope], repository, wakeSource: source,
    consult: async () => { queries++; return consult(); }, report: (code: string) => { faults.push(code); },
    now: () => 100_000,
    setTimer: (callback: () => void, delay: number) => { timers.set(delay, callback); return delay as unknown as ReturnType<typeof setTimeout>; },
    clearTimer: (timer: ReturnType<typeof setTimeout>) => { timers.delete(timer as unknown as number); }
  };
  return { options, completed, timers, faults, wake: () => wake(), disconnect: () => disconnect(Error()),
    counts: () => ({ reads, queries, subscriptions }) };
}

test("disabled worker does not subscribe, read storage, schedule or query", async () => {
  const h = harness([{ lease, nextWakeAt: null }]);
  const worker = new RecoveryWorker({ ...h.options, enabled: false });
  await worker.start();
  assert.deepEqual(h.counts(), { reads: 0, queries: 0, subscriptions: 0 });
  assert.equal(h.timers.size, 0);
  assert.equal(worker.ready, false);
});

test("startup drains durable pending work then empty queue has no timer/polling", async () => {
  const h = harness([{ lease, nextWakeAt: null }]);
  const worker = new RecoveryWorker(h.options);
  await worker.start();
  assert.deepEqual(h.counts(), { reads: 2, queries: 1, subscriptions: 1 });
  assert.equal(h.completed[0].decision.state, "authorized");
  assert.equal(h.timers.size, 0);
  assert.equal(worker.ready, true);
  await worker.stop();
});

test("network failure preserves pending and schedules backoff only for remaining work", async () => {
  const h = harness([{ lease, nextWakeAt: null }, { lease: null, nextWakeAt: 130_000 }], async () => { throw Error("timeout"); });
  const worker = new RecoveryWorker(h.options);
  await worker.start();
  assert.deepEqual(h.completed, [{ decision: { state: "pending", origin: "transport", code: "RECOVERY_COMMUNICATION_FAILURE" }, nextAt: 130_000 }]);
  assert.deepEqual([...h.timers.keys()], [30_000]);
  h.disconnect();
  assert.equal(h.timers.size, 0);
  assert.equal(worker.ready, false);
  h.wake(); // reconnect notification drains again, including a lost notification
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(worker.ready, true);
  assert.equal(h.counts().reads, 3);
  await worker.stop();
});

test("scope isolation never consults another store or releases its reservation", async () => {
  for (const changed of [{ ...lease, document: { ...fixtureDocument, storeId: 2 } }]) {
    const h = harness([{ lease: changed, nextWakeAt: null }]);
    const worker = new RecoveryWorker(h.options);
    await worker.start();
    assert.equal(h.counts().queries, 0);
    assert.equal(h.completed[0].decision.state, "manual_review");
    assert.equal(h.completed[0].nextAt, null);
    await worker.stop();
  }
});

test("repeated transport failures remain pending rather than becoming a fabricated terminal error", async () => {
  const h = harness([{ lease: { ...lease, attempt: 25 }, nextWakeAt: null }], async () => { throw Error('timeout'); });
  const worker = new RecoveryWorker(h.options);
  await worker.start();
  assert.equal(h.counts().queries, 1);
  assert.equal(h.completed[0].decision.state, 'pending');
  assert.equal(h.completed[0].nextAt, 100_000 + 30 * 60_000);
  await worker.stop();
});

test("storage failure leaves lease intact and schedules retry, never a rejection", async () => {
  const h = harness([{ lease, nextWakeAt: null }]);
  h.options.repository.complete = async () => { throw Error("database unavailable"); };
  const worker = new RecoveryWorker(h.options);
  await worker.start();
  assert.equal(h.completed.length, 0);
  assert.deepEqual(h.faults, ["RECOVERY_STORAGE_UNAVAILABLE"]);
  assert.deepEqual([...h.timers.keys()], [30_000]);
  await worker.stop();
});

test("wake during queue-empty check is not lost", async () => {
  const h = harness([]);
  const original = h.options.repository.claim;
  let round = 0;
  h.options.repository.claim = async () => {
    round++;
    if (round === 1) { h.wake(); return { lease: null, nextWakeAt: null }; }
    return original();
  };
  const worker = new RecoveryWorker(h.options);
  await worker.start();
  assert.equal(round, 2);
  assert.equal(h.timers.size, 0);
  await worker.stop();
});

test("stop or disconnection during a claim never starts another external query", async () => {
  for (const action of ['stop', 'disconnect'] as const) {
    const h = harness([]);
    let resolveClaim!: (value: RecoveryClaim) => void;
    h.options.repository.claim = async () => new Promise<RecoveryClaim>(resolve => { resolveClaim = resolve; });
    const worker = new RecoveryWorker(h.options);
    const started = worker.start();
    await new Promise(resolve => setImmediate(resolve));
    const stopped = action === 'stop' ? worker.stop() : Promise.resolve(h.disconnect());
    resolveClaim({ lease, nextWakeAt: 190_000 });
    await Promise.all([started, stopped]);
    assert.equal(h.counts().queries, 0);
    assert.equal(h.completed.length, 0);
    assert.equal(h.timers.size, 0);
    await worker.stop();
  }
});

test("shutdown during listener startup closes the late subscription without reading storage", async () => {
  const h = harness([]);
  let finishSubscription!: () => void;
  let closed = 0;
  h.options.wakeSource.subscribe = async () => {
    await new Promise<void>(resolve => { finishSubscription = resolve; });
    return async () => { closed++; };
  };
  const worker = new RecoveryWorker(h.options);
  const started = worker.start();
  await worker.stop();
  finishSubscription();
  await started;
  assert.equal(closed, 1);
  assert.equal(worker.ready, false);
  assert.equal(h.counts().reads, 0);
  assert.equal(h.counts().queries, 0);
});
