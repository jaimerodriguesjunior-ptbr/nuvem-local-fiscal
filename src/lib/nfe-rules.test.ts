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

function nfePayloadWithItem(
  ideOverrides: Record<string, unknown>,
  cfop: string
) {
  const payload = minimalNfePayload(ideOverrides);
  Object.assign(payload.infNFe, {
    det: [
      {
        prod: {
          CFOP: cfop
        }
      }
    ]
  });
  return payload;
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

test("NF-e exige documento referenciado quando a finalidade nao e normal", () => {
  const result = validateNfeEmissionPayload(minimalNfePayload({ finNFe: 4 }));

  assert.equal(result.ok, false);
  assert.equal(result.issues.some((issue) => issue.code === "missing_document_reference"), true);
});

test("NF-e aceita documento referenciado por chave fiscal valida", () => {
  const result = validateNfeEmissionPayload(
    minimalNfePayload({
      finNFe: 4,
      NFref: [{ refNFe: "41260612345678000195550010000001231000001234" }]
    })
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
});

test("NF-e bloqueia CFOP fora do MVP de venda e devolucao", () => {
  const sale = validateNfeEmissionPayload(nfePayloadWithItem({ finNFe: 1 }, "5949"));
  const returnNfe = validateNfeEmissionPayload(
    nfePayloadWithItem(
      {
        finNFe: 4,
        NFref: [{ refNFe: "41260612345678000195550010000001231000001234" }]
      },
      "6202"
    )
  );

  assert.equal(sale.ok, false);
  assert.equal(sale.issues.some((issue) => issue.code === "unsupported_mvp_nfe_cfop"), true);
  assert.equal(returnNfe.ok, true);
  assert.deepEqual(returnNfe.issues, []);
});

test("NF-e bloqueia complemento e ajuste no MVP mesmo com NFref valido", () => {
  for (const finality of [2, 3, 5, 6]) {
    const result = validateNfeEmissionPayload(
      minimalNfePayload({
        finNFe: finality,
        NFref: [{ refNFe: "41260612345678000195550010000001231000001234" }]
      })
    );

    assert.equal(result.ok, false);
    assert.equal(
      result.issues.some((issue) => issue.code === "unsupported_mvp_nfe_finality"),
      true
    );
  }
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
