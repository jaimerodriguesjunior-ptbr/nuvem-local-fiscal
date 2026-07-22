import assert from "node:assert/strict";
import test from "node:test";

import { chunkForPersistence } from "./supabase-persistence.js";

test("divide documentos em lotes pequenos para persistencia", () => {
  const rows = Array.from({ length: 53 }, (_, index) => index + 1);
  const chunks = chunkForPersistence(rows, 25);

  assert.deepEqual(chunks.map((chunk) => chunk.length), [25, 25, 3]);
  assert.deepEqual(chunks.flat(), rows);
});
