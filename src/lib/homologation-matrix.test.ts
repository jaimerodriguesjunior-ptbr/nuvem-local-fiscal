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

test("MVP operacional fica registrado como escopo satisfeito", () => {
  const item = homologationMatrix.find((matrixItem) => matrixItem.id === "mvp-operational-scope");

  assert.equal(item?.status, "satisfied");
  assert.equal(item?.evidence.some((evidence) => evidence.includes("NF-e MVP aceita")), true);
  assert.equal(item?.evidence.some((evidence) => evidence.includes("NFC-e MVP aceita")), true);
});

test("devolucao NF-e homologada fica registrada como fluxo satisfeito", () => {
  const item = homologationMatrix.find(
    (matrixItem) => matrixItem.id === "nfe-pr-autoeletrica-return-reference"
  );

  assert.equal(item?.status, "satisfied");
  assert.equal(item?.evidence.some((evidence) => evidence.includes("nfe-4.xml")), true);
});

test("referenciamento NF-e fica satisfeito com devolucao, complemento e ajuste homologados", () => {
  const item = homologationMatrix.find(
    (matrixItem) => matrixItem.id === "referenciamento-nfe-nfce"
  );

  assert.equal(item?.status, "satisfied");
  assert.equal(item?.evidence.some((evidence) => evidence.includes("nfe-4.xml")), true);
  assert.equal(item?.evidence.some((evidence) => evidence.includes("nfe-5.xml")), true);
  assert.equal(item?.evidence.some((evidence) => evidence.includes("nfe-7.xml")), true);
});

test("NFS-e MVP registra Toledo satisfeito e Guaira com cancelamento aberto", () => {
  const guaira = homologationMatrix.find(
    (matrixItem) => matrixItem.id === "nfse-guaira-ipm-consulta-cancelamento"
  );
  const toledo = homologationMatrix.find(
    (matrixItem) => matrixItem.id === "nfse-toledo-equiplano"
  );

  assert.equal(guaira?.status, "blocks_production");
  assert.equal(guaira?.evidence.some((evidence) => evidence.includes("nfse-15.xml")), true);
  assert.equal(guaira?.nextAction.includes("Cancelar em homologacao"), true);
  assert.equal(toledo?.status, "satisfied");
  assert.equal(toledo?.evidence.some((evidence) => evidence.includes("nfse-5.xml")), true);
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
    assert.match(item.nextAction, /Carregar|Conciliar|Fechar|Criar|Confirmar|Homologar|Cancelar/);
  }
});
