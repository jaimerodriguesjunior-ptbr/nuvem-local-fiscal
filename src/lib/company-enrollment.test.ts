import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import forge from "node-forge";
import { InMemoryStore } from "../store.js";
import { registerDocumentRoutes } from "../routes/documents.js";
import { config } from "../config.js";
import { prepareEnrollment, type EnrollmentState } from "./company-enrollment.js";
import { parsePfx, decryptCertificateBundle } from "./certificates.js";
import { certificateHolderCnpj } from "./certificate-holder-cnpj.js";
import type { SupabasePersistence } from "./supabase-persistence.js";

const cnpj = "11222333000181", password = "synthetic-password";
const requestId = "00000000-0000-4000-a000-000000000001";
const rootKeys = forge.pki.rsa.generateKeyPair(2048), keys = forge.pki.rsa.generateKeyPair(2048);
const root = forge.pki.createCertificate();
root.publicKey = rootKeys.publicKey; root.serialNumber = "01";
root.validity.notBefore = new Date(Date.now()-86400000); root.validity.notAfter = new Date(Date.now()+86400000*30);
root.setSubject([{ name: "commonName", value: "Synthetic TEST CA - never deploy" }]); root.setIssuer(root.subject.attributes);
root.setExtensions([{ name: "basicConstraints", cA: true }, { name: "keyUsage", keyCertSign: true, cRLSign: true }]);
root.sign(rootKeys.privateKey, forge.md.sha256.create());
const trust = forge.pki.certificateToPem(root);
function material(options: { holder?: string; expired?: boolean; selfSigned?: boolean; wrongKey?: boolean; rootFirst?: boolean; ca?: boolean; future?: boolean } = {}) {
  const cert = forge.pki.createCertificate(); cert.publicKey = keys.publicKey; cert.serialNumber = "02";
  cert.validity.notBefore = new Date(Date.now()+(options.future ? 86400000 : -86400000));
  cert.validity.notAfter = new Date(Date.now()+(options.expired ? -60000 : 86400000*2));
  cert.setSubject([{ name: "commonName", value: "Synthetic" }, { type: "2.16.76.1.3.3", value: options.holder ?? cnpj }]);
  cert.setIssuer(options.selfSigned ? cert.subject.attributes : root.subject.attributes);
  cert.setExtensions([{ name: "basicConstraints", cA: !!options.ca }, { name: "keyUsage", digitalSignature: true }]);
  cert.sign(options.selfSigned ? keys.privateKey : rootKeys.privateKey, forge.md.sha256.create());
  const chain = options.rootFirst ? [root,cert] : [cert,root];
  const pfx = forge.pkcs12.toPkcs12Asn1(options.wrongKey ? forge.pki.rsa.generateKeyPair(1024).privateKey : keys.privateKey, chain, password, { algorithm: "3des" });
  return { pem: forge.pki.certificateToPem(cert), base64: Buffer.from(forge.asn1.toDer(pfx).getBytes(), "binary").toString("base64") };
}
const valid = material();
function body(pfx = valid.base64) { return { request_id: requestId, externalCompanyId: "tenant:store",
  empresa: { cnpj, razao_social: "Empresa sintética", codigo_municipio_ibge: "4108809", uf: "PR",
    regime_tributario: "1", logradouro: "Rua Teste", numero: "1", bairro: "Centro", cidade: "Teste", cep: "85880000" },
  ambientes: ["homologacao","producao"], pfxBase64: pfx, password, fileName: "synthetic.pfx" }; }
const prepare = (data: unknown = body(), roots = trust) => prepareEnrollment(data,"client-test","2026-01-01T00:00:00.000Z",["homologacao","producao"],"synthetic-encryption",roots);

test("trusted chain, matching key and CNPJ produce encrypted, stable enrollment identity", () => {
  const a = prepare(), b = prepare();
  assert.equal(a.fingerprint,b.fingerprint); assert.notEqual(a.certificate.encryptedBundle,b.certificate.encryptedBundle);
  assert.equal(decryptCertificateBundle(a.certificate.encryptedBundle,"synthetic-encryption").password,password);
  assert.equal(a.company.cnpj,cnpj);
});
for (const scenario of ["selfSigned","expired","future","wrongKey","ca","foreignCnpj","wrongPassword","noTrust","malformed","invalidCnpj","missingAddress","invalidEnvironment"] as const) {
  test(`rejects ${scenario} before persistence`, () => {
    let data: any = body();
    if (["selfSigned","expired","future","wrongKey","ca"].includes(scenario)) data = body(material({ [scenario]: true }).base64);
    if (scenario === "foreignCnpj") data = body(material({ holder: "98765432000198" }).base64);
    if (scenario === "wrongPassword") data.password = "wrong";
    if (scenario === "malformed") data = null;
    if (scenario === "invalidCnpj") data.empresa.cnpj = "11222333000182";
    if (scenario === "missingAddress") data.empresa.logradouro = "";
    if (scenario === "invalidEnvironment") data.ambientes = ["invalid"];
    assert.throws(() => prepare(data, scenario === "noTrust" ? "" : trust));
  });
}
test("selects leaf matching private key even when CA comes first in PFX", () => {
  const data = material({ rootFirst:true });
  assert.equal(certificateHolderCnpj(parsePfx(Buffer.from(data.base64,"base64"),password).certificatePem),cnpj);
  assert.equal(prepare(body(data.base64)).company.cnpj,cnpj);
});

