import assert from "node:assert/strict";
import test from "node:test";

import {
  getNfseRuleProfile,
  resolveNfseProvider,
  validateNfseConfigDraft,
  validateNfseRuntimePolicy
} from "./nfse-rules.js";

test("resolves supported NFS-e providers by municipality or explicit alias", () => {
  assert.equal(resolveNfseProvider({ municipalityCode: "4108809" }), "guaira-ipm");
  assert.equal(resolveNfseProvider({ municipalityCode: "4127700" }), "toledo-equiplano");
  assert.equal(resolveNfseProvider({ provider: "IPM Atende.Net" }), "guaira-ipm");
  assert.equal(resolveNfseProvider({ provider: "Equiplano Toledo" }), "toledo-equiplano");
});

test("rejects provider and municipality mismatch before saving municipal config", () => {
  const result = validateNfseConfigDraft({
    cnpj: "35181069000143",
    ambiente: "homologacao",
    provider: "guaira-ipm",
    municipalityCode: "4127700",
    login: "usuario",
    hasPassword: true,
    settings: {}
  });

  assert.equal(result.provider, "guaira-ipm");
  assert.match(result.errors.join(" "), /4127700/);
  assert.match(result.errors.join(" "), /toledo-equiplano/);
});

test("captures municipal credentials and profile-specific required settings", () => {
  const profile = getNfseRuleProfile("toledo-equiplano");
  const result = validateNfseConfigDraft({
    cnpj: "35181069000143",
    ambiente: "homologacao",
    provider: "toledo-equiplano",
    municipalityCode: "4127700",
    login: "970339",
    hasPassword: true,
    settings: {
      nfseEndpoint: profile?.defaults.endpoint,
      nfseInscricaoMunicipal: "970339",
      nfseRpsEmissor: "1",
      nfseDefaultServiceCode: "17.19.01.000",
      nfseDefaultAliquotaIss: 3
    }
  });

  assert.equal(result.errors.length, 0);
});

test("keeps production municipal transmission blocked by provider profile", () => {
  assert.deepEqual(
    validateNfseRuntimePolicy({
      provider: "guaira-ipm",
      ambiente: "homologacao",
      operation: "emissao"
    }),
    { allowed: true, reason: null }
  );

  const blocked = validateNfseRuntimePolicy({
    provider: "guaira-ipm",
    ambiente: "producao",
    operation: "emissao"
  });
  assert.equal(blocked.allowed, false);
  assert.match(blocked.reason ?? "", /producao/);
});
