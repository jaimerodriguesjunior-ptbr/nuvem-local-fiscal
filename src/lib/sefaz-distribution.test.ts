import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import test from "node:test";

import { buildDistributionRequest, parseDistributionResponse } from "./sefaz-distribution.js";

test("monta consulta por ultimo NSU e interpreta documentos compactados da SEFAZ", () => {
  const request = buildDistributionRequest({ cnpj: "12345678000195", ambiente: "homologacao", modo: "dist-nsu", nsu: "42" });
  assert.match(request.requestXml, /<ultNSU>000000000000042<\/ultNSU>/);
  assert.match(request.requestXml, /<tpAmb>2<\/tpAmb>/);
  assert.match(request.soapEnvelope, /<nfeDistDFeInteresse[^>]*><nfeDadosMsg>/);
  const documentXml = '<resNFe xmlns="http://www.portalfiscal.inf.br/nfe"><chNFe>41260712345678000195550010000000011000000010</chNFe></resNFe>';
  const zip = gzipSync(Buffer.from(documentXml, "utf8")).toString("base64");
  const result = parseDistributionResponse(`<retDistDFeInt xmlns="http://www.portalfiscal.inf.br/nfe"><tpAmb>2</tpAmb><verAplic>SVRS</verAplic><cStat>138</cStat><xMotivo>Documentos localizados</xMotivo><ultNSU>000000000000042</ultNSU><maxNSU>000000000000042</maxNSU><loteDistDFeInt><docZip NSU="000000000000042" schema="resNFe_v1.01.xsd" compressed="true">${zip}</docZip></loteDistDFeInt></retDistDFeInt>`, request.requestXml);
  assert.equal(result.cStat, "138");
  assert.equal(result.ultNsu, "000000000000042");
  assert.equal(result.documents[0]?.xml, documentXml);
  assert.equal(result.documents[0]?.schema, "resNFe_v1.01.xsd");
});
