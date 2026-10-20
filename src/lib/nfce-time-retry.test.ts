import assert from "node:assert/strict";
import test from "node:test";
import type { DocumentRecord, DocumentEventRecord } from "../types.js";
import type { InMemoryStore } from "../store.js";
import { prepareHomologationNfceTimeRetry } from "./nfce-time-retry.js";
import { processHomologationNfce } from "./document-processing.js";
const sefaz = require("./sefaz-authorization.js") as typeof import("./sefaz-authorization.js");
const certificates = require("./certificates.js") as typeof import("./certificates.js");
const nfe = require("./nfe-xml.js") as typeof import("./nfe-xml.js");
const xsd = require("./xsd-validator.js") as typeof import("./xsd-validator.js");
const rules = require("./nfce-rules.js") as typeof import("./nfce-rules.js");

const key = "41" + "2610" + "13107823000162" + "65" + "001" + "000000001" + "1" + "12345678" + "0";
const now = new Date("2026-10-20T23:00:00Z");
function fixture() {
  return { id: "doc_time", providerLikeId: "doc_time", tipoDocumento: "NFCe", ambiente: "homologacao",
    issuerCnpj: "13107823000162", numero: 1, serie: 1, chave: key, status: "erro", motivoStatus: "704",
    protocolo: null, sefazReceipt: null, signatureValid: true, xsdValid: true,
    nfceConfigEncrypted: "synthetic", xmlSigned: "old",
    payloadNormalizado: { ide: { dhEmi: "2026-10-20T10:00:00-03:00" } },
    payloadOriginal: { infNFe: { ide: { mod: 65, tpAmb: 2, nNF: 1, serie: 1, dhEmi: "2026-10-20T10:00:00-03:00" }, emit: { CNPJ: "13107823000162" } } }
  } as unknown as DocumentRecord;
}

test("renews only dhEmi on a cloned homologation 704 payload", () => {
  const document = fixture();
  const before = structuredClone(document);
  const refreshed = prepareHomologationNfceTimeRetry(document, now);
  assert.equal(refreshed.issueTime, "2026-10-20T20:00:00-03:00");
  const expected = structuredClone(before.payloadOriginal) as any;
  expected.infNFe.ide.dhEmi = refreshed.issueTime;
  assert.deepEqual(refreshed.payload, expected);
  assert.deepEqual(document, before);
});

test("blocks production, finals, pending receipts, other failures and month changes", () => {
  for (const patch of [ { ambiente: "producao" }, { tipoDocumento: "NFe" }, { status: "autorizado" },
    { status: "cancelado" }, { motivoStatus: "999" }, { protocolo: "123" }, { sefazReceipt: "123" },
    { numero: 2 }, { serie: 2 }, { issuerCnpj: "01997929000108" }, { chave: null } ]) {
    assert.throws(() => prepareHomologationNfceTimeRetry({ ...fixture(), ...patch } as DocumentRecord, now));
  }
  assert.throws(() => prepareHomologationNfceTimeRetry(fixture(), new Date("2026-11-01T12:00:00Z")), /mes/);
});

for (const scenario of ["absent", "authorized", "unavailable", "persistence_failure", "default", "key_change"] as const) {
  test(`time retry preserves the preflight fence: ${scenario}`, async (t) => {
    // tsx exposes non-configurable getters; exercise these integration cases on the deployed CommonJS build.
    if (!Object.getOwnPropertyDescriptor(rules, "assertValidNfceEmissionPayload")?.configurable) {
      t.skip("Run with node --test dist/lib/nfce-time-retry.test.js after npm run build"); return;
    }
    t.mock.timers.enable({ apis: ["Date"], now });
    const document = fixture();
    const oldPayload = structuredClone(document.payloadOriginal);
    const events: DocumentEventRecord[] = [];
    const order: string[] = [];
    let transmissions = 0;
    t.mock.method(rules, "assertValidNfceEmissionPayload", () => undefined);
    t.mock.method(certificates, "openEncryptedCertificate", () => ({ privateKeyPem: "synthetic", certificatePem: "synthetic" }) as any);
    t.mock.method(certificates, "decryptSecretPayload", () => ({ cscId: "1", csc: "synthetic" }));
    t.mock.method(nfe, "generateAndSignNfeXml", (payload: any) => ({ accessKey: scenario === "key_change" && payload.infNFe.ide.dhEmi !== "2026-10-20T10:00:00-03:00" ? key.slice(0, -1) + "1" : key, unsignedXml: "synthetic", signedXml: payload.infNFe.ide.dhEmi, signatureValid: true }));
    t.mock.method(xsd, "validateNfeXml", () => ({ valid: true, errors: [], schema: "synthetic" }));
    t.mock.method(sefaz, "querySefazDocumentStatus", async () => {
      order.push("preflight");
      assert.deepEqual(document.payloadOriginal, oldPayload);
      return { cStat: scenario === "authorized" ? "100" : scenario === "unavailable" ? "108" : "217",
        protocolCStat: scenario === "authorized" ? "100" : "", protocol: scenario === "authorized" ? "123" : "",
        accessKey: key, xMotivo: "synthetic" } as any;
    });
    t.mock.method(sefaz, "authorizeNfeAtSefaz", async (input: any) => {
      order.push("authorize"); transmissions++;
      assert.equal(input.signedXml, scenario === "default" ? "2026-10-20T10:00:00-03:00" : "2026-10-20T20:00:00-03:00");
      assert.deepEqual(order, scenario === "default" ? ["preflight", "authorize"] : ["preflight", "durable_preparation", "authorize"]);
      return { protocolCStat: "100", protocol: "123", accessKey: key } as any;
    });
    const store = {
      findDocument: () => document, findIssuerByCnpj: () => ({ uf: "PR" }),
      findActiveCertificate: () => ({ id: "synthetic", encryptedBundle: "synthetic" }),
      getDocumentEvents: () => events,
      addDocumentEvent: (_id: string, event: DocumentEventRecord) => { events.push(event); },
      saveSignedXml: (_id: string, input: any) => { Object.assign(document, { xmlSigned: input.signedXml }); return document; },
      saveSefazAuthorization: () => { document.status = "autorizado"; return document; },
      failDocument: (_id: string, code: string, reason: string) => { document.status = "erro"; document.motivoStatus = code; document.motivo = reason; return document; },
      waitForPersistence: async () => {
        if (JSON.stringify(document.payloadOriginal) !== JSON.stringify(oldPayload) && !order.includes("durable_preparation")) {
          if (scenario === "persistence_failure") throw new Error("synthetic persistence failure");
          order.push("durable_preparation");
        }
      }
    } as unknown as InMemoryStore;
    const result = await processHomologationNfce(store, document.id, { refreshHomologationIssueTime: scenario !== "default" });
    assert.equal(transmissions, ["absent", "default"].includes(scenario) ? 1 : 0);
    assert.equal(document.numero, 1); assert.equal(document.serie, 1); assert.equal(document.chave, key);
    if (["authorized", "unavailable", "default", "key_change"].includes(scenario)) {
      assert.deepEqual(document.payloadOriginal, oldPayload);
      assert.equal(events.some(e => e.eventType === "homologation_issue_time_refreshed"), false);
    }
    if (scenario === "persistence_failure") assert.match(result.error ?? "", /persistence/);
  });
}
