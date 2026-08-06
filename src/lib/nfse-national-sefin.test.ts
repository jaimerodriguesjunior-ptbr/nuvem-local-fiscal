import assert from "node:assert/strict";
import test from "node:test";

import {
  consultNationalDps,
  consultNationalNfse,
  gunzipBase64,
  type NationalSefinTransport,
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

test("consulta DPS e NFS-e pelos endpoints nacionais", async () => {
  const calls: Array<{ method: string; path: string }> = [];
  const transport: NationalSefinTransport = async (options) => {
    calls.push({ method: String(options.method), path: String(options.path) });
    if (options.path?.startsWith("/API/SefinNacional/dps/")) {
      return { statusCode: 200, body: JSON.stringify({ chaveAcesso: "NFS4108809TESTE" }) };
    }
    return { statusCode: 200, body: "<NFSe><infNFSe><chNFSe>NFS4108809TESTE</chNFSe></infNFSe></NFSe>" };
  };
  const shared = {
    endpoint: "https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional",
    privateKeyPem: "private-key",
    certificatePem: "certificate",
    transport
  };
  const dps = await consultNationalDps({ ...shared, dpsId: "DPS410880921234567890123400001000000000000001" });
  const nfse = await consultNationalNfse({ ...shared, accessKey: dps.accessKey! });

  assert.equal(dps.accessKey, "NFS4108809TESTE");
  assert.match(nfse.nfseXml ?? "", /<NFSe>/);
  assert.deepEqual(calls, [
    { method: "GET", path: "/API/SefinNacional/dps/DPS410880921234567890123400001000000000000001" },
    { method: "GET", path: "/API/SefinNacional/nfse/NFS4108809TESTE" }
  ]);
});
