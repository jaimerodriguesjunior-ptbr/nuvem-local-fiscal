import assert from "node:assert/strict";
import test from "node:test";

import {
  homologationGateSummary,
  homologationMatrix,
  productionBlockingItems,
  scopedBlockedItems
} from "./homologation-matrix.js";

test("matriz de homologacao mantem producao bloqueada enquanto lacunas criticas existem", () => {
  const summary = homologationGateSummary();

  assert.equal(summary.productionReady, false);
  assert.equal(summary.total, homologationMatrix.length);
  assert.deepEqual(summary.blockingIds, [
    "rt-classification-contract",
    "referenciamento-nfe-nfce",
    "retry-queue-distributed-processing",
    "nfse-guaira-ipm-consulta-cancelamento"
  ]);
});

test("itens de bloqueio por escopo nao contam como pendencia escondida", () => {
  assert.deepEqual(
    scopedBlockedItems().map((item) => item.id),
    ["nfce-offline-contingency-scope", "nfe-danfe-print-type-scope"]
  );
});

test("cada item da matriz possui evidencia e proximo passo operacional", () => {
  const ids = new Set<string>();

  for (const item of homologationMatrix) {
    assert.equal(ids.has(item.id), false, `id duplicado: ${item.id}`);
    ids.add(item.id);
    assert.equal(item.evidence.length > 0, true, `sem evidencia: ${item.id}`);
    assert.equal(item.nextAction.trim().length > 0, true, `sem proximo passo: ${item.id}`);
  }
});

test("todo bloqueio de producao aponta uma acao de fechamento", () => {
  for (const item of productionBlockingItems()) {
    assert.match(item.nextAction, /Fechar|Criar|Confirmar/);
  }
});
