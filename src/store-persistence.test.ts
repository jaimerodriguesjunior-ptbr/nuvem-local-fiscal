import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type {
  PersistenceChanges,
  StoreSnapshotState
} from "./lib/supabase-persistence.js";
import { SupabasePersistence } from "./lib/supabase-persistence.js";
import { InMemoryStore } from "./store.js";
import type { Certificate } from "./types.js";

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

test("reconcilia o ID em memoria quando reutiliza certificado ativo no Supabase", async () => {
  const persistence = new SupabasePersistence("https://example.test", "service-role-key");
  let persistedRows: Array<Record<string, unknown>> = [];
  const fakeClient = {
    from(table: string) {
      assert.equal(table, "fiscal_certificates");
      return {
        select() {
          return {
            in() {
              return {
                async eq() {
                  return { data: [{ id: "certificado-persistido", cnpj: "12345678000195" }], error: null };
                }
              };
            }
          };
        },
        async upsert(rows: Array<Record<string, unknown>>) {
          persistedRows = rows;
          return { error: null };
        }
      };
    }
  };
  (persistence as unknown as { client: unknown }).client = fakeClient;

  const certificate = {
    id: "uuid-temporario",
    issuerId: "issuer-1",
    cnpj: "12345678000195",
    fileName: "empresa.pfx",
    uploadedAt: "2026-08-07T00:00:00.000Z",
    validFrom: "2026-01-01T00:00:00.000Z",
    validUntil: "2027-01-01T00:00:00.000Z",
    serialNumber: "123",
    subject: "CN=Empresa",
    holderCnpj: "12345678000195",
    encryptedBundle: "encrypted",
    active: true
  } satisfies Certificate;

  await (persistence as unknown as {
    upsertCertificates(items: Certificate[], companies: Map<string, string>): Promise<void>;
  }).upsertCertificates([certificate], new Map([[certificate.cnpj, "company-1"]]));

  assert.equal(persistedRows[0]?.id, "certificado-persistido");
  assert.equal(certificate.id, "certificado-persistido");
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
