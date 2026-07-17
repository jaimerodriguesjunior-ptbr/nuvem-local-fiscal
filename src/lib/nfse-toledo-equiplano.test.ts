import assert from "node:assert/strict";
import test from "node:test";

import {
  allowsLegacyEquiplanoHomologationTls,
  buildCancelarNfseXml,
  hasToledoMunicipalReceipt,
  toToledoIssueDateTime
} from "./nfse-toledo-equiplano.js";

test("requires a Toledo municipal receipt before keeping an NFS-e processing", () => {
  assert.equal(hasToledoMunicipalReceipt({}), false);
  assert.equal(hasToledoMunicipalReceipt({ nrRps: "15" }), false);
  assert.equal(hasToledoMunicipalReceipt({ nrLote: "17" }), true);
  assert.equal(hasToledoMunicipalReceipt({ protocolo: "123" }), true);
  assert.equal(hasToledoMunicipalReceipt({ nrNfse: "9" }), true);
});

test("allows incomplete TLS chain only for Equiplano homologation", () => {
  assert.equal(
    allowsLegacyEquiplanoHomologationTls(
      new URL("https://www.esnfs.com.br:9443//homologacaows/services/Enfs")
    ),
    true
  );
  assert.equal(
    allowsLegacyEquiplanoHomologationTls(
      new URL("https://www.esnfs.com.br:9443/producao/services/Enfs")
    ),
    false
  );
  assert.equal(
    allowsLegacyEquiplanoHomologationTls(
      new URL("https://example.com:9443/homologacaows/services/Enfs")
    ),
    false
  );
  assert.equal(
    allowsLegacyEquiplanoHomologationTls(
      new URL("http://www.esnfs.com.br:9443/homologacaows/services/Enfs")
    ),
    false
  );
});

test("formats Toledo RPS issue date in Sao Paulo time", () => {
  const now = new Date("2026-07-02T12:34:56-03:00");

  assert.equal(
    toToledoIssueDateTime("2026-07-01T22:04:45-03:00", now),
    "2026-07-01T22:04:45"
  );
  assert.equal(
    toToledoIssueDateTime("2026-07-02T01:04:45.000Z", now),
    "2026-07-01T22:04:45"
  );
});

test("builds Toledo NFSe cancellation XML with municipal number", () => {
  const xml = buildCancelarNfseXml({
    settings: {
      cnpj: "13167722000187",
      inscricaoMunicipal: "972184",
      idEntidade: "136"
    } as never,
    nfseNumber: "7",
    reason: "Cancelamento de teste em homologacao"
  });

  assert.match(xml, /esCancelarNfseEnvio/);
  assert.match(xml, /<nrInscricaoMunicipal>972184<\/nrInscricaoMunicipal>/);
  assert.match(xml, /<cnpj>13167722000187<\/cnpj>/);
  assert.match(xml, /<idEntidade>136<\/idEntidade>/);
  assert.match(xml, /<nrNfse>7<\/nrNfse>/);
  assert.match(
    xml,
    /<dsMotivoCancelamento>Cancelamento de teste em homologacao<\/dsMotivoCancelamento>/
  );
});

test("toToledoIssueDateTime limita data futura ao dia atual de Sao Paulo", () => {
  const issuedAt = toToledoIssueDateTime(
    "2026-07-03T08:00:00-03:00",
    new Date("2026-07-02T12:34:56-03:00")
  );

  assert.equal(issuedAt, "2026-07-02T12:34:56");
});

test("toToledoIssueDateTime preserva data passada", () => {
  const issuedAt = toToledoIssueDateTime(
    "2026-07-01T08:00:00-03:00",
    new Date("2026-07-02T12:34:56-03:00")
  );

  assert.equal(issuedAt, "2026-07-01T08:00:00");
});
