import assert from "node:assert/strict";
import test from "node:test";
import tls from "node:tls";

import forge from "node-forge";

import { buildCertificateTlsOptions } from "./certificates.js";

// Synthetic material only: no customer certificate or password is stored here.
const password = "synthetic-pfx-password";
const keys = forge.pki.rsa.generateKeyPair(2048);
const certificate = forge.pki.createCertificate();
certificate.publicKey = keys.publicKey;
certificate.serialNumber = "01";
certificate.validity.notBefore = new Date("2026-01-01T00:00:00Z");
certificate.validity.notAfter = new Date("2030-01-01T00:00:00Z");
certificate.setSubject([{ name: "commonName", value: "synthetic.test" }]);
certificate.setIssuer(certificate.subject.attributes);
certificate.sign(keys.privateKey, forge.md.sha256.create());
const pfx = Buffer.from(
  forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(keys.privateKey, [certificate], password, {
    algorithm: "aes256"
  })).getBytes(),
  "binary"
);

test("preserves the original PFX options when OpenSSL accepts the certificate", () => {
  const options = buildCertificateTlsOptions(pfx, password);
  assert.equal(options.pfx, pfx);
  assert.equal(options.passphrase, password);
  assert.doesNotThrow(() => tls.createSecureContext(options));
});

test("recovers usable TLS credentials from a PFX rejected for PKCS12 compatibility", (t) => {
  const rejected = t.mock.method(tls, "createSecureContext", () => {
    throw new Error("Unsupported PKCS12 PFX data");
  });
  const options = buildCertificateTlsOptions(pfx, password);
  rejected.mock.restore();

  assert.equal(options.pfx, undefined);
  assert.equal(options.passphrase, undefined);
  assert.match(options.key ?? "", /BEGIN RSA PRIVATE KEY/);
  assert.match(options.cert ?? "", /BEGIN CERTIFICATE/);
  assert.doesNotThrow(() => tls.createSecureContext(options));
});

test("keeps errors unrelated to PKCS12 compatibility visible to the caller", (t) => {
  const originalError = new Error("mac verify failure");
  t.mock.method(tls, "createSecureContext", () => { throw originalError; });
  assert.throws(() => buildCertificateTlsOptions(pfx, "wrong-password"), (error) => error === originalError);
});
