import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Fastify from "fastify";
import { registerDocumentRoutes } from "../routes/documents.js";
import type { InMemoryStore } from "../store.js";
import type { DocumentRecord } from "../types.js";

function fixture(count: number, model: "NFCe" | "NFe", cancelled: boolean, long: boolean) {
  const items = Array.from({ length: count }, (_, i) => `<det nItem="${i + 1}"><prod><cProd>PROD${String(i + 1).padStart(3, "0")}</cProd><xProd>${long ? "LENTE MULTIFOCAL COM TRATAMENTO ANTIRREFLEXO E PROTECAO ULTRAVIOLETA CODIGOSEMESPACOSABCDEFGHIJ0123456789 " : "LENTE OFTALMICA "}${i + 1}</xProd><qCom>2.0000</qCom><uCom>UN</uCom><vUnCom>1499.95</vUnCom><vProd>2999.90</vProd></prod></det>`).join("");
  return {
    id: "doc_print_test", tipoDocumento: model, issuerCnpj: "13107823000162", ambiente: "homologacao",
    numero: 123, serie: 1, status: cancelled ? "cancelado" : "autorizado", chave: "41261113107823000162650010000001231000000010", protocolo: "141260000000000",
    xml: `<nfeProc><NFe><infNFe><ide><nNF>123</nNF><serie>1</serie><tpAmb>2</tpAmb><dhEmi>2026-11-13T10:00:00-03:00</dhEmi></ide><emit><CNPJ>13107823000162</CNPJ><xNome>${long ? "OTICA EMPRESA DE TESTE COM RAZAO SOCIAL MUITO LONGA PARA CONFERIR QUEBRA DE LINHAS" : "OTICA DE TESTE"}</xNome><IE>1234567890</IE><enderEmit><xLgr>RUA DE TESTE COM ENDERECO COMPRIDO</xLgr><nro>1234</nro><xBairro>CENTRO</xBairro><xMun>TOLEDO</xMun><UF>PR</UF><CEP>85900000</CEP></enderEmit></emit><dest>${cancelled ? "<CNPJ>13107823000162</CNPJ>" : "<CPF>12345678909</CPF>"}<xNome>${long ? "CONSUMIDOR DE TESTE COM NOME COMPLETO MUITO COMPRIDO PARA VALIDAR MARGENS" : "CONSUMIDOR DE TESTE"}</xNome></dest>${items}<total><ICMSTot><vNF>2999.90</vNF><vProd>2999.90</vProd></ICMSTot></total><pag><detPag><tPag>01</tPag><vPag>2999.90</vPag></detPag></pag></infNFe><infNFeSupl><qrCode>https://example.com/nfce?p=41261113107823000162650010000001231000000010|2|2|1|ABCDEF</qrCode><urlChave>https://example.com/consulta/nfce</urlChave></infNFeSupl></NFe><protNFe><infProt><chNFe>41261113107823000162650010000001231000000010</chNFe><nProt>141260000000000</nProt><dhRecbto>2026-11-13T10:00:01-03:00</dhRecbto></infProt></protNFe></nfeProc>`
  } as unknown as DocumentRecord;
}

for (const [name, count, model, cancelled, long] of [
  ["short", 1, "NFCe", false, false],
  ["long", 75, "NFCe", false, true],
  ["cancelled", 3, "NFCe", true, true],
  ["a4", 1, "NFe", false, false],
] as const) {
  test(`PDF ${name}: dimensions, content, access and immutable source`, async () => {
    const document = fixture(count, model, cancelled, long);
    const before = JSON.stringify(document);
    const store = {
      findToken: (token: string) => token === "valid" ? { token, clientId: "test", scopes: ["nfe", "nfce"], environments: ["homologacao"], allowedCnpjs: [document.issuerCnpj] } : null,
      findDocument: () => document,
      findIssuerByCnpj: () => null,
    } as unknown as InMemoryStore;
    const app = Fastify({ logger: false });
    app.decorate("store", store);
    await app.register(registerDocumentRoutes);
    try {
      const url = `/${model.toLowerCase()}/${document.id}/pdf`;
      assert.equal((await app.inject({ url })).statusCode, 401);
      const response = await app.inject({ url, headers: { authorization: "Bearer valid" } });
      assert.equal(response.statusCode, 200, response.body);
      assert.match(String(response.headers["content-type"]), /application\/pdf/);
      const box = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(response.body)!;
      assert.ok(box);
      if (model === "NFCe") {
        assert.ok(Math.abs(Number(box[1]) * 25.4 / 72 - 80) < 0.001);
        if (long && count === 75) assert.ok(Number(box[2]) > 3000);
        for (let i = 1; i <= count; i++) assert.ok(response.body.includes(`PROD${String(i).padStart(3, "0")}`));
        assert.match(response.body, /Mente Binaria/);
        assert.match(response.body, /141260000000000/);
        assert.ok(response.body.includes(cancelled ? "CNPJ: 13.107.823/0001-62" : "CPF: 123.456.789-09"));
        assert.match(response.body, /Consulta via QR Code/);
        if (cancelled) assert.match(response.body, /NFC-e CANCELADA/);
        for (const match of response.body.matchAll(/BT \/F\d [\d.]+ Tf [\d.]+ (-?[\d.]+) Td/g)) {
          assert.ok(Number(match[1]) >= 12 && Number(match[1]) < Number(box[2]), `text outside page: ${match[0]}`);
        }
      } else {
        assert.equal(Number(box[1]), 595);
        assert.equal(Number(box[2]), 842);
      }
      assert.equal(JSON.stringify(document), before);
      if (process.env.NFCE_PRINT_VALIDATION_DIR) {
        mkdirSync(process.env.NFCE_PRINT_VALIDATION_DIR, { recursive: true });
        writeFileSync(join(process.env.NFCE_PRINT_VALIDATION_DIR, `${name}.pdf`), response.rawPayload);
      }
    } finally { await app.close(); }
  });
}
