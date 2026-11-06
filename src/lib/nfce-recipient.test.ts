import assert from "node:assert/strict";
import test from "node:test";
import { nfceRecipientLines } from "./nfce-recipient.js";

test("CPF without a name identifies the NFC-e consumer", () => {
  assert.deepEqual(nfceRecipientLines("", "12345678909"), ["CPF: 123.456.789-09"]);
});
test("name and CPF are both printed", () => {
  assert.deepEqual(nfceRecipientLines(" CLIENTE ", "123.456.789-09"), ["CLIENTE", "CPF: 123.456.789-09"]);
});
test("CNPJ identifies the consumer with or without a name", () => {
  assert.deepEqual(nfceRecipientLines("", "12345678000195"), ["CNPJ: 12.345.678/0001-95"]);
  assert.deepEqual(nfceRecipientLines("EMPRESA", "12.345.678/0001-95"), ["EMPRESA", "CNPJ: 12.345.678/0001-95"]);
});
test("a name alone is preserved and an absent recipient stays unidentified", () => {
  assert.deepEqual(nfceRecipientLines("CLIENTE", ""), ["CLIENTE"]);
  assert.deepEqual(nfceRecipientLines(" ", ""), ["CONSUMIDOR NAO IDENTIFICADO"]);
});
