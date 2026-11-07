import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { config } from "../config.js";
import { InMemoryStore } from "../store.js";
import type { Certificate } from "../types.js";
import type { PersistenceChanges, StoreSnapshotState, SupabasePersistence } from "./supabase-persistence.js";
import { refreshNfceIssueTime } from "./nfce-issue-time.js";
import { processHomologationNfce } from "./document-processing.js";

const certificates = require("./certificates.js") as typeof import("./certificates.js");
const nfe = require("./nfe-xml.js") as typeof import("./nfe-xml.js");
const xsd = require("./xsd-validator.js") as typeof import("./xsd-validator.js");
const rules = require("./nfce-rules.js") as typeof import("./nfce-rules.js");
const sefaz = require("./sefaz-authorization.js") as typeof import("./sefaz-authorization.js");
const now = new Date("2026-11-07T15:33:16Z");
const cnpj = "98765432000110";
const key = "41261198765432000110650020000001521123456780";

function fixture(t: TestContext, persistence?: SupabasePersistence) {
  const directory = mkdtempSync(join(tmpdir(), "nlf-first-send-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const stateFile = join(directory, "state.json");
  const store = new InMemoryStore("synthetic", "synthetic", "synthetic", stateFile, persistence);
  store.upsertIssuerEnvironment(cnpj, "producao", { razaoSocial: "Synthetic", uf: "PR" });
  const document = store.createDocument({
    tipoDocumento: "NFCe", issuerCnpj: cnpj, ambiente: "producao",
    payloadOriginal: { infNFe: { ide: { mod: 65, tpAmb: 1, nNF: 152, serie: 2, dhEmi: "2026-11-07T12:30:10-03:00" } } },
    payloadNormalizado: {}, nfceConfigEncrypted: "synthetic"
  });
  return { store, document, stateFile };
}

test("a real store creates and reloads a production NFC-e without XML, allowing first-send preparation", t => {
  const { store, document, stateFile } = fixture(t);
  assert.equal(document.xml, "");
  assert.equal(document.chave, null);
  const reloaded = new InMemoryStore("synthetic", "synthetic", "synthetic", stateFile).findDocument(document.id)!;
  assert.equal(reloaded.xml, "");
  const refreshed = refreshNfceIssueTime(reloaded, now, "never_sent");
  assert.equal((refreshed.payloadOriginal as any).infNFe.ide.dhEmi, "2026-11-07T12:33:16-03:00");
  assert.equal(refreshed.numero, 152);
  assert.equal(refreshed.serie, 2);
  assert.equal((store.findDocument(document.id)!.payloadOriginal as any).infNFe.ide.dhEmi, "2026-11-07T12:30:10-03:00");
});

test("stored failed documents with placeholder XML are not cleared or retried by the fix", t => {
  const { document, stateFile } = fixture(t);
  const old = { ...document, status: "erro" as const,
    xml: `<mock tipo="NFCe" id="${document.id}" numero="152" serie="2" />`,
    motivo: "NFCE_TIME_REFRESH_UNPROVEN" };
  const snapshot = structuredClone(old);
  assert.throws(() => refreshNfceIssueTime(old, now, "never_sent"), /NFCE_TIME_REFRESH_UNPROVEN/);
  assert.deepEqual(old, snapshot);
  assert.equal(new InMemoryStore("synthetic", "synthetic", "synthetic", stateFile).findDocument(document.id)!.numero, 152);
});

for (const scenario of ["authorized", "xsd_failure", "persistence_failure", "old_placeholder"] as const) {
  test(`legacy production NFC-e from createDocument through processing: ${scenario}`, async t => {
    // The deployed CommonJS build permits replacing only external dependencies.
    if (!Object.getOwnPropertyDescriptor(rules, "assertValidNfceEmissionPayload")?.configurable) {
      t.skip("Run node --test dist/lib/nfce-first-send.test.js after npm run build");
      return;
    }
    const originalProduction = config.fiscalProductionEnabled;
    config.fiscalProductionEnabled = true;
    t.after(() => { config.fiscalProductionEnabled = originalProduction; });
    t.mock.timers.enable({ apis: ["Date"], now });
    let persistedSigned = false;
    let preparations = 0;
    let queries = 0;
    let transmissions = 0;
    const persistence = {
      async saveChanges(_state: StoreSnapshotState, changes: PersistenceChanges) {
        if (changes.documents?.some(d => d.xmlSigned)) {
          if (scenario === "persistence_failure") throw new Error("synthetic persistence failure");
          persistedSigned = true;
        }
      }
    } as unknown as SupabasePersistence;
    const { store, document } = fixture(t, persistence);
    if (scenario === "old_placeholder") {
      document.xml = `<mock tipo="NFCe" id="${document.id}" numero="152" serie="2" />`;
      document.status = "erro";
    }
    await store.waitForPersistence();
    t.mock.method(store, "findActiveCertificate", () => ({ id: "synthetic", encryptedBundle: "synthetic" }) as Certificate);
    t.mock.method(rules, "assertValidNfceEmissionPayload", () => undefined);
    t.mock.method(certificates, "openEncryptedCertificate", () => ({ privateKeyPem: "synthetic", certificatePem: "synthetic" }) as any);
    t.mock.method(certificates, "decryptSecretPayload", () => ({ cscId: "1", csc: "synthetic" }));
    t.mock.method(nfe, "generateAndSignNfeXml", (payload: any) => {
      preparations++;
      assert.equal(payload.infNFe.ide.dhEmi, "2026-11-07T12:33:16-03:00");
      assert.equal(payload.infNFe.ide.nNF, 152);
      return { accessKey: key, unsignedXml: "synthetic", signedXml: "synthetic", signatureValid: true };
    });
    t.mock.method(xsd, "validateNfeXml", () => ({ valid: scenario !== "xsd_failure", errors: ["synthetic XSD"], schema: "synthetic" }));
    t.mock.method(sefaz, "querySefazDocumentStatus", async () => {
      queries++;
      assert.equal(persistedSigned, true);
      return { cStat: "217", protocolCStat: "", protocol: "", accessKey: key, xMotivo: "synthetic" } as any;
    });
    t.mock.method(sefaz, "authorizeNfeAtSefaz", async () => {
      transmissions++;
      assert.equal(queries, 1);
      assert.equal(persistedSigned, true);
      return { idLote: "synthetic", receipt: "", batchCStat: "104", batchReason: "synthetic",
        protocolCStat: "100", protocolReason: "synthetic", protocol: "synthetic", accessKey: key,
        responseXml: "synthetic", processedXml: "<nfeProc>synthetic</nfeProc>" } as any;
    });
    const result = await processHomologationNfce(store, document.id);
    const success = scenario === "authorized";
    assert.equal(preparations, scenario === "old_placeholder" ? 0 : 1);
    assert.equal(queries, success ? 1 : 0);
    assert.equal(transmissions, success ? 1 : 0);
    assert.equal(result.transmitted, success);
    assert.equal(document.numero, 152);
    assert.equal(document.serie, 2);
    if (success) {
      assert.equal(result.error, null);
      assert.equal(document.status, "autorizado");
      const again = await processHomologationNfce(store, document.id);
      assert.equal(again.transmitted, false);
      assert.equal(transmissions, 1);
    } else {
      assert.match(result.error!, scenario === "old_placeholder" ? /NFCE_TIME_REFRESH_UNPROVEN/ : scenario === "xsd_failure" ? /XSD/ : /persistence/);
      assert.equal(store.getDocumentEvents(document.id).some(e => e.eventType === "sefaz_authorization_started"), false);
    }
  });
}
