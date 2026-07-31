import assert from "node:assert/strict";
import test from "node:test";

test("contrato HTTP de configuracao, polling e XML de distribuicao NF-e", async () => {
  process.env.STATE_FILE = `./storage/distribution-test-${process.pid}.json`;
  process.env.JWT_SECRET = "distribution-jwt";
  process.env.CERTIFICATE_ENCRYPTION_KEY = "distribution-cert";
  process.env.SUPABASE_URL = "";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "";
  const { buildApp } = await import("./app.js");
  const app = buildApp(); await app.ready();
  try {
    const tokenResponse = await app.inject({ method: "POST", url: "/oauth/token", headers: { "content-type": "application/x-www-form-urlencoded" }, payload: "grant_type=client_credentials&client_id=local-client&client_secret=local-secret&scope=distribuicao-nfe" });
    const bearer = { authorization: `Bearer ${tokenResponse.json().access_token as string}`, "content-type": "application/json" };
    const cnpj = "12345678000195";
    const config = await app.inject({ method: "PUT", url: `/empresas/${cnpj}/distnfe`, headers: bearer, payload: { ambiente: "homologacao", distribuicao_automatica: true, distribuicao_intervalo_horas: 4, ciencia_automatica: true } });
    assert.equal(config.statusCode, 200, config.body);
    assert.deepEqual(config.json(), { ambiente: "homologacao", distribuicao_automatica: true, distribuicao_intervalo_horas: 4, ciencia_automatica: true });
    const created = app.store.createDistribution({ cnpj, ambiente: "homologacao", modo: "cons-chave", nsu: null, chave: "41260712345678000195550010000000011000000010" });
    const document = app.store.addDistributionDocument({ distributionId: created.id, cnpj, ambiente: "homologacao", nsu: "000000000000042", schema: "procNFe_v4.00.xsd", tipoDocumento: "nota", formaDistribuicao: "completa", chave: created.chave, xml: "<nfeProc />" });
    app.store.saveDistributionResult(created.id, { status: "concluido", ultNsu: document.nsu, maxNsu: document.nsu, codigoStatus: "138", motivoStatus: "Documentos localizados" });
    const poll = await app.inject({ method: "GET", url: `/distribuicao/nfe/${created.id}`, headers: bearer });
    assert.equal(poll.statusCode, 200, poll.body); assert.equal(poll.json().status, "concluido"); assert.equal(poll.json().ult_nsu, document.nsu);
    assert.equal(poll.json().documentos_count, 1); assert.equal(poll.json().documentos[0].id, document.id);
    const xml = await app.inject({ method: "GET", url: `/distribuicao/nfe/documentos/${document.id}/xml`, headers: bearer });
    assert.equal(xml.statusCode, 200); assert.equal(xml.body, "<nfeProc />");
    const manifestation = await app.inject({ method: "POST", url: "/distribuicao/nfe/manifestacoes", headers: bearer, payload: { cpf_cnpj: cnpj, ambiente: "homologacao", chave: created.chave, tipo_evento: "210210" } });
    assert.equal(manifestation.statusCode, 202, manifestation.body); assert.ok(manifestation.json().id);
  } finally { await app.close(); }
});
