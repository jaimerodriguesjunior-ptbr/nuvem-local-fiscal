import assert from "node:assert/strict";
import test from "node:test";

import { formatMunicipioUfLabel, resolveIbgeMunicipality } from "./ibge-municipios.js";

test("resolve IBGE municipality names used in DANFSe", () => {
  assert.deepEqual(resolveIbgeMunicipality("5000609"), {
    codigo: "5000609",
    nome: "Amambai",
    uf: "MS"
  });
  assert.equal(resolveIbgeMunicipality(4108809)?.nome, "Guaíra");
  assert.equal(resolveIbgeMunicipality("4127700")?.uf, "PR");
  assert.equal(resolveIbgeMunicipality("123"), null);
});

test("DANFSe municipality label falls back to IBGE when XML has only cMun", () => {
  assert.equal(
    formatMunicipioUfLabel({ codigoIbge: "5000609" }),
    "Amambai / MS"
  );
  assert.equal(
    formatMunicipioUfLabel({ nome: "Toledo", uf: "PR", codigoIbge: "4127700" }),
    "Toledo / PR"
  );
  assert.equal(formatMunicipioUfLabel({}), "");
});
