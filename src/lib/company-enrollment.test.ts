import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, basename } from "node:path";
import Fastify from "fastify";
import forge from "node-forge";
import { InMemoryStore } from "../store.js";
import { registerDocumentRoutes } from "../routes/documents.js";
import { certificateHolderCnpj } from "./certificate-holder-cnpj.js";
import { decryptCertificateBundle } from "./certificates.js";
import { config } from "../config.js";

const cnpj = "11222333000181";
const password = "synthetic-password";
const keys = forge.pki.rsa.generateKeyPair(1024);
function certificate(holder = cnpj, expired = false, withOid = true) {
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "11";
  cert.validity.notBefore = new Date(Date.now() - 86400000);
  cert.validity.notAfter = new Date(Date.now() + (expired ? -60000 : 86400000));
  cert.setSubject(withOid ? [{ name: "commonName", value: "Synthetic" }, { type: "2.16.76.1.3.3", value: holder }]
    : [{ name: "commonName", value: `Synthetic:${holder}` }]);
  cert.setIssuer(cert.subject.attributes);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const pfx = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, { algorithm: "3des" });
  return { pem: forge.pki.certificateToPem(cert), base64: Buffer.from(forge.asn1.toDer(pfx).getBytes(), "binary").toString("base64") };
}
const valid = certificate();

async function setup(scopes = ["empresa", "nfse", "empresa-cadastro"], environments: Array<"homologacao" | "producao"> = ["homologacao", "producao"]) {
  const app = Fastify({ logger: false });
  const directory = mkdtempSync(join(tmpdir(), "nlf-company-enrollment-"));
  app.addHook("onClose", async () => {
    if (resolve(directory).startsWith(resolve(tmpdir())) && basename(directory).startsWith("nlf-company-enrollment-")) rmSync(directory, { recursive: true, force: true });
  });
  const store = new InMemoryStore("seed-client", "synthetic-secret", "test-jwt", join(directory, "state.json"));
  app.decorate("store", store);
  const client = store.upsertApiClient({ name: "NF Toledo test", clientId: "nftoledo-test", clientSecret: "synthetic-secret",
    allowedScopes: scopes, allowedEnvironments: environments, allowedCnpjs: [], active: true });
  const token = store.createAccessToken(client.clientId, scopes, environments, [], client.updatedAt).token;
  await app.register(registerDocumentRoutes);
  return { app, store, client, bearer: { authorization: `Bearer ${token}` } };
}
function body(pfxBase64 = valid.base64) {
  return { empresa: { cnpj, razao_social: "Empresa sintética", codigo_municipio_ibge: "4108809", uf: "PR" },
    ambientes: ["homologacao", "producao"], externalCompanyId: "org-test", pfxBase64, password, fileName: "synthetic.pfx" };
}

test("cadastra novo CNPJ nos ambientes autorizados e guarda A1 cifrado", async () => {
  const { app, store, client, bearer } = await setup();
  try {
    const other = store.upsertApiClient({ name: "Outro programa", clientId: "other-program", clientSecret: "synthetic-other-secret",
      allowedScopes: ["empresa"], allowedEnvironments: ["homologacao"], allowedCnpjs: [], active: true });
    const result = await app.inject({ method: "POST", url: "/empresas/cadastro-certificado", headers: bearer, payload: body() });
    assert.equal(result.statusCode, 201, result.body);
    assert.equal(store.issuers.filter(i => i.cnpj === cnpj).length, 2);
    assert.equal(store.findIssuerByCnpj(cnpj)?.metadata?.registeredByIntegration, client.clientId);
    assert.equal(store.findIssuerByCnpj(cnpj)?.metadata?.externalCompanyId, "org-test");
    assert.deepEqual(store.apiClients.find(c => c.id === client.id)?.allowedCnpjs, [cnpj]);
    assert.deepEqual(other.allowedCnpjs, []);
    const saved = store.findActiveCertificate(cnpj)!;
    assert.ok(saved.encryptedBundle);
    assert.equal(decryptCertificateBundle(saved.encryptedBundle!, config.certificateEncryptionKey).password, password);
    assert.equal(result.body.includes(password), false);
    assert.equal(result.body.includes(valid.base64), false);
    const otherClient = store.apiClients.find(c => c.clientId === "seed-client");
    assert.ok(otherClient);
  } finally { await app.close(); }
});

for (const scenario of ["sem-permissao", "senha-incorreta", "outro-cnpj", "vencido", "ambiente-nao-permitido", "cnpj-existente", "sem-token"] as const) {
  test(`cadastro recusado sem alterar certificados ou vincular CNPJ: ${scenario}`, async () => {
    const { app, store, client, bearer } = await setup(scenario === "sem-permissao" ? ["empresa", "nfse"] : undefined,
      scenario === "ambiente-nao-permitido" ? ["homologacao"] : undefined);
    try {
      if (scenario === "cnpj-existente") store.ensureIssuer(cnpj, "homologacao");
      const payload = body(scenario === "outro-cnpj" ? certificate("98765432000198").base64 : scenario === "vencido" ? certificate(cnpj, true).base64 : valid.base64);
      if (scenario === "senha-incorreta") payload.password = "wrong";
      const result = await app.inject({ method: "POST", url: "/empresas/cadastro-certificado", headers: scenario === "sem-token" ? {} : bearer, payload });
      assert.ok(result.statusCode >= 400, result.body);
      assert.equal(store.findActiveCertificate(cnpj), null);
      assert.equal(store.apiClients.find(c => c.id === client.id)?.allowedCnpjs.length, 0);
      assert.equal(store.issuers.filter(i => i.cnpj === cnpj).length, scenario === "cnpj-existente" ? 1 : 0);
    } finally { await app.close(); }
  });
}

test("extrai CNPJ somente do OID ou do sufixo explícito do CN", () => {
  assert.equal(certificateHolderCnpj(valid.pem), cnpj);
  assert.equal(certificateHolderCnpj(certificate(cnpj, false, false).pem), cnpj);
});

test("identifica CNPJ do otherName ICP-Brasil no SAN", () => {
  const cert = forge.pki.certificateFromPem(valid.pem);
  cert.setSubject([{ name: "commonName", value: "Synthetic SAN" }]);
  const asn = forge.asn1;
  const otherName = asn.create(asn.Class.CONTEXT_SPECIFIC, 0, true, [
    asn.create(asn.Class.UNIVERSAL, asn.Type.OID, false, asn.oidToDer("2.16.76.1.3.3").getBytes()),
    asn.create(asn.Class.CONTEXT_SPECIFIC, 0, true, [asn.create(asn.Class.UNIVERSAL, asn.Type.UTF8, false, cnpj)]),
  ]);
  cert.setExtensions([{ id: "2.5.29.17", value: asn.toDer(asn.create(asn.Class.UNIVERSAL, asn.Type.SEQUENCE, true, [otherName])).getBytes() }]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  assert.equal(certificateHolderCnpj(forge.pki.certificateToPem(cert)), cnpj);
});
