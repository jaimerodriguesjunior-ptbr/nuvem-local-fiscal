import assert from "node:assert/strict";
import test from "node:test";

import {
  gunzipBase64,
  parseNationalSefinResponse,
  transmitNationalDps
} from "./nfse-national-sefin.js";

test("compacta a DPS e monta POST autenticado por certificado para a SEFIN", async () => {
  let requestBody = "";
  let requestPath = "";
  const result = await transmitNationalDps({
    endpoint: "https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional",
    signedDpsXml: "<DPS>assinada</DPS>",
    privateKeyPem: "private-key",
    certificatePem: "certificate",
    transport: async (options, body) => {
      requestPath = String(options.path);
      requestBody = body;
      return { statusCode: 202, body: JSON.stringify({}) };
    }
  });

  assert.equal(requestPath, "/API/SefinNacional/nfse");
  assert.equal(result.accepted, true);
  assert.equal(
    gunzipBase64(JSON.parse(requestBody).dpsXmlGZipB64),
    "<DPS>assinada</DPS>"
  );
});

test("interpreta retorno de rejeicao e XML NFS-e compactado", () => {
  const rejected = parseNationalSefinResponse(
    422,
    JSON.stringify({ erros: [{ Codigo: "E0038", Descricao: "Convenio inativo" }] })
  );
  assert.equal(rejected.accepted, false);
  assert.deepEqual(rejected.errors[0], {
    code: "E0038",
    description: "Convenio inativo",
    detail: null
  });
});
