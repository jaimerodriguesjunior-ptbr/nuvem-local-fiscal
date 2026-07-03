import type { Environment, Issuer, ServiceConfig } from "../types.js";
import { config } from "../config.js";

export type NfseProviderId = "guaira-ipm" | "toledo-equiplano";

export type NfseRuleProfile = {
  provider: NfseProviderId;
  displayName: string;
  municipalityCode: string;
  municipalityName: string;
  ruleSetVersion: string;
  effectiveFrom: string;
  requiresMunicipalLogin: boolean;
  requiresMunicipalPassword: boolean;
  requiresCertificateForTransmission: boolean;
  productionTransmissionEnabled: boolean;
  defaults: {
    endpoint: string;
    serviceCode?: string;
    activityCode?: string;
    issRate?: number;
    taxSituation?: string;
    rpsSeries?: string;
    rpsIssuer?: string;
    requestFormat?: "soap" | "xml";
    soapAction?: string;
    tomCode?: string;
  };
  requiredSettings: Array<keyof ServiceConfig["settings"]>;
};

export type NfseConfigDraft = {
  cnpj: string;
  ambiente: Environment;
  provider: string;
  municipalityCode: string;
  login: string;
  hasPassword: boolean;
  settings: ServiceConfig["settings"];
};

function digitsOnly(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function providerText(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

export const NFSE_RULE_PROFILES: Record<NfseProviderId, NfseRuleProfile> = {
  "guaira-ipm": {
    provider: "guaira-ipm",
    displayName: "Guaira / IPM Atende.Net",
    municipalityCode: "4108809",
    municipalityName: "Guaira",
    ruleSetVersion: "municipal-2026-07-02",
    effectiveFrom: "2026-07-02",
    requiresMunicipalLogin: true,
    requiresMunicipalPassword: true,
    requiresCertificateForTransmission: false,
    productionTransmissionEnabled: false,
    defaults: {
      endpoint:
        "https://guaira.atende.net/atende.php?pg=rest&service=WNERestServiceNFSe&cidade=padrao",
      serviceCode: "140101",
      activityCode: "4520007",
      issRate: 2.01,
      taxSituation: "0",
      rpsSeries: "1",
      tomCode: "7571"
    },
    requiredSettings: [
      "nfseEndpoint",
      "nfseTomCode",
      "nfseEconomicRegistration",
      "nfseDefaultServiceCode",
      "nfseDefaultActivityCode",
      "nfseDefaultTaxSituation",
      "nfseDefaultAliquotaIss"
    ]
  },
  "toledo-equiplano": {
    provider: "toledo-equiplano",
    displayName: "Toledo / Equiplano",
    municipalityCode: "4127700",
    municipalityName: "Toledo",
    ruleSetVersion: "municipal-2026-07-02",
    effectiveFrom: "2026-07-02",
    requiresMunicipalLogin: true,
    requiresMunicipalPassword: true,
    requiresCertificateForTransmission: true,
    productionTransmissionEnabled: false,
    defaults: {
      endpoint: "https://www.esnfs.com.br:9443//homologacaows/services/Enfs",
      serviceCode: "17.19.01.000",
      issRate: 3,
      rpsSeries: "1",
      rpsIssuer: "1",
      requestFormat: "soap",
      soapAction: "http://services.enfsws.es/esRecepcionarLoteRps"
    },
    requiredSettings: [
      "nfseEndpoint",
      "nfseInscricaoMunicipal",
      "nfseIdEntidade",
      "nfseRpsEmissor",
      "nfseDefaultServiceCode",
      "nfseDefaultAliquotaIss"
    ]
  }
};

export function normalizeNfseProvider(value: unknown): NfseProviderId | null {
  const provider = providerText(value);
  if (!provider) return null;
  if (provider.includes("guaira") || provider.includes("ipm") || provider.includes("atende")) {
    return "guaira-ipm";
  }
  if (provider.includes("toledo") || provider.includes("equiplano")) {
    return "toledo-equiplano";
  }
  return null;
}

export function nfseProviderFromMunicipality(value: unknown): NfseProviderId | null {
  const municipalityCode = digitsOnly(value);
  if (municipalityCode === NFSE_RULE_PROFILES["guaira-ipm"].municipalityCode) {
    return "guaira-ipm";
  }
  if (municipalityCode === NFSE_RULE_PROFILES["toledo-equiplano"].municipalityCode) {
    return "toledo-equiplano";
  }
  return null;
}

export function resolveNfseProvider(input: {
  issuer?: Issuer | null;
  serviceConfig?: ServiceConfig | null;
  provider?: unknown;
  municipalityCode?: unknown;
}): NfseProviderId | null {
  const explicitProvider =
    normalizeNfseProvider(input.provider) ??
    normalizeNfseProvider(input.serviceConfig?.settings.nfseProvider);
  if (explicitProvider) return explicitProvider;

  const issuerAddress =
    typeof input.issuer?.metadata?.endereco === "object" &&
    input.issuer.metadata.endereco !== null
      ? (input.issuer.metadata.endereco as Record<string, unknown>)
      : {};
  return nfseProviderFromMunicipality(
    input.municipalityCode ??
      input.serviceConfig?.settings.nfseMunicipalityCode ??
      input.issuer?.metadata?.codigo_municipio ??
      issuerAddress.codigo_municipio
  );
}

export function getNfseRuleProfile(provider: NfseProviderId | null) {
  return provider ? NFSE_RULE_PROFILES[provider] : null;
}

export function assertNfseProviderMunicipalityCompatibility(input: {
  provider: NfseProviderId | null;
  municipalityCode: unknown;
}) {
  const municipalityProvider = nfseProviderFromMunicipality(input.municipalityCode);
  if (input.provider && municipalityProvider && input.provider !== municipalityProvider) {
    return `Municipio ${digitsOnly(input.municipalityCode)} pertence ao provedor ${municipalityProvider}, nao ${input.provider}.`;
  }
  return null;
}

export function validateNfseConfigDraft(draft: NfseConfigDraft) {
  const provider = normalizeNfseProvider(draft.provider);
  const compatibilityError = assertNfseProviderMunicipalityCompatibility({
    provider,
    municipalityCode: draft.municipalityCode
  });
  if (compatibilityError) return { provider, errors: [compatibilityError] };

  const profile = getNfseRuleProfile(provider);
  if (!profile) {
    return { provider, errors: [] };
  }

  const errors: string[] = [];
  if (profile.requiresMunicipalLogin && !draft.login) {
    errors.push(`Informe login da prefeitura para ${profile.displayName}.`);
  }
  if (profile.requiresMunicipalPassword && !draft.hasPassword) {
    errors.push(`Informe senha da prefeitura para ${profile.displayName}.`);
  }

  for (const setting of profile.requiredSettings) {
    const value = draft.settings[setting];
    if (value === undefined || value === null || value === "") {
      errors.push(`Informe ${setting} para ${profile.displayName}.`);
    }
  }

  return { provider, errors };
}

export function validateNfseRuntimePolicy(input: {
  provider: NfseProviderId | null;
  ambiente: Environment;
  operation: "emissao" | "consulta" | "cancelamento";
}) {
  const profile = getNfseRuleProfile(input.provider);
  if (!profile) {
    return { allowed: false, reason: "Provedor NFS-e nao configurado." };
  }
  if (
    input.ambiente === "producao" &&
    !profile.productionTransmissionEnabled &&
    !config.fiscalProductionEnabled
  ) {
    return {
      allowed: false,
      reason: `${profile.displayName} em producao ainda esta bloqueado pelo motor de regras.`
    };
  }
  return { allowed: true, reason: null };
}
