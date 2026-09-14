import assert from "node:assert/strict";
import test from "node:test";

import { createSingleFlight } from "./single-flight.js";

test("compartilha uma unica execucao para chamadas concorrentes da mesma chave", async () => {
  const runSingleFlight = createSingleFlight();
  let executions = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const operation = async () => {
    executions += 1;
    await gate;
    return { status: "cancelado" };
  };

  const first = runSingleFlight("NFSe:doc_1", operation);
  const second = runSingleFlight("NFSe:doc_1", operation);
  await Promise.resolve();
  assert.equal(executions, 1);

  release();
  assert.deepEqual(await Promise.all([first, second]), [
    { status: "cancelado" },
    { status: "cancelado" }
  ]);
  assert.equal(executions, 1);
});

test("libera a chave depois que a operacao termina", async () => {
  const runSingleFlight = createSingleFlight();
  let executions = 0;
  const operation = async () => ++executions;

  assert.equal(await runSingleFlight("NFe:doc_1", operation), 1);
  assert.equal(await runSingleFlight("NFe:doc_1", operation), 2);
});
