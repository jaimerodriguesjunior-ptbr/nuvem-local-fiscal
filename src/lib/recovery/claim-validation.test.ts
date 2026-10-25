import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeRecoveryClaim } from "./claim-validation.js";
import { fixtureDocument } from "./test-fixtures.js";

const claim = { lease: { id: "11111111-1111-1111-1111-111111111111",
  token: "22222222-2222-2222-2222-222222222222", version: 2, attempt: 1, document: fixtureDocument }, nextWakeAt: 1_800_000_000_000 };

test("RPC decoder refuses malformed timers/leases without coercing legacy values", () => {
  for (const value of [null, [], {}, { lease: null }, { lease: null, nextWakeAt: "1800000000000" },
    { lease: null, nextWakeAt: NaN }, { lease: null, nextWakeAt: -1 },
    { ...claim, lease: { ...claim.lease, version: null } },
    { ...claim, lease: { ...claim.lease, version: "2" } },
    { ...claim, lease: { ...claim.lease, token: "-".repeat(36) } },
    { ...claim, lease: { ...claim.lease, document: { ...fixtureDocument, series: 0 } } },
    { ...claim, lease: { ...claim.lease, document: { ...fixtureDocument, signedXml: "changed" } } }]) {
    assert.throws(() => decodeRecoveryClaim(value), /RECOVERY_CLAIM_INVALID/);
  }
});

test("RPC decoder accepts the durable contract and preserves exact frozen bytes", () => {
  assert.deepEqual(decodeRecoveryClaim(claim), claim);
  assert.deepEqual(decodeRecoveryClaim({ lease: null, nextWakeAt: null }), { lease: null, nextWakeAt: null });
  const extra = { ...claim, lease: { ...claim.lease, document: { ...fixtureDocument, unexpectedSecret: "discarded" } } };
  assert.equal("unexpectedSecret" in decodeRecoveryClaim(extra).lease!.document, false);
});
