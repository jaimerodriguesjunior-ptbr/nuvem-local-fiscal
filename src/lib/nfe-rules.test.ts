import assert from "node:assert/strict";
import test from "node:test";

import { validateNfeEmissionPayload } from "./nfe-rules.js";

function minimalNfePayload(overrides: Record<string, unknown> = {}) {
  return {
    ambiente: "homologacao",
    infNFe: {
      ide: {
        mod: 55,
        tpImp: 1,
        ...overrides
      }
    }
  };
}

test("NF-e aceita modelo 55 com DANFE A4 retrato", () => {
  const result = validateNfeEmissionPayload(minimalNfePayload());

  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
});

test("NF-e bloqueia tipo de impressao DANFE fora do layout local validado", () => {
  const result = validateNfeEmissionPayload(minimalNfePayload({ tpImp: 3 }));

  assert.equal(result.ok, false);
  assert.equal(
    result.issues.some((issue) => issue.code === "unsupported_nfe_danfe_print_type"),
    true
  );
});

test("NF-e bloqueia payload de outro modelo no endpoint /nfe", () => {
  const result = validateNfeEmissionPayload(minimalNfePayload({ mod: 65 }));

  assert.equal(result.ok, false);
  assert.equal(result.issues.some((issue) => issue.code === "invalid_model"), true);
});

test("NF-e preserva contrato RTC de modelo 55 para grupos IBSCBS", () => {
  const result = validateNfeEmissionPayload({
    ambiente: "homologacao",
    infNFe: {
      ide: {
        mod: 65,
        tpImp: 1
      },
      det: [
        {
          imposto: {
            IBSCBS: {
              CST: "000",
              cClassTrib: "000001",
              gIBSCBS: {
                vBC: 0
              }
            }
          }
        }
      ]
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.issues.some((issue) => issue.code === "rtc_model_mismatch"), true);
});

test("NF-e sem ide continua compativel quando nao ha grupo RTC para validar", () => {
  const result = validateNfeEmissionPayload({
    ambiente: "homologacao",
    emitente: {
      cnpj: "12345678000195"
    }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
});
