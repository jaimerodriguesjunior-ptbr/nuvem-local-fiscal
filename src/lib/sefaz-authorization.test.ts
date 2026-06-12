import assert from "node:assert/strict";
import test from "node:test";

import { DOMParser } from "@xmldom/xmldom";

import {
  buildAuthorizationBatch,
  getSefazEndpoint,
  parseAuthorizationResponse,
  parseDocumentStatusResponse
} from "./sefaz-authorization.js";

const signedXml =
  `<?xml version="1.0" encoding="UTF-8"?>` +
  `<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe123" versao="4.00"/></NFe>`;

test("recovers an authorized processed XML from key consultation", () => {
  const responseXml = `<?xml version="1.0"?>
    <soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
      <soap:Body>
        <retConsSitNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
          <tpAmb>2</tpAmb>
          <cStat>100</cStat>
          <xMotivo>Autorizado o uso da NF-e</xMotivo>
          <chNFe>41260601997929000108550010000000281750678756</chNFe>
          <protNFe versao="4.00">
            <infProt>
              <tpAmb>2</tpAmb>
              <chNFe>41260601997929000108550010000000281750678756</chNFe>
              <nProt>141260000346001</nProt>
              <cStat>100</cStat>
              <xMotivo>Autorizado o uso da NF-e</xMotivo>
            </infProt>
          </protNFe>
        </retConsSitNFe>
      </soap:Body>
    </soap:Envelope>`;

  const result = parseDocumentStatusResponse(
    responseXml,
    {
      ambiente: "homologacao",
      uf: "PR",
      documentType: "NFe",
      endpoint: "https://example.test/consulta",
      httpStatus: 200,
      accessKey: "41260601997929000108550010000000281750678756"
    },
    signedXml
  );

  assert.equal(result.protocolCStat, "100");
  assert.equal(result.protocol, "141260000346001");
  assert.match(result.processedXml, /<nfeProc/);
  assert.match(result.processedXml, /<protNFe/);
});

test("builds a synchronous authorization batch", () => {
  const batch = buildAuthorizationBatch(signedXml, "000000000000001");

  assert.match(batch.batchXml, /<idLote>000000000000001<\/idLote>/);
  assert.match(batch.batchXml, /<indSinc>1<\/indSinc>/);
  assert.doesNotMatch(batch.batchXml, /<\?xml[^>]*\?>.*<\?xml/s);
  assert.doesNotMatch(batch.soapEnvelope, /<nfeAutorizacaoLote/);
  assert.equal(
    (batch.soapEnvelope.match(/<\?xml/g) ?? []).length,
    1
  );
  const document = new DOMParser().parseFromString(
    batch.soapEnvelope,
    "application/xml"
  );
  assert.equal(document.getElementsByTagName("parsererror").length, 0);
  assert.equal(
    document.getElementsByTagNameNS("*", "nfeDadosMsg").length,
    1
  );
  assert.equal(document.getElementsByTagNameNS("*", "enviNFe").length, 1);
});

test("uses the NFC-e endpoint for model 65 documents", () => {
  assert.equal(
    getSefazEndpoint({
      uf: "PR",
      documentType: "NFCe",
      ambiente: "homologacao",
      service: "authorization"
    }),
    "https://homologacao.nfce.sefa.pr.gov.br/nfce/NFeAutorizacao4"
  );
});

test("parses an authorized synchronous response", () => {
  const response = `<?xml version="1.0"?>
    <soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
      <soap:Body>
        <nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4">
          <retEnviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
            <tpAmb>2</tpAmb><verAplic>PR-v4</verAplic><cStat>104</cStat>
            <xMotivo>Lote processado</xMotivo><cUF>41</cUF>
            <dhRecbto>2026-06-11T10:00:00-03:00</dhRecbto>
            <protNFe versao="4.00"><infProt>
              <tpAmb>2</tpAmb><verAplic>PR-v4</verAplic>
              <chNFe>41260601997929000108650020000000801001903462</chNFe>
              <dhRecbto>2026-06-11T10:00:00-03:00</dhRecbto>
              <nProt>141260000000001</nProt><digVal>abc</digVal>
              <cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo>
            </infProt></protNFe>
          </retEnviNFe>
        </nfeResultMsg>
      </soap:Body>
    </soap:Envelope>`;

  const result = parseAuthorizationResponse(
    response,
    {
      ambiente: "homologacao",
      uf: "PR",
      endpoint: "https://example.test",
      httpStatus: 200,
      idLote: "000000000000001"
    },
    signedXml
  );

  assert.equal(result.batchCStat, "104");
  assert.equal(result.protocolCStat, "100");
  assert.equal(result.protocol, "141260000000001");
  assert.match(result.processedXml, /<nfeProc/);
});
