import assert from "node:assert/strict";
import test from "node:test";

import { validateDocumentReferences } from "./document-reference-rules.js";

const VALID_ACCESS_KEY = "41260612345678000195550010000001231000001234";

test("aceita finalidade normal sem documento referenciado", () => {
  const result = validateDocumentReferences({
    infNFe: {
      ide: {
        finNFe: 1
      }
    }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
});

test("exige NFref em finalidade que referencia documento anterior", () => {
  const result = validateDocumentReferences({
    infNFe: {
      ide: {
        finNFe: 4
      }
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.issues.some((issue) => issue.code === "missing_document_reference"), true);
});

test("aceita referencia por chave de NF-e com 44 digitos", () => {
  const result = validateDocumentReferences({
    infNFe: {
      ide: {
        finNFe: 4,
        NFref: [{ refNFe: VALID_ACCESS_KEY }]
      }
    }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
});

test("bloqueia chave referenciada fora do formato fiscal", () => {
  const result = validateDocumentReferences({
    infNFe: {
      ide: {
        finNFe: 4,
        NFref: [{ refNFe: "123" }]
      }
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.issues.some((issue) => issue.code === "invalid_document_reference_key"), true);
});

test("bloqueia NFref ambiguo com mais de um tipo de referencia", () => {
  const result = validateDocumentReferences({
    infNFe: {
      ide: {
        finNFe: 4,
        NFref: [{ refNFe: VALID_ACCESS_KEY, refCTe: VALID_ACCESS_KEY }]
      }
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.issues.some((issue) => issue.code === "ambiguous_document_reference"), true);
});

test("valida referencia de cupom fiscal ECF", () => {
  const result = validateDocumentReferences({
    infNFe: {
      ide: {
        finNFe: 4,
        NFref: [{ refECF: { mod: "2D", nECF: "1", nCOO: "123" } }]
      }
    }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
});
