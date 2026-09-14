import assert from "node:assert/strict";
import test from "node:test";

import {
  consultNationalDps,
  consultNationalNfse,
  gzipBase64,
  gunzipBase64,
  type NationalSefinTransport,
  parseNationalSefinEventResponse,
  parseNationalSefinResponse,
  transmitNationalCancellation,
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
      return { statusCode: 201, body: JSON.stringify({}) };
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

test("interpreta o erro singular devolvido pelas consultas da SEFIN", () => {
  const rejected = parseNationalSefinResponse(
    403,
    JSON.stringify({ erro: { codigo: "403", descricao: "Sigilo fiscal" } })
  );
  assert.equal(rejected.accepted, false);
  assert.deepEqual(rejected.errors, [{
    code: "403",
    description: "Sigilo fiscal",
    detail: null
  }]);
});

test("evento de cancelamento so aceita cStat 135 explicito", () => {
  const accepted = parseNationalSefinEventResponse(
    200,
    JSON.stringify({ codigoStatus: "135", motivoStatus: "Evento registrado" })
  );
  assert.equal(accepted.accepted, true);

  const empty = parseNationalSefinEventResponse(200, "");
  assert.equal(empty.accepted, false);
  assert.equal(empty.errors[0]?.code, "SEFIN_EVENTO_STATUS_AUSENTE");

  const unexpected = parseNationalSefinEventResponse(
    200,
    JSON.stringify({ codigoStatus: "136", motivoStatus: "Status sem confirmacao" })
  );
  assert.equal(unexpected.accepted, false);
  assert.equal(unexpected.errors[0]?.code, "SEFIN_EVENTO_STATUS_NAO_CONFIRMADO");
});

test("evento Nacional retornado e assinado pela SEFIN confirma cancelamento sem cStat", () => {
  const eventXml =
    '<?xml version="1.0"?><evento xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01">' +
    '<infEvento Id="EVT41088092268667353000183000000000000226098587746845101101001">' +
    '<verAplic>SefinNacional_1.6.0</verAplic><nSeqEvento>1</nSeqEvento>' +
    '<pedRegEvento><infPedReg><e101101><xDesc>Cancelamento de NFS-e</xDesc>' +
    '</e101101></infPedReg></pedRegEvento></infEvento><Signature /></evento>';
  const parsed = parseNationalSefinEventResponse(
    201,
    JSON.stringify({ eventoXmlGZipB64: gzipBase64(eventXml) })
  );

  assert.equal(parsed.accepted, true);
  assert.equal(parsed.eventStatusCode, "EVENT_REGISTERED");
  assert.equal(parsed.eventReason, "Evento de cancelamento registrado pela SEFIN Nacional.");
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.processedXml, eventXml);
});

test("evento de cancelamento interpreta erro singular da SEFIN", () => {
  const rejected = parseNationalSefinEventResponse(
    422,
    JSON.stringify({ erro: { codigo: "E9999", descricao: "Evento rejeitado" } })
  );
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.errors[0]?.code, "E9999");
});

test("evento de cancelamento usa o nome oficial do campo compactado", async () => {
  let requestBody = "";
  let requestPath = "";
  await transmitNationalCancellation({
    endpoint: "https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional",
    accessKey: "41088091235181069000143000000000000226020000000002",
    signedEventXml: "<pedRegEvento>assinado</pedRegEvento>",
    privateKeyPem: "private-key",
    certificatePem: "certificate",
    transport: async (options, body) => {
      requestPath = String(options.path);
      requestBody = body;
      return {
        statusCode: 200,
        body: JSON.stringify({ codigoStatus: "135", motivoStatus: "Evento registrado" })
      };
    }
  });

  assert.equal(
    requestPath,
    "/API/SefinNacional/nfse/41088091235181069000143000000000000226020000000002/eventos"
  );
  const parsedBody = JSON.parse(requestBody);
  assert.deepEqual(Object.keys(parsedBody), ["pedidoRegistroEventoXmlGZipB64"]);
  assert.equal(
    gunzipBase64(parsedBody.pedidoRegistroEventoXmlGZipB64),
    "<pedRegEvento>assinado</pedRegEvento>"
  );
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
