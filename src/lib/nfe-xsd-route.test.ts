import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerDocumentRoutes } from "../routes/documents.js";
import type { InMemoryStore } from "../store.js";
import type { DocumentRecord, DocumentEventRecord } from "../types.js";

test("retomada HTTP exige acesso, impede duplicidade e preserva o documento", async () => {
  const document = { id: "doc_xsd_test", providerLikeId: "doc_xsd_test", tipoDocumento: "NFe", issuerCnpj: "13107823000162", ambiente: "homologacao", numero: 4, serie: 3, status: "erro", xsdValid: false, motivo: "XML reprovado no XSD: ordem", payloadOriginal: { infNFe: { ide: { mod: 55, nNF: 4, serie: 3, finNFe: 1, tpNF: 1, tpAmb: 2, tpImp: 1 }, emit: { CNPJ: "13107823000162" }, det: [{ prod: { CFOP: "5101", uCom: "M3", uTrib: "M3", qCom: 150, qTrib: 150, vUnCom: 80, vUnTrib: 80 } }] } } } as unknown as DocumentRecord;
  const events: DocumentEventRecord[] = [];
  let preparations = 0;
  const store = {
    findToken: (token: string) => token === "valid" ? { token, clientId: "test", scopes: ["nfe"], environments: ["homologacao"], allowedCnpjs: [document.issuerCnpj] } : token === "foreign" ? { token, clientId: "other", scopes: ["nfe"], environments: ["homologacao"], allowedCnpjs: ["01997929000108"] } : null,
    findDocument: () => document,
    findServiceConfigRecord: () => null,
    getDocumentEvents: () => events,
    prepareNfeXsdRetry: (_id: string, payload: unknown) => { preparations++; document.payloadOriginal = payload; document.status = "processamento"; },
    addDocumentEvent: (_id: string, event: DocumentEventRecord) => { events.push(event); },
    waitForPersistence: () => new Promise(resolve => setTimeout(resolve, 20)),
    findIssuerByCnpj: () => null,
    findActiveCertificate: () => null,
    failDocument: (_id: string, code: string, message: string) => { document.status = "erro"; document.motivoStatus = code; document.motivo = message; return document; },
  } as unknown as InMemoryStore;
  const app = Fastify({ logger: false });
  app.decorate("store", store);
  await app.register(registerDocumentRoutes);
  await app.ready();
  const url = "/nfe/doc_xsd_test/retomar-xsd";
  const payload = { numero: 4, serie: 3, confirmacao: "RETOMAR MESMA NFE", unidades: ["TON"] };
  try {
    assert.equal((await app.inject({ method: "POST", url, payload })).statusCode, 401);
    assert.equal((await app.inject({ method: "POST", url, headers: { authorization: "Bearer foreign" }, payload })).statusCode, 403);
    const headers = { authorization: "Bearer valid" };
    assert.equal((await app.inject({ method: "POST", url, headers, payload: { ...payload, numero: 5 } })).statusCode, 409);
    assert.equal(preparations, 0);
    const responses = await Promise.all([app.inject({ method: "POST", url, headers, payload }), app.inject({ method: "POST", url, headers, payload })]);
    assert.deepEqual(responses.map(response => response.statusCode).sort(), [409, 422]);
    assert.equal(preparations, 1);
    const processed = responses.find(response => response.statusCode === 422)!.json();
    assert.equal(processed.id, document.id);
    assert.equal(processed.numero, 4);
    assert.equal(processed.serie, 3);
    assert.equal(processed.transmitido, false);
    assert.equal((document.payloadOriginal as { infNFe: { det: Array<{ prod: { uCom: string } }> } }).infNFe.det[0].prod.uCom, "TON");
    assert.equal((await app.inject({ method: "POST", url, headers, payload })).statusCode, 409);
  } finally { await app.close(); }
});
