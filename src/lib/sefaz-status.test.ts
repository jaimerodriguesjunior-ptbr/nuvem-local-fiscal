import assert from "node:assert/strict";
import test from "node:test";

import {
  buildStatusSoapEnvelope,
  parseStatusSoapResponse
} from "./sefaz-status.js";

test("builds a homologation status request", () => {
  const xml = buildStatusSoapEnvelope("homologacao", "41");

  assert.match(xml, /<tpAmb>2<\/tpAmb>/);
  assert.match(xml, /<cUF>41<\/cUF>/);
  assert.match(xml, /<xServ>STATUS<\/xServ>/);
  assert.match(xml, /nfeStatusServicoNF/);
});

test("parses a SEFAZ status response", () => {
  const response = `<?xml version="1.0"?>
    <soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
      <soap:Body>
        <retConsStatServ xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
          <tpAmb>2</tpAmb>
          <verAplic>PR-v4_9_4</verAplic>
          <cStat>107</cStat>
          <xMotivo>Servico em Operacao</xMotivo>
          <cUF>41</cUF>
          <dhRecbto>2026-06-10T23:30:00-03:00</dhRecbto>
          <tMed>1</tMed>
        </retConsStatServ>
      </soap:Body>
    </soap:Envelope>`;

  const parsed = parseStatusSoapResponse(response, {
    ambiente: "homologacao",
    uf: "PR",
    endpoint: "https://example.test/status",
    statusCode: 200
  });

  assert.equal(parsed.cStat, "107");
  assert.equal(parsed.xMotivo, "Servico em Operacao");
  assert.equal(parsed.cUF, "41");
});
