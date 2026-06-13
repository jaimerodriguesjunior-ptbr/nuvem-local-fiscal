import assert from "node:assert/strict";
import test from "node:test";

import {
  allowsLegacyEquiplanoHomologationTls,
  buildCancelarNfseXml
} from "./nfse-toledo-equiplano.js";

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
