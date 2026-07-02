import assert from "node:assert/strict";
import test from "node:test";

import {
  assertNumericCnpj,
  normalizeFiscalIdentifier,
  normalizeNumericCnpj
} from "./fiscal-identity.js";

test("classifica CNPJ numerico, formatado e alfanumerico", () => {
  assert.deepEqual(normalizeFiscalIdentifier("35.181.069/0001-43"), {
    kind: "numeric_cnpj",
    value: "35181069000143",
    digits: "35181069000143"
  });
  assert.equal(normalizeNumericCnpj("35.181.069/0001-43"), "35181069000143");

  assert.deepEqual(normalizeFiscalIdentifier("12ABC34501DE67"), {
    kind: "alpha_cnpj",
    value: "12ABC34501DE67",
    digits: "123450167"
  });

  assert.throws(
    () => assertNumericCnpj("12ABC34501DE67"),
    /CNPJ alfanumerico ainda nao e suportado/
  );
});
