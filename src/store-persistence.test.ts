import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type {
  PersistenceChanges,
  StoreSnapshotState,
  SupabasePersistence
} from "./lib/supabase-persistence.js";
import { InMemoryStore } from "./store.js";

test("persiste somente o documento alterado", async () => {
  const changes: PersistenceChanges[] = [];
  const persistence = {
    saveChanges: async (_state: StoreSnapshotState, changed: PersistenceChanges) => {
      changes.push(changed);
    }
  } as unknown as SupabasePersistence;
  const stateFile = join(mkdtempSync(join(tmpdir(), "nlf-store-")), "state.json");
  const store = new InMemoryStore("client", "secret", "token", stateFile, persistence);

  store.upsertIssuerEnvironment("12345678000195", "homologacao", {
    razaoSocial: "Emitente Teste"
  });
  await store.waitForPersistence();
  changes.length = 0;

  const document = store.createDocument({
    tipoDocumento: "NFSe",
    issuerCnpj: "12345678000195",
    ambiente: "homologacao",
    payloadOriginal: {},
    payloadNormalizado: {}
  });
  await store.waitForPersistence();

  assert.equal(changes.length, 1);
  assert.deepEqual(changes[0]?.documents?.map((item) => item.id), [document.id]);
  assert.equal(changes[0]?.issuers, undefined);
  assert.equal(changes[0]?.serviceConfigs, undefined);
});

test("prioriza regra de devolucao especifica da empresa apos recarregar", () => {
  const stateFile = join(mkdtempSync(join(tmpdir(), "nlf-store-")), "state.json");
  const store = new InMemoryStore("client", "secret", "token", stateFile);
  store.upsertReturnCfopRule({
    companyCnpj: null,
    sourceCfop: "5102",
    profile: "global",
    conditions: {},
    sameStateCfop: "5202",
    interstateCfop: "6202",
    riskLevel: "low",
    active: true,
    source: "test"
  });
  store.upsertReturnCfopRule({
    companyCnpj: "12345678000195",
    sourceCfop: "5102",
    profile: "empresa",
    conditions: {},
    sameStateCfop: "5411",
    interstateCfop: "6411",
    riskLevel: "low",
    active: true,
    source: "test"
  });

  const rules = store.listReturnCfopRules("12345678000195");
  assert.equal(rules[0]?.profile, "empresa");
});
