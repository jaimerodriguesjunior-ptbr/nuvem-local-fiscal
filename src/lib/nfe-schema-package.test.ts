import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  NFE_SCHEMA_PACKAGE,
  nfeSchemaPath
} from "./nfe-schema-package.js";

test("pacote XSD NF-e/NFC-e local bate com o PL_010c oficial validado em 2026-07-02", () => {
  assert.equal(NFE_SCHEMA_PACKAGE.id, "PL_010c_NT2022_002v1.30");
  assert.equal(NFE_SCHEMA_PACKAGE.svrsListedAt, "2026-03-20");

  for (const [fileName, expectedHash] of Object.entries(NFE_SCHEMA_PACKAGE.files)) {
    const filePath = nfeSchemaPath(fileName as keyof typeof NFE_SCHEMA_PACKAGE.files);
    const actualHash = createHash("sha256")
      .update(readFileSync(filePath))
      .digest("hex")
      .toUpperCase();

    assert.equal(actualHash, expectedHash, `${fileName} diverge do pacote oficial`);
  }
});
