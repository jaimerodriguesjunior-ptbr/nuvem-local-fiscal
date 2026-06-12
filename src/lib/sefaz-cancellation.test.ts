import assert from "node:assert/strict";
import test from "node:test";

import forge from "node-forge";

import {
  buildCancellationEventId,
  buildSignedCancellationXml,
  parseCancellationResponse
} from "./sefaz-cancellation.js";

function createCertificate() {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const certificate = forge.pki.createCertificate();
  certificate.publicKey = keys.publicKey;
  certificate.serialNumber = "03";
  certificate.validity.notBefore = new Date(Date.now() - 60_000);
  certificate.validity.notAfter = new Date(Date.now() + 86_400_000);
  certificate.setSubject([{ name: "commonName", value: "Cancelamento Teste" }]);
  certificate.setIssuer(certificate.subject.attributes);
  certificate.sign(keys.privateKey, forge.md.sha256.create());
  return {
    privateKeyPem: forge.pki.privateKeyToPem(keys.privateKey),
    certificatePem: forge.pki.certificateToPem(certificate)
  };
}

test("monta ID do evento de cancelamento", () => {
  const key = "41260601997929000108650020000000841689972490";
  assert.equal(
    buildCancellationEventId(key),
    `ID110111${key}01`
  );
});

test("monta e assina lote de cancelamento", () => {
  const certificate = createCertificate();
  const result = buildSignedCancellationXml({
    uf: "PR",
    ambiente: "homologacao",
    cnpj: "01997929000108",
    accessKey: "41260601997929000108650020000000841689972490",
    authorizationProtocol: "141260001354073",
    justification: "Erro de preenchimento nos dados da venda",
    eventDate: new Date("2026-06-11T13:00:00.000Z"),
    batchId: "123456789012345",
    ...certificate
  });

  assert.match(result.requestXml, /<tpEvento>110111<\/tpEvento>/);
  assert.match(result.requestXml, /<nProt>141260001354073<\/nProt>/);
  assert.match(result.signedEventXml, /<Signature xmlns="http:\/\/www.w3.org\/2000\/09\/xmldsig#">/);
  assert.match(result.batchXml, /<envEvento/);
  assert.match(result.batchXml, /<idLote>123456789012345<\/idLote>/);
});

test("interpreta cancelamento homologado pela SEFAZ", () => {
  const signed = {
    eventId: "ID1101114126060199792900010865002000000084168997249001",
    batchId: "123456789012345",
    requestXml: "<evento />",
    signedEventXml:
      '<evento xmlns="http://www.portalfiscal.inf.br/nfe"><infEvento Id="ID1" /></evento>',
    batchXml: "<envEvento />"
  };
  const responseXml =
    `<?xml version="1.0"?>` +
    `<retEnvEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">` +
    `<idLote>123456789012345</idLote><tpAmb>2</tpAmb>` +
    `<verAplic>PR-v4</verAplic><cOrgao>41</cOrgao>` +
    `<cStat>128</cStat><xMotivo>Lote de Evento Processado</xMotivo>` +
    `<retEvento versao="1.00"><infEvento>` +
    `<tpAmb>2</tpAmb><verAplic>PR-v4</verAplic><cOrgao>41</cOrgao>` +
    `<cStat>135</cStat><xMotivo>Evento registrado e vinculado a NF-e</xMotivo>` +
    `<chNFe>41260601997929000108650020000000841689972490</chNFe>` +
    `<tpEvento>110111</tpEvento><nSeqEvento>1</nSeqEvento>` +
    `<dhRegEvento>2026-06-11T10:00:00-03:00</dhRegEvento>` +
    `<nProt>141260001400000</nProt>` +
    `</infEvento></retEvento></retEnvEvento>`;

  const parsed = parseCancellationResponse(
    responseXml,
    {
      ambiente: "homologacao",
      uf: "PR",
      endpoint: "https://sefaz.test/evento",
      httpStatus: 200
    },
    signed
  );

  assert.equal(parsed.batchStatusCode, "128");
  assert.equal(parsed.statusCode, "135");
  assert.equal(parsed.protocol, "141260001400000");
  assert.match(parsed.processedEventXml, /<procEventoNFe/);
});
