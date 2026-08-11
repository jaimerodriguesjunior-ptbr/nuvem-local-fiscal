import type { InMemoryStore } from "../store.js";
import type { DocumentRecord } from "../types.js";
import {
  cancelGuairaIpmNfse,
  consultGuairaIpmNfse,
  isGuairaIpmConfig,
  processGuairaIpmNfse,
  transmitGuairaIpmTest
} from "./nfse-guaira-ipm.js";
import {
  cancelToledoNfse,
  consultToledoNfse,
  isToledoNfseConfig,
  processToledoNfse
} from "./nfse-toledo-equiplano.js";
import {
  cancelNationalNfse,
  consultNationalNfse,
  isNationalNfseConfig,
  processNationalNfse,
  transmitPreparedNationalDps
} from "./nfse-national.js";

export type NfseProviderResult = {
  document: DocumentRecord;
  transmitted: boolean;
  error: string | null;
};

function providerContext(store: InMemoryStore, document: DocumentRecord) {
  return {
    issuer: store.findIssuerByCnpj(document.issuerCnpj, document.ambiente),
    serviceConfig: store.findServiceConfigRecord(
      document.issuerCnpj,
      document.ambiente,
      "NFSE"
    )
  };
}

export function configuredNfseProvider(
  store: InMemoryStore,
  document: DocumentRecord
) {
  const { issuer, serviceConfig } = providerContext(store, document);
  if (isGuairaIpmConfig(issuer, serviceConfig)) return "guaira-ipm";
  if (isToledoNfseConfig(issuer, serviceConfig)) return "toledo-equiplano";
  if (isNationalNfseConfig(issuer, serviceConfig)) return "nfse-nacional";
  return null;
}

export async function processConfiguredNfse(
  store: InMemoryStore,
  documentId: string
): Promise<NfseProviderResult> {
  const document = store.findDocument(documentId, "NFSe");
  if (!document) {
    throw new Error("Documento NFS-e nao encontrado para processamento.");
  }
  const provider = configuredNfseProvider(store, document);
  if (provider === "guaira-ipm") return processGuairaIpmNfse(store, documentId);
  if (provider === "toledo-equiplano") return processToledoNfse(store, documentId);
  if (provider === "nfse-nacional") return processNationalNfse(store, documentId);

  const message = "Provedor NFS-e nao configurado para este emitente.";
  const failed = store.failDocument(document.id, "CONFIGURACAO_NFSE", message);
  await store.waitForPersistence();
  return { document: failed ?? document, transmitted: false, error: message };
}

export async function consultConfiguredNfse(
  store: InMemoryStore,
  documentId: string
): Promise<NfseProviderResult> {
  const document = store.findDocument(documentId, "NFSe");
  if (!document) {
    throw new Error("Documento NFS-e nao encontrado para consulta.");
  }
  // Consultas pertencem ao conector que gerou o documento, mesmo quando a
  // empresa ja voltou para o provedor municipal ou trocou de contingencia.
  const provider = document.providerName ?? configuredNfseProvider(store, document);
  if (provider === "guaira-ipm") return consultGuairaIpmNfse(store, documentId);
  if (provider === "toledo-equiplano") return consultToledoNfse(store, documentId);
  if (provider === "nfse-nacional") return consultNationalNfse(store, documentId);
  return { document, transmitted: false, error: null };
}

export async function transmitConfiguredNfseTest(
  store: InMemoryStore,
  documentId: string
): Promise<NfseProviderResult> {
  const document = store.findDocument(documentId, "NFSe");
  if (!document) {
    throw new Error("Documento NFS-e nao encontrado para transmissao.");
  }
  const provider = configuredNfseProvider(store, document);
  if (provider === "guaira-ipm") {
    return transmitGuairaIpmTest(store, documentId);
  }
  throw new Error("Transmissao manual de teste disponivel somente para Guaira/IPM.");
}

export async function transmitConfiguredNationalNfseHomologation(
  store: InMemoryStore,
  documentId: string
): Promise<NfseProviderResult> {
  const document = store.findDocument(documentId, "NFSe");
  if (!document) {
    throw new Error("Documento NFS-e nao encontrado para transmissao.");
  }
  const provider = configuredNfseProvider(store, document);
  if (provider !== "nfse-nacional") {
    throw new Error("Esta rota manual e exclusiva para DPS do Sistema Nacional NFS-e.");
  }
  return transmitPreparedNationalDps(store, documentId);
}

export async function cancelConfiguredNfse(
  store: InMemoryStore,
  documentId: string,
  reason: string,
  reasonCode: unknown = "9"
): Promise<NfseProviderResult> {
  const document = store.findDocument(documentId, "NFSe");
  if (!document) {
    throw new Error("Documento NFS-e nao encontrado para cancelamento.");
  }
  const provider = document.providerName ?? configuredNfseProvider(store, document);
  if (provider === "toledo-equiplano") {
    return cancelToledoNfse(store, documentId, reason);
  }
  if (provider === "guaira-ipm") {
    return cancelGuairaIpmNfse(store, documentId, reason);
  }
  if (provider === "nfse-nacional") {
    return cancelNationalNfse(store, documentId, reason, reasonCode);
  }
  throw new Error("Provedor NFS-e nao configurado para este emitente.");
}
