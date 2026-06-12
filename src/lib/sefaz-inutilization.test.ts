import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildInutilizationId
} from "./sefaz-inutilization.js";

test("monta ID de inutilizacao conforme campos fiscais", () => {
  assert.equal(
    buildInutilizationId({
      stateCode: "41",
      ano: 26,
      cnpj: "01997929000108",
      model: "65",
      serie: 2,
      numeroInicial: 90,
      numeroFinal: 90
    }),
    "ID41260199792900010865002000000090000000090"
  );
});
