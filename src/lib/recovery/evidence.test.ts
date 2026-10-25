import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcileConsultation, validateRecoveryDocument } from "./evidence.js";
import { fixtureDocument as doc, fixtureKey, fixtureResponse } from "./test-fixtures.js";

test("matching authorization recovers the exact frozen XML without regeneration", () => {
  const result = reconcileConsultation(doc, fixtureResponse());
  assert.equal(result.state, "authorized");
  if (result.state !== "authorized") return;
  assert.ok(result.processedXml.includes(doc.signedXml));
  assert.equal(result.protocol, "141260000000001");
  assert.equal(result.evidenceXml, fixtureResponse());
});

test("missing/mismatched digest, environment or key never promotes authorization", () => {
  for (const response of [fixtureResponse("100", null), fixtureResponse("100", "wrong"),
    fixtureResponse("100", "dGVzdA==", "9".repeat(44)),
    fixtureResponse().replaceAll("<tpAmb>1</tpAmb>", "<tpAmb>2</tpAmb>")]) {
    assert.equal(reconcileConsultation(doc, response).state, "manual_review");
  }
});

test("217, duplicate and processing do not prove rejection or permit resend", () => {
  for (const code of ["217", "204", "539", "105", "108", "999"]) {
    assert.deepEqual(reconcileConsultation(doc, fixtureResponse(code)), { state: "pending", origin: "sefaz", code });
  }
});

test("ambiguous/unsafe XML and changed bytes fail closed", () => {
  const invalid = ["<broken>", '<!DOCTYPE x [<!ENTITY y "boom">]>' + fixtureResponse(),
    `<root>${fixtureResponse()}${fixtureResponse()}</root>`,
    fixtureResponse().replace("</retConsSitNFe>", "<chNFe>fake</chNFe></retConsSitNFe>")];
  for (const response of invalid) assert.equal(reconcileConsultation(doc, response).state, "manual_review");
  assert.throws(() => validateRecoveryDocument({ ...doc, signedXml: doc.signedXml + " " }));
  assert.throws(() => validateRecoveryDocument({ ...doc, number: 124 }));
  assert.throws(() => validateRecoveryDocument({ ...doc, accessKey: fixtureKey.slice(0,43) + "9" }));
});
