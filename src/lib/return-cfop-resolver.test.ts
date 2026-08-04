import assert from "node:assert/strict";
import test from "node:test";

import { applyReturnCfopResolution, resolveReturnCfop } from "./return-cfop-resolver.js";
import type { ReturnCfopRule } from "../types.js";

const rules: ReturnCfopRule[] = [
  {
    id: "resale",
    companyCnpj: null,
    sourceCfop: "5102",
    profile: "resale_standard",
    conditions: {},
    sameStateCfop: "5202",
    interstateCfop: "6202",
    riskLevel: "low",
    active: true,
    source: "test",
    createdAt: "2026-08-04T00:00:00.000Z",
    updatedAt: "2026-08-04T00:00:00.000Z"
  }
];

function payload(overrides: Record<string, unknown> = {}) {
  return {
    infNFe: {
      ide: { finNFe: 4 },
      dest: { enderDest: { UF: "PR" } },
      det: [{ nItem: 1, prod: { cProd: "P1", CFOP: "5202" } }],
      metadados: { devolucao: { itens: [{ nItem: 1, cfopOrigem: "5102" }] } },
      ...overrides
    }
  };
}

test("nao altera NF-e que nao seja devolucao", () => {
  const result = resolveReturnCfop({ infNFe: { ide: { finNFe: 1 } } }, "PR", rules);
  assert.equal(result.isReturn, false);
  assert.equal(result.needsReview, false);
});

test("resolve devolucao de revenda por regra central", () => {
  const input = payload();
  const result = resolveReturnCfop(input, "PR", rules);
  assert.equal(result.shouldBlock, false);
  assert.equal(result.needsReview, false);
  assert.equal(result.items[0].outputCfop, "5202");
  assert.equal(result.items[0].fallbackApplied, false);
  const normalized = applyReturnCfopResolution(input, result) as any;
  assert.equal(normalized.infNFe.det[0].prod.CFOP, "5202");
});

test("usa fallback e cria pendencia quando a combinacao ainda nao existe", () => {
  const input = payload({
    dest: { enderDest: { UF: "SP" } },
    metadados: { devolucao: { itens: [{ nItem: 1, cfopOrigem: "5405", st: true, cest: "0100100" }] } }
  });
  const result = resolveReturnCfop(input, "PR", rules);
  assert.equal(result.shouldBlock, false);
  assert.equal(result.needsReview, true);
  assert.equal(result.items[0].riskLevel, "medium");
  assert.equal(result.items[0].outputCfop, "6202");
  assert.equal(result.items[0].fallbackApplied, true);
});

test("bloqueia apenas quando a origem informa uso e consumo ou ativo", () => {
  const input = payload({
    metadados: { devolucao: { itens: [{ nItem: 1, cfopOrigem: "5102", finalidadeCompra: "uso_consumo" }] } }
  });
  const result = resolveReturnCfop(input, "PR", rules);
  assert.equal(result.shouldBlock, true);
  assert.match(result.clientMessage ?? "", /validacao fiscal especifica/i);
  assert.equal(result.items[0].outputCfop, null);
});
