import assert from "node:assert/strict";
import test from "node:test";
import { prepareNfeXsdRetryPayload } from "./nfe-xsd-retry.js";
import type { DocumentRecord, DocumentEventRecord } from "../types.js";
const fixture = () => ({ tipoDocumento: "NFe", issuerCnpj: "13107823000162", ambiente: "producao", numero: 4, serie: 3, status: "erro", xsdValid: false, motivo: "XML reprovado no XSD: ordem", payloadOriginal: { infNFe: { ide: { mod: 55, nNF: 4, serie: 3, finNFe: 1, tpNF: 1, tpAmb: 1 }, emit: { CNPJ: "13107823000162" }, det: [{ prod: { uCom: "M3", uTrib: "M3", qCom: 150, qTrib: 150, vUnCom: 80, vUnTrib: 80, vProd: 12000 }, imposto: { IBSCBS: { CST: "000", cClassTrib: "000001" } } }] } } } as unknown as DocumentRecord);
const body = { numero: 4, serie: 3, confirmacao: "RETOMAR MESMA NFE", unidades: ["TON"] };
test("corrige somente unidades e data preservando numero, serie, impostos e valores", () => {
  const doc = fixture();
  const result = prepareNfeXsdRetryPayload(doc, [], body);
  const inf = result.infNFe as { ide: Record<string, unknown>; det: Array<{ prod: Record<string, unknown> }> };
  assert.equal(inf.det[0].prod.uCom, "TON");
  assert.equal(inf.det[0].prod.uTrib, "TON");
  inf.det[0].prod.uCom = "M3"; inf.det[0].prod.uTrib = "M3"; delete inf.ide.dhEmi;
  assert.deepEqual(result, doc.payloadOriginal);
});
test("bloqueia documento autorizado, incerteza externa, identidade diferente e conversao de unidade", () => {
  for (const patch of [{ status: "autorizado" }, { xsdValid: true }, { protocolo: "123" }, { sefazBatchId: "123" }, { sefazResponseXml: "resposta" }]) {
    assert.throws(() => prepareNfeXsdRetryPayload({ ...fixture(), ...patch } as DocumentRecord, [], body));
  }
  assert.throws(() => prepareNfeXsdRetryPayload(fixture(), [{ eventType: "sefaz_preflight_started" } as DocumentEventRecord], body));
  assert.throws(() => prepareNfeXsdRetryPayload(fixture(), [], { ...body, numero: 5 }));
  assert.throws(() => prepareNfeXsdRetryPayload(fixture(), [], { ...body, unidades: ["<TON>"] }));
  const doc = fixture();
  (doc.payloadOriginal as { infNFe: { det: Array<{ prod: { uTrib: string } }> } }).infNFe.det[0].prod.uTrib = "KG";
  assert.throws(() => prepareNfeXsdRetryPayload(doc, [], body));
});
