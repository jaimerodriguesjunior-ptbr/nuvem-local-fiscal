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
  assert.equal(resolveNfseProvider({ provider: "Sistema Nacional" }), "nfse-nacional");
});

test("allows the national provider for a municipality with a legacy connector", () => {
  const profile = getNfseRuleProfile("nfse-nacional");
  const result = validateNfseConfigDraft({
    cnpj: "35181069000143",
    ambiente: "homologacao",
    provider: "nfse-nacional",
    municipalityCode: "4108809",
    login: "",
    hasPassword: false,
    settings: {
      nfseInscricaoMunicipal: "324743",
      nfseRpsSerie: "1",
      nfseNationalLayoutVersion: "1.01",
      nfseNationalTaxCode: "140101",
      nfseNationalSimpleOption: "3",
      nfseNationalSimpleTaxRegime: "1",
      nfseNationalSpecialTaxRegime: "0",
      nfseNationalIssTaxation: "1",
      nfseNationalIssRetention: "1"
    }
  });

  assert.equal(profile?.ruleSetVersion, "snnfse-prodrest-v1.01-20260727");
  assert.equal(result.provider, "nfse-nacional");
  assert.deepEqual(result.errors, []);
});

test("validates national tax, municipal and optional NBS codes", () => {
  const result = validateNfseConfigDraft({
    cnpj: "35181069000143",
    ambiente: "homologacao",
    provider: "nfse-nacional",
    municipalityCode: "4108809",
    login: "",
    hasPassword: false,
    settings: {
      nfseInscricaoMunicipal: "324743",
      nfseRpsSerie: "90000",
      nfseNationalLayoutVersion: "1.01",
      nfseNationalTaxCode: "1401",
      nfseNationalMunicipalTaxCode: "14",
      nfseNationalNbsCode: "123",
      nfseNationalSimpleOption: "3",
      nfseNationalSpecialTaxRegime: "0",
      nfseNationalIssTaxation: "1",
      nfseNationalIssRetention: "1"
    }
  });

  assert.match(result.errors.join(" "), /tributacao nacional com 6 digitos/);
  assert.match(result.errors.join(" "), /tributacao municipal deve ter 3 digitos/);
  assert.match(result.errors.join(" "), /NBS deve ter 9 digitos/);
  assert.match(result.errors.join(" "), /Serie DPS invalida/);
  assert.match(result.errors.join(" "), /regime de apuracao/);
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