test("rejects ambiguous CNPJ attributes and reads ICP-Brasil SAN", () => {
  const cert = forge.pki.certificateFromPem(valid.pem);
  cert.setSubject([{ name:"commonName",value:`Synthetic:98765432000198` },{type:"2.16.76.1.3.3",value:cnpj}]);
  cert.sign(rootKeys.privateKey,forge.md.sha256.create());
  assert.equal(certificateHolderCnpj(forge.pki.certificateToPem(cert)),null);
  cert.setSubject([{name:"commonName",value:"Synthetic SAN"}]);
  const asn=forge.asn1;
  const otherName=asn.create(asn.Class.CONTEXT_SPECIFIC,0,true,[
    asn.create(asn.Class.UNIVERSAL,asn.Type.OID,false,asn.oidToDer("2.16.76.1.3.3").getBytes()),
    asn.create(asn.Class.CONTEXT_SPECIFIC,0,true,[asn.create(asn.Class.UNIVERSAL,asn.Type.UTF8,false,cnpj)]),
  ]);
  cert.setExtensions([{id:"2.5.29.17",value:asn.toDer(asn.create(asn.Class.UNIVERSAL,asn.Type.SEQUENCE,true,[otherName])).getBytes()}]);
  cert.sign(rootKeys.privateKey,forge.md.sha256.create());
  assert.equal(certificateHolderCnpj(forge.pki.certificateToPem(cert)),cnpj);
});

test("HTTP enrollment preserves old tokens, hydrates only committed state and conceals secrets", async () => {
  const dir = mkdtempSync(join(tmpdir(),"nlf-enrollment-"));
  const priorTrust = config.enrollmentTrustFile;
  config.enrollmentTrustFile = join(dir,"trust.pem"); writeFileSync(config.enrollmentTrustFile,trust);
  const store = new InMemoryStore("seed-client","secret","test-jwt",join(dir,"state.json"));
  const client = store.upsertApiClient({ name:"Test", clientId:"client-test",clientSecret:"secret",
    allowedScopes:["empresa","empresa-cadastro","nfce"],allowedEnvironments:["homologacao","producao"],allowedCnpjs:["01997929000108"],active:true });
  const token = store.createAccessToken(client.clientId,client.allowedScopes,client.allowedEnvironments,client.allowedCnpjs,client.updatedAt).token;
  let committed: EnrollmentState | null = null, fail = true;
  const persistence = { companyEnrollment: async (_c: string,_v: string,_r: string,input: ReturnType<typeof prepare> | null) => {
    if (!input) return committed;
    if (fail) throw new Error("synthetic persistence failure with secret that must not leak");
    committed = { receipt:{ success:true,request_id:input.requestId,cnpj,ambientes:input.environments,fingerprint:input.fingerprint },
      client:{ ...client,updatedAt:client.updatedAt.replace('Z','+00:00'),allowedCnpjs:[...client.allowedCnpjs,cnpj] },
      issuers:input.environments.map(ambiente=>({ id:`issuer-${ambiente}`,cnpj,razaoSocial:"Test",nomeFantasia:"Test",ambiente,uf:"PR",ie:"",crt:"1",serieNfe:1,serieNfce:1,ativo:true })),
      certificate:{ id:"cert-test",issuerId:"issuer-homologacao",cnpj,uploadedAt:new Date().toISOString(),active:true,...input.certificate } };
    return committed;
  } } as unknown as SupabasePersistence;
  Object.assign(store,{ persistence });
  const app = Fastify({ logger:false }); app.decorate("store",store); await app.register(registerDocumentRoutes);
  const headers = { authorization:`Bearer ${token}` };
  try {
    let response = await app.inject({ method:"POST",url:"/empresas/cadastro-certificado",headers,payload:body() });
    assert.equal(response.statusCode,503); assert.equal(response.body.includes("synthetic persistence"),false);
    assert.equal(store.findIssuerByCnpj(cnpj),null); assert.equal(store.findActiveCertificate(cnpj),null);
    fail = false;
    response = await app.inject({ method:"POST",url:"/empresas/cadastro-certificado",headers,payload:body() });
    assert.equal(response.statusCode,201,response.body); assert.equal(response.body.includes(password),false);
    assert.equal(response.body.includes("encryptedBundle"),false); assert.ok(store.findIssuerByCnpj(cnpj));
    assert.ok(store.findToken(token)); assert.deepEqual(store.findToken(token)?.allowedCnpjs,["01997929000108"]);
    const lookup = await app.inject({ method:"GET",url:`/empresas/cadastro-certificado/${requestId}`,headers });
    assert.equal(lookup.statusCode,200,lookup.body); assert.equal(lookup.json().request_id,requestId);
    const restricted = store.createAccessToken(client.clientId,["empresa"],client.allowedEnvironments,[],client.updatedAt).token;
    const denied = await app.inject({ method:"POST",url:"/empresas/cadastro-certificado",headers:{ authorization:`Bearer ${restricted}` },payload:body() });
    assert.equal(denied.statusCode,403);
  } finally { await app.close(); config.enrollmentTrustFile=priorTrust; rmSync(dir,{recursive:true,force:true}); }
});
