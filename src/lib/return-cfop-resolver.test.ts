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

test("aceita a finalidade documentada em portugues para regra semeada em ingles", () => {
  const seededRules = rules.map((rule) => ({
    ...rule,
    conditions: { purchasePurpose: "resale" }
  }));
  const input = payload({
    metadados: { devolucao: { itens: [{ nItem: 1, cfopOrigem: "5102", finalidadeCompra: "revenda" }] } }
  });
  const result = resolveReturnCfop(input, "PR", seededRules);
  assert.equal(result.needsReview, false);
  assert.equal(result.items[0].profile, "resale_standard");
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

test("herda a finalidade global da devolucao quando o item nao a repete", () => {
  const input = payload({
    metadados: { devolucao: { finalidadeCompra: "uso e consumo", itens: [{ nItem: 1, cfopOrigem: "5102" }] } }
  });
  const result = resolveReturnCfop(input, "PR", rules);
  assert.equal(result.shouldBlock, true);
  assert.equal(result.items[0].profile, "review_required");
});

test("exige revisao para devolucao ao exterior em vez de aplicar fallback interestadual", () => {
  const input = payload({ dest: { enderDest: { UF: "EX" } } });
  const result = resolveReturnCfop(input, "PR", rules);
  assert.equal(result.shouldBlock, true);
  assert.equal(result.items[0].profile, "exterior_review_required");
  assert.equal(result.items[0].outputCfop, null);
});
test("preserva CFOP 5411 explicito apenas no opt-in da devolucao", () => {
  const input = {
    metadados: {
      devolucao: {
        finalidadeCompra: "revenda",
        manualCfopOverrideV1: true,
        itens: [
          { nItem: 1, cProd: "P1", cfopOrigem: "5405", cfopManual: true, cfopDestino: "5411", st: true },
          { nItem: 2, cProd: "P2", cfopOrigem: "5405", cfopManual: true, cfopDestino: "5411", st: true }
        ]
      }
    },
    infNFe: {
      ide: { finNFe: 4 },
      dest: { enderDest: { UF: "PR" } },
      det: [
        { nItem: 1, prod: { cProd: "P1", CFOP: "5411" } },
        { nItem: 2, prod: { cProd: "P2", CFOP: "5411" } }
      ]
    }
  };

  const manualResult = resolveReturnCfop(input, "PR", rules);
  assert.equal(manualResult.shouldBlock, false);
  assert.deepEqual(manualResult.items.map((item) => item.profile), [
    "client_manual_override_v1",
    "client_manual_override_v1"
  ]);
  const manualPayload = applyReturnCfopResolution(input, manualResult) as unknown as typeof input;
  assert.deepEqual(manualPayload.infNFe.det.map((item) => item.prod.CFOP), ["5411", "5411"]);

  const legacyPayload = structuredClone(input);
  legacyPayload.metadados.devolucao.manualCfopOverrideV1 = false;
  const legacyResult = resolveReturnCfop(legacyPayload, "PR", rules);
  assert.equal(legacyResult.shouldBlock, false);
  assert.deepEqual(legacyResult.items.map((item) => item.outputCfop), ["5202", "5202"]);
  const legacyNormalized = applyReturnCfopResolution(legacyPayload, legacyResult) as unknown as typeof input;
  assert.deepEqual(legacyNormalized.infNFe.det.map((item) => item.prod.CFOP), ["5202", "5202"]);
});

test("bloqueia override manual divergente antes de mudar o CFOP", () => {
  const input = payload({
    det: [{ nItem: 1, prod: { cProd: "P1", CFOP: "5411" } }],
    metadados: {
      devolucao: {
        manualCfopOverrideV1: true,
        itens: [{ nItem: 1, cfopOrigem: "5405", cfopManual: true, cfopDestino: "5202" }]
      }
    }
  });
  const result = resolveReturnCfop(input, "PR", rules);
  assert.equal(result.shouldBlock, true);
  assert.equal(result.items[0].profile, "invalid_client_manual_override_v1");
  assert.equal(result.items[0].outputCfop, null);
});
