import assert from "node:assert/strict";
import test from "node:test";

import { buildMvpActivationChecklist } from "./mvp-activation-checklist.js";

test("monta checklist de ativacao para empresa com NFC-e, NF-e e NFS-e", () => {
  const checklist = buildMvpActivationChecklist(["nfce", "nfe", "nfse"]);
  const ids = checklist.map((item) => item.id);

  assert.equal(ids.includes("company-fiscal-registration"), true);
  assert.equal(ids.includes("support-fallback"), true);
  assert.equal(ids.includes("nfce-csc"), true);
  assert.equal(ids.includes("nfe-sale-return-smoke"), true);
  assert.equal(ids.includes("nfse-provider-profile"), true);
});

test("nao duplica itens quando o mesmo documento aparece mais de uma vez", () => {
  const checklist = buildMvpActivationChecklist(["nfe", "nfe"]);
  const ids = checklist.map((item) => item.id);

  assert.equal(ids.filter((id) => id === "nfe-sale-return-smoke").length, 1);
});
